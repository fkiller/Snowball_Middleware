import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { formatSessionKey, parseSessionKey, type DispatchPort, type DispatchReceipt, type CommandRecord, type DecisionRecord } from '@snowball/core';
export { opencodeManifest } from './manifest.js';

export interface OpenCodeBinding {
  hostId: string;
  instanceId: string;
  baseUrl?: string;
  authPassword?: string;
}

export class OpenCodeFault extends Error {
  constructor(readonly code: string, readonly delivery: 'not_sent' | 'unknown' = 'not_sent') {
    super(`OpenCode error: ${code}`);
    this.name = 'OpenCodeFault';
  }
}

export class OpenCodeOwnedAdapter extends EventEmitter implements DispatchPort {
  readonly ownerId = `opencode-owner:${randomUUID()}`;
  readonly #binding: OpenCodeBinding;
  readonly #baseUrl: string;
  readonly #authPassword?: string;
  #ready = false;
  #auth: 'unknown' | 'needs_auth' | 'available' | 'not_required' = 'unknown';
  #owned = new Set<string>();
  #turns = new Map<string, string>();
  #sseController?: AbortController;

  constructor(binding: OpenCodeBinding) {
    super();
    this.#binding = structuredClone(binding);
    this.#baseUrl = (binding.baseUrl || 'http://127.0.0.1:4096').replace(/\/+$/, '');
    this.#authPassword = binding.authPassword;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#authPassword) {
      h['Authorization'] = `Bearer ${this.#authPassword}`;
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
      credentialSource: 'opencode-server' as const,
      existingDesktopControl: false,
      ownedSessionCount: this.#owned.size,
      baseUrl: this.#baseUrl,
    };
  }

  async initialize(): Promise<void> {
    if (this.#ready) throw new OpenCodeFault('already_connected');
    await this.refreshAuth();
    this.#ready = true;
    this.startSse();
  }

  async refreshAuth(): Promise<void> {
    try {
      const res = await fetch(`${this.#baseUrl}/global/health`, {
        headers: this.headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) {
        this.#auth = 'needs_auth';
      } else if (res.ok) {
        this.#auth = this.#authPassword ? 'available' : 'not_required';
      } else {
        this.#auth = 'unknown';
      }
    } catch {
      this.#auth = 'unknown';
      throw new OpenCodeFault('server_unreachable');
    }
  }

  private checkReady(): void {
    if (!this.#ready) throw new OpenCodeFault('not_connected');
  }

  async createSession(root: string, options: { title?: string } = {}): Promise<{ sessionKey: string; ownerId: string }> {
    this.checkReady();
    if (this.#auth === 'needs_auth' || this.#auth === 'unknown') throw new OpenCodeFault('needs_auth');

    const res = await fetch(`${this.#baseUrl}/session`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ directory: root, title: options.title || 'Snowball Session' }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      if (res.status === 401) throw new OpenCodeFault('needs_auth');
      throw new OpenCodeFault('create_session_failed');
    }

    const data = (await res.json()) as { id?: string };
    if (!data || typeof data.id !== 'string') {
      throw new OpenCodeFault('invalid_session_response');
    }

    this.#owned.add(data.id);
    return { sessionKey: this.sessionKey(data.id), ownerId: this.ownerId };
  }

  async listSessions(): Promise<{ nativeId: string; sessionKey: string; ownerId: string | null; readOnly: boolean; cwd: string }[]> {
    this.checkReady();
    const res = await fetch(`${this.#baseUrl}/session`, {
      headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new OpenCodeFault('list_sessions_failed');
    const list = (await res.json()) as Array<{ id: string; directory?: string }>;
    if (!Array.isArray(list)) throw new OpenCodeFault('invalid_session_list');

    return list.map(s => ({
      nativeId: s.id,
      sessionKey: this.sessionKey(s.id),
      ownerId: this.#owned.has(s.id) ? this.ownerId : null,
      readOnly: !this.#owned.has(s.id),
      cwd: s.directory || '',
    }));
  }

  async readSession(nativeId: string): Promise<{ nativeId: string; readOnly: boolean }> {
    this.checkReady();
    const res = await fetch(`${this.#baseUrl}/session/${encodeURIComponent(nativeId)}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new OpenCodeFault('read_session_failed');
    return { nativeId, readOnly: !this.#owned.has(nativeId) };
  }

  async execute(
    envelope: { command: CommandRecord; decision?: DecisionRecord },
    signal: AbortSignal
  ): Promise<DispatchReceipt> {
    const input = envelope.command.input;
    const no = (reason: string): DispatchReceipt => ({ status: 'not_sent', reason });
    if (!this.#ready || signal.aborted) return no('not_connected_or_cancelled');

    const target = parseSessionKey(input.sessionKey);
    if (
      input.ownerId !== this.ownerId ||
      target.hostId !== this.#binding.hostId ||
      target.harness.instanceId !== this.#binding.instanceId ||
      target.harness.pluginId !== 'snowball.opencode' ||
      !this.#owned.has(target.nativeSessionId)
    ) {
      return no('owner_mismatch');
    }

    const sessionId = target.nativeSessionId;
    const payload = input.payload as Record<string, unknown>;

    if (input.operation === 'sessions.send') {
      if (typeof payload?.text !== 'string' || !payload.text.trim()) return no('invalid_message');
      try {
        const res = await fetch(`${this.#baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ text: payload.text }),
          signal,
        });
        if (!res.ok) return no('send_failed');
        const data = (await res.json()) as { messageId?: string; id?: string };
        const correlationId = data?.messageId || data?.id || randomUUID();
        this.#turns.set(sessionId, correlationId);
        return { status: 'acknowledged', correlationId };
      } catch (err: any) {
        if (signal.aborted) return no('cancelled');
        throw new OpenCodeFault('send_failed', 'unknown');
      }
    }

    if (input.operation === 'sessions.interrupt') {
      try {
        const res = await fetch(`${this.#baseUrl}/session/${encodeURIComponent(sessionId)}/abort`, {
          method: 'POST',
          headers: this.headers,
          signal,
        });
        if (!res.ok) return no('interrupt_failed');
        this.#turns.delete(sessionId);
        return { status: 'acknowledged', correlationId: String(payload?.turnId || sessionId) };
      } catch {
        return no('interrupt_failed');
      }
    }

    if (input.operation === 'decisions.resolve') {
      const decision = envelope.decision;
      if (!decision || decision.ownerId !== this.ownerId || typeof payload?.answer !== 'string') {
        return no('invalid_decision');
      }
      try {
        const res = await fetch(`${this.#baseUrl}/session/${encodeURIComponent(sessionId)}/decision`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ decisionId: decision.decisionId, answer: payload.answer }),
          signal,
        });
        if (!res.ok) return no('decision_failed');
        return { status: 'acknowledged', correlationId: decision.decisionId };
      } catch {
        throw new OpenCodeFault('decision_delivery_unknown', 'unknown');
      }
    }

    return no('unsupported_operation');
  }

  private startSse(): void {
    if (this.#sseController) this.#sseController.abort();
    this.#sseController = new AbortController();
    const signal = this.#sseController.signal;

    void (async () => {
      try {
        const res = await fetch(`${this.#baseUrl}/event`, {
          headers: { ...this.headers, Accept: 'text/event-stream' },
          signal,
        });
        if (!res.ok || !res.body) {
          this.emit('offline', { ownerId: this.ownerId });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            if (!block.trim()) continue;
            let eventType = 'message';
            let dataStr = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              if (line.startsWith('data:')) dataStr = line.slice(5).trim();
            }

            try {
              const data = JSON.parse(dataStr);
              if (data?.sessionId) {
                // If turn started from external owner on our owned session, revoke ownership
                if (eventType === 'turn/started' && this.#owned.has(data.sessionId) && this.#turns.get(data.sessionId) !== data.turnId) {
                  this.#owned.delete(data.sessionId);
                  this.emit('ownerLost', { sessionKey: this.sessionKey(data.sessionId), ownerId: this.ownerId, reason: 'external_turn' });
                }
                this.emit('event', {
                  sessionKey: this.sessionKey(data.sessionId),
                  ownerId: this.ownerId,
                  kind: eventType,
                  text: data.text,
                });
              }
            } catch {}
          }
        }
      } catch {
        if (!signal.aborted) {
          this.emit('offline', { ownerId: this.ownerId });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.#ready = false;
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
