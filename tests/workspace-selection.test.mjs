import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommandJournal, WorkspaceStore, localWorkspaceIO } from '../packages/core/dist/index.js';
import { LocalApi } from '../packages/api/dist/index.js';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
import { chooseNativeWorkspace } from '../apps/supervisor/native-picker.mjs';
const hostId = `host_${'d'.repeat(32)}`;
async function setup(t, chooseWorkspace, options = {}, io) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-select-')); const root = path.join(temp, 'project'); fs.mkdirSync(root);
  const directory = path.join(temp, 'workspaces');
  const store = new WorkspaceStore({ hostId, directory, io });
  const journal = new CommandJournal({ hostId, directory: path.join(temp, 'commands') });
  const api = new LocalApi({ journal, workspaceStore: store, chooseWorkspace: signal => chooseWorkspace(root, signal), ...options });
  await api.start(); const client = new LocalClient(api.origin); const login = await client.bootstrap(api.issueBootstrap().code);
  t.after(async () => { await api.close(); store.close(); journal.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  return { api, client, login, store, root, directory };
}
test('trusted picker registers durably and exposes no browser-supplied path interface', async t => {
  let calls = 0;
  const { api, client, store, root, directory } = await setup(t, async root => { calls++; return { root, displayName: 'Chosen project' }; });
  assert.equal((await client.snapshot()).workspaceSelectionAvailable, true);
  assert.equal((await fetch(api.origin + '/v1/workspaces/select', { method: 'POST', headers: { Origin: api.origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal(calls, 0);
  const selected = await client.selectWorkspace(); assert.equal(selected.selected, true); assert.equal(calls, 1);
  assert.equal((await client.snapshot()).workspaceDetails[0].displayName, 'Chosen project');
  fs.writeFileSync(path.join(root, 'hello.txt'), 'local');
  assert.deepEqual(await client.readFile(selected.workspaceId, 'hello.txt'), { text: 'local' });
  await api.close(); store.close(); const restored = new WorkspaceStore({ hostId, directory });
  assert.equal(restored.list()[0].workspaceId, selected.workspaceId); restored.close();
});
test('cancelled native selection returns to empty; revoked selection cannot publish late result', async t => {
  let release; let cancel = true;
  const { api, client, login, store, root } = await setup(t, async () => cancel ? null : new Promise(resolve => { release = resolve; }));
  assert.deepEqual(await client.selectWorkspace(), { selected: false }); assert.deepEqual(store.list(), []);
  cancel = false; const pending = client.selectWorkspace(); const rejected = assert.rejects(pending, error => error.code === 'workspace_selection_cancelled');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.selectWorkspace(), error => error.status === 429);
  api.revokeController(login.controllerId); await rejected;
  release({ root, displayName: 'Late' }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.list(), []);
});
test('session expiry during directory inspection is checked before durable commit', async t => {
  let now = 100; let release; const io = { inspect: async root => {
    const fact = await localWorkspaceIO.inspect(root); await new Promise(resolve => { release = resolve; }); return fact;
  } };
  const { client, store } = await setup(t, async root => ({ root, displayName: 'Project' }), { now: () => now, sessionTtlMs: 1000 }, io);
  const pending = client.selectWorkspace(); const rejected = assert.rejects(pending, error => error.status === 401);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  now = 1101; release(); await rejected; assert.deepEqual(store.list(), []);
});
test('aborted native picker reports cancellation without opening a dialog', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(chooseNativeWorkspace(controller.signal), error => error.code === 'workspace_selection_cancelled');
});
test('selection failures surface actionable codes without paths', async t => {
  const failing = async (t, io, picker) => {
    const { client, store, root } = await setup(t, picker ?? (async root => ({ root, displayName: 'Project' })), {}, io);
    try {
      await client.selectWorkspace();
      assert.fail('selection should fail');
    } catch (error) { return { error, store, root }; }
  };
  const denied = await failing(t, { inspect: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  assert.equal(denied.error.status, 503); assert.equal(denied.error.code, 'workspace_selection_permission');
  assert.equal(String(denied.error.message).includes(denied.root), false); assert.deepEqual(denied.store.list(), []);
  const missing = await failing(t, { inspect: async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } });
  assert.equal(missing.error.status, 503); assert.equal(missing.error.code, 'workspace_selection_missing');
  assert.deepEqual(missing.store.list(), []);
  const invalid = await failing(t, undefined, async () => ({ root: 'relative/path', displayName: 'Bad' }));
  assert.equal(invalid.error.status, 400); assert.equal(invalid.error.code, 'workspace_selection_invalid');
  assert.deepEqual(invalid.store.list(), []);
  const { client, store } = await setup(t, async root => ({ root, displayName: 'Project' }));
  store.close();
  await assert.rejects(client.selectWorkspace(), error => error.status === 503 && error.code === 'workspace_storage_unavailable');
});
