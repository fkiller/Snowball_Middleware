import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { RemoteReadGateway } from '../packages/api/dist/index.js';
import { listSessions } from '../apps/mobile/remote.mjs';

test('a TLS terminator with the same host certificate is not gateway identity', { timeout: 30000 }, async t => {
  const openssl = spawnSync('openssl', ['version'], { stdio: 'ignore', timeout: 5000 });
  if (openssl.error || openssl.status !== 0) { t.skip('OpenSSL is needed for the disposable test certificate'); return; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-terminator-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const certFile = path.join(temp, 'certificate.pem'), keyFile = path.join(temp, 'key.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
    '-out', certFile, '-days', '1', '-subj', '/CN=node.tail.ts.net', '-addext', 'subjectAltName=DNS:node.tail.ts.net'],
    { stdio: 'ignore', timeout: 15000 });
  assert.equal(generated.status, 0);
  const cert = fs.readFileSync(certFile), key = fs.readFileSync(keyFile);
  const gateway = new RemoteReadGateway({ sessionService: { snapshotSessions: () => [] }, tls: { host: 'node.tail.ts.net', cert, key } });
  await gateway.start();
  t.after(() => gateway.close());
  const grant = gateway.issueReadCredential();
  const upstreamPort = Number(new URL(gateway.origin).port);
  let terminatorReceivedCredential = false;
  const terminator = https.createServer({ cert, key }, (request, response) => {
    terminatorReceivedCredential = request.headers.authorization === `Bearer ${grant.token}`;
    const upstream = https.request({ host: '127.0.0.1', port: upstreamPort, path: request.url,
      servername: 'node.tail.ts.net', ca: cert, headers: { Host: 'node.tail.ts.net', Authorization: request.headers.authorization } },
    result => { response.writeHead(result.statusCode); result.pipe(response); });
    upstream.on('error', () => response.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => { terminator.once('error', reject); terminator.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => terminator.close(resolve)));

  // Control: a normal TLS-validated client accepts the same certificate at a
  // terminator and would expose its disposable test bearer to that process.
  const status = await new Promise((resolve, reject) => {
    const request = https.request({ host: '127.0.0.1', port: terminator.address().port, path: '/remote/v1/sessions',
      servername: 'node.tail.ts.net', ca: cert,
      headers: { Host: 'node.tail.ts.net', Authorization: `Bearer ${grant.token}` } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 200);
  assert.equal(terminatorReceivedCredential, true);

  // The actual mobile entry point must refuse before even invoking a transport.
  let called = false;
  await assert.rejects(listSessions('https://node.tail.ts.net', grant.token, async () => { called = true; }),
    error => error.kind === 'gateway_identity_unverified');
  assert.equal(called, false);
});
