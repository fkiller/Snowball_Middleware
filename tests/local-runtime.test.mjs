import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';

test('local composition restores durable registration on a new listener without replaying folder selection', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-runtime-'));
  const root = path.join(temp, 'project'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'hello.txt'), 'offline local');
  const dataDir = path.join(temp, 'private-state'); const runtimes = [];
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  let choices = 0;
  const start = async () => { const runtime = await startLocalRuntime({ dataDir, chooseWorkspace: async () => { choices++; return { root, displayName: 'Project' }; } }); runtimes.push(runtime); return runtime; };
  const first = await start(); const client = new LocalClient(first.origin); await client.bootstrap(first.issueBootstrap().code);
  assert.deepEqual((await client.snapshot()).workspaces, []);
  assert.equal((await fetch(first.origin)).status, 200);
  const selected = await client.selectWorkspace(); assert.equal(choices, 1);
  await first.close(); const second = await start(); const restored = new LocalClient(second.origin); await restored.bootstrap(second.issueBootstrap().code);
  assert.equal((await restored.snapshot()).workspaces[0].workspaceId, selected.workspaceId);
  assert.equal(choices, 1);
  assert.deepEqual(await restored.readFile(selected.workspaceId, 'hello.txt'), { text: 'offline local' });
  assert.equal((await restored.snapshot()).harness, null);
});
