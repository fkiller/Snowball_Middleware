import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { SessionService } from '@snowball/core';

type Grant = { deviceId: string; expiresAt: number; requests: number; window: number };
export interface RemoteReadGatewayOptions {
  sessionService: SessionService;
  /** Additional exact HTTP Host authorities accepted from a trusted local proxy. */
  proxyHosts?: string[];
  port?: number;
  now?: () => number;
}

/**
 * Development foundation only: separate loopback listener, no pairing or TLS.
 * Trusted local code must explicitly start it and issue/revoke each in-memory
 * credential. It never forwards requests to the unauthenticated Supervisor.
 */
export class RemoteReadGateway {
  private readonly server: http.Server;
  private readonly grants = new Map<string, Grant>();
  private readonly now: () => number;
  private readonly proxyHosts: Set<string>;
  private originValue = '';
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
    this.server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, (req, res) => this.route(req, res));
    this.server.maxConnections = 32;
    this.server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  }

  get origin(): string { if (!this.originValue) throw new Error('Gateway not listening'); return this.originValue; }

  async start(): Promise<string> {
    if (this.closed || this.starting || this.originValue) throw new Error('Gateway already started or closed');
    this.starting = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.server.once('error', onError);
        this.server.listen(this.options.port ?? 0, '127.0.0.1', () => { this.server.off('error', onError); resolve(); });
      });
      const address = this.server.address();
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Unexpected gateway listener');
      this.originValue = `http://127.0.0.1:${address.port}`;
      return this.originValue;
    } finally { this.starting = false; }
  }

  /** Trusted local code only; this is not a pairing endpoint. Never log the token. */
  issueReadCredential(): { deviceId: string; token: string; expiresAt: number } {
    if (!this.originValue || this.closed) throw new Error('Gateway not listening');
    const now = this.now();
    for (const [hash, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(hash);
    if (this.grants.size >= 16) throw new Error('Credential capacity reached');
    const token = randomBytes(32).toString('base64url');
    const deviceId = `remote_${randomBytes(16).toString('hex')}`;
    const expiresAt = now + 8 * 60 * 60 * 1000;
    this.grants.set(createHash('sha256').update(token).digest('hex'), { deviceId, expiresAt, requests: 0, window: now });
    return { deviceId, token, expiresAt };
  }

  /** Trusted local code only. Existing connections have no streaming state. */
  revokeCredential(deviceId: string): void {
    for (const [hash, grant] of this.grants) if (grant.deviceId === deviceId) this.grants.delete(hash);
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    res.end(data);
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const now = this.now();
    if (now - this.attemptWindow >= 60_000 || now < this.attemptWindow) { this.attempts = 0; this.attemptWindow = now; }
    if (++this.attempts > 1200) { this.send(res, 429, { error: 'rate_limited' }); return; }
    const counts = new Map<string, number>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!.toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (['host', 'authorization', 'origin', 'sec-fetch-site', 'content-length'].some(name => (counts.get(name) ?? 0) > 1)) { this.send(res, 400, { error: 'invalid_request' }); return; }
    // Native clients only. This foundation has no browser session or CORS support.
    const host = req.headers.host;
    if (!host || (host !== this.origin.slice(7) && !this.proxyHosts.has(host)) || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) { this.send(res, 403, { error: 'boundary_denied' }); return; }
    if (req.method !== 'GET') { this.send(res, 405, { error: 'method_denied' }); return; }
    if (!req.url || req.url.includes('?') || req.url.includes('#') || req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) { this.send(res, 400, { error: 'invalid_request' }); return; }
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) { this.send(res, 401, { error: 'unauthorized' }); return; }
    const hash = createHash('sha256').update(auth.slice(7)).digest('hex');
    const grant = this.grants.get(hash);
    if (!grant || grant.expiresAt <= now) { if (grant) this.grants.delete(hash); this.send(res, 401, { error: 'unauthorized' }); return; }
    if (now - grant.window >= 60_000 || now < grant.window) { grant.window = now; grant.requests = 0; }
    if (++grant.requests > 120) { this.send(res, 429, { error: 'rate_limited' }); return; }
    if (req.url !== '/remote/v1/sessions') { this.send(res, 404, { error: 'not_found' }); return; }
    try {
      // Counts and harness identifiers remain sensitive metadata. Do not export
      // titles (which may contain prompts), session identifiers, paths, message
      // text, decisions or commands through this experimental interface.
      const sessions = this.options.sessionService.snapshotSessions().slice(0, 256).map(session => ({
        status: session.status, harnessPluginId: session.harnessPluginId,
      }));
      if (Buffer.byteLength(JSON.stringify(sessions)) > 1024 * 1024) { this.send(res, 503, { error: 'capacity' }); return; }
      this.send(res, 200, { sessions });
    } catch { this.send(res, 503, { error: 'unavailable' }); }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.grants.clear();
    if (this.server.listening) await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    this.originValue = '';
  }
}
