import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { createHash, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import type { SessionService } from '@snowball/core';
import { PersistentRemoteCredentials, type RemoteCredentialInfo } from './remote-credentials.js';
import { RemotePairingCoordinator } from './remote-pairing.js';
import { parseTailscaleHost } from './tailscale-host.js';

type Grant = RemoteCredentialInfo;
export interface RemoteReadGatewayOptions {
  sessionService: SessionService;
  /** Optional exact authority; remote authorities require gateway-owned TLS. */
  proxyHosts?: string[];
  port?: number;
  bindAddress?: '127.0.0.1' | '0.0.0.0';
  now?: () => number;
  /** Constructed only after the caller validates its OS-private storage. */
  credentialStore?: PersistentRemoteCredentials;
  /** Optional device-key pairing and signed-request coordinator. */
  pairing?: RemotePairingCoordinator;
  /** Development-only in-memory key material; callers own secure acquisition and rotation. */
  tls?: { host: string; cert: string | Buffer; key: string | Buffer };
}

/**
 * Development foundation only: separate loopback listener, no pairing.
 * Trusted local code must explicitly start it and issue/revoke each in-memory
 * credential. It never forwards requests to the unauthenticated Supervisor.
 */
export class RemoteReadGateway {
  private readonly server: http.Server | https.Server;
  private readonly grants = new Map<string, Grant>();
  private readonly rates = new Map<string, { requests: number; window: number }>();
  private readonly now: () => number;
  private readonly proxyHosts: Set<string>;
  private readonly tlsFingerprint: string = '';
  private originValue = '';
  private authority = '';
  private closed = false;
  private starting = false;
  private attempts = 0;
  private attemptWindow = 0;

  constructor(private readonly options: RemoteReadGatewayOptions) {
    this.now = options.now ?? Date.now;
    this.proxyHosts = new Set(options.proxyHosts ?? []);
    for (const host of this.proxyHosts) {
      // An authority, never a URL, wildcard, credentials, path, or whitespace.
      if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host) || host.length > 253) throw new Error('Invalid proxy Host');
    }
    if (!options.tls && this.proxyHosts.size) throw new Error('Remote proxy Host requires gateway TLS');
    const serverOptions = { maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 };
    if (options.tls) {
      let host: string;
      let key: ReturnType<typeof createPrivateKey>;
      let certificate: X509Certificate;
      try {
        host = parseTailscaleHost(options.tls.host);
        certificate = new X509Certificate(options.tls.cert);
        key = createPrivateKey(options.tls.key);
        const now = this.now();
        if (!Number.isFinite(now) || !Number.isFinite(Date.parse(certificate.validFrom)) || !Number.isFinite(Date.parse(certificate.validTo)) ||
            now < Date.parse(certificate.validFrom) || now >= Date.parse(certificate.validTo) ||
            certificate.checkHost(host, { subject: 'never', wildcards: false }) !== host || !certificate.checkPrivateKey(key) ||
            [...this.proxyHosts].some(proxyHost => proxyHost !== host)) throw new Error('invalid identity');
      } catch {
        throw new Error('Invalid remote TLS identity');
      }
      this.tlsFingerprint = createHash('sha256').update(certificate.raw).digest('hex');
      this.proxyHosts.add(host);
      const context = tls.createSecureContext({ cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' });
      this.server = https.createServer({
        ...serverOptions, cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2',
        SNICallback: (servername, callback) => {
          if (servername.toLowerCase() !== host) return callback(new Error('Unrecognized server name'));
          callback(null, context);
        },
      }, (req, res) => void this.route(req, res));
      // The native client connects using the approved DNS name, never an IP.
      // Reject clients that omit SNI as well as clients selecting another name.
      this.server.on('secureConnection', socket => {
        if (!socket.servername || socket.servername.toLowerCase() !== host) socket.destroy();
      });
    } else {
      this.server = http.createServer(serverOptions, (req, res) => void this.route(req, res));
    }
    this.server.maxConnections = 32;
    this.server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  }

  get origin(): string { if (!this.originValue) throw new Error('Gateway not listening'); return this.originValue; }

  async start(): Promise<string> {
    if (this.closed || this.starting || this.originValue) throw new Error('Gateway already started or closed');
    this.starting = true;
    try {
      const bindHost = this.options.bindAddress ?? '127.0.0.1';
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.server.once('error', onError);
        this.server.listen(this.options.port ?? 0, bindHost, () => { this.server.off('error', onError); resolve(); });
      });
      const address = this.server.address();
      if (!address || typeof address === 'string' || (address.address !== '127.0.0.1' && address.address !== '0.0.0.0')) throw new Error('Unexpected gateway listener');
      this.authority = `127.0.0.1:${address.port}`;
      this.originValue = `${this.options.tls ? 'https' : 'http'}://${this.authority}`;
      return this.originValue;
    } finally { this.starting = false; }
  }

  /** Trusted local code only; this is not a pairing endpoint. Never log the token. */
  issueReadCredential(label = 'Remote device'): { deviceId: string; token: string; expiresAt: number } {
    if (!this.originValue || this.closed) throw new Error('Gateway not listening');
    if (this.options.credentialStore) return this.options.credentialStore.issue(label);
    if (!label || label.length > 64 || label !== label.trim() || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('Invalid device label');
    const now = this.now();
    for (const [hash, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(hash);
    if (this.grants.size >= 16) throw new Error('Credential capacity reached');
    const token = randomBytes(32).toString('base64url');
    const deviceId = `remote_${randomBytes(16).toString('hex')}`;
    const expiresAt = now + 8 * 60 * 60 * 1000;
    this.grants.set(createHash('sha256').update(token).digest('hex'), { deviceId, label, issuedAt: now, expiresAt });
    return { deviceId, token, expiresAt };
  }

  /** Trusted local code only; no bearer tokens or token hashes are returned. */
  listReadCredentials(): RemoteCredentialInfo[] {
    if (!this.originValue || this.closed) throw new Error('Gateway not listening');
    if (this.options.credentialStore) return this.options.credentialStore.list();
    const now = this.now();
    return [...this.grants.values()].filter(grant => grant.issuedAt <= now && grant.expiresAt > now).map(grant => ({ ...grant }));
  }

  /** Trusted local code only. Existing connections have no streaming state. */
  revokeCredential(deviceId: string): void {
    if (this.options.credentialStore && /^remote_[a-f0-9]{32}$/.test(deviceId)) {
      this.options.credentialStore.revoke(deviceId);
    }
    if (deviceId.startsWith('dev_')) {
      this.options.pairing?.revokeDevice(deviceId);
    }
    for (const [hash, grant] of this.grants) if (grant.deviceId === deviceId) this.grants.delete(hash);
    this.rates.delete(deviceId);
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    res.end(data);
  }

  private async readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const ct = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (ct !== 'application/json' || req.headers['content-encoding']) throw new Error('invalid_request');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 8192) throw new Error('payload_limit');
      chunks.push(chunk);
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_request');
    return parsed as Record<string, unknown>;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const now = this.now();
    if (now - this.attemptWindow >= 60_000 || now < this.attemptWindow) { this.attempts = 0; this.attemptWindow = now; }
    const counts = new Map<string, number>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!.toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (['host', 'authorization', 'origin', 'sec-fetch-site', 'content-length', 'x-snowball-device-id', 'x-snowball-timestamp', 'x-snowball-nonce', 'x-snowball-signature'].some(name => (counts.get(name) ?? 0) > 1)) { this.send(res, 400, { error: 'invalid_request' }); return; }
    // Native clients only. This foundation has no browser session or CORS support.
    const host = req.headers.host;
    if (!host || (host !== this.authority && !this.proxyHosts.has(host)) || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) { this.send(res, 403, { error: 'boundary_denied' }); return; }
    if (!req.url || req.url.includes('?') || req.url.includes('#') || req.headers['transfer-encoding'] !== undefined) { this.send(res, 400, { error: 'invalid_request' }); return; }

    if (req.url === '/remote/v1/pair/request') {
      if (req.method !== 'POST') { this.send(res, 405, { error: 'method_denied' }); return; }
      if (!this.options.pairing || !this.tlsFingerprint) { this.send(res, 404, { error: 'not_found' }); return; }
      if (++this.attempts > 1200) { this.send(res, 429, { error: 'rate_limited' }); return; }
      try {
        const body = await this.readJsonBody(req);
        const result = this.options.pairing.submitPairRequest(body, this.tlsFingerprint);
        this.send(res, 201, result);
      } catch (err) {
        const code = err instanceof Error ? err.message : 'invalid_pair_request';
        const status = code === 'invitation_invalid_or_expired' || code === 'invitation_proof_invalid' || code === 'device_signature_invalid' ? 401 : 400;
        this.send(res, status, { error: code });
      }
      return;
    }

    if (req.method !== 'GET') { this.send(res, 405, { error: 'method_denied' }); return; }
    if (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') { this.send(res, 400, { error: 'invalid_request' }); return; }

    if (req.url === '/remote/v1/pair/status') {
      if (!this.options.pairing || !this.tlsFingerprint) { this.send(res, 404, { error: 'not_found' }); return; }
      const devId = typeof req.headers['x-snowball-device-id'] === 'string' ? req.headers['x-snowball-device-id'] : '';
      const ts = typeof req.headers['x-snowball-timestamp'] === 'string' ? req.headers['x-snowball-timestamp'] : '';
      const nonce = typeof req.headers['x-snowball-nonce'] === 'string' ? req.headers['x-snowball-nonce'] : '';
      const sig = typeof req.headers['x-snowball-signature'] === 'string' ? req.headers['x-snowball-signature'] : '';
      if (!devId || !ts || !nonce || !sig) {
        this.send(res, ++this.attempts > 1200 ? 429 : 401, { error: this.attempts > 1200 ? 'rate_limited' : 'unauthorized' }); return;
      }
      try {
        const status = this.options.pairing.checkPairStatus({
          deviceId: devId, timestamp: ts, nonce, signature: sig, gatewayFingerprint: this.tlsFingerprint,
        });
        this.send(res, 200, status);
      } catch {
        this.send(res, ++this.attempts > 1200 ? 429 : 401, { error: this.attempts > 1200 ? 'rate_limited' : 'unauthorized' });
      }
      return;
    }

    const signedDeviceId = typeof req.headers['x-snowball-device-id'] === 'string' ? req.headers['x-snowball-device-id'] : '';
    const signedSignature = typeof req.headers['x-snowball-signature'] === 'string' ? req.headers['x-snowball-signature'] : '';
    let deviceId: string | undefined;
    try {
      if (signedDeviceId && signedSignature && this.options.pairing && this.tlsFingerprint) {
        const ts = typeof req.headers['x-snowball-timestamp'] === 'string' ? req.headers['x-snowball-timestamp'] : '';
        const nonce = typeof req.headers['x-snowball-nonce'] === 'string' ? req.headers['x-snowball-nonce'] : '';
        deviceId = this.options.pairing.authenticateSignedRequest({
          method: 'GET', path: req.url, deviceId: signedDeviceId, timestamp: ts, nonce, signature: signedSignature, gatewayFingerprint: this.tlsFingerprint,
        })?.deviceId;
      } else {
        const auth = req.headers.authorization;
        const hash = auth && /^Bearer [A-Za-z0-9_-]{43}$/.test(auth) ? createHash('sha256').update(auth.slice(7)).digest('hex') : '';
        if (this.options.credentialStore) deviceId = this.options.credentialStore.authenticate(hash, now)?.deviceId;
        else {
          const grant = this.grants.get(hash);
          if (grant && grant.issuedAt <= now && grant.expiresAt > now) deviceId = grant.deviceId;
        }
      }
    } catch { this.send(res, 503, { error: 'unavailable' }); return; }
    if (!deviceId) {
      this.send(res, ++this.attempts > 1200 ? 429 : 401, { error: this.attempts > 1200 ? 'rate_limited' : 'unauthorized' }); return;
    }
    let rate = this.rates.get(deviceId);
    if (!rate) { rate = { requests: 0, window: now }; this.rates.set(deviceId, rate); }
    if (now - rate.window >= 60_000 || now < rate.window) { rate.window = now; rate.requests = 0; }
    if (++rate.requests > 120) { this.send(res, 429, { error: 'rate_limited' }); return; }
    if (req.url !== '/remote/v1/sessions') { this.send(res, 404, { error: 'not_found' }); return; }
    try {
      // Counts and harness identifiers remain sensitive metadata. Do not export
      // titles (which may contain prompts), session identifiers, paths, message
      // text, decisions or commands through this experimental interface.
      const sessions = this.options.sessionService.snapshotSessions().slice(0, 256).map(session => ({
        status: ['idle', 'busy', 'error'].includes(session.status) ? session.status : 'unknown',
        harnessPluginId: typeof session.harnessPluginId === 'string' && session.harnessPluginId.length <= 128 && /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(session.harnessPluginId) ? session.harnessPluginId : 'unknown',
      }));
      if (Buffer.byteLength(JSON.stringify(sessions)) > 1024 * 1024) { this.send(res, 503, { error: 'capacity' }); return; }
      this.send(res, 200, { sessions });
    } catch { this.send(res, 503, { error: 'unavailable' }); }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.grants.clear(); this.rates.clear();
    if (this.server.listening) await new Promise<void>((resolve, reject) => {
      this.server.close(error => error ? reject(error) : resolve());
      this.server.closeAllConnections();
    });
    this.originValue = '';
  }
}
