import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CommandJournal,
  SessionService,
  formatSessionKey,
} from '../packages/core/dist/index.js';

const hostId = `host_${'a'.repeat(32)}`;
const actorId = `ctl_${'b'.repeat(16)}`;

class MockHarnessAdapter extends EventEmitter {
  status(){return {instanceId:'inst-1',connected:true};}
  constructor(ownerId = 'owner-proc-1') {
    super();
    this.ownerId = ownerId;
  }
  calls = [];
  created = 0;

  async createSession(root) {
    this.created++;
    const sessionKey = formatSessionKey({
      hostId,
      harness: { pluginId: 'harness.alpha', instanceId: 'inst-1' },
      nativeSessionId: `sess-${this.created}`,
    });
    return { sessionKey, ownerId: this.ownerId };
  }

  async execute(envelope) {
    this.calls.push(envelope.command.input);
    return { status: 'acknowledged', correlationId: 'corr-1' };
  }

  async stop() {
    this.emit('offline');
  }
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'snowball-harness-life-test-'));
  const journal = new CommandJournal({ directory: path.join(dir, 'journal'), hostId });
  const service = new SessionService({ hostId, journal });
  const adapter1 = new MockHarnessAdapter('owner-pid-101');
  service.registerAdapter('harness.alpha', adapter1);

  t.after(async () => {
    journal.close();
    await rm(dir, { recursive: true, force: true });
  });

  return { dir, journal, service, adapter1 };
}

test('MW.03.02.01.03.A1: harness process crash / restart cleanly updates ownership without contaminating previous sessions', async t => {
  const { service, adapter1 } = await fixture(t);

  // 1. Create session with original process
  const { sessionKey: session1 } = await service.createSession('harness.alpha', '/workspace/task-1');
  const sessBefore = service.getSession(session1);
  assert.equal(sessBefore?.readOnly, false);
  assert.equal(sessBefore?.ownerId, 'owner-pid-101');

  // 2. Harness crashes / sleeps, restarts with new PID/owner
  const adapter2 = new MockHarnessAdapter('owner-pid-202');
  await service.reconnectAdapter('harness.alpha', adapter2);

  // Verification A1: Old session is safely converted to read-only, avoiding cross-process owner contamination
  const sessAfter = service.getSession(session1);
  assert.equal(sessAfter?.readOnly, true);
  assert.equal(sessAfter?.ownerId, null);

  // Commands to old session must be rejected as read-only
  await assert.rejects(
    service.sendPrompt(actorId, session1, 'Must not send to stale owner'),
    /Cannot send prompt to a read-only or foreign session/
  );

  // 3. New session created on reconnected adapter belongs cleanly to the new owner
  const { sessionKey: session2 } = await service.createSession('harness.alpha', '/workspace/task-2');
  const sessNew = service.getSession(session2);
  assert.equal(sessNew?.readOnly, false);
  assert.equal(sessNew?.ownerId, 'owner-pid-202');

  const sendResult = await service.sendPrompt(actorId, session2, 'Valid message to new owner');
  assert.ok(sendResult.commandId);

  const dispatched = await service.dispatchNext(session2);
  assert.ok(dispatched);
  assert.equal(adapter2.calls.length, 1);
});

test('MW.03.02.01.03.A2: harness disable/remove preserves draft destination and never sends to a foreign harness (R-TARGET / H12-H14)', async t => {
  const { service } = await fixture(t);

  // Register second harness
  const adapterBeta = new MockHarnessAdapter('owner-beta');
  service.registerAdapter('harness.beta', adapterBeta);

  const { sessionKey: sessionAlpha } = await service.createSession('harness.alpha', '/workspace/alpha');
  const controller = service.getControllerContext(actorId);

  // Controller binds a draft to sessionAlpha
  controller.beginDraft('draft-alpha-1', sessionAlpha);
  assert.equal(controller.getDraft()?.destinationKey, sessionAlpha);

  // Disable harness.alpha
  service.disableAdapter('harness.alpha');
  assert.equal(service.isAdapterDisabled('harness.alpha'), true);

  // INVARIANT: draft destination MUST NOT change to harness.beta
  assert.equal(controller.getDraft()?.destinationKey, sessionAlpha);

  // Sending to disabled harness must fail with harness_disabled
  await assert.rejects(
    service.sendPrompt(actorId, sessionAlpha, 'Must not send while disabled'),
    /Harness harness.alpha is currently disabled/
  );

  // Verify adapterBeta received ZERO commands
  assert.equal(adapterBeta.calls.length, 0);

  // Re-enable harness.alpha
  service.enableAdapter('harness.alpha');
  assert.equal(service.isAdapterDisabled('harness.alpha'), false);

  // Now sending succeeds strictly to sessionAlpha
  const sendRes = await service.sendPrompt(actorId, sessionAlpha, 'Sending after re-enabled');
  assert.ok(sendRes.commandId);

  // Now remove harness.alpha completely
  await service.removeAdapter('harness.alpha');

  // Sessions of harness.alpha become read-only historical records
  const sessAlphaAfter = service.getSession(sessionAlpha);
  assert.equal(sessAlphaAfter?.readOnly, true);

  // Sending to removed harness fails safely
  await assert.rejects(
    service.sendPrompt(actorId, sessionAlpha, 'Must not send after removed'),
    /Cannot send prompt to a read-only or foreign session/
  );

  // Still zero commands sent to harness.beta
  assert.equal(adapterBeta.calls.length, 0);
});
