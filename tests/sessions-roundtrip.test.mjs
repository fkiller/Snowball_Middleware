import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CommandJournal,
  SessionService,
  ControllerContext,
  formatSessionKey,
} from '../packages/core/dist/index.js';

const hostId = `host_${'c'.repeat(32)}`;
const actorId = `ctl_${'d'.repeat(16)}`;

class MockHarnessAdapter extends EventEmitter {
  status(){return {instanceId:'test',connected:true};}
  ownerId = 'mock-harness-owner-1';
  calls = [];
  createdCount = 0;
  activeTurns = new Map();

  async createSession(root, options = {}) {
    this.createdCount++;
    const nativeId = `session-${this.createdCount}`;
    const sessionKey = formatSessionKey({
      hostId,
      harness: { pluginId: 'mock.harness', instanceId: 'test' },
      nativeSessionId: nativeId,
    });
    return { sessionKey, ownerId: this.ownerId };
  }

  async listSessions() {
    return [
      { nativeId: 'foreign-hist-1', readOnly: true, ownerId: null, preview: 'Historical foreign task' },
      ...Array.from({ length: this.createdCount }, (_, i) => ({
        nativeId: `session-${i + 1}`,
        readOnly: false,
        ownerId: this.ownerId,
        preview: `Active task ${i + 1}`,
      })),
    ];
  }

  async readSession(id) {
    return { nativeId: id, readOnly: id === 'foreign-hist-1' };
  }

  async execute(envelope, signal) {
    const input = envelope.command.input;
    this.calls.push(input);

    if (input.operation === 'sessions.send') {
      const turnId = `turn-${Date.now()}`;
      this.activeTurns.set(input.sessionKey, turnId);
      // Emit turn events asynchronously
      queueMicrotask(() => {
        this.emit('event', { sessionKey: input.sessionKey, kind: 'turn/started', turnId });
        this.emit('event', { sessionKey: input.sessionKey, kind: 'item/agentMessage/delta', text: 'Working on it...' });
      });
      return { status: 'acknowledged', correlationId: turnId };
    }

    if (input.operation === 'sessions.interrupt') {
      const turnId = this.activeTurns.get(input.sessionKey);
      this.activeTurns.delete(input.sessionKey);
      queueMicrotask(() => {
        this.emit('event', { sessionKey: input.sessionKey, kind: 'turn/completed', turnId });
      });
      return { status: 'acknowledged', correlationId: turnId || 'int-1' };
    }

    if (input.operation === 'decisions.resolve') {
      return { status: 'acknowledged', correlationId: envelope.decision?.decisionId || 'dec-1' };
    }

    return { status: 'not_sent', reason: 'unsupported' };
  }

  simulateDecision(sessionKey, nativeRequestId = 'req-1', answers = ['accept', 'decline']) {
    this.emit('decision', {
      sessionKey,
      ownerId: this.ownerId,
      nativeRequestId,
      nativeRevision: 'rev-1',
      allowedAnswers: answers,
    });
  }

  completeTurn(sessionKey) {
    const turnId = this.activeTurns.get(sessionKey);
    this.activeTurns.delete(sessionKey);
    this.emit('event', { sessionKey, kind: 'turn/completed', turnId });
  }
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'snowball-sessions-test-'));
  const journal = new CommandJournal({ directory: path.join(dir, 'journal'), hostId });
  const service = new SessionService({ hostId, journal });
  const adapter = new MockHarnessAdapter();
  service.registerAdapter('mock.harness', adapter);

  t.after(async () => {
    journal.close();
    await rm(dir, { recursive: true, force: true });
  });

  return { dir, journal, service, adapter };
}

test('MW.05.02.01.01.A1: fixture local harness vertical slice round-trip (create -> send -> events -> decision -> interrupt/recovery) with zero devices', async t => {
  const { service, adapter } = await fixture(t);

  // 1. Create session via SessionService
  const { sessionKey, ownerId } = await service.createSession('mock.harness', '/workspace/local-slice');
  assert.ok(sessionKey);
  assert.equal(ownerId, adapter.ownerId);

  const session = service.getSession(sessionKey);
  assert.ok(session);
  assert.equal(session.readOnly, false);
  assert.equal(service.getSession(sessionKey).status, 'idle');

  // 2. Send prompt -> enqueues to journal
  const events = [];
  service.on('sessionEvent', e => events.push(e));

  const sendResult = await service.sendPrompt(actorId, sessionKey, 'Write a unit test');
  assert.ok(sendResult.commandId);
  assert.equal(sendResult.status, 'queued');

  // 3. Dispatch command to adapter
  const dispatched = await service.dispatchNext(sessionKey);
  assert.ok(dispatched);
  assert.equal(dispatched.status, 'acknowledged');
  assert.ok(dispatched.correlationId);

  // Wait for turn events
  await new Promise(r => setTimeout(r, 50));
  assert.ok(events.some(e => e.kind === 'turn/started'));
  assert.ok(events.some(e => e.kind === 'item/agentMessage/delta'));
  assert.equal(service.getSession(sessionKey).status, 'busy');

  // 4. Simulate a decision required from harness (e.g. command execution approval)
  let decisionReceived;
  service.once('decisionRequired', d => { decisionReceived = d; });
  adapter.simulateDecision(sessionKey, 'req-approval-1', ['accept', 'decline']);

  await new Promise(r => setTimeout(r, 20));
  assert.ok(decisionReceived);
  assert.ok(decisionReceived.decisionId);

  // 5. Resolve decision
  const decResolve = await service.resolveDecision(actorId, decisionReceived.decisionId, 'accept');
  assert.equal(decResolve.status, 'queued');
  assert.ok(decResolve.dispatched);
  assert.equal(decResolve.dispatched.status, 'acknowledged');

  // 6. Interrupt active turn
  const intResult = await service.interruptTurn(actorId, sessionKey, dispatched.correlationId);
  assert.ok(intResult.dispatched);
  assert.equal(intResult.dispatched.status, 'acknowledged');

  // Wait for turn completion event
  await new Promise(r => setTimeout(r, 50));
  assert.ok(events.some(e => e.kind === 'turn/completed'));
  assert.equal(session.status, 'idle');
});

test('MW.05.02.01.01.A2: foreign/historical sessions are strictly read-only and reject mutations', async t => {
  const { service } = await fixture(t);

  // List sessions from adapter (includes foreign-hist-1)
  const sessions = await service.listSessions();
  const foreign = sessions.find(s => s.nativeSessionId === 'foreign-hist-1');
  assert.ok(foreign);
  assert.equal(foreign.readOnly, true);
  assert.equal(foreign.ownerId, null);

  // Attempting to send prompt to foreign session must be rejected
  await assert.rejects(
    service.sendPrompt(actorId, foreign.sessionKey, 'Must not send'),
    /Cannot send prompt to a read-only or foreign session/
  );

  // Attempting to interrupt foreign session must be rejected
  await assert.rejects(
    service.interruptTurn(actorId, foreign.sessionKey, 'turn-x'),
    /SessionFault/
  );
});

test('MW.05.02.01.01.A2: scope change / new task selection never mutates in-flight draft destination (R-TARGET / J03)', async t => {
  const { service } = await fixture(t);

  const { sessionKey: sessionA } = await service.createSession('mock.harness', '/workspace/task-a');
  const { sessionKey: sessionB } = await service.createSession('mock.harness', '/workspace/task-b');

  const controller = service.getControllerContext(actorId);

  // 1. Controller selects session A
  controller.selectScope({ sessionKey: sessionA });
  assert.equal(controller.getSelection().sessionKey, sessionA);

  // 2. Controller binds a draft to session A
  const draftId = 'draft-test-1';
  controller.beginDraft(draftId, sessionA);
  assert.equal(controller.getDraft()?.destinationKey, sessionA);
  assert.equal(controller.getDraft()?.phase, 'recording');

  // 3. Controller switches selection to session B while draft is active (recording/transcribing)
  controller.selectScope({ sessionKey: sessionB });
  assert.equal(controller.getSelection().sessionKey, sessionB);

  // INVARIANT CHECK (R-TARGET / J03): Draft destination MUST remain sessionA!
  assert.equal(controller.getDraft()?.destinationKey, sessionA);
  assert.equal(controller.getDraft()?.draftId, draftId);

  // 4. Complete draft phase transitions
  controller.updateDraftPhase('transcribing');
  assert.equal(controller.getDraft()?.destinationKey, sessionA);

  controller.updateDraftPhase('review');
  assert.equal(controller.getDraft()?.destinationKey, sessionA);

  // 5. Enqueue prompt to session A using the draft destination
  const activeDraft = controller.getDraft();
  assert.ok(activeDraft);
  const sendRes = await service.sendPrompt(actorId, activeDraft.destinationKey, 'Prompt from draft');
  assert.ok(sendRes.commandId);

  const dispatched = await service.dispatchNext(sessionA);
  assert.equal(dispatched.input.sessionKey, sessionA);
});
