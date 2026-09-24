import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import {
  LanHostRegistry,
  LanHostListener,
  CommandJournal,
  SessionService,
  ControllerContext,
  createHostId,
  formatSessionKey,
} from '../packages/core/dist/index.js';

// Helper to make HTTP request
function request(origin, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, origin);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // non-json body
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== null) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('MW.09.01.01.01.A1: Unregistered host, spoofed signature, expired credential rejected; network-off immediately closes listener', async t => {
  const hostIdA = 'host_00000000000000000000000000000001';
  const registryA = new LanHostRegistry({
    hostId: hostIdA,
    name: 'Windows Workstation',
    platform: 'win32',
  });

  const listenerA = new LanHostListener(registryA, {
    host: '127.0.0.1',
    getStatus: () => ({ customMetric: 42 }),
  });

  // Start listener
  const originA = await listenerA.start();
  t.after(async () => {
    await listenerA.close();
  });

  assert.equal(listenerA.isRunning, true);

  // 1. Unregistered host attempts to access /peer/status -> 401
  const fakeHostId = 'host_ffffffffffffffffffffffffffffffff';
  const now = Date.now();
  const unregRes = await request(originA, 'GET', '/peer/status', {
    'x-snowball-host-id': fakeHostId,
    'x-snowball-timestamp': now.toString(),
    'x-snowball-signature': 'fake-signature',
  });
  assert.equal(unregRes.status, 401);
  assert.equal(unregRes.json?.error, 'unauthorized');

  // 2. Setup Host B and pair properly
  const hostIdB = 'host_00000000000000000000000000000002';
  const registryB = new LanHostRegistry({
    hostId: hostIdB,
    name: 'MacBook Pro',
    platform: 'darwin',
  });

  // Initiate pairing on A
  const session = registryA.initiatePairing();
  assert.equal(session.status, 'pending');

  // Verify pairing with correct PIN and Host B info
  const pairedOnA = registryA.verifyPairing(session.pairingId, session.pin, {
    hostId: hostIdB,
    name: registryB.name,
    platform: registryB.platform,
    publicKey: registryB.getLocalHost().publicKey,
    address: '127.0.0.1',
    port: 9000,
  });
  assert.equal(pairedOnA.status, 'paired');
  assert.equal(registryA.listPairedHosts().length, 1);

  // Also pair A on B so B can sign requests
  const sessionB = registryB.initiatePairing();
  registryB.verifyPairing(sessionB.pairingId, sessionB.pin, {
    hostId: hostIdA,
    name: registryA.name,
    platform: registryA.platform,
    publicKey: registryA.getLocalHost().publicKey,
    address: '127.0.0.1',
    port: 8000,
  });

  // 3. Valid authenticated request from Host B -> 200
  const validTimestamp = Date.now();
  const validPayload = `${validTimestamp}:GET:/peer/status:`;
  const validSig = registryB.signPayload(validPayload);

  const validRes = await request(originA, 'GET', '/peer/status', {
    'x-snowball-host-id': hostIdB,
    'x-snowball-timestamp': validTimestamp.toString(),
    'x-snowball-signature': validSig,
  });
  assert.equal(validRes.status, 200);
  assert.equal(validRes.json?.online, true);
  assert.equal(validRes.json?.customMetric, 42);

  // 4. Spoofed signature (altered payload / wrong key) -> 401
  const spoofRes = await request(originA, 'GET', '/peer/status', {
    'x-snowball-host-id': hostIdB,
    'x-snowball-timestamp': validTimestamp.toString(),
    'x-snowball-signature': 'altered_or_wrong_signature',
  });
  assert.equal(spoofRes.status, 401);
  assert.equal(spoofRes.json?.error, 'invalid_signature');

  // 5. Expired credential / timestamp drift (> 30s) -> 401
  const expiredTimestamp = Date.now() - 40_000;
  const expiredPayload = `${expiredTimestamp}:GET:/peer/status:`;
  const expiredSig = registryB.signPayload(expiredPayload);

  const expiredRes = await request(originA, 'GET', '/peer/status', {
    'x-snowball-host-id': hostIdB,
    'x-snowball-timestamp': expiredTimestamp.toString(),
    'x-snowball-signature': expiredSig,
  });
  assert.equal(expiredRes.status, 401);
  assert.equal(expiredRes.json?.error, 'credential_expired');

  // 6. Network-off: Closing listener immediately terminates access
  await listenerA.close();
  assert.equal(listenerA.isRunning, false);

  // Subsequent request immediately fails with connection refused / reset
  await assert.rejects(
    request(originA, 'GET', '/peer/status', {
      'x-snowball-host-id': hostIdB,
      'x-snowball-timestamp': Date.now().toString(),
      'x-snowball-signature': validSig,
    }),
    /ECONNREFUSED|ECONNRESET/
  );
});

test('MW.09.01.01.01.A2: same-process platform-labelled fixture pairing/cancellation/unpairing leaves local PC control independent', async t => {
  // Setup Windows host with local session & journal
  const winHostId = 'host_11111111111111111111111111111111';
  const winRegistry = new LanHostRegistry({
    hostId: winHostId,
    name: 'Windows Desktop',
    platform: 'win32',
  });
  const winListener = new LanHostListener(winRegistry, { host: '127.0.0.1' });
  const winOrigin = await winListener.start();
  t.after(async () => {
    await winListener.close();
  });

  // Windows local control resources:
  const journalDir = `tests/.tmp-win-journal-${Date.now()}`;
  const winJournal = new CommandJournal({
    hostId: winHostId,
    directory: journalDir,
  });
  t.after(() => {
    winJournal.close();
    try {
      import('node:fs').then(fs => fs.rmSync(journalDir, { recursive: true, force: true }));
    } catch {}
  });
  const winSessionService = new SessionService({
    hostId: winHostId,
    journal: winJournal,
  });

  // Register an owned local harness adapter on Windows
  class LocalHarnessAdapter extends EventEmitter {
    status(){return {instanceId:'win-instance',connected:true};}
    ownerId = 'win-owner-1';
    async createSession(root, options = {}) {
      const sessionKey = formatSessionKey({
        hostId: winHostId,
        harness: { pluginId: 'test.local', instanceId: 'win-instance' },
        nativeSessionId: 'sess-win-1',
      });
      return { sessionKey, ownerId: this.ownerId };
    }
    async listSessions() {
      const sessionKey = formatSessionKey({
        hostId: winHostId,
        harness: { pluginId: 'test.local', instanceId: 'win-instance' },
        nativeSessionId: 'sess-win-1',
      });
      return [{ sessionKey, nativeId: 'sess-win-1', readOnly: false, ownerId: this.ownerId, preview: 'Windows Critical Task' }];
    }
    async readSession(id) {
      return { nativeId: id, readOnly: false };
    }
    async execute(envelope, signal) {
      return { receiptId: 'rec-1', status: 'completed' };
    }
  }

  const localHarness = new LocalHarnessAdapter();
  winSessionService.registerAdapter('test.local', localHarness);
  const winSession = await winSessionService.createSession('test.local', 'C:\\workspace\\test', {
    title: 'Windows Critical Task',
  });
  assert.ok(winSession.sessionKey);

  // Setup Mac host with local control
  const macHostId = 'host_22222222222222222222222222222222';
  const macRegistry = new LanHostRegistry({
    hostId: macHostId,
    name: 'Mac Studio',
    platform: 'darwin',
  });
  const macListener = new LanHostListener(macRegistry, { host: '127.0.0.1' });
  const macOrigin = await macListener.start();
  t.after(async () => {
    await macListener.close();
  });

  // Mac local controller context (R-TARGET / J03)
  const macActorId = `ctl_${'a'.repeat(16)}`;
  const macContext = new ControllerContext(macActorId);
  const macSessionKey = formatSessionKey({
    hostId: macHostId,
    harness: { pluginId: 'test.mac', instanceId: 'mac-inst' },
    nativeSessionId: 'mac-sess-1',
  });
  macContext.beginDraft('draft-mac-1', macSessionKey);

  // --- Step 1: Pairing Initiation and Cancellation ---
  const cancelSession = winRegistry.initiatePairing();
  assert.equal(cancelSession.status, 'pending');
  winRegistry.cancelPairing(cancelSession.pairingId);
  assert.throws(
    () =>
      winRegistry.verifyPairing(cancelSession.pairingId, cancelSession.pin, {
        hostId: macHostId,
        name: macRegistry.name,
        platform: macRegistry.platform,
        publicKey: macRegistry.getLocalHost().publicKey,
        address: '127.0.0.1',
        port: 8000,
      }),
    /invalid_pairing_state|cancelled/
  );
  // Verify local control on Windows unaffected:
  const initialSessions = await winSessionService.listSessions();
  assert.equal(initialSessions.length, 1);
  assert.equal(initialSessions[0].title, 'Windows Critical Task');

  // Trusted-local fixture enrollment only. HTTP cannot create or disclose a PIN.
  const initRes = await request(winOrigin, 'POST', '/peer/pair/initiate', {}, {});
  assert.equal(initRes.status, 403);
  const enrollment = winRegistry.initiatePairing();
  winRegistry.verifyPairing(enrollment.pairingId, enrollment.pin, {
    ...macRegistry.getLocalHost(), address: '127.0.0.1', port: 8001,
  });

  // Also pair Windows on Mac
  const macPairing = macRegistry.initiatePairing();
  macRegistry.verifyPairing(macPairing.pairingId, macPairing.pin, {
    hostId: winHostId,
    name: winRegistry.name,
    platform: winRegistry.platform,
    publicKey: winRegistry.getLocalHost().publicKey,
    address: '127.0.0.1',
    port: 8000,
  });

  assert.equal(winRegistry.listPairedHosts().length, 1);
  assert.equal(macRegistry.listPairedHosts().length, 1);

  // --- Step 3: Authenticated Peer Query ---
  // Mac queries Windows status
  const t1 = Date.now();
  const sig1 = macRegistry.signPayload(`${t1}:GET:/peer/status:`);
  const statusRes = await request(winOrigin, 'GET', '/peer/status', {
    'x-snowball-host-id': macHostId,
    'x-snowball-timestamp': t1.toString(),
    'x-snowball-signature': sig1,
  });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.json?.host?.name, 'Windows Desktop');
  assert.equal(statusRes.json?.host?.platform, 'win32');

  // Verify Mac's local draft was not retargeted (R-TARGET)
  const macDraft = macContext.getDraft();
  assert.equal(macDraft?.destinationKey, macSessionKey);
  assert.equal(macDraft?.draftId, 'draft-mac-1');

  // --- Step 4: Unpair / Revocation ---
  // Mac unpairs from Windows
  const t2 = Date.now();
  const sig2 = macRegistry.signPayload(`${t2}:POST:/peer/unpair:`);
  const unpairRes = await request(winOrigin, 'POST', '/peer/unpair', {
    'x-snowball-host-id': macHostId,
    'x-snowball-timestamp': t2.toString(),
    'x-snowball-signature': sig2,
  });
  assert.equal(unpairRes.status, 200);

  // Windows no longer has Mac paired
  assert.equal(winRegistry.getPairedHost(macHostId), undefined);
  assert.equal(winRegistry.listPairedHosts().length, 0);

  // Mac attempting further status query to Windows is rejected -> 401
  const t3 = Date.now();
  const sig3 = macRegistry.signPayload(`${t3}:GET:/peer/status:`);
  const rejectedRes = await request(winOrigin, 'GET', '/peer/status', {
    'x-snowball-host-id': macHostId,
    'x-snowball-timestamp': t3.toString(),
    'x-snowball-signature': sig3,
  });
  assert.equal(rejectedRes.status, 401);

  // --- Step 5: Verify Local PC Control Remains 100% Independent ---
  // Windows session and journal continue functioning normally:
  const winSessions = await winSessionService.listSessions();
  assert.equal(winSessions.length, 1);
  assert.equal(winSessions[0].title, 'Windows Critical Task');

  // Windows can send prompt to its local harness
  const actorId = `ctl_${'e'.repeat(16)}`;
  const promptRes = await winSessionService.sendPrompt(
    actorId,
    winSessions[0].sessionKey,
    'Local command after unpairing'
  );
  assert.equal(promptRes.status, 'queued');

  // Mac local draft continues functioning normally:
  const finalMacDraft = macContext.getDraft();
  assert.equal(finalMacDraft?.destinationKey, macSessionKey);
  assert.equal(finalMacDraft?.draftId, 'draft-mac-1');
});
