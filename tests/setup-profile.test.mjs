import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseSetupOptions, repositoriesFor, chooseLanAddress, privateIpv4 } from '../scripts/setup-profile.mjs';

test('each installation includes every harness and only the chosen hardware repository', () => {
  const web = repositoriesFor('web');
  assert.deepEqual(web.sort(), ['Snowball_Harness_Antigravity', 'Snowball_Harness_Codex', 'Snowball_Harness_OpenCode', 'Snowball_Middleware']);
  assert.deepEqual(repositoriesFor('mk20').filter(r => !web.includes(r)), ['Snowball_Control']);
  assert.deepEqual(repositoriesFor('m5stack').filter(r => !web.includes(r)), ['Snowball_Device_M5Stack']);
  for (const args of [['--profile', 'other'], ['--port', '80'], ['--port', '65536'], ['--serial'], ['--unknown']]) assert.throws(() => parseSetupOptions(args));
  assert.equal(parseSetupOptions([]).profile,'all');
  assert.deepEqual(repositoriesFor('all'),repositoriesFor(['mk20','m5stack']));
  assert.equal(parseSetupOptions(['--profile', 'm5stack', '--prepare-m5stack','--no-flash']).profile, 'm5stack');
  assert.equal(parseSetupOptions([])['prepare-m5stack'],undefined);
  for(const args of [['--no-flash'],['--serial','COM7'],['--profile','web','--prepare-m5stack']])assert.throws(()=>parseSetupOptions(args));
});

test('LAN selection supports all private ranges and refuses ambiguous or public routing', () => {
  const interfaces = { Ethernet: [{ family: 'IPv4', internal: false, address: '10.8.0.2', netmask: '255.255.255.0' }], Ethernet2: [{ family: 'IPv4', internal: false, address: '172.20.5.2', netmask: '255.255.255.0' }] };
  assert.equal(chooseLanAddress(interfaces, undefined, '172.20.5.12'), '172.20.5.2');
  assert.throws(() => chooseLanAddress(interfaces));
  assert.throws(() => chooseLanAddress(interfaces, '8.8.8.8'));
  assert.equal(privateIpv4('192.168.400.1'), false);
  assert.equal(privateIpv4('127.0.0.1'), false);
});

test('device LAN selection excludes Hyper-V and VPN defaults without hiding real ambiguity', () => {
  const address = value => ({family:'IPv4',internal:false,address:value,netmask:'255.255.255.0'});
  const virtual = {'vEthernet (Default Switch)':[address('172.27.64.1')],Tailscale:[address('10.1.2.3')]};
  assert.equal(chooseLanAddress({...virtual,Ethernet:[address('192.168.1.225')]}),'192.168.1.225');
  assert.throws(()=>chooseLanAddress(virtual));
  assert.throws(()=>chooseLanAddress({...virtual,Ethernet:[address('192.168.1.225')],Ethernet2:[address('10.2.3.4')]}));
  assert.equal(chooseLanAddress(virtual,undefined,'172.27.64.5'),'172.27.64.1');
  assert.equal(chooseLanAddress(virtual,'10.1.2.3'),'10.1.2.3');
});

for (const profile of ['web', 'm5stack']) test(`${profile} native API starts and stops without Control or a hardware/STT process`, { timeout: 120000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-profile-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/start-all.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: { ...process.env, SNOWBALL_PROFILE: profile, SNOWBALL_PORT: String(port), SNOWBALL_CONTROL_ROOT: path.join(temporary, 'absent-control'), SNOWBALL_DATA_DIR: path.join(temporary, 'private-state'), SNOWBALL_SUITE_CONFIG: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exited = once(child, 'exit');
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-8000); });
  t.after(async () => {
    if (child.connected) child.send('snowball.stop');
    const watchdog = setTimeout(() => child.kill(), 5000);
    await exited; clearTimeout(watchdog);
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const deadline = Date.now() + 90000;
  let snapshot;
  while (Date.now() < deadline && child.exitCode === null) {
    try { const response = await fetch(origin + '/v1/snapshot', { headers: { Origin: origin }, signal: AbortSignal.timeout(1000) }); if (response.ok) { snapshot = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(snapshot, 'Real native-session API did not respond: ' + output);
  assert.equal(snapshot.accessMode, 'local-no-auth');
  assert.equal((await fetch(origin + '/')).status, 200);
  if (process.platform !== 'win32') {
    for (const name of ['host.v1.json', 'live-bootstrap.json']) assert.equal(fs.statSync(path.join(temporary, 'private-state', name)).mode & 0o777, 0o600);
    const {ensurePrivateStateDirectory} = await import('../apps/supervisor/private-state.mjs');
    ensurePrivateStateDirectory(path.join(temporary, 'private-state'));
  }
  assert.doesNotMatch(output, /Whisper Runtime|MK20 LAN Hardware|USB Raw HID/);
  child.send('snowball.stop');
  const [code] = await exited;
  assert.equal(code, 0);
});
