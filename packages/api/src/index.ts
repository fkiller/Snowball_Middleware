import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { CommandJournal, createControllerId, JournalFault, type CommandInput, type DeviceRegistry, type DiscoverySnapshot, type WorkspaceStore } from '@snowball/core';
import { WorkspaceFiles } from './workspaces.js';
import type { SupervisorAssets } from './supervisor.js';
export { loadSupervisorAssets, type SupervisorAssets } from './supervisor.js';
export { WorkspaceFiles, type WorkspaceSummary } from './workspaces.js';

const secret = () => randomBytes(32).toString('base64url');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
class ApiFault extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function fail(status: number, code: string): never { throw new ApiFault(status, code); }
/** Actionable selection/storage failures without paths or raw exceptions. */
const SELECTION_STATUS: Record<string, number> = {
  workspace_selection_cancelled: 409,
  workspace_selection_busy: 429,
  workspace_selection_invalid: 400,
  workspace_selection_limit: 429,
  workspace_selection_missing: 503,
  workspace_selection_permission: 503,
  workspace_selection_storage: 503,
  workspace_selection_unavailable: 503,
  workspace_storage_unavailable: 503,
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
interface Session { controllerId: string; csrfHash: string; expiresAt: number; requests: number; window: number }
interface Stream { response: ServerResponse; session: Session }
interface Event { cursor: string; data: string }
export interface LocalApiOptions {
  journal: CommandJournal; workspaces?: WorkspaceFiles; devices?: DeviceRegistry; harness?: HarnessSurvey; port?: number;
  sessionTtlMs?: number; eventCapacity?: number; now?: () => number;
  supervisor?: SupervisorAssets;
  workspaceStore?: WorkspaceStore;
  /** Trusted native picker. The HTTP request never supplies a path or display name. */
  chooseWorkspace?: (signal: AbortSignal) => Promise<{ root: string; displayName: string } | null>;
}
/**
 * Reviewed harness candidate survey supplied by the trusted runtime.
 * describe() returns the last reviewed scan without touching the filesystem;
 * rescan() reruns bounded metadata collection on explicit user action.
 * Neither grants enrollment nor runs probes: provider policies and probe
 * approvals belong to provider/runtime tasks, never to a browser action.
 */
export interface HarnessSurvey {
  describe(): DiscoverySnapshot;
  rescan(): Promise<DiscoverySnapshot>;
}

/** Constructed by the local runtime. Construction does not start any harness or device. */
export class LocalApi {
  private readonly server: http.Server;
  private readonly sessions = new Map<string, Session>();
  private readonly grants = new Map<string, number>();
  private readonly streams = new Set<Stream>();
  private readonly events: Event[] = [];
  private readonly epoch = randomBytes(16).toString('hex');
  private sequence = 0;
  private originValue = '';
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly eventCapacity: number;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeDevices?: () => void;
  private readonly unsubscribeWorkspaces?: () => void;
  private readonly workspaceChecks = new Set<string>();
  private harnessScanning = false;
  private selection?: { controllerId: string; abort: AbortController };
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private attemptWindow = 0;
  private closed = false;
  private starting = false;
  constructor(private readonly options: LocalApiOptions) {
    if (options.workspaceStore) {
      if (options.workspaces) throw new Error('Supply workspaceStore or workspaces, not both');
      this.options = { ...options, workspaces: WorkspaceFiles.fromRegistry(options.workspaceStore) };
    }
    this.now = options.now ?? Date.now;
    this.ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
    this.eventCapacity = options.eventCapacity ?? 256;
    if (!Number.isSafeInteger(this.ttl) || this.ttl < 1 || !Number.isSafeInteger(this.eventCapacity) || this.eventCapacity < 1 || this.eventCapacity > 4096) throw new Error('Invalid API limits');
    this.server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, (req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      void this.route(req, res).catch(error => this.error(res, error));
    });
    this.server.maxConnections = 64;
    this.server.on('clientError', (_, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
    this.unsubscribe = options.journal.subscribe(() => this.changed());
    this.unsubscribeDevices = options.devices?.subscribe(() => this.changed());
    this.unsubscribeWorkspaces = this.options.workspaces?.subscribe(() => this.changed());
  }
  get origin(): string { if (!this.originValue) throw new Error('API not listening'); return this.originValue; }
  get cursor(): string { return `${this.epoch}:${this.sequence}`; }
  async start(): Promise<string> {
    if (this.closed || this.starting || this.server.listening || this.originValue) throw new Error('API already started or closed');
    this.starting = true;
    await new Promise<void>((resolve, reject) => {
      const error = (e: Error) => reject(e);
      this.server.once('error', error);
      this.server.listen(this.options.port ?? 0, '127.0.0.1', () => { this.server.off('error', error); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Unexpected listener');
    this.originValue = `http://127.0.0.1:${address.port}`;
    this.heartbeat = setInterval(() => {
      this.prune();
      for (const stream of this.streams) this.writeStream(stream, ': heartbeat\n\n');
    }, 15_000); this.heartbeat.unref();
    return this.origin;
  }
  /** Trusted tray/CLI only; never exposed as an HTTP route. Return value is secret. */
  issueBootstrap(): { code: string; expiresAt: number } {
    if (this.closed || !this.originValue) throw new Error('API not running'); this.prune();
    if (this.grants.size >= 16) throw new Error('Bootstrap capacity reached');
    const code = secret(); const expiresAt = this.now() + 60_000;
    this.grants.set(digest(code), expiresAt); return { code, expiresAt };
  }
  revokeController(controllerId: string): void {
    if (this.selection?.controllerId === controllerId) this.selection.abort.abort();
    for (const [hash, session] of this.sessions) if (session.controllerId === controllerId) this.sessions.delete(hash);
    for (const stream of this.streams) if (stream.session.controllerId === controllerId) { stream.response.end(); this.streams.delete(stream); }
  }
  private prune(): void {
    for (const [hash, expiry] of this.grants) if (expiry <= this.now()) this.grants.delete(hash);
    for (const [hash, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(hash);
    for (const stream of this.streams) if (stream.session.expiresAt <= this.now()) { stream.response.end(); this.streams.delete(stream); }
  }
  private changed(): void {
    this.sequence++;
    const event = { cursor: this.cursor, data: JSON.stringify({ cursor: this.cursor }) };
    this.events.push(event); if (this.events.length > this.eventCapacity) this.events.shift();
    for (const stream of this.streams) this.writeStream(stream, `id: ${event.cursor}\nevent: changed\ndata: ${event.data}\n\n`);
  }
  private writeStream(stream: Stream, text: string): void {
    if (stream.session.expiresAt <= this.now() || stream.response.destroyed) { stream.response.end(); this.streams.delete(stream); return; }
    if (!stream.response.write(text)) { stream.response.destroy(); this.streams.delete(stream); }
  }
  private send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > 8 * 1024 * 1024) fail(503, 'snapshot_capacity');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(json);
  }
  private error(res: ServerResponse, error: unknown): void {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof ApiFault) { this.send(res, error.status, { error: error.code }); return; }
    if (error instanceof JournalFault) {
      const status = ['stale_revision', 'stale_decision', 'idempotency_conflict', 'conflict', 'expired'].includes(error.code) ? 409 : error.code === 'capacity' ? 429 : ['unavailable', 'io', 'owner_unavailable'].includes(error.code) ? 503 : 400;
      this.send(res, status, { error: error.code }); return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && SELECTION_STATUS[code] !== undefined) {
      this.send(res, SELECTION_STATUS[code]!, { error: code });
      return;
    }
    this.send(res, 400, { error: 'invalid_request' });
  }
  private boundary(req: IncomingMessage): void {
    const duplicates = new Map<string, number>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) { const name = req.rawHeaders[i]!.toLowerCase(); duplicates.set(name, (duplicates.get(name) ?? 0) + 1); }
    if (['host', 'origin', 'authorization', 'x-snowball-csrf', 'content-type'].some(k => (duplicates.get(k) ?? 0) > 1)) fail(400, 'duplicate_header');
    if (req.headers.host !== this.origin.slice(7)) fail(403, 'host_denied');
    if (req.headers.origin !== undefined && req.headers.origin !== this.origin) fail(403, 'origin_denied');
    if (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) fail(403, 'origin_denied');
    if (!['GET', 'POST'].includes(req.method ?? '')) fail(405, 'method_denied');
    if (req.method === 'POST' && req.headers.origin !== this.origin) fail(403, 'origin_required');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048 || req.url.includes('#')) fail(400, 'invalid_url');
  }
  private authenticate(req: IncomingMessage): Session {
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'unauthorized');
    const session = this.sessions.get(digest(auth.slice(7)));
    if (!session || session.expiresAt <= this.now()) fail(401, 'unauthorized');
    if (req.method === 'POST' && (typeof req.headers['x-snowball-csrf'] !== 'string' || digest(req.headers['x-snowball-csrf']) !== session.csrfHash)) fail(403, 'csrf_denied');
    if (this.now() - session.window >= 60_000) { session.window = this.now(); session.requests = 0; }
    if (++session.requests > 600) fail(429, 'rate_limited');
    return session;
  }
  private stillAuthorized(req: IncomingMessage, session: Session): void {
    if (session.expiresAt <= this.now() || this.sessions.get(digest(req.headers.authorization!.slice(7))) !== session) fail(401, 'unauthorized');
  }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || req.headers['content-encoding']) fail(415, 'json_required');
    const buffers: Buffer[] = []; let length = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          for await (const chunk of req) {
            length += chunk.length; if (length > 128 * 1024) fail(413, 'payload_limit'); buffers.push(chunk);
          }
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers)));
          if (!record(value)) fail(400, 'object_required'); return value;
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { req.destroy(); reject(new ApiFault(408, 'request_timeout')); }, 5000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  private snapshot(): unknown {
    return {
      cursor: this.cursor,
      sessions: this.options.journal.listSessions(),
      commands: this.options.journal.listCommands().map(c => ({ commandId: c.input.commandId, actorId: c.input.actorId, sessionKey: c.input.sessionKey, ownerId: c.input.ownerId, operation: c.input.operation, status: c.status, revision: c.revision, order: c.order, updatedAt: c.updatedAt })),
      decisions: this.options.journal.listDecisions().map(d => ({ decisionId: d.decisionId, sessionKey: d.sessionKey, ownerId: d.ownerId, status: d.status, revision: d.revision, ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}) })),
      workspaces: this.options.workspaces?.list() ?? [],
      workspaceDetails: this.options.workspaces?.describe() ?? [],
      workspaceSelectionAvailable: !!(this.options.workspaceStore && this.options.chooseWorkspace),
      devices: this.options.devices?.list() ?? [],
      deviceSources: this.options.devices?.sourceStates() ?? [],
      deviceCandidates: this.options.devices?.listCandidates() ?? [],
      harness: this.options.harness?.describe() ?? null,
    };
  }
  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.boundary(req);
    const url = new URL(req.url!, this.origin);
    const workspaceMatch = /^\/v1\/workspaces\/(ws_[a-f0-9]{16})\/file$/.exec(url.pathname);
    if (url.search && (!workspaceMatch || [...url.searchParams.keys()].some(k => k !== 'path') || url.searchParams.getAll('path').length !== 1)) fail(400, 'query_denied');
    if (this.options.supervisor && req.method === 'GET') {
      const assets = this.options.supervisor;
      const asset = new Map<string, [string, string]>([
        ['/', ['text/html', assets.html]], ['/supervisor/app.js', ['text/javascript', assets.script]],
        ['/supervisor/style.css', ['text/css', assets.style]], ['/supervisor/client.js', ['text/javascript', assets.client]],
      ]).get(url.pathname);
      if (asset) {
        if (Buffer.byteLength(asset[1]) > 1024 * 1024) fail(503, 'asset_capacity');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        res.writeHead(200, { 'Content-Type': `${asset[0]}; charset=utf-8` }); res.end(asset[1]); return;
      }
    }
    if (url.pathname === '/v1/bootstrap' && req.method === 'POST') {
      if (this.now() - this.attemptWindow >= 60_000) { this.attemptWindow = this.now(); this.attempts = 0; }
      if (++this.attempts > 30) fail(429, 'rate_limited');
      const body = await this.body(req); this.prune();
      if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.code) || Object.keys(body).length !== 1) fail(401, 'unauthorized');
      const hash = digest(body.code);
      if (!this.grants.has(hash)) fail(401, 'unauthorized');
      if (this.sessions.size >= 64) fail(429, 'session_capacity');
      this.grants.delete(hash);
      const token = secret(); const csrfToken = secret();
      const session = { controllerId: createControllerId(), csrfHash: digest(csrfToken), expiresAt: this.now() + this.ttl, requests: 0, window: this.now() };
      this.sessions.set(digest(token), session);
      this.send(res, 201, { token, csrfToken, controllerId: session.controllerId, expiresAt: session.expiresAt }); return;
    }
    const session = this.authenticate(req);
    if (url.pathname === '/v1/workspaces/select' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.workspaceStore || !this.options.chooseWorkspace) fail(503, 'workspace_selection_unavailable');
      if (this.selection) fail(429, 'workspace_selection_busy');
      const selection = { controllerId: session.controllerId, abort: new AbortController() };
      this.selection = selection;
      const cancelled = () => selection.abort.abort();
      res.once('close', cancelled);
      const timer = setTimeout(cancelled, 120_000);
      const operation = (async () => {
        const picked = await this.options.chooseWorkspace!(selection.abort.signal);
        this.stillAuthorized(req, session);
        if (selection.abort.signal.aborted) fail(409, 'workspace_selection_cancelled');
        if (!picked) return { selected: false as const };
        // The store checks cancellation again after filesystem inspection, before fsync/publication.
        const workspace = await this.options.workspaceStore!.registerSelected(picked.root, picked.displayName, selection.abort.signal, () => this.stillAuthorized(req, session));
        return { selected: true as const, workspaceId: workspace.workspaceId };
      })();
      // Hold the slot even if the picker ignores abort. No late result may grant a root.
      void operation.then(() => { if (this.selection === selection) this.selection = undefined; }, () => { if (this.selection === selection) this.selection = undefined; });
      let onAbort: () => void = () => {};
      try {
        const result = await Promise.race([operation, new Promise<never>((_, reject) => {
          onAbort = () => reject(new ApiFault(409, 'workspace_selection_cancelled'));
          selection.abort.signal.addEventListener('abort', onAbort, { once: true });
          if (selection.abort.signal.aborted) onAbort();
        })]);
        this.stillAuthorized(req, session); this.send(res, 200, result); return;
      } finally { clearTimeout(timer); res.off('close', cancelled); selection.abort.signal.removeEventListener('abort', onAbort); }
    }
    const workspaceRecheck = /^\/v1\/workspaces\/(ws_[a-f0-9]{16})\/recheck$/.exec(url.pathname);
    if (workspaceRecheck && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.workspaces) fail(404, 'workspace_unavailable');
      const id = workspaceRecheck[1]!;
      if (this.workspaceChecks.has(id) || this.workspaceChecks.size >= 4) fail(429, 'workspace_check_busy');
      this.workspaceChecks.add(id);
      const pending = this.options.workspaces.recheck(id);
      // A timeout ends the HTTP wait, not the native filesystem operation. Retain
      // its slot until settlement so repeated retries cannot multiply hung work.
      void pending.then(() => this.workspaceChecks.delete(id), () => this.workspaceChecks.delete(id));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        let result;
        try {
          result = await Promise.race([pending, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ApiFault(504, 'workspace_check_timeout')), 3000);
          })]);
        } catch (error) { if (error instanceof ApiFault) throw error; fail(404, 'workspace_unavailable'); }
        this.stillAuthorized(req, session);
        this.send(res, 200, result); return;
      } finally { if (timer) clearTimeout(timer); }
    }
    if (url.pathname === '/v1/harness/scan' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.harness) fail(404, 'harness_unavailable');
      if (this.harnessScanning) fail(429, 'harness_scan_busy');
      this.harnessScanning = true;
      const pending = this.options.harness.rescan();
      // A hung surveyor retains the slot until settlement so retries cannot
      // multiply filesystem work. The surveyor itself stays bounded by core.
      void pending.then(() => { this.harnessScanning = false; }, () => { this.harnessScanning = false; });
      let result: DiscoverySnapshot;
      try { result = await pending; }
      catch (error) { if (error instanceof ApiFault) throw error; fail(503, 'harness_scan_failed'); }
      this.stillAuthorized(req, session);
      this.send(res, 200, result); return;
    }
    if (url.pathname === '/v1/snapshot' && req.method === 'GET') { this.send(res, 200, this.snapshot()); return; }
    if (url.pathname === '/v1/commands' && req.method === 'POST') {
      const body = await this.body(req);
      this.stillAuthorized(req, session);
      if ('actorId' in body) fail(400, 'actor_is_authenticated');
      if (typeof body.commandId === 'string') {
        const prior = this.options.journal.command(body.commandId);
        if (prior && prior.input.actorId !== session.controllerId) fail(403, 'command_owner_denied');
      }
      const result = this.options.journal.enqueue({ ...body, actorId: session.controllerId } as CommandInput);
      this.send(res, result.replayed ? 200 : 202, result); return;
    }
    if (url.pathname === '/v1/logout' && req.method === 'POST') {
      this.revokeController(session.controllerId); this.send(res, 200, { revoked: true }); return;
    }
    const detail = /^\/v1\/(commands|decisions)\/([A-Za-z0-9._:-]{1,128})$/.exec(url.pathname);
    if (detail && req.method === 'GET') {
      const item = detail[1] === 'commands' ? this.options.journal.command(detail[2]!) : this.options.journal.decision(detail[2]!);
      if (!item) fail(404, 'not_found'); this.send(res, 200, item); return;
    }
    if (workspaceMatch && req.method === 'GET') {
      if (!this.options.workspaces) fail(404, 'file_unavailable');
      let file: { text: string };
      try { file = await this.options.workspaces.read(workspaceMatch[1]!, url.searchParams.get('path') ?? ''); }
      catch { fail(404, 'file_unavailable'); }
      this.stillAuthorized(req, session);
      this.send(res, 200, file); return;
    }
    if (url.pathname === '/v1/events' && req.method === 'GET') {
      if (this.streams.size >= 32 || [...this.streams].filter(s => s.session === session).length >= 2) fail(429, 'stream_capacity');
      const cursor = req.headers['last-event-id'];
      const match = typeof cursor === 'string' ? /^([a-f0-9]{32}):(0|[1-9][0-9]{0,15})$/.exec(cursor) : null;
      const number = match ? Number(match[2]) : -1;
      const floor = this.sequence - this.events.length;
      const valid = !!match && match[1] === this.epoch && number >= floor && number <= this.sequence;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
      const stream = { response: res, session }; this.streams.add(stream);
      res.on('close', () => this.streams.delete(stream));
      if (!valid) this.writeStream(stream, `event: resync\ndata: ${JSON.stringify({ cursor: this.cursor, snapshot: '/v1/snapshot' })}\n\n`);
      else {
        for (const event of this.events) if (Number(event.cursor.split(':')[1]) > number) this.writeStream(stream, `id: ${event.cursor}\nevent: changed\ndata: ${event.data}\n\n`);
        this.writeStream(stream, `: connected\n\n`);
      }
      return;
    }
    fail(404, 'not_found');
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.selection?.abort.abort();
    this.unsubscribe(); this.unsubscribeDevices?.(); this.unsubscribeWorkspaces?.(); if (this.heartbeat) clearInterval(this.heartbeat);
    for (const stream of this.streams) stream.response.destroy(); this.streams.clear();
    this.grants.clear(); this.sessions.clear();
    if (this.server.listening) await new Promise<void>((resolve, reject) => { this.server.close(error => error ? reject(error) : resolve()); this.server.closeAllConnections(); });
  }
}
