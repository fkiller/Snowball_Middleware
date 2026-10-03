import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { CommandJournal, ControllerStateStore, SessionFault, type SessionService, type SessionCreateStore, createControllerId, JournalFault, type CommandInput, type DeviceRegistry, type DiscoverySnapshot, type WorkspaceStore } from '@snowball/core';
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
export interface LocalSettings {
  revision: number;
  autostart: boolean;
  language: 'ko' | 'en';
  controlPaused: boolean;
  notifications: boolean;
  updatedAt: string;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
interface Session { controllerId: string; csrfHash: string; expiresAt: number; requests: number; window: number }
interface Stream { response: ServerResponse; session: Session }
interface Event { cursor: string; data: string }
export interface LocalApiOptions {
  controllerStates?: ControllerStateStore;
  journal: CommandJournal; workspaces?: WorkspaceFiles; devices?: DeviceRegistry; harness?: HarnessSurvey; port?: number;
  sessionService?: SessionService;
  createStore?: SessionCreateStore;
  /** Trusted composition callback, never supplied by a plugin or HTTP request. */
  onCommandQueued?: (sessionKey: string) => void;
  initialSettings?: Partial<Pick<LocalSettings, 'autostart' | 'language' | 'controlPaused' | 'notifications'>>;
  applySettings?: (next: LocalSettings, previous: LocalSettings) => Promise<void>;
  desktopCapabilities?: { tray: boolean; autostart: boolean; codexSelection?: boolean };
  sessionTtlMs?: number; eventCapacity?: number; now?: () => number;
  supervisor?: SupervisorAssets;
  workspaceStore?: WorkspaceStore;
  /** Local UI has no login/PIN; network boundaries still apply. */
  noAuth?: boolean;
  hostname?: string;
  realSessions?: unknown;
  turnsStore?: unknown;
  connectedHarnesses?: Array<{
    pluginId: string;
    instanceId: string;
    connected: boolean;
    disabled?: boolean;
    canCreate?: boolean;
    canAttach?: boolean;
    canListModels?: boolean;
    sessionListTruncated?: boolean;
  }>;
  listModels?: (pluginId: string, instanceId: string) => Promise<Array<{ model: string; displayName: string; efforts: string[] }>>;
  createSession?: (pluginId: string, workspaceCanonical: string, options: { title?: string; model?: string; workspaceId?: string }, instanceId: string) => Promise<{ sessionKey: string; ownerId: string; title: string }>;
  /** Trusted native picker. The HTTP request never supplies a path or display name. */
  chooseWorkspace?: (signal: AbortSignal) => Promise<{ root: string; displayName: string } | null>;
  /** Native tray selection and reviewed provider enrollment; HTTP only triggers the picker. */
  connectCodex?: (signal: AbortSignal) => Promise<string>;
  disconnectCodex?: (instanceId: string, signal: AbortSignal) => Promise<string>;
  resetCodex?: (signal: AbortSignal) => Promise<boolean>;
  /** Explicit lab locator only. A reachable development port never grants device control. */
  mk20Lan?: {
    describe(): { selected: { version: number; targetAddress: string; interfaceName: string } | null; interfaces: { name: string; address: string }[]; error?: string };
    configure(value: { targetAddress: string; interfaceName: string }): Promise<unknown>;
    remove(): Promise<unknown>;
  };
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
  private readonly controllerStates: ControllerStateStore;
  private readonly server: http.Server;
  private readonly sessions = new Map<string, Session>();
  private readonly localSessions = new Map<string, Session>();
  private readonly localControllerId = createControllerId();
  private readonly grants = new Map<string, number>();
  private readonly streams = new Set<Stream>();
  private readonly events: Event[] = [];
  private readonly epoch = randomBytes(16).toString('hex');
  private readonly settings: LocalSettings;
  private sequence = 0;
  private originValue = '';
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly eventCapacity: number;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeDevices?: () => void;
  private readonly unsubscribeWorkspaces?: () => void;
  private readonly serviceListeners: Array<() => void> = [];
  private readonly creatingSessions = new Set<string>();
  private settingsBusy = false;
  private readonly workspaceChecks = new Set<string>();
  private harnessScanning = false;
  private mk20LanBusy = false;
  private selection?: { controllerId: string; abort: AbortController };
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private attemptWindow = 0;
  private closed = false;
  private starting = false;
  constructor(private readonly options: LocalApiOptions) {
    this.controllerStates=options.controllerStates??new ControllerStateStore();
    this.now = options.now ?? Date.now;
    this.settings = {
      revision: 1,
      autostart: false,
      language: 'ko',
      controlPaused: false,
      notifications: true,
      ...options.initialSettings,
      updatedAt: new Date(this.now()).toISOString(),
    };
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
    if (options.sessionService) {
      for (const event of ['sessionEvent', 'adapterOffline', 'ownerLost', 'adapterDisabled', 'adapterEnabled', 'adapterRemoved', 'adapterReconnected', 'adapterAdded']) {
        const listener = () => this.changed(); options.sessionService.on(event, listener);
        this.serviceListeners.push(() => options.sessionService!.off(event, listener));
      }
    }
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
    this.localSessions.delete(controllerId);
    if (this.selection?.controllerId === controllerId) this.selection.abort.abort();
    for (const [hash, session] of this.sessions) if (session.controllerId === controllerId) this.sessions.delete(hash);
    for (const stream of this.streams) if (stream.session.controllerId === controllerId) { stream.response.end(); this.streams.delete(stream); }
  }
  private prune(): void {
    for (const [id, session] of this.localSessions) if (session.expiresAt <= this.now()) this.localSessions.delete(id);
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
    if (['host', 'origin', 'authorization', 'x-snowball-csrf', 'x-snowball-controller', 'content-type'].some(k => (duplicates.get(k) ?? 0) > 1)) fail(400, 'duplicate_header');
    if (req.headers.host !== this.origin.slice(7)) fail(403, 'host_denied');
    if (req.headers.origin !== undefined && req.headers.origin !== this.origin) fail(403, 'origin_denied');
    if (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) fail(403, 'origin_denied');
    if (!['GET', 'POST', 'PATCH'].includes(req.method ?? '')) fail(405, 'method_denied');
    if (['POST', 'PATCH'].includes(req.method ?? '') && req.headers.origin !== this.origin) fail(403, 'origin_required');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048 || req.url.includes('#')) fail(400, 'invalid_url');
  }
  private authenticate(req: IncomingMessage): Session {
    if (this.options.noAuth) {
      const controllerId = req.headers['x-snowball-controller'] ?? this.localControllerId;
      if (typeof controllerId !== 'string' || !/^ctl_[a-f0-9]{16}$/.test(controllerId)) fail(400, 'invalid_controller');
      this.prune();
      let local = this.localSessions.get(controllerId);
      if (!local) {
        if (this.localSessions.size >= 64) fail(429, 'session_capacity');
        local = { controllerId, csrfHash: '', expiresAt: this.now() + this.ttl, requests: 0, window: this.now() };
        this.localSessions.set(controllerId, local);
      }
      if (this.now() - local.window >= 60_000) { local.window = this.now(); local.requests = 0; }
      if (++local.requests > 600) fail(429, 'rate_limited');
      return local;
    }
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'unauthorized');
    const session = this.sessions.get(digest(auth.slice(7)));
    if (!session || session.expiresAt <= this.now()) fail(401, 'unauthorized');
    if (['POST', 'PATCH'].includes(req.method ?? '') && (typeof req.headers['x-snowball-csrf'] !== 'string' || digest(req.headers['x-snowball-csrf']) !== session.csrfHash)) fail(403, 'csrf_denied');
    if (this.now() - session.window >= 60_000) { session.window = this.now(); session.requests = 0; }
    if (++session.requests > 600) fail(429, 'rate_limited');
    return session;
  }
  private stillAuthorized(req: IncomingMessage, session: Session): void {
    if (this.options.noAuth && this.localSessions.get(session.controllerId) === session && session.expiresAt > this.now()) return;
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
    const sessionDetails = (this.options.sessionService?.snapshotSessions() ?? []).map(session => {
      const workspaceId = session.workspaceId ?? this.options.workspaces?.workspaceIdForExactRoot(session.cwd);
      return { ...session, ...(workspaceId ? { workspaceId } : {}) };
    });
    return {
      accessMode: this.options.noAuth ? 'local-no-auth' : 'token',
      cursor: this.cursor,
      settings: structuredClone(this.settings),
      desktopCapabilities: this.options.desktopCapabilities ?? { tray: false, autostart: false },
      sessions: this.options.journal.listSessions(),
      sessionDetails,
      sessionMessages: this.options.sessionService?.snapshotMessages() ?? {},
      connectedHarnesses: this.options.connectedHarnesses ?? this.options.sessionService?.snapshotAdapters() ?? [],
      commands: this.options.journal.listCommands().map(c => ({ commandId: c.input.commandId, actorId: c.input.actorId, sessionKey: c.input.sessionKey, ownerId: c.input.ownerId, operation: c.input.operation, status: c.status, revision: c.revision, order: c.order, updatedAt: c.updatedAt })),
      decisions: this.options.journal.listDecisions().map(d => ({ decisionId: d.decisionId, sessionKey: d.sessionKey, ownerId: d.ownerId, status: d.status, revision: d.revision, allowedAnswers: [...d.allowedAnswers], ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}) })),
      workspaces: this.options.workspaces?.list() ?? [],
      workspaceDetails: this.options.workspaces?.describe() ?? [],
      workspaceCandidates: (this.options.workspaces?.listCandidates() ?? []).map(candidate => {
        const workspaceId = this.options.workspaces?.workspaceIdForExactRoot(candidate.root);
        return { ...candidate, ...(workspaceId ? { workspaceId } : {}) };
      }),
      workspaceSelectionAvailable: !!(this.options.workspaceStore && this.options.chooseWorkspace),
      devices: this.options.devices?.list() ?? [],
      deviceSources: this.options.devices?.sourceStates() ?? [],
      deviceCandidates: this.options.devices?.listCandidates() ?? [],
      mk20Lan: this.options.mk20Lan?.describe() ?? null,
      harness: this.options.harness?.describe() ?? null,
      hostname: this.options.hostname || os.hostname(),
      realSessions: this.options.realSessions ?? null,
      turnsStore: this.options.turnsStore ?? null,
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
    if (url.pathname === '/v1/harness/connect-codex' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.connectCodex) fail(404, 'native_connection_unavailable');
      const abort = new AbortController();
      const disconnected = () => abort.abort(); res.once('close', disconnected);
      try {
        let instanceId;
        try { instanceId = await this.options.connectCodex(abort.signal); }
        catch (error) {
          const code = (error as { message?: string } | null)?.message;
          if (code === 'selection_cancelled') fail(409, code);
          if (code === 'connection_busy' || code === 'connection_limit') fail(429, code);
          if (code === 'already_connected') fail(409, code);
          if (code === 'connection_unavailable') fail(503, code);
          fail(503, 'connection_failed');
        }
        this.stillAuthorized(req, session);
        this.send(res, 200, { instanceId, snapshot: this.snapshot() }); return;
      } finally { res.off('close', disconnected); }
    }
    if (url.pathname === '/v1/harness/disconnect-codex' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length !== 1 || typeof body.instanceId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body.instanceId)) fail(400, 'invalid_instance');
      if (!this.options.disconnectCodex) fail(404, 'native_connection_unavailable');
      const abort = new AbortController(); const disconnected = () => abort.abort(); res.once('close', disconnected);
      try {
        try { await this.options.disconnectCodex(body.instanceId, abort.signal); }
        catch (error) {
          const code = (error as { message?: string } | null)?.message;
          if (code === 'selection_cancelled' || code === 'connection_missing') fail(409, code);
          if (code === 'connection_busy') fail(429, code);
          fail(503, 'connection_failed');
        }
        this.stillAuthorized(req, session); this.send(res, 200, { snapshot: this.snapshot() }); return;
      } finally { res.off('close', disconnected); }
    }
    if (url.pathname === '/v1/harness/reset-codex' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.resetCodex) fail(404, 'native_connection_unavailable');
      const abort = new AbortController(); const disconnected = () => abort.abort(); res.once('close', disconnected);
      try {
        try { await this.options.resetCodex(abort.signal); }
        catch (error) {
          const code = (error as { message?: string } | null)?.message;
          if (code === 'selection_cancelled') fail(409, code);
          if (code === 'connection_busy') fail(429, code);
          fail(503, 'connection_failed');
        }
        this.stillAuthorized(req, session); this.send(res, 200, { snapshot: this.snapshot() }); return;
      } finally { res.off('close', disconnected); }
    }
    if (url.pathname === '/v1/devices/mk20-lan/configure' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (!this.options.mk20Lan) fail(404, 'mk20_lan_unavailable');
      if (Object.keys(body).sort().join(',') !== 'interfaceName,targetAddress' || typeof body.interfaceName !== 'string' || typeof body.targetAddress !== 'string') fail(400, 'invalid_mk20_endpoint');
      if (this.mk20LanBusy) fail(429, 'device_scan_busy');
      this.mk20LanBusy = true;
      try { await this.options.mk20Lan.configure({ targetAddress: body.targetAddress, interfaceName: body.interfaceName }); }
      catch (error) { fail((error as Error)?.message === 'invalid_mk20_endpoint' ? 400 : 503, (error as Error)?.message === 'invalid_mk20_endpoint' ? 'invalid_mk20_endpoint' : 'device_config_failed'); }
      finally { this.mk20LanBusy = false; }
      this.send(res, 200, { snapshot: this.snapshot() }); return;
    }
    if (url.pathname === '/v1/devices/mk20-lan/remove' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length) fail(400, 'invalid_request');
      if (!this.options.mk20Lan) fail(404, 'mk20_lan_unavailable');
      if (this.mk20LanBusy) fail(429, 'device_scan_busy');
      this.mk20LanBusy = true;
      try { await this.options.mk20Lan.remove(); }
      catch { fail(503, 'device_config_failed'); }
      finally { this.mk20LanBusy = false; }
      this.send(res, 200, { snapshot: this.snapshot() }); return;
    }
    if (url.pathname === '/v1/controller' && req.method === 'GET') {
      this.send(res,200,this.controllerStates.get(session.controllerId));return;
    }
    if (url.pathname === '/v1/controller' && req.method === 'POST') {
      const body=await this.body(req);this.stillAuthorized(req,session);
      if(Object.keys(body).sort().join(',')!=='expectedRevision,patch'||!Number.isSafeInteger(body.expectedRevision))fail(400,'invalid_controller_request');
      try{this.send(res,200,this.controllerStates.update(session.controllerId,Number(body.expectedRevision),body.patch));}
      catch(error){const code=(error as Error).message;fail(code==='stale_controller_revision'||code==='draft_destination_locked'?409:code==='controller_capacity'?429:400,code.startsWith('invalid_')||['stale_controller_revision','draft_destination_locked','controller_capacity'].includes(code)?code:'invalid_controller_state');}
      // UI-only changes deliberately do not broadcast a global SSE repaint.
      return;
    }
    if (url.pathname === '/v1/snapshot' && req.method === 'GET') { this.send(res, 200, this.snapshot()); return; }
    if (url.pathname === '/v1/settings' && req.method === 'GET') {
      this.send(res, 200, { settings: structuredClone(this.settings) }); return;
    }
    if (url.pathname === '/v1/settings' && req.method === 'PATCH') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (!record(body) || typeof body.expectedRevision !== 'number' || !record(body.patch)) fail(400, 'invalid_request');
      if (body.expectedRevision !== this.settings.revision) fail(409, 'stale_revision');
      const patch = body.patch;
      const allowedKeys = ['autostart', 'language', 'controlPaused', 'notifications'];
      for (const key of Object.keys(patch)) {
        if (!allowedKeys.includes(key)) fail(400, 'invalid_setting_key');
      }
      if ('autostart' in patch && typeof patch.autostart !== 'boolean') fail(400, 'invalid_setting_value');
      if ('controlPaused' in patch && typeof patch.controlPaused !== 'boolean') fail(400, 'invalid_setting_value');
      if ('notifications' in patch && typeof patch.notifications !== 'boolean') fail(400, 'invalid_setting_value');
      if ('language' in patch && !['ko', 'en'].includes(String(patch.language))) fail(400, 'invalid_setting_value');

      if ('autostart' in patch && patch.autostart !== this.settings.autostart && !this.options.desktopCapabilities?.autostart) fail(409, 'autostart_unavailable');
      if (this.settingsBusy) fail(409, 'settings_busy');
      const next = { ...this.settings, ...patch, revision: this.settings.revision + 1, updatedAt: new Date(this.now()).toISOString() } as LocalSettings;
      this.settingsBusy = true;
      try {
        await this.options.applySettings?.(next, structuredClone(this.settings));
        Object.assign(this.settings, next);
      } catch { fail(503, 'settings_apply_failed'); }
      finally { this.settingsBusy = false; }
      this.changed();
      this.send(res, 200, { settings: structuredClone(this.settings) }); return;
    }
    if (url.pathname === '/v1/sessions/create' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (this.settings.controlPaused) fail(409, 'control_paused');
      const service = this.options.sessionService; const store = this.options.workspaceStore;
      if (!service && !this.options.createSession) fail(503, 'harness_runtime_unavailable');
      if (!store) fail(503, 'create_storage_unavailable');
      if (Object.keys(body).some(k => !['requestId', 'pluginId', 'instanceId', 'workspaceId', 'title', 'model'].includes(k)) || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.requestId) || typeof body.pluginId !== 'string' || typeof body.instanceId !== 'string' || typeof body.workspaceId !== 'string' || body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 128) || body.model !== undefined && typeof body.model !== 'string') fail(400, 'invalid_request');
      const adapters = this.options.connectedHarnesses ?? service?.snapshotAdapters() ?? [];
      const binding = adapters.find(a => a.pluginId === body.pluginId && a.instanceId === body.instanceId);
      if (!binding || !binding.connected || !binding.canCreate || binding.disabled) fail(409, 'create_unavailable');
      const creates = this.options.createStore;
      if (creates && this.creatingSessions.has(session.controllerId)) fail(409, 'create_in_progress');
      if (creates) this.creatingSessions.add(session.controllerId);
      let beganNativeAttempt = false;
      try {
        const workspace = await store.assertReadable(body.workspaceId);
        this.stillAuthorized(req, session);
        if (this.settings.controlPaused) fail(409, 'control_paused');
        const fingerprint = digest(JSON.stringify([body.pluginId, body.instanceId, workspace.canonical, body.workspaceId, body.title ?? '', body.model ?? '']));
        const prior = creates?.get(body.requestId);
        if (prior && prior.fingerprint !== fingerprint) fail(409, 'create_request_mismatch');
        if (prior?.status === 'confirmed') {
          const current = service?.getSession(prior.sessionKey!);
          this.send(res, 200, { requestId: body.requestId, sessionKey: prior.sessionKey, ownerId: current?.ownerId ?? null, restoredReadOnly: current?.readOnly ?? true, snapshot: this.snapshot() }); return;
        }
        if (prior) fail(409, 'session_creation_unconfirmed');
        creates?.begin(body.requestId, fingerprint);
        beganNativeAttempt = true;
        const created = this.options.createSession
          ? await this.options.createSession(body.pluginId, workspace.canonical, { ...(typeof body.title === 'string' ? { title: body.title } : {}), ...(typeof body.model === 'string' ? { model: body.model } : {}), workspaceId: body.workspaceId }, body.instanceId)
          : await service!.createSession(body.pluginId, workspace.canonical, { ...(typeof body.title === 'string' ? { title: body.title } : {}), ...(typeof body.model === 'string' ? { model: body.model } : {}), workspaceId: body.workspaceId }, body.instanceId);
        creates?.confirm(body.requestId, fingerprint, created.sessionKey);
        this.changed(); this.send(res, 200, { ...created, requestId: body.requestId, restoredReadOnly: false, snapshot: this.snapshot() });
      } catch (error) { if (error instanceof ApiFault) throw error; if (beganNativeAttempt) fail(503, 'session_creation_unconfirmed'); if (error instanceof SessionFault) fail(409, error.code); fail(503, 'create_preflight_failed'); }
      finally { if (creates) this.creatingSessions.delete(session.controllerId); }
      return;
    }
    if (url.pathname === '/v1/sessions/create-status' && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      if (Object.keys(body).length !== 1 || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.requestId)) fail(400, 'invalid_request');
      const intent = this.options.createStore?.get(body.requestId);
      if (!intent) fail(404, 'create_request_not_found');
      this.send(res, 200, { requestId: body.requestId, status: intent.status === 'pending' ? 'unconfirmed' : 'confirmed', ...(intent.sessionKey ? { sessionKey: intent.sessionKey } : {}) }); return;
    }
    if (['/v1/harness/sessions', '/v1/harness/models', '/v1/sessions/attach'].includes(url.pathname) && req.method === 'POST') {
      const body = await this.body(req); this.stillAuthorized(req, session);
      const service = this.options.sessionService;
      if (url.pathname === '/v1/harness/models' && this.options.listModels) {
        if (Object.keys(body).some(k => !['pluginId', 'instanceId'].includes(k)) || typeof body.pluginId !== 'string' || typeof body.instanceId !== 'string') fail(400, 'invalid_request');
        try {
          const models = await this.options.listModels(body.pluginId, body.instanceId);
          this.send(res, 200, { models });
          return;
        } catch (error) {
          if (error instanceof ApiFault) throw error;
          fail(503, 'harness_operation_failed');
        }
      }
      if (!service) fail(503, 'harness_runtime_unavailable');
      try {
        if (url.pathname === '/v1/harness/sessions') {
          if (Object.keys(body).some(k => k !== 'pluginId') || typeof body.pluginId !== 'string') fail(400, 'invalid_request');
          await service.listSessions(body.pluginId); this.changed(); this.send(res, 200, this.snapshot());
        } else if (url.pathname === '/v1/harness/models') {
          if (Object.keys(body).some(k => !['pluginId', 'instanceId'].includes(k)) || typeof body.pluginId !== 'string' || typeof body.instanceId !== 'string') fail(400, 'invalid_request');
          this.send(res, 200, { models: await service.listModels(body.pluginId, body.instanceId) });
        } else {
          if (this.settings.controlPaused) fail(409, 'control_paused');
          if (Object.keys(body).some(k => k !== 'sessionKey') || typeof body.sessionKey !== 'string') fail(400, 'invalid_request');
          await service.attachSession(body.sessionKey); this.changed(); this.send(res, 200, this.snapshot());
        }
      } catch (error) { if (error instanceof ApiFault) throw error; if (error instanceof SessionFault) fail(409, error.code); fail(503, 'harness_operation_failed'); }
      return;
    }
    if (url.pathname === '/v1/commands' && req.method === 'POST') {
      const body = await this.body(req);
      this.stillAuthorized(req, session);
      if (this.settings.controlPaused) fail(409, 'control_paused');
      if ('actorId' in body) fail(400, 'actor_is_authenticated');
      if (typeof body.commandId === 'string') {
        const prior = this.options.journal.command(body.commandId);
        if (prior && prior.input.actorId !== session.controllerId) fail(403, 'command_owner_denied');
      }
      const result = this.options.journal.enqueue({ ...body, actorId: session.controllerId } as CommandInput);
      if (!result.replayed) this.options.onCommandQueued?.(result.command.input.sessionKey);
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
    for (const dispose of this.serviceListeners) dispose();
    for (const stream of this.streams) stream.response.destroy(); this.streams.clear();
    this.grants.clear(); this.sessions.clear(); this.localSessions.clear();
    if (this.server.listening) await new Promise<void>((resolve, reject) => { this.server.close(error => error ? reject(error) : resolve()); this.server.closeAllConnections(); });
  }
}
