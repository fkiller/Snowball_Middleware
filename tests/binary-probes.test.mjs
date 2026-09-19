import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { binaryProbeDigest, runBinaryProbe, BinaryHarnessProbe } from '../packages/plugin-host/dist/index.js';
const digest = value => createHash('sha256').update(value).digest('hex');
const executable = await realpath(process.execPath);
const exeHash = digest(await readFile(executable));
const fixture = await realpath(fileURLToPath(new URL('./fixtures/binary-probe.mjs', import.meta.url)));
const fixtureHash = digest(await readFile(fixture));
const spec = (mode = 'version', marker) => ({ id: 'fixture.binary', executable: { path: executable, sha256: exeHash }, args: [fixture, mode, ...(marker ? [marker] : [])], artifacts: [{ path: fixture, sha256: fixtureHash }], versions: { 'fixture 1.0.0': '1.0.0', clean: '1.0.0' } });
const approvals = s => new Map([[s.id, binaryProbeDigest(s)]]);
async function temp(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'snowball-probe-')); t.after(() => rm(dir, { force: true, recursive: true })); return dir; }
async function waitFor(fn, timeout = 3000) { const end = Date.now() + timeout; for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error('fixture deadline'); await new Promise(r => setTimeout(r, 15)); } }
test('reviewed native process version probe returns installed only, with exact spec approval', async () => {
  const s = spec(); assert.equal((await runBinaryProbe(s, new Map())).status, 'untrusted');
  const result = await runBinaryProbe(s, approvals(s)); assert.deepEqual(result, { status: 'supported', version: '1.0.0', presence: 'installed', controllable: false });
  const approved = approvals(s); s.args.push('changed'); assert.equal((await runBinaryProbe(s, approved)).status, 'untrusted');
  assert.equal((await runBinaryProbe({ ...s, executable: { ...s.executable, path: 'C:\\probe.cmd' } }, approved)).status, 'untrusted');
});
test('selected script replacement and missing binary fail before process launch', async t => {
  const dir = await temp(t); const script = path.join(dir, 'probe.mjs'); await writeFile(script, 'console.log("fixture 1.0.0")');
  const s = spec(); s.args = [script]; s.artifacts = [{ path: script, sha256: digest(await readFile(script)) }]; const approved = approvals(s);
  await writeFile(script, 'throw new Error("must not launch")'); assert.equal((await runBinaryProbe(s, approved)).status, 'changed');
  s.executable.path = path.join(dir, 'missing.exe'); assert.equal((await runBinaryProbe(s, approvals(s))).status, 'missing');
});
test('fixed argv is not shell text and inherited secrets/runtime injection are omitted', async () => {
  const previous = process.env.SNOWBALL_TEST_SECRET; process.env.SNOWBALL_TEST_SECRET = 'private';
  try { const s = spec('env'); assert.equal((await runBinaryProbe(s, approvals(s))).status, 'supported'); }
  finally { if (previous === undefined) delete process.env.SNOWBALL_TEST_SECRET; else process.env.SNOWBALL_TEST_SECRET = previous; }
  const s = spec('x & echo fixture 1.0.0'); assert.equal((await runBinaryProbe(s, approvals(s))).status, 'unsupported');
});
test('stdout/stderr bounds, unknown output and process failure never expose raw output', async () => {
  for (const [mode, status] of [['flood', 'output_limit'], ['stderr', 'output_limit'], ['unknown-private-output', 'unsupported'], ['fail', 'failed']]) {
    const s = spec(mode); const result = await runBinaryProbe(s, approvals(s)); assert.equal(result.status, status); assert.equal(result.version, null); assert.ok(!JSON.stringify(result).includes('private'));
  }
});
test('deadline terminates owned hanging child and no automatic retry occurs', async t => {
  const dir = await temp(t); const marker = path.join(dir, 'pid'); const s = spec('hang', marker);
  const result = await runBinaryProbe(s, approvals(s), { timeoutMs: 1500 }); assert.equal(result.status, 'timeout');
  const pid = Number(await readFile(marker, 'utf8'));
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  assert.equal(Number(await readFile(marker, 'utf8')), pid);
});
test('explicit and pre-launch cancellation leave no owned child running', async t => {
  const dir = await temp(t); const marker = path.join(dir, 'pid'); const s = spec('hang', marker); const signal = new AbortController();
  const pending = runBinaryProbe(s, approvals(s), { signal: signal.signal });
  await waitFor(async () => { try { return (await readFile(marker)).length > 0; } catch { return false; } });
  const pid = Number(await readFile(marker, 'utf8')); signal.abort(); assert.equal((await pending).status, 'cancelled');
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  await rm(marker); assert.equal((await runBinaryProbe(s, approvals(s), { signal: AbortSignal.abort() })).status, 'cancelled');
  await assert.rejects(readFile(marker));
});
test('selection copies review input and consecutive probes cannot publish stale generations', async () => {
  const s = spec(); const probe = new BinaryHarnessProbe(s, approvals(s)); s.args[1] = 'unknown';
  const first = probe.probe(); const second = await probe.probe();
  assert.equal((await first).status, 'cancelled'); assert.equal(second.status, 'supported');
  assert.equal(probe.snapshot().generation, second.generation); assert.equal(probe.snapshot().version, '1.0.0');
});
