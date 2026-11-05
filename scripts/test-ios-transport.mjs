#!/usr/bin/env node
// Runs the actual Apple URLSession/Security implementation against disposable
// loopback TLS peers. It does not configure Tailscale or trust a system root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw Error('Native TLS verification requires macOS with Swift.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-ios-tls-'));
const servers = [];
const counts = {};
try {
  function certificate(name, host = 'localhost', validity) {
    const key = path.join(temporary, `${name}.key`), cert = path.join(temporary, `${name}.pem`);
    const result = spawnSync('/usr/bin/openssl', ['req', '-x509', '-sha256', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-pkeyopt', 'ec_param_enc:named_curve',
      '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`,
      '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=serverAuth'],
    { stdio: 'ignore', timeout: 10000 });
    assert.equal(result.status, 0, 'Disposable TLS identity generation');
    if (validity) {
      // LibreSSL silently turns `req -days -1` into a valid 30-day cert.
      // Use explicit CA dates and verify them before claiming an expiry test.
      const csr = path.join(temporary, `${name}.csr`), config = path.join(temporary, `${name}.cnf`);
      const database = path.join(temporary, `${name}.db`), serial = path.join(temporary, `${name}.serial`);
      fs.writeFileSync(database, ''); fs.writeFileSync(serial, '01\n');
      fs.writeFileSync(config, `[ca]\ndefault_ca=local\n[local]\ndatabase=${database}\nserial=${serial}\nnew_certs_dir=${temporary}\ndefault_md=sha256\npolicy=subject\nx509_extensions=server\n[subject]\ncommonName=supplied\n[server]\nsubjectAltName=DNS:${host}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`);
      assert.equal(spawnSync('/usr/bin/openssl', ['req', '-new', '-key', key, '-out', csr, '-subj', `/CN=${host}`], { stdio: 'ignore' }).status, 0);
      assert.equal(spawnSync('/usr/bin/openssl', ['ca', '-batch', '-selfsign', '-config', config, '-keyfile', key, '-cert', cert,
        '-in', csr, '-out', cert, '-startdate', validity[0], '-enddate', validity[1]], { stdio: 'ignore' }).status, 0);
    }
    const identity = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    return { ...identity, pin: new X509Certificate(identity.cert).fingerprint256.replaceAll(':', '').toLowerCase() };
  }
  const good = certificate('good'), other = certificate('other'), wrongHost = certificate('wrong', 'wrong.example');
  const expired = certificate('expired', 'localhost', ['20000101000000Z', '20000102000000Z']);
  const future = certificate('future', 'localhost', ['20360101000000Z', '20360102000000Z']);
  assert.ok(Date.parse(new X509Certificate(expired.cert).validTo) < Date.now(), 'Expiry fixture must actually be expired');
  assert.ok(Date.parse(new X509Certificate(future.cert).validFrom) > Date.now(), 'Future fixture must not yet be valid');
  const fixtures = {};
  async function peer(name, identity, respond) {
    counts[name] = 0;
    const server = https.createServer(identity, (request, response) => {
      counts[name]++;
      assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(43)}`);
      assert.equal(request.url, '/remote/v1/sessions');
      respond(request, response);
    });
    servers.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fixtures[name] = { url: `https://localhost:${server.address().port}/remote/v1/sessions`, pin: identity.pin, der: new X509Certificate(identity.cert).raw.toString('base64') };
  }
  const json = (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"sessions":[]}'); };
  await peer('ok', good, json);
  await peer('other', other, json);
  await peer('wrongHost', wrongHost, json);
  await peer('expired', expired, json);
  await peer('future', future, json);
  await peer('redirectTarget', good, json);
  await peer('redirect', good, (_request, response) => { response.writeHead(302, { Location: fixtures.redirectTarget.url }); response.end(); });
  await peer('oversized', good, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '65537' }); response.end('a'.repeat(65537)); });
  await peer('chunked', good, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('a'.repeat(32768)); response.end('b'.repeat(32769)); });
  for (const [name, status] of [['unauthorized', 401], ['forbidden', 403], ['rateLimited', 429], ['unavailable', 503]]) {
    await peer(name, good, (_request, response) => { response.writeHead(status); response.end(); });
  }
  await peer('html', good, (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<html>bad</html>'); });
  await peer('slow', good, () => {});
  const fixtureFile = path.join(temporary, 'fixtures.json');
  fs.writeFileSync(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
  const compiler = process.env.SNOWBALL_SWIFT ?? '/usr/bin/swift';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(compiler, ['test', '--disable-sandbox', '--package-path', path.join(root, 'apps/mobile/modules/gateway-transport'),
      '--scratch-path', path.join(temporary, 'build'), '--cache-path', path.join(temporary, 'cache')], {
      stdio: 'inherit', env: { ...process.env, SNOWBALL_IOS_TLS_FIXTURES: fixtureFile,
        CLANG_MODULE_CACHE_PATH: path.join(temporary, 'clang-cache') },
    });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Native TLS tests must pass');
  for (const name of ['other', 'wrongHost', 'expired', 'future', 'redirectTarget']) assert.equal(counts[name], 0, `${name} must receive no HTTP request or credential`);
  assert.equal(counts.ok, 1, 'A successful native TLS request must reach the server');
  console.log('Verified: mismatched TLS peers and redirect target received no HTTP credentials.');
} finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(temporary, { recursive: true, force: true });
}
