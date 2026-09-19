import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AntigravityObserverAdapter, antigravityManifest } from '../packages/harness-antigravity/dist/index.js';
import { formatSessionKey } from '../packages/core/dist/index.js';

const hostId = `host_${'a'.repeat(32)}`;
const instanceId = 'ag-test';

async function createBrainFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snowball-ag-test-'));
  const convId1 = '11111111-2222-3333-4444-555555555555';
  const convId2 = '66666666-7777-8888-9999-aaaaaaaaaaaa';

  const logDir1 = path.join(root, convId1, '.system_generated', 'logs');
  const logDir2 = path.join(root, convId2, '.system_generated', 'logs');
  await mkdir(logDir1, { recursive: true });
  await mkdir(logDir2, { recursive: true });

  const transcript1 = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>Fix the login race condition</USER_REQUEST>', created_at: '2026-09-19T10:00:00Z' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'I will analyze the login code.', created_at: '2026-09-19T10:00:05Z' }),
  ].join('\n') + '\n';

  const transcript2 = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Implement dark mode UI toggle', created_at: '2026-09-19T11:00:00Z' }),
  ].join('\n') + '\n';

  await writeFile(path.join(logDir1, 'transcript.jsonl'), transcript1, 'utf8');
  await writeFile(path.join(logDir2, 'transcript.jsonl'), transcript2, 'utf8');

  return { root, convId1, convId2, logDir1, logDir2 };
}

test('MW.03.02.01.02.A2: Antigravity manifest publishes observe-only capabilities; zero control capabilities', async () => {
  const manifest = await antigravityManifest();
  assert.equal(manifest.id, 'snowball.antigravity');
  assert.equal(manifest.kind, 'harness');

  // Must only have observe capabilities
  const ops = manifest.capabilities.map(c => c.operation);
  assert.ok(ops.includes('harness.status'));
  assert.ok(ops.includes('harness.list'));
  assert.ok(ops.includes('harness.read'));
  assert.ok(ops.includes('harness.watch'));

  // Must have ZERO control capabilities
  assert.ok(manifest.capabilities.every(c => c.access === 'observe'));
  assert.ok(!ops.includes('harness.connect'));
  assert.ok(!ops.includes('harness.create'));
  assert.ok(!ops.includes('harness.execute'));
});

test('MW.03.02.01.02.A2: AntigravityObserverAdapter status reports readOnly and observe-only truthfully', async t => {
  const { root } = await createBrainFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const adapter = new AntigravityObserverAdapter({ hostId, instanceId, brainDir: root });
  await adapter.start();
  t.after(async () => { await adapter.stop(); });

  const status = adapter.status();
  assert.equal(status.connected, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.surface, 'transcript-observer');
  assert.equal(status.existingDesktopControl, false);
  assert.deepEqual(status.capabilities, ['observe']);
});

test('MW.03.02.01.02.A2: listSessions and readSession parse conversations and turns without claiming control', async t => {
  const { root, convId1, convId2 } = await createBrainFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const adapter = new AntigravityObserverAdapter({ hostId, instanceId, brainDir: root });
  await adapter.start();
  t.after(async () => { await adapter.stop(); });

  const sessions = await adapter.listSessions();
  assert.equal(sessions.length, 2);

  // All sessions must be strictly read-only with null ownerId
  for (const s of sessions) {
    assert.equal(s.readOnly, true);
    assert.equal(s.ownerId, null);
  }

  const s1 = sessions.find(s => s.nativeId === convId1);
  assert.ok(s1);
  assert.equal(s1.preview, 'Fix the login race condition');
  assert.equal(s1.sessionKey, formatSessionKey({ hostId, harness: { pluginId: 'snowball.antigravity', instanceId }, nativeSessionId: convId1 }));

  const read = await adapter.readSession(convId1);
  assert.equal(read.readOnly, true);
  assert.equal(read.turns.length, 2);
  assert.equal(read.turns[0].type, 'USER_INPUT');
  assert.equal(read.turns[1].type, 'PLANNER_RESPONSE');
});

test('MW.03.02.01.02.A2: execute rejects mutations with read_only_harness and never claims control', async t => {
  const { root, convId1 } = await createBrainFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const adapter = new AntigravityObserverAdapter({ hostId, instanceId, brainDir: root });
  await adapter.start();
  t.after(async () => { await adapter.stop(); });

  const sessionKey = formatSessionKey({ hostId, harness: { pluginId: 'snowball.antigravity', instanceId }, nativeSessionId: convId1 });
  const envelope = {
    command: {
      input: {
        commandId: 'cmd-1',
        actorId: 'ctl_test',
        ownerId: adapter.ownerId,
        sessionKey,
        operation: 'sessions.send',
        payload: { text: 'test command' },
        expectedRevision: 0,
      },
    },
  };

  const receipt = await adapter.execute(envelope, new AbortController().signal);
  assert.equal(receipt.status, 'not_sent');
  assert.equal(receipt.reason, 'read_only_harness');
});

test('MW.03.02.01.02.A2: watchSession observes transcript append events', async t => {
  const { root, convId1, logDir1 } = await createBrainFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const adapter = new AntigravityObserverAdapter({ hostId, instanceId, brainDir: root });
  await adapter.start();
  t.after(async () => { await adapter.stop(); });

  const events = [];
  adapter.on('event', e => events.push(e));

  adapter.watchSession(convId1);

  // Append a new turn to transcript
  const newTurn = JSON.stringify({
    step_index: 2,
    type: 'PLANNER_RESPONSE',
    source: 'MODEL',
    content: 'Race condition resolved.',
    created_at: '2026-09-19T10:01:00Z',
  }) + '\n';

  await appendFile(path.join(logDir1, 'transcript.jsonl'), newTurn, 'utf8');

  // Wait for watcher event
  await new Promise(r => setTimeout(r, 200));

  adapter.unwatchSession(convId1);
  assert.ok(events.length >= 1);
  assert.equal(events[0].kind, 'item/agentMessage/delta');
  assert.equal(events[0].text, 'Race condition resolved.');
});
