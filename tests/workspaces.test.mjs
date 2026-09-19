import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry, localWorkspaceIO } from '../packages/core/dist/index.js';
import { WorkspaceFiles } from '../packages/api/dist/index.js';

async function setup(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'snowball-workspaces-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'work'); await fs.mkdir(root);
  return { temp, root, registry: new WorkspaceRegistry() };
}
const candidate = (root, id = 'one') => ({ candidateId: id, harness: { pluginId: 'test.harness', instanceId: 'local' }, nativeProjectId: 'native', root, displayName: 'Reported' });

test('project reports are metadata only; explicit matching never grants additional roots', async t => {
  const { root } = await setup(t);
  let calls = 0;
  const registry = new WorkspaceRegistry({ inspect: async p => { calls++; return localWorkspaceIO.inspect(p); } });
  assert.deepEqual(registry.list(), []);
  registry.reportCandidates([candidate(root), candidate(path.join(root, 'unknown'), 'two')]);
  assert.equal(calls, 0); assert.deepEqual(registry.list(), []);
  const entry = await registry.register(root, 'Work');
  assert.equal(entry.status, 'empty'); assert.deepEqual(registry.listAssociations(), []);
  await registry.associateCandidate('one', entry.workspaceId);
  assert.equal(registry.listAssociations().length, 1);
  await assert.rejects(registry.associateCandidate('two', entry.workspaceId));
  registry.reportCandidates([candidate(root, 'two')]);
  assert.deepEqual(registry.listAssociations(), []);
  assert.equal(registry.list().length, 1);
  assert.throws(() => registry.reportCandidates(Array.from({ length: 101 }, (_, i) => candidate(root, String(i)))));
});

test('aliases and worktrees remain separate; logical links do not expand read scope', async t => {
  const { root, temp, registry } = await setup(t);
  const other = path.join(temp, 'work-other'); await fs.mkdir(other);
  await fs.writeFile(path.join(root, 'own.txt'), 'first'); await fs.writeFile(path.join(other, 'secret.txt'), 'second');
  await fs.writeFile(path.join(root, '.git'), 'gitdir: ../work-other/.git/worktrees/first');
  const alias = path.join(temp, 'alias'); await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const one = await registry.register(root, 'First'); const two = await registry.register(other, 'Second');
  const aliased = await registry.register(alias, 'Alias');
  assert.notEqual(one.project.projectId, two.project.projectId);
  assert.notEqual(one.workspaceId, aliased.workspaceId);
  assert.deepEqual(one.identity, aliased.identity);
  registry.linkProjects(one.project.projectId, two.project.projectId);
  const files = WorkspaceFiles.fromRegistry(registry);
  assert.deepEqual(await files.read(one.workspaceId, 'own.txt'), { text: 'first' });
  for (const relative of ['../work-other/secret.txt', 'secret.txt', '.git', '.git/config']) await assert.rejects(files.read(one.workspaceId, relative));
  assert.deepEqual(await files.read(two.workspaceId, 'secret.txt'), { text: 'second' });
  registry.remove(two.workspaceId);
  assert.deepEqual(registry.listProjectLinks(), []);
  await assert.rejects(files.read(two.workspaceId, 'secret.txt'));
});

test('move requires explicit same-directory repair; replacement/copy cannot inherit identity', async t => {
  const { root, temp, registry } = await setup(t);
  await fs.writeFile(path.join(root, 'file.txt'), 'original');
  const one = await registry.register(root, 'First'); const files = WorkspaceFiles.fromRegistry(registry);
  const moved = path.join(temp, 'moved'); await fs.rename(root, moved);
  assert.equal((await registry.refresh(one.workspaceId)).status, 'missing');
  await assert.rejects(files.read(one.workspaceId, 'file.txt'));
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'file.txt'), 'replacement');
  assert.equal((await registry.refresh(one.workspaceId)).status, 'needs_review');
  await assert.rejects(registry.relocate(one.workspaceId, root), /identity mismatch/);
  const repaired = await registry.relocate(one.workspaceId, moved);
  assert.equal(repaired.workspaceId, one.workspaceId); assert.equal(repaired.project.projectId, one.project.projectId);
  assert.deepEqual(await files.read(one.workspaceId, 'file.txt'), { text: 'original' });
  await fs.rm(moved, { recursive: true });
  assert.equal((await registry.refresh(one.workspaceId)).status, 'missing');
});

test('restart retains captured identities and IDs without trusting old ready status', async t => {
  const { root, temp, registry } = await setup(t);
  const one = await registry.register(root, 'Work');
  registry.reportCandidates([candidate(root)]); await registry.associateCandidate('one', one.workspaceId);
  const persisted = registry.serialize(); const restored = WorkspaceRegistry.restore(persisted);
  assert.equal(restored.list()[0].status, 'unavailable');
  assert.deepEqual(restored.listCandidates(), []); assert.deepEqual(restored.listAssociations(), []);
  assert.equal((await restored.refresh(one.workspaceId)).status, 'empty');
  await fs.rename(root, path.join(temp, 'saved')); await fs.mkdir(root);
  const restarted = WorkspaceRegistry.restore(persisted);
  assert.equal((await restarted.refresh(one.workspaceId)).status, 'needs_review');
  await assert.rejects(restarted.assertReadable(one.workspaceId));
  const duplicate = JSON.parse(persisted); duplicate.entries.push(duplicate.entries[0]);
  assert.throws(() => WorkspaceRegistry.restore(JSON.stringify(duplicate)));
  assert.throws(() => WorkspaceRegistry.restore(JSON.stringify({ ...JSON.parse(persisted), version: 99 })));
});

test('permission and case-sensitive volume fixtures preserve distinct roots and recover truthfully', async t => {
  const { temp } = await setup(t);
  const upper = path.join(temp, 'Work'); const lower = path.join(temp, 'work');
  let denied = false;
  const registry = new WorkspaceRegistry({ inspect: async root => {
    if (denied) throw Object.assign(new Error('Denied fixture'), { code: 'EACCES' });
    return { canonical: root, identity: { device: '1', inode: root === upper ? '2' : '3', birth: '4' }, empty: true };
  } });
  const a = await registry.register(upper, 'Upper'); const b = await registry.register(lower, 'Lower');
  assert.notEqual(a.workspaceId, b.workspaceId); assert.notEqual(a.identity.inode, b.identity.inode);
  registry.reportCandidates([candidate(lower)]);
  await assert.rejects(registry.associateCandidate('one', a.workspaceId), /mismatch/);
  await registry.associateCandidate('one', b.workspaceId);
  denied = true;
  assert.equal((await registry.refresh(a.workspaceId)).status, 'needs_permission');
  await assert.rejects(registry.assertReadable(a.workspaceId));
  denied = false; assert.equal((await registry.refresh(a.workspaceId)).status, 'empty');
});

test('root junction retarget and nested junction never silently authorize outside files', async t => {
  const { root, temp, registry } = await setup(t);
  const outside = path.join(temp, 'work-other'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  const alias = path.join(temp, 'alias'); const kind = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(root, alias, kind); const one = await registry.register(alias, 'Alias');
  const files = WorkspaceFiles.fromRegistry(registry);
  await fs.symlink(outside, path.join(root, 'nested'), kind);
  await assert.rejects(files.read(one.workspaceId, 'nested/secret.txt'));
  await fs.unlink(alias); await fs.symlink(outside, alias, kind);
  assert.equal((await registry.refresh(one.workspaceId)).status, 'needs_review');
  await assert.rejects(files.read(one.workspaceId, 'secret.txt'));
});

test('late refresh cannot resurrect removed registration; returned records cannot mutate grants', async t => {
  const { root } = await setup(t);
  let release;
  let block = false;
  const registry = new WorkspaceRegistry({ inspect: async p => {
    const fact = await localWorkspaceIO.inspect(p);
    if (block) await new Promise(resolve => { release = resolve; });
    return fact;
  } });
  const one = await registry.register(root, 'Work'); one.identity.inode = '999';
  assert.notEqual(registry.list()[0].identity.inode, '999');
  block = true; const refreshing = registry.refresh(one.workspaceId);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  registry.remove(one.workspaceId); release();
  await assert.rejects(refreshing, /changed/); assert.deepEqual(registry.list(), []);
});
