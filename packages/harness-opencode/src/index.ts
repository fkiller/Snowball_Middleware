import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { formatSessionKey, parseSessionKey, type DispatchPort, type DispatchReceipt, type CommandRecord, type DecisionRecord } from '@snowball/plugin-sdk';
export { opencodeManifest } from './manifest.js';

const OBSERVED_SERVER_VERSION = '1.18.31';

export interface OpenCodeBinding {
  hostId: string;
  instanceId: string;
  baseUrl?: string;
  authPassword?: string;
  authUsername?: string;
}

export class OpenCodeFault extends Error {
  constructor(readonly code: string, readonly delivery: 'not_sent' | 'unknown' = 'not_sent') {
    super(`OpenCode error: ${code}`);
    this.name = 'OpenCodeFault';
  }
}

async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new OpenCodeFault('invalid_response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maximum) throw new OpenCodeFault('response_limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new OpenCodeFault('invalid_response'); }
}

export class OpenCodeOwnedAdapter extends EventEmitter implements DispatchPort {
  readonly ownerId = `opencode-owner:${randomUUID()}`;
  readonly #binding: OpenCodeBinding;
  readonly #baseUrl: string;
  readonly #authPassword?: string;
  #ready = false;
  #version?: string;
  #auth: 'unknown' | 'needs_auth' | 'available' | 'not_required' = 'unknown';
  #owned = new Set<string>();
  #turns = new Map<string, string>();
  #sseController?: AbortController;

  constructor(binding: OpenCodeBinding) {
    super();
    this.#binding = structuredClone(binding);
    const url = new URL(binding.baseUrl || 'http://127.0.0.1:4096');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new OpenCodeFault('local_endpoint_required');
    this.#baseUrl = url.origin;
    this.#authPassword = binding.authPassword;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#authPassword) {
      h['Authorization'] = `Basic ${Buffer.from(`${this.#binding.authUsername ?? 'opencode'}:${this.#authPassword}`).toString('base64')}`;
    }
    return h;
  }

  private sessionKey(nativeId: string): string {
    return formatSessionKey({
      hostId: this.#binding.hostId,
      harness: { pluginId: 'snowball.opencode', instanceId: this.#binding.instanceId },
      nativeSessionId: nativeId,
    });
  }

  status() {
    return {
      connected: this.#ready,
      auth: this.#auth,
      ownerId: this.ownerId,
      instanceId: this.#binding.instanceId,
      surface: 'http-sse' as const,
      credentialSource: 'opencode-local' as const,
      existingDesktopControl: false,
      readOnly: true,
      capabilities: ['observe'] as const,
      controlReason: 'owner_protocol_unverified',
      ownedSessionCount: this.#owned.size,
      providerVersion: this.#version ?? null,
      baseUrl: this.#baseUrl,
    };
  }

  async initialize(): Promise<void> {
    if (this.#ready) throw new OpenCodeFault('already_connected');
    await this.refreshAuth();
    // SSE normalization requires a pinned provider schema; no invented turn events.
  }

  async refreshAuth(): Promise<void> {
    this.#ready = false; this.#version = undefined;
    try {
      const res = await fetch(`${this.#baseUrl}/global/health`, {
        redirect: 'error',
        headers: this.headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) {
        this.#auth = 'needs_auth';
      } else if (res.ok) {
        const health = await boundedJson(res, 16 * 1024) as { healthy?: boolean; version?: string };
        if (health?.healthy !== true || typeof health.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(health.version)) throw new OpenCodeFault('invalid_health');
        if (health.version !== OBSERVED_SERVER_VERSION) throw new OpenCodeFault('unsupported_version');
        this.#auth = this.#authPassword ? 'available' : 'not_required';
        await this.fetchSessions();
        this.#version = health.version; this.#ready = true;
      } else {
        this.#auth = 'unknown';
      }
    } catch (error) {
      this.#ready = false;
      if (error instanceof OpenCodeFault && error.code === 'needs_auth') { this.#auth = 'needs_auth'; return; }
      this.#auth = 'unknown';
      if (error instanceof OpenCodeFault) throw error;
      throw new OpenCodeFault('server_unreachable');
    }
  }

  private checkReady(): void {
    if (!this.#ready || !['available', 'not_required'].includes(this.#auth)) throw new OpenCodeFault('not_connected');
  }

  private async fetchSessions(): Promise<Array<{ id: string; directory?: string }>> {
    const res = await fetch(`${this.#baseUrl}/session`, { redirect: 'error', headers: this.headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 401) { this.#auth = 'needs_auth'; this.#ready = false; throw new OpenCodeFault('needs_auth'); }
    if (!res.ok) throw new OpenCodeFault('list_sessions_failed');
    const list = await boundedJson(res, 1024 * 1024);
    if (!Array.isArray(list) || list.length > 256) throw new OpenCodeFault('invalid_session_list');
    const ids = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 128 || /[\x00-\x1f\x7f/\\]/.test(item.id) || ids.has(item.id) || item.directory !== undefined && (typeof item.directory !== 'string' || item.directory.length > 4096)) throw new OpenCodeFault('invalid_session_list');
      ids.add(item.id);
    }
    return list as Array<{ id: string; directory?: string }>;
  }

  async listSessions(): Promise<{ nativeId: string; sessionKey: string; ownerId: string | null; readOnly: boolean; cwd: string; model?: string; effort?: string; access?: string }[]> {
    this.checkReady();
    const list = await this.fetchSessions();

    return list.map(s => {
      const model = typeof (s as any).model === 'string' ? (s as any).model : undefined;
      const effort = typeof (s as any).effort === 'string' ? (s as any).effort : undefined;
      const access = typeof (s as any).access === 'string' ? (s as any).access : (typeof (s as any).permission === 'string' ? (s as any).permission : undefined);
      return {
        nativeId: s.id,
        sessionKey: this.sessionKey(s.id),
        ownerId: this.#owned.has(s.id) ? this.ownerId : null,
        readOnly: !this.#owned.has(s.id),
        cwd: s.directory || '',
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(access ? { access } : {}),
      };
    });
  }

  async readSession(nativeId: string): Promise<{ nativeId: string; readOnly: boolean; model?: string; effort?: string; access?: string }> {
    this.checkReady();
    if (typeof nativeId !== 'string' || nativeId.length < 1 || nativeId.length > 128 || /[\x00-\x1f\x7f/\\]/.test(nativeId)) throw new OpenCodeFault('invalid_session_id');
    const res = await fetch(`${this.#baseUrl}/session/${encodeURIComponent(nativeId)}`, {
      redirect: 'error', headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) { this.#auth = 'needs_auth'; this.#ready = false; throw new OpenCodeFault('needs_auth'); }
    if (!res.ok) throw new OpenCodeFault('read_session_failed');
    const item = await boundedJson(res, 128 * 1024) as { id?: string };
    if (item?.id !== nativeId) throw new OpenCodeFault('invalid_session');
    const model = typeof (item as any).model === 'string' ? (item as any).model : undefined;
    const effort = typeof (item as any).effort === 'string' ? (item as any).effort : undefined;
    const access = typeof (item as any).access === 'string' ? (item as any).access : (typeof (item as any).permission === 'string' ? (item as any).permission : undefined);
    return {
      nativeId,
      readOnly: !this.#owned.has(nativeId),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(access ? { access } : {}),
    };
  }

  /** Live provider catalog. OpenCode variants are not claimed to be Codex efforts. */
  async listModels(): Promise<Array<{ model: string; displayName: string; efforts: string[]; defaultEffort: null }>> {
    this.checkReady();
    const res = await fetch(`${this.#baseUrl}/config/providers`, {
      redirect: 'error', headers: this.headers, signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) { this.#auth = 'needs_auth'; this.#ready = false; throw new OpenCodeFault('needs_auth'); }
    if (!res.ok) throw new OpenCodeFault('model_catalog_failed');
    const catalog = await boundedJson(res, 2 * 1024 * 1024) as { providers?: unknown };
    if (!catalog || !Array.isArray(catalog.providers) || catalog.providers.length > 32) throw new OpenCodeFault('invalid_model_catalog');
    const models: Array<{ model: string; displayName: string; efforts: string[]; defaultEffort: null }> = [];
    const seen = new Set<string>();
    for (const provider of catalog.providers) {
      const p = provider as Record<string, unknown>;
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(p.id) || !p.models || typeof p.models !== 'object' || Array.isArray(p.models)) throw new OpenCodeFault('invalid_model_catalog');
      const entries = Object.entries(p.models);
      if (entries.length > 256) throw new OpenCodeFault('invalid_model_catalog');
      for (const [nativeId, detail] of entries) {
        const d = detail as Record<string, unknown>;
        if (!/^[A-Za-z0-9._:/-]{1,256}$/.test(nativeId) || !d || typeof d !== 'object' || d.id !== nativeId || d.providerID !== p.id || typeof d.name !== 'string' || d.name.length > 256) throw new OpenCodeFault('invalid_model_catalog');
        const model = `${p.id}/${nativeId}`;
        if (seen.has(model) || models.length >= 512) throw new OpenCodeFault('invalid_model_catalog');
        seen.add(model);
        models.push({ model, displayName: d.name, efforts: [], defaultEffort: null });
      }
    }
    return models;
  }

  async createSession(root: string, options: { title?: string } = {}): Promise<{ sessionKey: string; ownerId: string }> {
    throw new OpenCodeFault('owner_protocol_unverified');
  }

  async execute(
    envelope: { command: CommandRecord; decision?: DecisionRecord },
    signal: AbortSignal
  ): Promise<DispatchReceipt> {
    return { status: 'not_sent', reason: 'owner_protocol_unverified' };
  }

  async stop(): Promise<void> {
    this.#ready = false;
    this.#version = undefined;
    this.#auth = 'unknown';
    if (this.#sseController) {
      this.#sseController.abort();
      this.#sseController = undefined;
    }
    this.#owned.clear();
    this.#turns.clear();
    this.emit('offline', { ownerId: this.ownerId });
  }
}
