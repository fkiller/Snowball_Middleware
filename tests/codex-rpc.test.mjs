import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { CodexStdio } from '../packages/harness-codex/dist/index.js';
function fixture(t) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/codex-rpc.mjs', import.meta.url))], { stdio: 'pipe', windowsHide: true, shell: false });
  // Internal constructor is exercised directly only by this JS transport fixture.
  const rpc = new CodexStdio(child); t.after(() => rpc.stop()); return { child, rpc };
}
test('real bidirectional stdio preserves separate numeric request ID namespaces', async t => {
  const { rpc } = fixture(t); let request; rpc.once('request', value => { request = value; });
  assert.deepEqual(await rpc.request('collision', {}), { confirmed: true }); assert.equal(request.id, 1); assert.equal(request.method, 'item/commandExecution/requestApproval');
  rpc.respond(request.id, { decision: 'decline' }); assert.deepEqual(await rpc.request('echo', { still: 'ready' }), { still: 'ready' });
});
test('oversized native output fails pending requests without returning raw content', async t => {
  const { rpc } = fixture(t); await assert.rejects(rpc.request('flood', {}), e => e.code === 'protocol_failed' && e.delivery === 'unknown');
});
test('cancellation preserves unknown and graceful stop closes the owned process', async t => {
  const { rpc, child } = fixture(t); const abort = new AbortController(); const ready = once(rpc, 'notification');
  const pending = rpc.request('wait', {}, abort.signal); const rejected = assert.rejects(pending, e => e.code === 'cancelled' && e.delivery === 'unknown');
  await ready; abort.abort(); await rejected;
  assert.deepEqual(await rpc.request('echo', { next: true }), { next: true });
  await rpc.stop(); assert.ok(child.exitCode !== null || child.signalCode !== null);
});
