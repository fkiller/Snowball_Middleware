import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { RemoteReadGateway, parseTailscaleHost, extractTailscaleSelfHost } from '../packages/api/dist/index.js';

test('tailnet authority accepts only a canonical, exact node name', () => {
  assert.equal(parseTailscaleHost('NODE.Tail-1.ts.net.'), 'node.tail-1.ts.net');
  for (const value of [null, '', ' node.tail.ts.net', 'node.tail.ts.net ', 'https://node.tail.ts.net',
    'node.tail.ts.net:443', '*.tail.ts.net', 'node.tail.ts.net..', 'node.ts.net', 'node..tail.ts.net',
    '-node.tail.ts.net', 'node.tail.ts.net.example.com', 'node.tail.ts.net/path', 'nóde.tail.ts.net']) {
    assert.throws(() => parseTailscaleHost(value), /Invalid Tailscale host/);
  }
});

test('Tailscale self host extraction fails closed for offline or malformed status', () => {
  assert.equal(extractTailscaleSelfHost({ BackendState: 'Running', Self: { Online: true, DNSName: 'NODE.tail.ts.net.' } }), 'node.tail.ts.net');
  for (const value of [null, [], {}, { BackendState: 'Stopped', Self: { Online: true, DNSName: 'node.tail.ts.net' } },
    { BackendState: 'Running', Self: { Online: false, DNSName: 'node.tail.ts.net' } },
    { BackendState: 'Running', Self: { Online: 'true', DNSName: 'node.tail.ts.net' } },
    { BackendState: 'Running', Self: { Online: true, DNSName: 'node.evil.invalid' } },
    { BackendState: 'Running', Peer: { DNSName: 'node.tail.ts.net' } }]) {
    assert.throws(() => extractTailscaleSelfHost(value));
  }
});

// A raw TCP forwarder keeps TLS end-to-end between the client and gateway.
// The test-only CA is trusted only by this client, never by product code.
test('raw TCP forwarding preserves TLS to the authenticated gateway and rejects a hijacked backend', { timeout: 30000 }, async t => {
  const available = spawnSync('openssl', ['version'], { stdio: 'ignore', timeout: 5000 });
  if (available.error || available.status !== 0) { t.skip('OpenSSL is needed to create an ephemeral test certificate'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-tls-proxy-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const keyFile = path.join(tmp, 'key.pem');
  const certFile = path.join(tmp, 'cert.pem');
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
    '-out', certFile, '-days', '1', '-subj', '/CN=node.tail.ts.net', '-addext', 'subjectAltName=DNS:node.tail.ts.net'], { stdio: 'ignore', timeout: 15000 });
  assert.equal(openssl.status, 0, 'ephemeral test certificate creation failed');
  const ca = fs.readFileSync(certFile);
  const key = fs.readFileSync(keyFile);
  const makeImpostor = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'impostor.key'),
    '-out', path.join(tmp, 'impostor.pem'), '-days', '1', '-subj', '/CN=node.tail.ts.net', '-addext', 'subjectAltName=DNS:node.tail.ts.net'], { stdio: 'ignore', timeout: 15000 });
  assert.equal(makeImpostor.status, 0);
  const impostorKey = fs.readFileSync(path.join(tmp, 'impostor.key'));
  const impostorCert = fs.readFileSync(path.join(tmp, 'impostor.pem'));
  const sessionService = { snapshotSessions: () => [{ status: 'idle', harnessPluginId: 'snowball.codex' }] };
  assert.throws(() => new RemoteReadGateway({ sessionService, tls: { host: 'other.tail.ts.net', cert: ca, key } }), /Invalid remote TLS identity/);
  assert.throws(() => new RemoteReadGateway({ sessionService, tls: { host: 'node.tail.ts.net', cert: ca, key: impostorKey } }), /Invalid remote TLS identity/);
  assert.throws(() => new RemoteReadGateway({ sessionService, now: () => Date.now() + 3 * 86400000, tls: { host: 'node.tail.ts.net', cert: ca, key } }), /Invalid remote TLS identity/);
  assert.throws(() => new RemoteReadGateway({ sessionService, proxyHosts: ['other.tail.ts.net'], tls: { host: 'node.tail.ts.net', cert: ca, key } }), /Invalid remote TLS identity/);
  const gateway = new RemoteReadGateway({ sessionService, tls: { host: 'node.tail.ts.net', cert: ca, key } });
  await gateway.start();
  t.after(() => gateway.close());
  const gatewayPort = Number(new URL(gateway.origin).port);
  const proxySockets = new Set();
  const trackSocket = socket => {
    proxySockets.add(socket);
    socket.once('close', () => proxySockets.delete(socket));
    return socket;
  };
  const proxy = net.createServer(socket => {
    trackSocket(socket);
    const upstream = net.createConnection({ host: '127.0.0.1', port: gatewayPort });
    trackSocket(upstream);
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.pipe(upstream); upstream.pipe(socket);
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => {
    for (const socket of proxySockets) socket.destroy();
    return new Promise(resolve => proxy.close(resolve));
  });
  const port = proxy.address().port;
  const credential = gateway.issueReadCredential();
  const request = ({ host = 'node.tail.ts.net', servername = 'node.tail.ts.net', token = credential.token, rejectUnauthorized = true } = {}) => new Promise((resolve, reject) => {
    // Do not reuse an old pooled connection: the takeover assertion must
    // perform a fresh TLS handshake with the replacement backend.
    const req = https.request({ hostname: '127.0.0.1', port, path: '/remote/v1/sessions', servername, ca, agent: false,
      rejectUnauthorized,
      headers: { Host: host, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  assert.deepEqual(JSON.parse((await request()).body), { sessions: [{ status: 'idle', harnessPluginId: 'snowball.codex' }] });
  assert.equal((await request({ host: 'other.tail.ts.net' })).status, 403);
  assert.equal((await request({ token: '' })).status, 401);
  // The gateway closes the handshake itself for a foreign or missing SNI,
  // including clients that do not validate certificates on their own.
  await assert.rejects(request({ servername: 'other.tail.ts.net', rejectUnauthorized: false }), { code: 'ECONNRESET' });
  await assert.rejects(request({ servername: '', rejectUnauthorized: false }), { code: 'ECONNRESET' });
  gateway.revokeCredential(credential.deviceId);
  assert.equal((await request()).status, 401);
  await gateway.close();
  let stolen = 0;
  const hijacker = https.createServer({ key: impostorKey, cert: impostorCert }, (req, res) => { stolen++; res.end(); });
  await new Promise((resolve, reject) => { hijacker.once('error', reject); hijacker.listen(gatewayPort, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => hijacker.close(resolve)));
  await assert.rejects(request(), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  assert.equal(stolen, 0, 'an untrusted backend must not receive the HTTP request or bearer');
});
