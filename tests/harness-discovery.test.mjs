import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HarnessDiscovery } from '../packages/core/dist/index.js';
const provider = extra => ({ id: 'example.harness', commandNames: ['harness'], knownPaths: [], ...extra });
const options = { platform: 'darwin', pathValue: '/bin:/tools' };
const missing = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
const fact = canonicalPath => ({ canonicalPath, stamp: '1:2:3:4' });

test('macOS fixtures preserve multiple installs, provenance and manual paths without GUI PATH', async () => {
  const calls = [];
  const scan = new HarnessDiscovery({ async inspect(file) { calls.push(file); return fact(file === '/bin/harness' ? '/opt/harness' : file); } });
  const result = await scan.scan([provider({ knownPaths: ['/opt/harness'], overrides: ['/manual/harness'] })], options);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.find(c => c.locator === '/opt/harness').sources, ['known', 'path']);
  assert.ok(result.candidates.every(c => c.version === null && c.connection === 'unprobed' && !c.controllable));
  assert.deepEqual(calls, ['/manual/harness', '/opt/harness', '/bin/harness', '/tools/harness']);
  const gui = await scan.scan([provider({ overrides: ['/manual/harness'] })], { ...options, pathValue: '' });
  assert.equal(gui.candidates.length, 1);
  gui.candidates[0].sources.push('path'); assert.deepEqual(scan.snapshot().candidates[0].sources, ['override']);
});
test('Windows fixtures ignore relative/empty PATH, preserve CLI/Desktop installs and aggregate exact paths', async () => {
  const calls = [];
  const scan = new HarnessDiscovery({ async inspect(file) { calls.push(file); return fact(file); } });
  const result = await scan.scan([provider({ commandNames: ['harness.exe'], overrides: ['C:\\Apps\\harness.exe'], knownPaths: ['C:\\Desktop\\harness.exe'] })], { platform: 'win32', pathValue: ';.;relative;C:\\Apps;C:\\Apps;\\\\server\\share' });
  assert.deepEqual(calls, ['C:\\Apps\\harness.exe', 'C:\\Desktop\\harness.exe']);
  assert.equal(result.candidates.length, 2); assert.deepEqual(result.candidates[0].sources, ['override', 'path']);
});
test('empty, missing manual, changed file and permission outcomes remain truthful', async () => {
  let state = 'missing';
  const scan = new HarnessDiscovery({ async inspect(file) { if (state === 'missing') missing(); if (state === 'denied') throw Object.assign(new Error(), { code: 'EACCES' }); return { canonicalPath: file, stamp: state }; } });
  const p = [provider({ overrides: ['/manual/harness'] })];
  let result = await scan.scan(p, { ...options, pathValue: '' }); assert.equal(result.candidates.length, 0); assert.ok(result.issues.some(i => i.reason === 'missing'));
  state = 'first'; const first = (await scan.scan(p, { ...options, pathValue: '' })).candidates[0];
  state = 'replaced'; const second = (await scan.scan(p, { ...options, pathValue: '' })).candidates[0];
  assert.equal(first.id, second.id); assert.notEqual(first.stamp, second.stamp); assert.equal(second.controllable, false);
  state = 'denied'; result = await scan.scan(p, { ...options, pathValue: '' }); assert.equal(result.candidates.length, 0); assert.ok(result.issues.some(i => i.reason === 'permission_denied'));
});
test('registered endpoints cause no network/file IO and no guessed default ports', async () => {
  const scan = new HarnessDiscovery({ inspect() { assert.fail('unexpected filesystem access'); } });
  const result = await scan.scan([provider({ commandNames: [], endpoints: ['http://127.0.0.1:4096/', 'https://[::1]:1234/api', 'http://localhost:4096', 'http://2130706433:4096', 'http://192.168.1.2:4096', 'http://127.0.0.1:4096/?token=secret', 'http://u:p@127.0.0.1:4096'] })], { ...options, pathValue: '' });
  assert.equal(result.candidates.length, 2); assert.equal(result.issues.length, 5);
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('u:p'));
  assert.equal((await scan.scan([provider({ commandNames: [] })], options)).candidates.length, 0);
});
test('cancel/deadline and consecutive scans retain last valid results and reject late replies', async () => {
  let resolve, hang = false, calls = 0;
  const scan = new HarnessDiscovery({ async inspect(file) { calls++; return hang ? new Promise(r => { resolve = r; }) : fact(file); } });
  const p = [provider({ knownPaths: ['/stable'] })]; const opts = { ...options, pathValue: '', deadlineMs: 20 };
  const good = await scan.scan(p, opts); hang = true;
  const pending = scan.scan([provider({ knownPaths: ['/late'] })], opts); await new Promise(r => setImmediate(r)); scan.cancel();
  assert.equal((await pending).status, 'cancelled'); assert.deepEqual(scan.snapshot().candidates, good.candidates);
  const busy = await scan.scan(p, opts); assert.equal(busy.status, 'partial'); assert.equal(calls, 2);
  resolve(fact('/late')); await new Promise(r => setImmediate(r)); assert.equal(scan.snapshot().generation, busy.generation); assert.deepEqual(scan.snapshot().candidates, good.candidates);
  const timeout = await scan.scan(p, opts); assert.equal(timeout.status, 'partial'); assert.equal(timeout.issues.at(-1).reason, 'deadline');
  resolve(fact('/late-again')); await new Promise(r => setImmediate(r));
  hang = false; assert.equal((await scan.scan(p, opts)).status, 'complete');
});
test('refresh supersedes a pending generation; mutable input cannot redirect it', async () => {
  let resolve; const calls = [];
  const scan = new HarnessDiscovery({ async inspect(file) { calls.push(file); return new Promise(r => { resolve = r; }); } });
  const p = [provider({ knownPaths: ['/original'] })];
  const first = scan.scan(p, { ...options, pathValue: '' }); await new Promise(r => setImmediate(r)); p[0].knownPaths.push('/injected');
  const second = await scan.scan([], { ...options, pathValue: '' }); await first;
  resolve(fact('/original')); await new Promise(r => setImmediate(r));
  assert.equal(scan.snapshot().generation, second.generation); assert.deepEqual(scan.snapshot().candidates, []); assert.deepEqual(calls, ['/original']);
});
test('collection has finite exact-path limits and rejects command traversal', async () => {
  let calls = 0; const scan = new HarnessDiscovery({ async inspect(file) { calls++; return fact(file); } });
  const result = await scan.scan(Array.from({ length: 16 }, (_, i) => provider({ id: `p${i}`, commandNames: Array.from({ length: 32 }, (_, n) => `c${n}`) })), { ...options, pathValue: Array.from({ length: 40 }, (_, i) => `/dir${i}`).join(':') });
  assert.equal(calls, 256); assert.equal(result.status, 'partial'); assert.ok(result.issues.some(i => i.reason === 'path_directory_limit'));
  await assert.rejects(scan.scan([provider({ commandNames: ['../evil'] })], options), /invalid_command_name/);
});
test('native filesystem inspection revalidates an explicit local file without executing it', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'snowball-discovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'harness-not-executable'); await writeFile(file, 'this is not executable');
  const scan = new HarnessDiscovery(); const p = [provider({ overrides: [file], commandNames: [] })]; const opts = { platform: process.platform === 'win32' ? 'win32' : 'darwin', pathValue: '' };
  assert.equal((await scan.scan(p, opts)).candidates.length, 1);
  await rm(file); assert.equal((await scan.scan(p, opts)).candidates.length, 0);
});
