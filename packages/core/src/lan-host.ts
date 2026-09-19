import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { generateKeyPairSync, sign, verify, randomBytes, randomInt, timingSafeEqual, type KeyObject } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { isHostId, parseHostId, createHostId, type HostId } from './identity.js';

export class LanHostFault extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'LanHostFault';
  }
}

function ensure(value: unknown, code: string, message?: string): asserts value {
  if (!value) throw new LanHostFault(code, message);
}

export interface LocalHostConfig {
  hostId: HostId;
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  publicKey?: string;
  privateKey?: string;
}

export interface PairedHost {
  hostId: HostId;
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  publicKey: string;
  address: string;
  port: number;
  pairedAt: number;
  status: 'paired' | 'revoked';
  lastSeenAt?: number;
}

export interface PairingSession {
  pairingId: string;
  pin: string;
  remoteAddress?: string;
  remotePort?: number;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'cancelled' | 'expired';
}

export class LanHostRegistry {
  readonly hostId: HostId;
  readonly name: string;
  readonly platform: 'darwin' | 'win32' | 'linux';
  private readonly publicKeyPem: string;
  private readonly privateKeyPem: string;

  private readonly pairedHosts = new Map<HostId, PairedHost>();
  private readonly pairingSessions = new Map<string, PairingSession>();
  private readonly now: () => number;

  constructor(config: LocalHostConfig, options?: { now?: () => number }) {
    this.hostId = parseHostId(config.hostId);
    this.name = config.name;
    this.platform = config.platform;
    this.now = options?.now ?? Date.now;

    if (config.publicKey && config.privateKey) {
      this.publicKeyPem = config.publicKey;
      this.privateKeyPem = config.privateKey;
    } else {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    }
  }

  getLocalHost() {
    return {
      hostId: this.hostId,
      name: this.name,
      platform: this.platform,
      publicKey: this.publicKeyPem,
    };
  }

  initiatePairing(options?: { remoteAddress?: string; remotePort?: number; ttlMs?: number }): PairingSession {
    this.pruneSessions();
    const pairingId = randomBytes(16).toString('hex');
    const pin = randomInt(100000, 1000000).toString();
    const ttlMs = options?.ttlMs ?? 60_000;
    const createdAt = this.now();
    const session: PairingSession = {
      pairingId,
      pin,
      remoteAddress: options?.remoteAddress,
      remotePort: options?.remotePort,
      createdAt,
      expiresAt: createdAt + ttlMs,
      status: 'pending',
    };
    this.pairingSessions.set(pairingId, session);
    return { ...session };
  }

  cancelPairing(pairingId: string): void {
    const session = this.pairingSessions.get(pairingId);
    if (session && session.status === 'pending') {
      session.status = 'cancelled';
    }
  }

  verifyPairing(
    pairingId: string,
    pin: string,
    remoteHost: {
      hostId: HostId;
      name: string;
      platform: 'darwin' | 'win32' | 'linux';
      publicKey: string;
      address: string;
      port: number;
    }
  ): PairedHost {
    this.pruneSessions();
    const session = this.pairingSessions.get(pairingId);
    ensure(session, 'pairing_not_found', 'Pairing session not found or expired');
    ensure(session.status === 'pending', 'invalid_pairing_state', `Session status is ${session.status}`);
    ensure(session.expiresAt > this.now(), 'pairing_expired', 'Pairing session expired');

    // Safe comparison of PIN
    const pinBuf = Buffer.from(pin);
    const expectedBuf = Buffer.from(session.pin);
    const pinMatches = pinBuf.length === expectedBuf.length && timingSafeEqual(pinBuf, expectedBuf);
    ensure(pinMatches, 'invalid_pin', 'Pairing PIN mismatch');

    const hostId = parseHostId(remoteHost.hostId);
    ensure(hostId !== this.hostId, 'cannot_pair_self', 'Cannot pair with own host identity');
    ensure(remoteHost.publicKey && remoteHost.publicKey.includes('PUBLIC KEY'), 'invalid_public_key');

    const paired: PairedHost = {
      hostId,
      name: remoteHost.name,
      platform: remoteHost.platform,
      publicKey: remoteHost.publicKey,
      address: remoteHost.address,
      port: remoteHost.port,
      pairedAt: this.now(),
      status: 'paired',
      lastSeenAt: this.now(),
    };

    session.status = 'approved';
    this.pairedHosts.set(hostId, paired);
    return { ...paired };
  }

  revokeHost(hostId: HostId): void {
    const host = this.pairedHosts.get(hostId);
    if (host) {
      host.status = 'revoked';
    }
  }

  unpairHost(hostId: HostId): void {
    this.pairedHosts.delete(hostId);
  }

  getPairedHost(hostId: HostId): PairedHost | undefined {
    const host = this.pairedHosts.get(hostId);
    if (!host || host.status !== 'paired') return undefined;
    return { ...host };
  }

  listPairedHosts(): PairedHost[] {
    return Array.from(this.pairedHosts.values())
      .filter(h => h.status === 'paired')
      .map(h => ({ ...h }));
  }

  updateHostAddress(hostId: HostId, address: string, port: number): void {
    const host = this.pairedHosts.get(hostId);
    ensure(host && host.status === 'paired', 'host_not_paired');
    host.address = address;
    host.port = port;
    host.lastSeenAt = this.now();
  }

  signPayload(payload: string): string {
    const signature = sign(null, Buffer.from(payload, 'utf8'), this.privateKeyPem);
    return signature.toString('base64url');
  }

  verifySignature(hostId: HostId, payload: string, signatureBase64: string): boolean {
    const host = this.getPairedHost(hostId);
    if (!host) return false;
    try {
      const sigBuf = Buffer.from(signatureBase64, 'base64url');
      return verify(null, Buffer.from(payload, 'utf8'), host.publicKey, sigBuf);
    } catch {
      return false;
    }
  }

  private pruneSessions(): void {
    const now = this.now();
    for (const [id, session] of this.pairingSessions) {
      if (session.expiresAt <= now && session.status === 'pending') {
        session.status = 'expired';
      }
    }
  }
}

export interface LanHostListenerOptions {
  host?: string;
  port?: number;
  now?: () => number;
  getStatus?: () => Record<string, unknown>;
}

export class LanHostListener {
  private server?: http.Server;
  private listeningOrigin?: string;
  private readonly sockets = new Set<import('node:net').Socket>();
  private readonly now: () => number;

  constructor(
    readonly registry: LanHostRegistry,
    private readonly options: LanHostListenerOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  get origin(): string {
    if (!this.listeningOrigin) throw new LanHostFault('not_listening', 'LAN listener is not running');
    return this.listeningOrigin;
  }

  get isRunning(): boolean {
    return !!this.server && !!this.listeningOrigin;
  }

  async start(): Promise<string> {
    if (this.server) throw new LanHostFault('already_running', 'LAN listener already started');

    const bindHost = this.options.host ?? '127.0.0.1';
    const bindPort = this.options.port ?? 0;

    this.server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
      this.route(req, res).catch(err => {
        this.sendError(res, err);
      });
    });

    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(bindPort, bindHost, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    const addr = this.server.address();
    if (!addr || typeof addr === 'string') throw new LanHostFault('bind_error');
    this.listeningOrigin = `http://${bindHost}:${addr.port}`;
    return this.listeningOrigin;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = undefined;
    this.listeningOrigin = undefined;

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    await new Promise<void>(resolve => {
      s.close(() => resolve());
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'POST' && url === '/peer/pair/initiate') {
      const body = await this.readJson(req);
      const session = this.registry.initiatePairing({
        remoteAddress: typeof body.address === 'string' ? body.address : undefined,
        remotePort: typeof body.port === 'number' ? body.port : undefined,
      });
      this.sendJson(res, 200, {
        pairingId: session.pairingId,
        pin: session.pin,
        expiresAt: session.expiresAt,
        localHost: this.registry.getLocalHost(),
      });
      return;
    }

    if (method === 'POST' && url === '/peer/pair/verify') {
      const body = await this.readJson(req);
      ensure(typeof body.pairingId === 'string' && typeof body.pin === 'string' && typeof body.host === 'object' && body.host !== null, 'invalid_request');
      const remoteHost = body.host as {
        hostId: HostId;
        name: string;
        platform: 'darwin' | 'win32' | 'linux';
        publicKey: string;
        address: string;
        port: number;
      };
      const paired = this.registry.verifyPairing(body.pairingId, body.pin, remoteHost);
      this.sendJson(res, 200, {
        success: true,
        pairedHost: paired,
        localHost: this.registry.getLocalHost(),
      });
      return;
    }

    // All other /peer/* routes require mutual cryptographic authentication
    const remoteHostId = req.headers['x-snowball-host-id'] as string;
    const timestampStr = req.headers['x-snowball-timestamp'] as string;
    const signature = req.headers['x-snowball-signature'] as string;

    if (!remoteHostId || !timestampStr || !signature) {
      this.sendJson(res, 401, { error: 'unauthorized', message: 'Missing authentication headers' });
      return;
    }

    const host = this.registry.getPairedHost(remoteHostId);
    if (!host) {
      this.sendJson(res, 401, { error: 'unauthorized', message: 'Unregistered or revoked host' });
      return;
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || Math.abs(this.now() - timestamp) > 30_000) {
      this.sendJson(res, 401, { error: 'credential_expired', message: 'Timestamp drift or expired credential' });
      return;
    }

    let bodyText = '';
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      bodyText = await this.readText(req);
    }

    const payload = `${timestamp}:${method}:${url}:${bodyText}`;
    if (!this.registry.verifySignature(remoteHostId, payload, signature)) {
      this.sendJson(res, 401, { error: 'invalid_signature', message: 'Signature verification failed' });
      return;
    }

    if (method === 'GET' && url === '/peer/status') {
      const customStatus = this.options.getStatus ? this.options.getStatus() : {};
      this.sendJson(res, 200, {
        host: this.registry.getLocalHost(),
        online: true,
        now: this.now(),
        ...customStatus,
      });
      return;
    }

    if (method === 'POST' && url === '/peer/unpair') {
      this.registry.unpairHost(remoteHostId);
      this.sendJson(res, 200, { success: true });
      return;
    }

    this.sendJson(res, 404, { error: 'not_found' });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const json = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  private sendError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof LanHostFault) {
      const status = error.code === 'invalid_pin' ? 403 : error.code === 'pairing_expired' || error.code === 'credential_expired' ? 401 : 400;
      this.sendJson(res, status, { error: error.code, message: error.message });
      return;
    }
    this.sendJson(res, 500, { error: 'internal_error' });
  }

  private async readText(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 1024 * 1024) throw new LanHostFault('payload_too_large');
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const text = await this.readText(req);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new LanHostFault('invalid_json');
    }
  }
}

export interface HostAggregation {
  hostId: HostId;
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  status: 'online' | 'degraded' | 'offline' | 'revoked';
  isLocal: boolean;
  sessions: any[];
  lastSeenAt?: number;
  error?: string;
}

export interface LanHostFederatorOptions {
  now?: () => number;
  requestPeer?: (
    address: string,
    port: number,
    path: string,
    headers: Record<string, string>
  ) => Promise<{ status: number; data: any }>;
}

export interface SessionSource {
  listSessions(pluginId?: string): Promise<any[]>;
}

export class LanHostFederator {
  private readonly now: () => number;

  constructor(
    readonly registry: LanHostRegistry,
    readonly sessionSource: SessionSource,
    private readonly options: LanHostFederatorOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  async aggregate(): Promise<HostAggregation[]> {
    const localHost = this.registry.getLocalHost();
    const localSessions = await this.sessionSource.listSessions();

    const result: HostAggregation[] = [
      {
        hostId: localHost.hostId,
        name: localHost.name,
        platform: localHost.platform,
        status: 'online',
        isLocal: true,
        sessions: localSessions,
        lastSeenAt: this.now(),
      },
    ];

    const paired = this.registry.listPairedHosts();
    for (const remote of paired) {
      if (remote.status === 'revoked') {
        result.push({
          hostId: remote.hostId,
          name: remote.name,
          platform: remote.platform,
          status: 'revoked',
          isLocal: false,
          sessions: [],
        });
        continue;
      }

      try {
        if (this.options.requestPeer) {
          const timestamp = this.now();
          const signature = this.registry.signPayload(`${timestamp}:GET:/peer/status:`);
          const res = await this.options.requestPeer(remote.address, remote.port, '/peer/status', {
            'x-snowball-host-id': localHost.hostId,
            'x-snowball-timestamp': timestamp.toString(),
            'x-snowball-signature': signature,
          });

          if (res.status === 200) {
            result.push({
              hostId: remote.hostId,
              name: remote.name,
              platform: remote.platform,
              status: 'online',
              isLocal: false,
              sessions: Array.isArray(res.data?.sessions) ? res.data.sessions : [],
              lastSeenAt: this.now(),
            });
          } else {
            result.push({
              hostId: remote.hostId,
              name: remote.name,
              platform: remote.platform,
              status: 'degraded',
              isLocal: false,
              sessions: [],
              error: `HTTP ${res.status}`,
            });
          }
        } else {
          result.push({
            hostId: remote.hostId,
            name: remote.name,
            platform: remote.platform,
            status: 'offline',
            isLocal: false,
            sessions: [],
          });
        }
      } catch (err: any) {
        result.push({
          hostId: remote.hostId,
          name: remote.name,
          platform: remote.platform,
          status: 'degraded',
          isLocal: false,
          sessions: [],
          error: err?.message || 'peer_unreachable',
        });
      }
    }

    return result;
  }
}
