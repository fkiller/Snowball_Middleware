import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareGatewayIdentity } from '../apps/supervisor/gateway-identity.mjs';
import { RemoteReadGateway } from '../packages/api/dist/index.js';

const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['openssl'], { encoding: 'utf8', timeout: 5000 });
const openssl = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).find(line => path.isAbsolute(line) && fs.existsSync(line)) : undefined;
const host = 'node.example.ts.net';

test('a private dedicated gateway identity is stable and fails closed on damage, expiry or another host', { skip: !openssl, timeout: 30000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-gateway-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'private');
  const first = prepareGatewayIdentity({ directory, host, openssl });
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.host, host);
  // LibreSSL otherwise emits explicit EC parameters that Apple's TLS stack
  // rejects before the URLSession trust callback. Require the P-256 curve OID.
  const publicKey = new X509Certificate(first.certificate).publicKey.export({ format: 'der', type: 'spki' });
  assert.ok(publicKey.includes(Buffer.from('06082a8648ce3d030107', 'hex')));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE KEY/);
  const reopened = prepareGatewayIdentity({ directory, host });
  assert.equal(reopened.fingerprint, first.fingerprint);
  assert.equal(reopened.certificate, first.certificate);
  const file = path.join(directory, 'gateway-tls-identity.v1.json');
  const original = fs.readFileSync(file);
  assert.throws(() => prepareGatewayIdentity({ directory, host: 'other.example.ts.net', openssl }), /not replaced/);
  assert.throws(() => prepareGatewayIdentity({ directory, host, openssl, now: Date.now() + 31 * 86400000 }), /not replaced/);
  assert.deepEqual(fs.readFileSync(file), original);
  fs.writeFileSync(file, '{"private":"do-not-print"');
  assert.throws(() => prepareGatewayIdentity({ directory, host, openssl }), error =>
    error.message === 'Gateway identity unavailable; existing identity was not replaced');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"private":"do-not-print"');
});

test('a pinned dedicated certificate rejects another valid same-host TLS endpoint before a bearer is sent', { skip: !openssl, timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-gateway-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = prepareGatewayIdentity({ directory: path.join(root, 'first'), host, openssl });
  const other = prepareGatewayIdentity({ directory: path.join(root, 'other'), host, openssl });
  assert.notEqual(first.fingerprint, other.fingerprint);
  const gateway = new RemoteReadGateway({ sessionService: { snapshotSessions: () => [] }, tls: first.tlsOptions() });
  await gateway.start();
  t.after(() => gateway.close());
  const grant = gateway.issueReadCredential();
  let attackerReceived = false;
  const attacker = https.createServer(other.tlsOptions(), (_req, res) => { attackerReceived = true; res.end(); });
  await new Promise((resolve, reject) => { attacker.once('error', reject); attacker.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => attacker.close(resolve)));
  // These self-signed fixtures have the same subject. OpenSSL can choose the
  // wrong same-subject anchor from a combined CA array before reaching the pin
  // check. Trust each peer individually so the negative case really exercises
  // a PKI-valid, same-host endpoint with the wrong dedicated fingerprint.
  const request = (port, certificate) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, servername: host, path: '/remote/v1/sessions',
      ca: certificate, agent: false, headers: { Host: host, Authorization: `Bearer ${grant.token}` },
      checkServerIdentity: (name, peer) => tls.checkServerIdentity(name, peer) ||
        (createHash('sha256').update(peer.raw).digest('hex') === first.fingerprint ? undefined : Error('gateway_identity_mismatch')),
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(await request(Number(new URL(gateway.origin).port), first.certificate), 200);
  await assert.rejects(request(attacker.address().port, other.certificate), /gateway_identity_mismatch/);
  assert.equal(attackerReceived, false);
});

test('an identity whose private file becomes accessible to other users is refused', { skip: !openssl, timeout: 30000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-gateway-acl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'private');
  prepareGatewayIdentity({ directory, host, openssl });
  const file = path.join(directory, 'gateway-tls-identity.v1.json');
  if (process.platform === 'win32') {
    const icacls = path.join(process.env.SystemRoot, 'System32', 'icacls.exe');
    const result = spawnSync(icacls, [file, '/grant', '*S-1-1-0:(R)'], { windowsHide: true, stdio: 'ignore' });
    assert.equal(result.status, 0);
  } else fs.chmodSync(file, 0o644);
  assert.throws(() => prepareGatewayIdentity({ directory, host }), /not replaced/);
});
