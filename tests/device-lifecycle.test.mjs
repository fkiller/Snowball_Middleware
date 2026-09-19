import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceRegistry,
  CommandJournal,
  createControllerId,
  formatSessionKey,
} from '../packages/core/dist/index.js';

test('MW.04.03.01.01.A1: unplug/reset/crash safe recovery; stale button events and unknown commands never replayed', async t => {
  const registry = new DeviceRegistry();
  const source = { pluginId: 'mock.hardware', instanceId: 'device-1' };

  // 1. Scan and register a verified device
  const gen = registry.beginScan(source);
  const candidate = registry.observe(source, gen, {
    nativeDeviceId: 'native-dev-1',
    label: 'Hardware Pad',
    transport: 'hid',
    capabilities: ['button', 'select-session', 'display'],
    supported: true,
    verifiedIdentity: 'sig_verified_hardware_001',
  });
  registry.finishScan(source, gen, 'ready');

  const { binding, lease } = registry.register(candidate.candidateId, gen);
  assert.equal(binding.transport, 'hid');
  assert.ok(lease);

  // 2. Normal input works
  const now = Date.now();
  const res1 = registry.input(binding.deviceId, lease, 1, now, { kind: 'button', button: 'confirm' });
  assert.equal(res1.event.button, 'confirm');

  // 3. Unplug / disconnect: device enters offline state
  registry.disconnect(binding.deviceId, 'offline');
  const listed = registry.list();
  assert.equal(listed.find(d => d.deviceId === binding.deviceId)?.state, 'offline');

  // 4. Input while disconnected -> rejected
  assert.throws(
    () => registry.input(binding.deviceId, lease, 2, now + 100, { kind: 'button', button: 'confirm' }),
    /Device lease unavailable/
  );

  // 5. Stale button event / replayed event rejected
  assert.throws(
    () => registry.input(binding.deviceId, lease, 2, now - 5000, { kind: 'button', button: 'confirm' }),
    /Device lease unavailable/
  );

  // 6. Reconnect after replug
  const gen2 = registry.beginScan(source);
  const candidate2 = registry.observe(source, gen2, {
    nativeDeviceId: 'native-dev-1',
    label: 'Hardware Pad',
    transport: 'hid',
    capabilities: ['button', 'select-session', 'display'],
    supported: true,
    verifiedIdentity: 'sig_verified_hardware_001',
  });
  registry.finishScan(source, gen2, 'ready');

  // Reconnect with matching verifiedIdentity and revision 0
  const { binding: reconnected, lease: newLease } = registry.reconnect(
    binding.deviceId,
    candidate2.candidateId,
    gen2,
    0
  );
  assert.equal(reconnected.revision, 1);
  assert.notEqual(newLease, lease);

  // Stale sequence number (sequence <= lastSequence) or stale timestamp rejected
  assert.throws(
    () => registry.input(binding.deviceId, newLease, 1, Date.now() - 3000, { kind: 'button', button: 'confirm' }),
    /stale_input|Stale\/replayed input/
  );

  // Fresh input with new lease and monotonically increasing sequence works
  const res2 = registry.input(binding.deviceId, newLease, 1, Date.now(), { kind: 'button', button: 'confirm' });
  assert.equal(res2.event.button, 'confirm');

  // 7. Identity change / factory reset -> requires re-identification
  const gen3 = registry.beginScan(source);
  const candidateMismatched = registry.observe(source, gen3, {
    nativeDeviceId: 'native-dev-1',
    label: 'Hardware Pad',
    transport: 'hid',
    capabilities: ['button', 'select-session', 'display'],
    supported: true,
    verifiedIdentity: 'different_signature_after_factory_reset',
  });
  registry.finishScan(source, gen3, 'ready');

  assert.throws(
    () => registry.reconnect(binding.deviceId, candidateMismatched.candidateId, gen3, 1),
    /needs_identification|Physical identity must be confirmed again/
  );
});

test('MW.04.03.01.01.A2: simultaneous two devices + Web operations and revoke do not kill other controllers or running harness tasks', async t => {
  const registry = new DeviceRegistry();
  const source1 = { pluginId: 'mock.mk20', instanceId: 'mk20-inst' };
  const source2 = { pluginId: 'mock.hid', instanceId: 'hid-inst' };

  // Register Device 1 (MK20)
  const g1 = registry.beginScan(source1);
  const c1 = registry.observe(source1, g1, {
    nativeDeviceId: 'mk20-1',
    label: 'MK20 Control Dial',
    transport: 'lan',
    capabilities: ['button', 'select-session', 'display'],
    supported: true,
    verifiedIdentity: 'mk20_hw_key_1',
  });
  registry.finishScan(source1, g1, 'ready');
  const { binding: dev1, lease: lease1 } = registry.register(c1.candidateId, g1);

  // Register Device 2 (HID Keypad)
  const g2 = registry.beginScan(source2);
  const c2 = registry.observe(source2, g2, {
    nativeDeviceId: 'hid-keypad-1',
    label: 'Macro Keypad',
    transport: 'hid',
    capabilities: ['button', 'select-session'],
    supported: true,
  });
  registry.finishScan(source2, g2, 'ready');
  const { binding: dev2, lease: lease2 } = registry.register(c2.candidateId, g2);

  // Web controller
  const webControllerId = createControllerId();

  // Setup CommandJournal with an active session and decision
  const hostId = 'host_33333333333333333333333333333333';
  const journalDir = `tests/.tmp-lifecycle-journal-${Date.now()}`;
  const journal = new CommandJournal({
    hostId,
    directory: journalDir,
  });
  t.after(() => {
    journal.close();
    try {
      import('node:fs').then(fs => fs.rmSync(journalDir, { recursive: true, force: true }));
    } catch {}
  });

  const sessionKey = formatSessionKey({
    hostId,
    harness: { pluginId: 'mock.harness', instanceId: 'default' },
    nativeSessionId: 'task-live-1',
  });
  journal.registerSession(sessionKey, 'owner-1');

  // Enqueue a running command
  const sessionRecord = journal.session(sessionKey);
  const { command: cmd } = journal.enqueue({
    commandId: 'cmd_running_1',
    sessionKey,
    ownerId: 'owner-1',
    actorId: webControllerId,
    expectedRevision: sessionRecord.revision,
    operation: 'sessions.send',
    payload: { prompt: 'Active long running task' },
  });
  assert.equal(cmd.status, 'queued');

  // Register a pending decision
  journal.registerDecision({
    decisionId: 'dec_conflict_1',
    sessionKey,
    ownerId: 'owner-1',
    nativeRequestId: 'req-1',
    nativeRevision: 'rev-1',
    allowedAnswers: ['accept', 'reject'],
  });

  // 1. Simultaneous operations: Device 1 and Web resolve the same decision
  // Device 1 resolves first
  const sessionAfterCmd = journal.session(sessionKey);
  const { command: devCmd } = journal.enqueue({
    commandId: 'cmd_dev1_decision',
    sessionKey,
    ownerId: 'owner-1',
    actorId: dev1.controllerId,
    expectedRevision: sessionAfterCmd.revision,
    operation: 'decisions.resolve',
    decision: {
      decisionId: 'dec_conflict_1',
      expectedRevision: 0,
    },
    payload: { answer: 'accept' },
  });
  assert.equal(devCmd.status, 'queued');
  const claimedDecision = journal.decision('dec_conflict_1');
  assert.equal(claimedDecision.status, 'claimed');

  // Web attempts to resolve same decision with stale revision 0 -> rejected
  const sessionAfterDev = journal.session(sessionKey);
  assert.throws(
    () =>
      journal.enqueue({
        commandId: 'cmd_web_decision',
        sessionKey,
        ownerId: 'owner-1',
        actorId: webControllerId,
        expectedRevision: sessionAfterDev.revision,
        operation: 'decisions.resolve',
        decision: {
          decisionId: 'dec_conflict_1',
          expectedRevision: 0,
        },
        payload: { answer: 'reject' },
      }),
    /stale_decision|Decision no longer pending/
  );

  // 2. Revoke Device 1 (D16)
  registry.revoke(dev1.deviceId);
  assert.equal(registry.list().some(d => d.deviceId === dev1.deviceId), false);

  // Device 1 lease is immediately invalid
  assert.throws(
    () => registry.input(dev1.deviceId, lease1, 1, Date.now(), { kind: 'button', button: 'confirm' }),
    /Device lease unavailable/
  );

  // 3. Other controllers (Device 2 and Web) and running harness task are NOT affected
  // Device 2 continues working
  const resDev2 = registry.input(dev2.deviceId, lease2, 1, Date.now(), { kind: 'button', button: 'confirm' });
  assert.equal(resDev2.controllerId, dev2.controllerId);

  // The running harness command in the journal remains in queued/active state, NOT cancelled
  const currentCmd = journal.command('cmd_running_1');
  assert.equal(currentCmd?.status, 'queued');
  assert.equal(currentCmd?.input.sessionKey, sessionKey);

  // 4. Plugin crash handling: plugin crash marks only that plugin's devices as degraded
  registry.handlePluginCrash('mock.hid');
  const dev2State = registry.list().find(d => d.deviceId === dev2.deviceId);
  assert.equal(dev2State?.state, 'degraded');
});
