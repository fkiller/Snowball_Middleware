import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { diagnoseTailscale, diagnoseTailscaleServe, inspectTailscaleStatus } from '../scripts/diagnose-tailscale.mjs';

test('only bounded facts are returned; local addresses, users and names are never exported', () => {
  const value = { BackendState: 'Running', Self: { Online: true, DNSName: 'private.tailnet.ts.net.', HostName: 'secret-host', TailscaleIPs: ['100.64.1.2'] }, User: { LoginName: 'secret@example.test' } };
  assert.deepEqual(inspectTailscaleStatus(value), { status: 'observed', backendState: 'Running', selfOnline: true, dnsNameReported: true, connection: 'not_tested', serve: 'not_checked', identity: 'not_verified' });
  assert.equal(JSON.stringify(inspectTailscaleStatus(value)).includes('secret'), false);
  assert.deepEqual(inspectTailscaleStatus({ BackendState: 'UnknownFutureState', Self: value.Self }), { status: 'unrecognized' });
  assert.deepEqual(inspectTailscaleStatus(null), { status: 'unrecognized' });
  assert.equal(inspectTailscaleStatus({ BackendState: 'Stopped', Self: { Online: 'yes', DNSName: 'not a dns name' } }).selfOnline, null);
  assert.equal(inspectTailscaleStatus({ BackendState: 'Stopped', Self: { DNSName: 'not a dns name' } }).dnsNameReported, false);
});

test('Serve inspection runs only a bounded read-only status command and does not disclose its snapshot', () => {
  let calls = 0;
  const runner = (_binary, args, options) => {
    calls++;
    assert.deepEqual(args, ['serve', 'status', '--json']);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 256 * 1024);
    assert.equal(options.env.SECRET, undefined);
    return { status: 0, stdout: JSON.stringify({ TCP: { '443': { TCPForward: '127.0.0.1:24123' } }, AllowFunnel: { 'private.tail.ts.net:443': true } }) };
  };
  const ports = { listenPort: 443, backendPort: 24123 };
  const result = diagnoseTailscaleServe(process.execPath, ports, { runner, environment: { SECRET: 'hidden' } });
  assert.deepEqual(result, { status: 'observed', snapshot: 'public', connection: 'not_tested', identity: 'not_verified', backendOwnership: 'not_verified' });
  assert.doesNotMatch(JSON.stringify(result), /private|24123|hidden/);
  assert.deepEqual(diagnoseTailscaleServe(process.execPath, { ...ports, listenPort: 0 }, { runner }), { status: 'invalid_ports' });
  assert.equal(calls, 1);
  assert.deepEqual(diagnoseTailscaleServe(process.execPath, ports, { runner: () => ({ status: 0, stdout: '{"Future":true}' }) }),
    { status: 'observed', snapshot: 'unknown', connection: 'not_tested', identity: 'not_verified', backendOwnership: 'not_verified' });
});

test('explicit CLI invocation uses fixed args, bounded output, timeout and a minimal environment', () => {
  let invoked = false;
  const result = diagnoseTailscale(process.execPath, { environment: { HOME: '/chosen', PATH: '/untrusted', NODE_OPTIONS: '--danger', SECRET: 'never' }, runner: (binary, args, options) => {
    invoked = true;
    assert.equal(binary, fs.realpathSync(process.execPath));
    assert.deepEqual(args, ['status', '--json', '--peers=false']);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 256 * 1024);
    assert.deepEqual(options.env, { HOME: '/chosen', TAILSCALE_BE_CLI: '1' });
    return { status: 0, stdout: JSON.stringify({ BackendState: 'Running' }), stderr: 'private stderr' };
  }});
  assert.equal(invoked, true);
  assert.equal(result.status, 'observed');
  assert.equal(JSON.stringify(result).includes('private stderr'), false);
  assert.deepEqual(diagnoseTailscale('tailscale'), { status: 'invalid_executable' });
  assert.deepEqual(diagnoseTailscale(process.execPath, { runner: () => ({ error: new Error('private data'), status: null }) }), { status: 'unavailable' });
  assert.deepEqual(diagnoseTailscale(process.execPath, { runner: () => ({ status: 0, stdout: 'not json' }) }), { status: 'unrecognized' });
  assert.deepEqual(diagnoseTailscale(process.execPath, { runner: () => ({ status: 0, stdout: 'x'.repeat(256 * 1024 + 1) }) }), { status: 'unavailable' });
});

test('real local CLI is invoked with fixed read-only arguments and errors never print its raw output', { skip: process.platform === 'win32' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-ts-diagnostic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'fake tailscale');
  fs.writeFileSync(executable, '#!/bin/sh\n[ "$1" = status ] && [ "$2" = --json ] && [ "$3" = --peers=false ] || exit 9\nprintf \'{"BackendState":"Running","Self":{"Online":true,"DNSName":"host.tail.ts.net.","Secret":"not-exported"}}\'\n', { mode: 0o700 });
  const script = path.resolve('scripts/diagnose-tailscale.mjs');
  const result = spawnSync(process.execPath, [script, '--executable', executable], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).backendState, 'Running');
  assert.doesNotMatch(result.stdout, /not-exported|host\.tail/);
});

test('real oversized child output is rejected without returning the output or stderr', { skip: process.platform === 'win32' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-ts-output-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'oversized');
  fs.writeFileSync(executable, "#!/bin/sh\nprintf '%0262145d' 0\nprintf 'secret-stderr' >&2\n", { mode: 0o700 });
  const result = diagnoseTailscale(executable);
  assert.deepEqual(result, { status: 'unavailable' });
});
