import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DeviceRegistry, CommandJournal, formatSessionKey } from '../packages/core/dist/index.js';
import { PluginHost } from '../packages/plugin-host/dist/index.js';
import { LocalApi } from '../packages/api/dist/index.js';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
const source = { pluginId: 'snowball.virtual-device', instanceId: 'one' };
const hostId = `host_${'a'.repeat(32)}`;
const sessionKey = n => formatSessionKey({ hostId, harness: { pluginId: 'snowball.test', instanceId: 'one' }, nativeSessionId: `s${n}` });
const observation = (extra = {}) => ({ nativeDeviceId: 'one', label: 'same label', transport: 'virtual', supported: true, capabilities: ['button', 'select-session', 'display'], verifiedIdentity: 'physical-one', ...extra });
const code = value => e => e.code === value;
function register(registry, value = observation()) {
  const generation = registry.beginScan(source); const candidate = registry.observe(source, generation, value); registry.finishScan(source, generation, 'ready');
  return { ...registry.register(candidate.candidateId, generation), generation, candidate };
}

test('zero devices and failed/missing hardware plugins do not block authenticated Web API commands', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-device-api-'));
  const journal = new CommandJournal({ directory, hostId }); const devices = new DeviceRegistry();
  journal.registerSession(sessionKey(1), 'owner-1');
  const api = new LocalApi({ journal, devices }); await api.start();
  t.after(async () => { await api.close(); journal.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const client = new LocalClient(api.origin); await client.bootstrap(api.issueBootstrap().code);
  assert.deepEqual((await client.snapshot()).devices, []);
  const generation = devices.beginScan(source); devices.finishScan(source, generation, 'missing_plugin');
  assert.equal((await client.snapshot()).deviceSources[0].status, 'missing_plugin');
  const result = await client.submit({ commandId: 'web-1', sessionKey: sessionKey(1), ownerId: 'owner-1', expectedRevision: 0, operation: 'sessions.send', payload: { text: 'no hardware required' } });
  assert.equal(result.command.status, 'queued'); assert.equal(journal.listCommands().length, 1);
});

test('candidates have no control rights; unsupported, unpaired and stale scans never become ready', () => {
  const registry = new DeviceRegistry(); let generation = registry.beginScan(source);
  const unsupported = registry.observe(source, generation, observation({ supported: false }));
  assert.throws(() => registry.register(unsupported.candidateId, generation), code('unsupported'));
  const lan = registry.observe(source, generation, observation({ nativeDeviceId: 'network', transport: 'lan', verifiedIdentity: undefined }));
  assert.throws(() => registry.register(lan.candidateId, generation), code('unpaired'));
  assert.deepEqual(registry.list(), []);
  const old = generation; generation = registry.beginScan(source);
  assert.equal(registry.observe(source, old, observation()), undefined);
  registry.finishScan(source, old, 'failed'); assert.equal(registry.sourceStates()[0].status, 'scanning');
  const current = registry.observe(source, generation, observation()); registry.finishScan(source, generation, 'failed');
  assert.throws(() => registry.register(current.candidateId, generation), code('stale_device'));
});

test('restored binding keeps stable identity/context but requires fresh verified connection, rejecting old events', () => {
  const registry = new DeviceRegistry(() => 100); const first = register(registry);
  registry.input(first.binding.deviceId, first.lease, 1, 100, { kind: 'select-session', sessionKey: sessionKey(1) });
  const saved = registry.exportState(); assert.equal(JSON.stringify(saved).includes(first.lease), false);
  const restored = DeviceRegistry.restore(JSON.parse(JSON.stringify(saved)), () => 100);
  assert.equal(restored.list()[0].state, 'offline'); assert.equal(restored.list()[0].selection.sessionKey, sessionKey(1));
  assert.throws(() => restored.input(first.binding.deviceId, first.lease, 2, 100, { kind: 'button', button: 'confirm' }), code('offline'));
  const generation = restored.beginScan(source);
  const wrong = restored.observe(source, generation, observation({ nativeDeviceId: 'new-port', verifiedIdentity: 'different' }));
  assert.throws(() => restored.reconnect(first.binding.deviceId, wrong.candidateId, generation, 0), code('needs_identification'));
  const correct = restored.observe(source, generation, observation({ nativeDeviceId: 'new-port' }));
  const next = restored.reconnect(first.binding.deviceId, correct.candidateId, generation, 0);
  assert.notEqual(next.lease, first.lease); assert.equal(next.binding.controllerId, first.binding.controllerId);
  assert.throws(() => restored.input(first.binding.deviceId, first.lease, 2, 100, { kind: 'button', button: 'confirm' }), code('offline'));
  restored.input(first.binding.deviceId, next.lease, 1, 100, { kind: 'button', button: 'confirm' });
  assert.throws(() => restored.input(first.binding.deviceId, next.lease, 1, 100, { kind: 'button', button: 'confirm' }), code('stale_input'));
  assert.throws(() => restored.input(first.binding.deviceId, next.lease, 2, 5000, { kind: 'button', button: 'confirm' }), code('stale_input'));
  const corrupt = structuredClone(saved); corrupt.bindings.push(corrupt.bindings[0]); corrupt.controllers.push(corrupt.controllers[0]);
  assert.throws(() => DeviceRegistry.restore(corrupt), /Duplicate/);
});

test('unverified HID identity requires physical confirmation again; source failure invalidates only its devices', () => {
  const registry = new DeviceRegistry(); const first = register(registry, observation({ transport: 'hid', verifiedIdentity: undefined }));
  const restored = DeviceRegistry.restore(registry.exportState()); const generation = restored.beginScan(source);
  const candidate = restored.observe(source, generation, observation({ transport: 'hid', verifiedIdentity: undefined }));
  assert.throws(() => restored.reconnect(first.binding.deviceId, candidate.candidateId, generation, 0), code('needs_identification'));
  registry.finishScan(source, first.generation, 'failed'); assert.equal(registry.list()[0].state, 'degraded');
  assert.throws(() => registry.output(first.binding.deviceId, first.lease, first.binding.controllerId, 'old output'), code('offline'));
});

test('real virtual plugin supplies two devices with isolated semantic input and directed output', async t => {
  const directory = path.resolve('packages/device-virtual');
  const sha = createHash('sha256').update(fs.readFileSync(path.join(directory, 'dist/index.js'))).digest('hex');
  const manifest = { id: source.pluginId, publisher: 'Snowball fixture', version: '0.1.0', kind: 'hardware', sdkApiRange: '^1.0.0', entrypoint: 'dist/index.js', platforms: ['win32', 'darwin', 'linux'], architectures: ['x64', 'arm64'], capabilities: ['devices.list', 'devices.simulateInput', 'devices.render'].map(operation => ({ operation, access: operation === 'devices.list' ? 'observe' : 'control' })), permissions: [], configSchema: { type: 'object', properties: {}, additionalProperties: false }, integrity: { entrySha256: sha }, license: 'UNLICENSED' };
  const plugin = new PluginHost({ directory, manifest, approvedDigests: new Map([[manifest.id, sha]]), timeoutMs: 2000 });
  t.after(() => plugin.stop()); await plugin.start();
  const registry = new DeviceRegistry(); const generation = registry.beginScan(source);
  const candidates = (await plugin.request('devices.list', {})).map(raw => registry.observe(source, generation, raw));
  registry.finishScan(source, generation, 'ready'); const devices = candidates.map(c => registry.register(c.candidateId, generation));
  assert.equal(devices.length, 2); assert.notEqual(devices[0].binding.controllerId, devices[1].binding.controllerId);
  for (let i = 0; i < 2; i++) {
    const next = once(plugin, 'event');
    await plugin.request('devices.simulateInput', { deviceId: candidates[i].nativeDeviceId, input: { kind: 'select-session', sessionKey: sessionKey(i) } });
    const [event] = await next; assert.equal(event.pluginId, source.pluginId);
    const selected = candidates.findIndex(c => c.nativeDeviceId === event.data.deviceId);
    registry.input(devices[selected].binding.deviceId, devices[selected].lease, event.sequence, Date.now(), event.data.input);
  }
  for (let i = 0; i < 2; i++) {
    const device = devices[i]; const envelope = registry.output(device.binding.deviceId, device.lease, device.binding.controllerId, `screen-${i}`);
    assert.equal(envelope.selection.sessionKey, sessionKey(i)); assert.equal(envelope.nativeDeviceId, candidates[i].nativeDeviceId);
    const result = await plugin.request('devices.render', { deviceId: envelope.nativeDeviceId, frame: envelope });
    assert.equal(result.frame.selection.sessionKey, sessionKey(i)); assert.equal(result.frame.text, `screen-${i}`);
  }
  assert.throws(() => registry.output(devices[0].binding.deviceId, devices[0].lease, devices[1].binding.controllerId, 'wrong screen'), code('stale_device'));
  registry.disconnect(devices[0].binding.deviceId);
  assert.equal(registry.list()[0].state, 'offline'); assert.equal(registry.list()[1].state, 'ready');
});
