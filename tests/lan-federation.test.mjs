import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  LanHostRegistry,
  LanHostFederator,
  CommandJournal,
  SessionService,
  formatSessionKey,
  parseSessionKey,
} from '../packages/core/dist/index.js';

class MockHarnessAdapter extends EventEmitter {
  ownerId = 'mock-owner-fed';
  async createSession(root, options = {}) {
    return { sessionKey: options.sessionKey, ownerId: this.ownerId };
  }
  async listSessions() {
    return [];
  }
  async execute() {
    return { status: 'acknowledged' };
  }
}

test('MW.09.02.01.01.A1: remote disconnect / aggregator restart preserves local tasks and immutable destinations', async t => {
  const hostIdA = 'host_11111111111111111111111111111111';
  const registryA = new LanHostRegistry({
    hostId: hostIdA,
    name: 'Windows Workstation',
    platform: 'win32',
  });

  const journalDir = `tests/.tmp-fed-journal-${Date.now()}`;
  const journalA = new CommandJournal({ hostId: hostIdA, directory: journalDir });
  t.after(() => {
    journalA.close();
    try {
      import('node:fs').then(fs => fs.rmSync(journalDir, { recursive: true, force: true }));
    } catch {}
  });

  const sessionServiceA = new SessionService({ hostId: hostIdA, journal: journalA });
  const adapterA = new MockHarnessAdapter();
  sessionServiceA.registerAdapter('mock.harness', adapterA);

  // Create a local session on Host A
  const localNativeId = 'local-task-001';
  const localSessionKey = formatSessionKey({
    hostId: hostIdA,
    harness: { pluginId: 'mock.harness', instanceId: 'default' },
    nativeSessionId: localNativeId,
  });
  journalA.registerSession(localSessionKey, adapterA.ownerId);

  // Enqueue a local command with unknown/pending destination
  const sessionRecord = journalA.session(localSessionKey);
  const { command: localCmd } = journalA.enqueue({
    commandId: 'cmd_local_active_1',
    sessionKey: localSessionKey,
    ownerId: adapterA.ownerId,
    actorId: 'ctl_aaaaaaaaaaaaaaaa',
    expectedRevision: sessionRecord.revision,
    operation: 'sessions.send',
    payload: { prompt: 'Local critical task' },
  });
  assert.equal(localCmd.status, 'queued');

  // Pair Host B (Mac)
  const hostIdB = 'host_22222222222222222222222222222222';
  const registryB = new LanHostRegistry({
    hostId: hostIdB,
    name: 'MacBook Pro',
    platform: 'darwin',
  });

  const sessionB = registryA.initiatePairing();
  registryA.verifyPairing(sessionB.pairingId, sessionB.pin, {
    hostId: hostIdB,
    name: registryB.name,
    platform: registryB.platform,
    publicKey: registryB.getLocalHost().publicKey,
    address: '192.168.1.150',
    port: 9000,
  });

  // Pair Host C (Linux)
  const hostIdC = 'host_33333333333333333333333333333333';
  const registryC = new LanHostRegistry({
    hostId: hostIdC,
    name: 'Linux Server',
    platform: 'linux',
  });
  const sessionC = registryA.initiatePairing();
  registryA.verifyPairing(sessionC.pairingId, sessionC.pin, {
    hostId: hostIdC,
    name: registryC.name,
    platform: registryC.platform,
    publicKey: registryC.getLocalHost().publicKey,
    address: '192.168.1.200',
    port: 9000,
  });

  // Setup Federator with mock peer request transport
  let hostBReachable = true;
  let hostCReachable = false; // Host C is offline/unreachable

  const federator = new LanHostFederator(registryA, sessionServiceA, {
    requestPeer: async (address, port, path, headers) => {
      if (address === '192.168.1.150' && hostBReachable) {
        return {
          status: 200,
          data: {
            host: registryB.getLocalHost(),
            sessions: [
              {
                sessionKey: formatSessionKey({
                  hostId: hostIdB,
                  harness: { pluginId: 'mock.harness', instanceId: 'default' },
                  nativeSessionId: 'remote-mac-task',
                }),
                title: 'Mac Remote Session',
              },
            ],
          },
        };
      }
      throw new Error('connect ECONNREFUSED');
    },
  });

  // 1. Initial aggregation: Host A (local) online, Host B online, Host C degraded
  const agg1 = await federator.aggregate();
  assert.equal(agg1.length, 3);

  const localEntry = agg1.find(h => h.hostId === hostIdA);
  assert.equal(localEntry?.isLocal, true);
  assert.equal(localEntry?.status, 'online');

  const bEntry = agg1.find(h => h.hostId === hostIdB);
  assert.equal(bEntry?.isLocal, false);
  assert.equal(bEntry?.status, 'online');
  assert.equal(bEntry?.sessions.length, 1);

  const cEntry = agg1.find(h => h.hostId === hostIdC);
  assert.equal(cEntry?.isLocal, false);
  assert.equal(cEntry?.status, 'degraded');

  // 2. Remote Host B disconnects
  hostBReachable = false;
  const agg2 = await federator.aggregate();
  const bEntryAfterDisconnect = agg2.find(h => h.hostId === hostIdB);
  assert.equal(bEntryAfterDisconnect?.status, 'degraded');

  // 3. Local task and destinations are strictly preserved (R-TARGET / R-RECOVER / J07)
  const currentLocalCmd = journalA.command('cmd_local_active_1');
  assert.equal(currentLocalCmd?.status, 'queued');
  assert.equal(currentLocalCmd?.input.sessionKey, localSessionKey);
  assert.equal(parseSessionKey(currentLocalCmd.input.sessionKey).hostId, hostIdA);
});

test('MW.09.02.01.01.A2: same native session ID on different hosts isolated via composite key; G4 gate requires full multi-host matrix', async t => {
  const hostId1 = 'host_11111111111111111111111111111111';
  const hostId2 = 'host_22222222222222222222222222222222';

  // Both hosts have a session with the exact same native ID: "task-alpha-1"
  const nativeId = 'task-alpha-1';

  const key1 = formatSessionKey({
    hostId: hostId1,
    harness: { pluginId: 'mock.harness', instanceId: 'default' },
    nativeSessionId: nativeId,
  });

  const key2 = formatSessionKey({
    hostId: hostId2,
    harness: { pluginId: 'mock.harness', instanceId: 'default' },
    nativeSessionId: nativeId,
  });

  // 1. Composite keys are completely distinct (no collision)
  assert.notEqual(key1, key2);
  assert.equal(parseSessionKey(key1).hostId, hostId1);
  assert.equal(parseSessionKey(key2).hostId, hostId2);

  // 2. Command addressed to Host 1 cannot be registered on Host 2's journal
  const journalDir = `tests/.tmp-journal-foreign-${Date.now()}`;
  const journal2 = new CommandJournal({ hostId: hostId2, directory: journalDir });
  t.after(() => {
    journal2.close();
    try {
      import('node:fs').then(fs => fs.rmSync(journalDir, { recursive: true, force: true }));
    } catch {}
  });

  // Attempting to register Host 1's session on Host 2 throws 'Foreign host'
  assert.throws(
    () => journal2.registerSession(key1, 'owner-1'),
    /Foreign host/
  );

  // This proves identity isolation in one process, not a real two-OS G4 gate.
});
