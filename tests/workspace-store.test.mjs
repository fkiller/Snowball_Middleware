import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, localWorkspaceIO } from '../packages/core/dist/index.js';
import { WorkspaceFiles } from '../packages/api/dist/index.js';
const hostId = `host_${'b'.repeat(32)}`;
function setup(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-store-'));
  const directory = path.join(temp, 'state'); const root = path.join(temp, 'project'); fs.mkdirSync(root);
  const stores = [];
  const open = (options = {}) => { const store = new WorkspaceStore({ directory, hostId, ...options }); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  return { temp, directory, root, open };
}
test('durable workspace grant survives restart with original identity; removal revokes after restart', async t => {
  const { root, open } = setup(t);
  fs.writeFileSync(path.join(root, 'test.txt'), 'registered');
  const store = open(); let events = 0; store.subscribe(() => events++);
  const grant = await store.registerSelected(root, 'Project'); assert.equal(events, 1);
  assert.deepEqual(await WorkspaceFiles.fromRegistry(store).read(grant.workspaceId, 'test.txt'), { text: 'registered' });
  store.close(); const restarted = open();
  assert.equal(restarted.list()[0].status, 'unavailable');
  assert.equal(restarted.list()[0].workspaceId, grant.workspaceId);
  assert.deepEqual(restarted.list()[0].identity, grant.identity);
  await restarted.remove(grant.workspaceId); restarted.close();
  assert.deepEqual(open().list(), []);
});
test('state replacement, corruption, foreign host and second writer never acquire grants', async t => {
  const { root, directory, temp, open } = setup(t); const store = open();
  const grant = await store.registerSelected(root, 'Project');
  assert.throws(() => open(), /locked/);
  store.close(); assert.throws(() => open({ hostId: `host_${'c'.repeat(32)}` }), /foreign/);
  fs.renameSync(root, path.join(temp, 'moved')); fs.mkdirSync(root);
  const restarted = open(); assert.equal((await restarted.refresh(grant.workspaceId)).status, 'needs_review'); restarted.close();
  fs.appendFileSync(path.join(directory, 'commands.v1.jsonl'), 'partial');
  assert.throws(() => open(), /Incomplete/);
});
test('cancelled/closed/unauthorized inspections cannot publish or persist a late grant', async t => {
  const { root, open } = setup(t); let release; let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const io = { inspect: async root => { const fact = await localWorkspaceIO.inspect(root); entered(); await new Promise(resolve => { release = resolve; }); return fact; } };
  const store = open({ io }); const abort = new AbortController();
  const pending = store.registerSelected(root, 'Project', abort.signal); await waiting;
  await assert.rejects(store.registerSelected(root, 'Second'), /progress/);
  abort.abort(); release(); await assert.rejects(pending, /cancelled/); assert.deepEqual(store.list(), []);
  store.close(); const restarted = open(); assert.deepEqual(restarted.list(), []);
  await assert.rejects(restarted.registerSelected(root, 'Project', undefined, () => { throw new Error('Expired'); }), /Expired/);
  assert.deepEqual(restarted.list(), []);
});
test('full durable storage never publishes a successful registration', async t => {
  const { root, open } = setup(t); const store = open({ maxBytes: 1024 });
  await assert.rejects(store.registerSelected(root, 'x'.repeat(128)), /capacity|size|exceeds/i);
  assert.deepEqual(store.list(), []); store.close(); assert.deepEqual(open().list(), []);
});
