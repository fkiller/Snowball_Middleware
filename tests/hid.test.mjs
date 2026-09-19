import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HidDiscovery } from '../packages/device-hid/dist/index.js';
import { PluginHost } from '../packages/plugin-host/dist/index.js';

const profile = { id: 'fixture.buttons', vendorId: 0x1234, productId: 0x5678, selectors: ['win32','darwin'].map(platform => ({ platform, interface: platform === 'win32' ? 2 : -1, usagePage: 0xff00, usage: 1, release: 256 })), report: { length: 3, reportId: 1, buttons: [{ id: 'identify', offset: 1, mask: 1 }, { id: 'cancel', offset: 1, mask: 2 }] }, identificationButton: 'identify' };
const descriptor = (extra = {}) => ({ path: 'device-A', vendorId: 0x1234, productId: 0x5678, interface: 2, usagePage: 0xff00, usage: 1, release: 256, product: 'fixture', ...extra });
const fault = code => error => error.code === code;
class Handle {
  closed = 0; data; error;
  constructor(descriptor) { this.descriptor = descriptor; }
  async info() { return this.descriptor; }
  onData(cb) { this.data = cb; }
  onError(cb) { this.error = cb; }
  async close() { this.closed++; }
  report(...bytes) { this.data(Buffer.from(bytes)); }
}
function fixture(t, rows = [descriptor()], profiles = [profile], platform = 'win32', timeout = 1000) {
  const calls = []; const handles = [];
  const backend = { async enumerate(v,p) { calls.push(['enumerate',v,p]); return rows; }, async open(locator) { calls.push(['open',locator]); const h = new Handle(rows.find(r => r.path === locator)); handles.push(h); return h; } };
  const discovery = new HidDiscovery(backend, profiles, platform, timeout); t.after(() => discovery.close()); return { discovery, backend, calls, handles, rows };
}
async function begin(discovery) { const scan = await discovery.scan(); return discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation); }

test('scoped enumeration matches exact vendor collection/interface/release; keyboard/mouse never opened', async t => {
  for (const platform of ['win32','darwin']) {
    const rows = [descriptor({ interface: platform === 'win32' ? 2 : -1 }), descriptor({ path: 'keyboard', usagePage: 1, usage: 6 }), descriptor({ path: 'mouse', usagePage: 1, usage: 2 }), descriptor({ path: 'wrong-firmware', release: 257 }), descriptor({ path: 'missing-usage', usagePage: undefined })];
    const { discovery, calls } = fixture(t, rows, [profile], platform); const scan = await discovery.scan();
    assert.equal(scan.candidates.length, 1); assert.equal(scan.candidates[0].identity, 'physical_confirmation_required');
    assert.equal(JSON.stringify(scan).includes('device-A'), false); assert.deepEqual(calls, [['enumerate',0x1234,0x5678]]);
  }
  assert.throws(() => new HidDiscovery({}, [{ ...profile, selectors: [{ ...profile.selectors[0], usagePage: 1, usage: 6 }] }]), fault('unsafe_collection'));
});

test('empty supported-profile catalog never loads native HID or probes hardware', async t => {
  const { discovery, calls } = fixture(t, [], []); assert.deepEqual((await discovery.scan()).candidates, []); assert.deepEqual(calls, []);
});

test('duplicates/no serial remain separate and serial is neither exposed nor trusted', async t => {
  const { discovery } = fixture(t, [descriptor({ serialNumber: 'duplicate' }), descriptor({ path: 'device-B', serialNumber: 'duplicate' }), descriptor({ path: 'device-C' })]);
  const scan = await discovery.scan(); assert.equal(scan.candidates.length, 3); assert.equal(new Set(scan.candidates.map(c => c.candidateId)).size, 3);
  assert.deepEqual(scan.candidates.map(c => c.reason), ['duplicate_serial','duplicate_serial','missing_serial']);
  assert.equal(JSON.stringify(scan).includes('"serialNumber"'), false);
});

test('neutral then isolated press/release confirms only selected live handle; safe events have no command authority', async t => {
  const { discovery, handles } = fixture(t); const run = await begin(discovery); const h = handles[0];
  h.report(1,1,0); h.report(1,0,0); assert.throws(() => run.physicalEvidence(), fault('physical_confirmation_required'));
  h.report(1,1,0); h.report(1,3,0); h.report(1,0,0); assert.throws(() => run.physicalEvidence(), fault('physical_confirmation_required'));
  h.report(1,1,0); h.report(1,0,0); assert.equal(run.status().state, 'identified');
  assert.equal(run.physicalEvidence().candidateId, run.candidateId);
  assert.ok(run.drain().every(e => e.testId === run.testId && e.kind === 'button' && !('commandId' in e)));
  await run.close(); assert.equal(h.closed, 1); assert.throws(() => run.physicalEvidence(), fault('physical_confirmation_required'));
});

test('rescan, port/descriptor change and stale generation cannot silently reopen a different device', async t => {
  const { discovery, calls, rows } = fixture(t); const old = await discovery.scan();
  await discovery.scan(); await assert.rejects(discovery.beginSafeTest(old.candidates[0].candidateId, old.generation), fault('stale_candidate'));
  const fresh = await discovery.scan(); rows[0] = descriptor({ path: 'other-port' });
  await assert.rejects(discovery.beginSafeTest(fresh.candidates[0].candidateId, fresh.generation), fault('stale_candidate'));
  assert.ok(!calls.some(c => c[0] === 'open'));
});

test('changed metadata after opening closes the handle before reading any reports', async t => {
  const { discovery, backend } = fixture(t); const h = new Handle(descriptor({ usagePage: 1, usage: 6 })); backend.open = async () => h;
  const scan = await discovery.scan(); await assert.rejects(discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation), fault('stale_candidate'));
  assert.equal(h.closed, 1); assert.equal(h.data, undefined);
});

test('permission/busy/offline errors retain reasons and explicit retry works', async t => {
  const { discovery, backend } = fixture(t); const nativeOpen = backend.open;
  const scan = await discovery.scan();
  for (const [code, reason] of [['EACCES','needs_permission'],['EBUSY','busy'],['ENODEV','offline']]) {
    backend.open = async () => { throw Object.assign(new Error('private path hidden'), { code }); };
    await assert.rejects(discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation), e => e.code === reason && !e.message.includes('private'));
  }
  backend.open = nativeOpen; const run = await discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation); assert.equal(run.isOpen, true);
});

test('cancel/deadline and overlapping scans ignore late native results without multiplying calls', async t => {
  const { discovery, backend, calls } = fixture(t, [descriptor()], [profile], 'win32', 30); let resolve;
  backend.enumerate = () => { calls.push('hung'); return new Promise(r => { resolve = r; }); };
  const first = discovery.scan(); const second = await discovery.scan(); assert.equal(second.status, 'partial'); assert.ok(second.issues.includes('native_busy'));
  assert.equal((await first).status, 'cancelled'); assert.equal(calls.length, 1);
  resolve([descriptor()]); await new Promise(r => setImmediate(r));
  backend.enumerate = async () => [descriptor()]; assert.equal((await discovery.scan()).candidates.length, 1);
});

test('cancelled late open is closed and cannot race a second handle', async t => {
  const { discovery, backend } = fixture(t, [descriptor()], [profile], 'win32', 30); const scan = await discovery.scan();
  let resolve; backend.open = () => new Promise(r => { resolve = r; });
  await assert.rejects(discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation), fault('cancelled'));
  await assert.rejects(discovery.beginSafeTest(scan.candidates[0].candidateId, scan.generation), fault('native_busy'));
  const h = new Handle(descriptor()); resolve(h); await new Promise(r => setImmediate(r)); assert.equal(h.closed, 1); assert.equal(h.data, undefined);
});

test('malformed/flooded input and unplug close safe test, clear stale events, never replay', async t => {
  for (const scenario of ['invalid','flood','unplug']) {
    const { discovery, handles } = fixture(t); const run = await begin(discovery); const h = handles[0];
    if (scenario === 'invalid') h.report(2,0,0);
    if (scenario === 'flood') for (let i=0;i<70;i++) h.report(1,i%2,0);
    if (scenario === 'unplug') h.error(new Error('disconnected'));
    assert.equal(run.isOpen, false); assert.deepEqual(run.drain(), []); assert.equal(h.closed, 1);
  }
});

test('real isolated HID worker starts without profiles and refuses invented physical tests', async t => {
  const directory = path.resolve('packages/device-hid'); const digest = createHash('sha256').update(fs.readFileSync(path.join(directory,'dist/worker.js'))).digest('hex');
  const manifest = { id: 'snowball.hid', publisher: 'Snowball', version: '0.1.0', kind: 'hardware', sdkApiRange: '^1.0.0', entrypoint: 'dist/worker.js', platforms: ['win32','darwin','linux'], architectures: ['x64','arm64'], capabilities: ['devices.scan','devices.beginTest','devices.testStatus','devices.stopTest'].map(operation => ({ operation, access: operation === 'devices.scan' ? 'observe' : 'control' })), permissions: [], configSchema: { type:'object',properties:{},additionalProperties:false }, integrity:{entrySha256:digest},license:'UNLICENSED' };
  const host = new PluginHost({directory,manifest,approvedDigests:new Map([[manifest.id,digest]]),timeoutMs:2000}); t.after(()=>host.stop()); await host.start();
  const result = await host.request('devices.scan',{}); assert.ok(Array.isArray(result.candidates));
  await assert.rejects(host.request('devices.beginTest',{candidateId:'invented',generation:result.generation}),/stale_candidate/);
});
