import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { computeSasVerificationCode } from '../packages/api/dist/index.js';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';

const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['openssl'], { encoding: 'utf8', timeout: 5000 });
const openssl = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).find(line => path.isAbsolute(line.trim()) && fs.existsSync(line.trim())) : undefined;

function httpsJsonRequest({ url, servername, ca, method = 'GET', headers = {}, body }) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const req = https.request({
      hostname: parsed.hostname,
      port: Number(parsed.port || 443),
      path: parsed.pathname,
      method,
      servername,
      ca,
      agent: false,
      headers: {
        Host: servername,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('full Track B pairing journey: QR/code invitation -> P-256 request -> 6-digit SAS -> PC approve -> signed sessions -> replay block -> PC revoke', { skip: !openssl, timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-trackb-journey-'));
  let runtime;
  t.after(async () => {
    await runtime?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  runtime = await startLocalRuntime({
    dataDir: directory,
    desktop: { getAutostart: async () => false, setAutostart: async () => {} },
  });
  const pcClient = new LocalClient(runtime.origin);

  // 1. PC user clicks [Pair Mobile] -> POST /v1/remote/pair/start
  const started = await pcClient.startRemotePairing();
  const invitation = started.snapshot.mobileRemote?.activeInvitation;
  assert.ok(invitation, 'activeInvitation must be present');
  assert.match(invitation.pairingCode, /^SBP1\.[A-Za-z0-9_-]+$/);
  assert.match(invitation.qrSvg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.ok(invitation.endpoints.some(u => u.startsWith('https://127.0.0.1:')));

  // Decode the SBP1 pairing code just like the iPhone QR scanner / clipboard reader does
  const decoded = JSON.parse(Buffer.from(invitation.pairingCode.slice(5), 'base64url').toString('utf8'));
  assert.equal(decoded.v, 1);
  const fingerprint = Buffer.from(decoded.f, 'base64url').toString('hex');
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  const tlsServerName = decoded.s;
  const loopbackEndpoint = decoded.u.find(u => u.startsWith('https://127.0.0.1:'));
  assert.ok(loopbackEndpoint);

  const certPem = JSON.parse(fs.readFileSync(path.join(directory, 'remote', 'tls-identity', 'gateway-tls-identity.v1.json'), 'utf8')).cert;

  // 2. iPhone generates P-256 signing keypair in Keychain and sends POST /remote/v1/pair/request
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeySpki = spkiDer.toString('base64url');
  const expectedDeviceId = `dev_${createHash('sha256').update(spkiDer).digest('hex').slice(0, 16)}`;
  const timestamp = Date.now();

  const proof = createHmac('sha256', decoded.k)
    .update(`snowball-pair-v1\n${decoded.i}\n${fingerprint}\n${publicKeySpki}\n${timestamp}`, 'utf8')
    .digest('base64url');
  const sigMessage = `snowball-pair-sig-v1\n${decoded.i}\n${fingerprint}\n${publicKeySpki}\n${timestamp}\n${proof}`;
  const signature = sign('sha256', Buffer.from(sigMessage, 'utf8'), privateKey).toString('base64url');

  const pairResp = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/pair/request`,
    servername: tlsServerName,
    ca: certPem,
    method: 'POST',
    body: {
      invitationId: decoded.i,
      deviceLabel: 'Won’s iPhone 15',
      publicKeySpki,
      timestamp,
      proof,
      signature,
    },
  });
  assert.equal(pairResp.status, 201);
  assert.equal(pairResp.body.deviceId, expectedDeviceId);

  // Single-use invitation cannot be replayed
  const replayInvite = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/pair/request`,
    servername: tlsServerName,
    ca: certPem,
    method: 'POST',
    body: {
      invitationId: decoded.i,
      deviceLabel: 'Attacker Replay',
      publicKeySpki,
      timestamp,
      proof,
      signature,
    },
  });
  assert.equal(replayInvite.status, 401);

  // 3. Verify 6-digit SAS code matches identically on iPhone and PC
  const phoneSas = computeSasVerificationCode(decoded.i, fingerprint, publicKeySpki);
  assert.equal(pairResp.body.verificationCode, phoneSas);
  const snapWithPending = await pcClient.snapshot();
  assert.equal(snapWithPending.mobileRemote?.pendingRequests.length, 1);
  const pcPending = snapWithPending.mobileRemote.pendingRequests[0];
  assert.equal(pcPending.verificationCode, phoneSas);
  assert.equal(pcPending.deviceLabel, 'Won’s iPhone 15');

  // Helper to build signed request headers
  const signHeaders = (reqPath, customNonce) => {
    const ts = String(Date.now());
    const nonce = customNonce ?? randomBytes(16).toString('base64url');
    const canonical = `snowball-req-v1\nGET\n${reqPath}\n${fingerprint}\n${ts}\n${nonce}`;
    const sig = sign('sha256', Buffer.from(canonical, 'utf8'), privateKey).toString('base64url');
    return {
      'X-Snowball-Device-Id': expectedDeviceId,
      'X-Snowball-Timestamp': ts,
      'X-Snowball-Nonce': nonce,
      'X-Snowball-Signature': sig,
    };
  };

  // Before PC approval, /remote/v1/pair/status is 'pending' and /remote/v1/sessions is 401
  const pendingStatus = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/pair/status`,
    servername: tlsServerName,
    ca: certPem,
    headers: signHeaders('/remote/v1/pair/status'),
  });
  assert.equal(pendingStatus.status, 200);
  assert.equal(pendingStatus.body.status, 'pending');

  const unapprovedSessions = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/sessions`,
    servername: tlsServerName,
    ca: certPem,
    headers: signHeaders('/remote/v1/sessions'),
  });
  assert.equal(unapprovedSessions.status, 401);

  // 4. PC user confirms 6-digit SAS and clicks [Approve]
  const afterApprove = await pcClient.approveRemotePairing(pcPending.pairingId);
  assert.equal(afterApprove.snapshot.mobileRemote?.pendingRequests.length, 0);
  assert.equal(afterApprove.snapshot.mobileRemote?.pairedDevices.length, 1);
  assert.equal(afterApprove.snapshot.mobileRemote.pairedDevices[0].deviceId, expectedDeviceId);

  // Phone poll now sees 'approved'
  const approvedStatus = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/pair/status`,
    servername: tlsServerName,
    ca: certPem,
    headers: signHeaders('/remote/v1/pair/status'),
  });
  assert.equal(approvedStatus.status, 200);
  assert.equal(approvedStatus.body.status, 'approved');

  // 5. Phone reads /remote/v1/sessions signed by its P-256 private key
  const fixedNonce = randomBytes(16).toString('base64url');
  const firstHeaders = signHeaders('/remote/v1/sessions', fixedNonce);
  const sessionsResp = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/sessions`,
    servername: tlsServerName,
    ca: certPem,
    headers: firstHeaders,
  });
  assert.equal(sessionsResp.status, 200);
  assert.deepEqual(sessionsResp.body, { sessions: [] });

  // Replaying the exact same signed request headers (same nonce) is rejected
  const replayedReq = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/sessions`,
    servername: tlsServerName,
    ca: certPem,
    headers: firstHeaders,
  });
  assert.equal(replayedReq.status, 401);

  // 6. PC user clicks [Disconnect / Revoke] -> device immediately loses access
  const afterRevoke = await pcClient.revokeRemoteDevice(expectedDeviceId);
  assert.equal(afterRevoke.snapshot.mobileRemote?.pairedDevices.length, 0);

  const revokedSessions = await httpsJsonRequest({
    url: `${loopbackEndpoint}/remote/v1/sessions`,
    servername: tlsServerName,
    ca: certPem,
    headers: signHeaders('/remote/v1/sessions'),
  });
  assert.equal(revokedSessions.status, 401);
});
