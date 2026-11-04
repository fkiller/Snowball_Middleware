import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { parseTailscaleHost } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';

// Experimental host-side building block, not a pairing protocol. The caller
// must be trusted local code; neither this module nor the private key is
// exposed through the local HTTP API or the mobile application.
const FILE = 'gateway-tls-identity.v1.json';
const MAX_BYTES = 32 * 1024;

function validateIdentity(record, expectedHost, now) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).sort().join(',') !== 'cert,host,key,version' || record.version !== 1 ||
      record.host !== expectedHost || typeof record.cert !== 'string' || typeof record.key !== 'string') throw Error('invalid');
  const cert = new X509Certificate(record.cert);
  const key = createPrivateKey(record.key);
  const validFrom = Date.parse(cert.validFrom), validTo = Date.parse(cert.validTo);
  if (!Number.isFinite(now) || !Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now >= validTo ||
      cert.ca || cert.subject !== cert.issuer || !cert.verify(cert.publicKey) ||
      cert.checkHost(expectedHost, { subject: 'never', wildcards: false }) !== expectedHost ||
      key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !cert.checkPrivateKey(key)) throw Error('invalid');
  const fingerprint = createHash('sha256').update(cert.raw).digest('hex');
  // The private key is held in this closure and never appears in serialization
  // or an ordinary console inspection of the returned object.
  return Object.freeze({ host: expectedHost, fingerprint, certificate: record.cert,
    tlsOptions: () => ({ host: expectedHost, cert: record.cert, key: record.key }) });
}

function readIdentity(directory, host, now) {
  const dir = ensurePrivateStateDirectory(directory, [FILE]);
  const file = path.join(dir, FILE);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('invalid');
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_BYTES) throw Error('invalid');
  return validateIdentity(JSON.parse(bytes.toString('utf8')), host, now);
}

/**
 * Create once or load an exact-host identity in an OS-private directory.
 * The explicitly selected OpenSSL executable is a trusted local dependency.
 * A damaged/expired identity or a different hostname never triggers rotation.
 * This does not prove a phone identity, provision TLS to a listener, configure
 * Tailscale, or make a self-signed certificate trusted by a client.
 */
export function prepareGatewayIdentity({ directory, host, openssl, now }) {
  try {
    const currentTime = () => now === undefined ? Date.now() : now;
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('invalid');
    const canonicalHost = parseTailscaleHost(host);
    const dir = ensurePrivateStateDirectory(path.resolve(directory), [FILE]);
    const file = path.join(dir, FILE);
    if (fs.existsSync(file)) return readIdentity(dir, canonicalHost, currentTime());
    if (typeof openssl !== 'string' || !path.isAbsolute(openssl)) throw Error('invalid');
    const executable = fs.realpathSync(openssl);
    if (!fs.statSync(executable).isFile()) throw Error('invalid');
    fs.accessSync(executable, fs.constants.X_OK);
    const temporary = fs.mkdtempSync(path.join(dir, '.gateway-keygen-'));
    const certFile = path.join(temporary, 'cert.pem'), keyFile = path.join(temporary, 'key.pem');
    try {
      ensurePrivateStateDirectory(temporary);
      const env = {};
      // Do not forward OpenSSL configuration/module overrides or unrelated
      // runtime injection variables to the selected executable.
      for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH']) {
        if (typeof process.env[name] === 'string') env[name] = process.env[name];
      }
      const result = spawnSync(executable, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '30', '-subj', `/CN=${canonicalHost}`,
        '-addext', `subjectAltName=DNS:${canonicalHost}`, '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=serverAuth'],
      { shell: false, windowsHide: true, stdio: 'ignore', timeout: 30000, env });
      if (result.error || result.status !== 0) throw Error('key generation failed');
      const record = { version: 1, host: canonicalHost, cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
      validateIdentity(record, canonicalHost, currentTime());
      const data = Buffer.from(JSON.stringify(record));
      if (data.length > MAX_BYTES) throw Error('invalid');
      // Exclusive creation prevents overwriting a concurrent or prior identity.
      // An interrupted/corrupt file is retained for explicit local recovery.
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } finally {
      for (const name of [certFile, keyFile]) try { fs.unlinkSync(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.rmdirSync(temporary);
    }
    return readIdentity(dir, canonicalHost, currentTime());
  } catch { throw Error('Gateway identity unavailable; existing identity was not replaced'); }
}
