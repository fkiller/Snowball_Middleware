import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { PluginHost } from '../packages/plugin-host/dist/index.js';
import { parseManifest } from '../packages/plugin-sdk/dist/index.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = (sha, entrypoint = 'worker.mjs') => ({ id: 'snowball.virtual-device', publisher: 'Snowball development fixture', version: '0.1.0', kind: 'hardware', sdkApiRange: '^1.0.0', entrypoint, platforms: ['win32', 'darwin', 'linux'], architectures: ['x64', 'arm64'], capabilities: [{ operation: 'devices.list', access: 'observe' }, { operation: 'devices.identify', access: 'control' }], permissions: [], configSchema: { type: 'object', properties: {}, additionalProperties: false }, integrity: { entrySha256: sha }, license: 'UNLICENSED' });
const handshake = `import {createInterface} from 'node:readline';
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(r.method==='plugin.initialize')send({jsonrpc:'2.0',id:r.id,result:{apiVersion:'1.0.0',pluginId:'snowball.virtual-device'}});
else if(r.method!=='plugin.cancel'){BODY}});`;
async function fixture(t, body, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snowball-plugin-'));
  const script = handshake.replace('BODY', body);
  await fs.writeFile(path.join(directory, 'worker.mjs'), script);
  const m = manifest(hash(script));
  // Non-timing tests must tolerate process startup under the full suite's load.
  // Deadline behavior is tested separately with an explicit timeout override.
  const host = new PluginHost({ directory, manifest: m, approvedDigests: new Map([[m.id, m.integrity.entrySha256]]), timeoutMs: 2000, restartBackoffMs: 1000, ...options });
  t.after(async () => { await host.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { host, directory, manifest: m };
}

test('manifest rejects incompatible SDK, invalid entry path and duplicate operations; accepted data immutable', () => {
  const m = manifest('a'.repeat(64));
  assert.throws(() => parseManifest({ ...m, sdkApiRange: '^2.0.0' }), /supported/);
  assert.throws(() => parseManifest({ ...m, entrypoint: '../escape.mjs' }), /relative/);
  assert.throws(() => parseManifest({ ...m, capabilities: [...m.capabilities, m.capabilities[0]] }), /duplicate/);
  const parsed = parseManifest(m);
  assert.throws(() => { parsed.capabilities.push({ operation: 'system.exec', access: 'control' }); }, TypeError);
});

test('real virtual plugin handshake/request/event; unlisted operation never dispatched', async t => {
  const directory = path.resolve('packages/device-virtual');
  const m = manifest(hash(await fs.readFile(path.join(directory, 'dist/index.js'))), 'dist/index.js');
  const host = new PluginHost({ directory, manifest: m, approvedDigests: new Map([[m.id, m.integrity.entrySha256]]) });
  t.after(() => host.stop());
  await host.start();
  assert.equal(host.state, 'ready');
  assert.equal((await host.request('devices.list', {}))[0].deviceId, 'virtual-1');
  await assert.rejects(host.request('sessions.send', {}), e => e.code === 'unsupported' && e.delivery === 'not_sent');
  const event = once(host, 'event');
  await host.request('devices.identify', {});
  assert.equal((await event)[0].pluginId, m.id);
});

test('unapproved digest and altered artifact never start', async t => {
  const { host, directory } = await fixture(t, '', { approvedDigests: new Map() });
  await assert.rejects(host.start(), e => e.code === 'untrusted');
  const other = await fixture(t, '');
  await fs.appendFile(path.join(other.directory, 'worker.mjs'), '\n// tampered');
  await assert.rejects(other.host.start(), /integrity mismatch/);
  assert.equal(host.state, 'degraded');
});

test('request timeout retains unknown and late reply does not corrupt next request', async t => {
  // Allow process startup under parallel filesystem/HTTP tests. The late first reply
  // arrives while the second request is pending, rather than after this test exits.
  const { host } = await fixture(t, `setTimeout(()=>send({jsonrpc:'2.0',id:r.id,result:r.params}),r.params.delay);`, { timeoutMs: 1000 });
  await host.start();
  await assert.rejects(host.request('devices.list', { delay: 1250 }), e => e.code === 'timeout' && e.delivery === 'unknown');
  assert.deepEqual(await host.request('devices.list', { delay: 500 }), { delay: 500 });
});

test('cancel before/after dispatch has distinct certainty; outstanding limit enforced', async t => {
  const { host } = await fixture(t, '', { maxPending: 1 });
  await host.start();
  const before = AbortSignal.abort();
  await assert.rejects(host.request('devices.list', {}, before), e => e.delivery === 'not_sent');
  const controller = new AbortController();
  const pending = host.request('devices.list', {}, controller.signal);
  const rejected = assert.rejects(pending, e => e.code === 'cancelled' && e.delivery === 'unknown');
  await assert.rejects(host.request('devices.list', {}), e => e.code === 'limit');
  controller.abort(); await rejected;
});

test('crash rejects pending, cooldown prevents restart, other plugin remains healthy', async t => {
  const { host } = await fixture(t, 'process.exit(7);');
  const healthy = (await fixture(t, `send({jsonrpc:'2.0',id:r.id,result:42});`)).host;
  await Promise.all([host.start(), healthy.start()]);
  await assert.rejects(host.request('devices.list', {}), e => e.delivery === 'unknown');
  assert.equal(host.state, 'degraded');
  await assert.rejects(host.start(), /backoff|Previous process/);
  assert.equal(await healthy.request('devices.list', {}), 42);
});

test('oversized unterminated output is bounded and rejects pending as unknown', async t => {
  const { host } = await fixture(t, `process.stdout.write('x'.repeat(2048));`, { maxFrameBytes: 1024 });
  await host.start();
  await assert.rejects(host.request('devices.list', {}), e => e.code === 'limit' && e.delivery === 'unknown');
  assert.equal(host.state, 'degraded');
});

test('event identity cannot spoof process and event flood degrades plugin', async t => {
  const { host } = await fixture(t, `send({jsonrpc:'2.0',id:r.id,result:true});for(let n=1;n<5;n++)send({jsonrpc:'2.0',method:'plugin.event',params:{sequence:n,event:'device.input',data:{},pluginId:'attacker.spoof',generation:999}});`, { maxEventsPerSecond: 2 });
  await host.start();
  const events = []; host.on('event', event => events.push(event));
  const fault = once(host, 'fault');
  await host.request('devices.list', {});
  await fault;
  assert.equal(events.length, 2);
  assert.equal(events[0].pluginId, 'snowball.virtual-device');
  assert.equal(events[0].generation, 1);
});

test('concurrent start/stop cancels startup without orphan process', async t => {
  const { host } = await fixture(t, '');
  const starting = host.start();
  const rejected = assert.rejects(starting, e => e.code === 'cancelled');
  await host.stop(); await rejected;
  assert.equal(host.state, 'stopped');
});
