import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parseHostId, parseSessionKey, formatSessionKey, parsePluginId, parseInstanceId, type SessionKeyParts } from './identity.js';
import { CommandJournal, type DispatchPort } from './commands.js';
import { ControllerContext, type ControllerSelection } from './context.js';
import type { CommandRecord, DecisionRecord } from './journal-model.js';

export interface HarnessAdapter extends DispatchPort {
  status?(): Record<string, unknown>;
  listSessions?(): Promise<Array<{ nativeId: string; sessionKey?: string; ownerId?: string | null; readOnly?: boolean; cwd?: string; preview?: string }>>;
  readSession?(id: string): Promise<{ nativeId: string; readOnly?: boolean; turns?: unknown[] }>;
  createSession?(root: string, options?: Record<string, unknown>): Promise<{ sessionKey: string; ownerId: string }>;
  listModels?(): Promise<Array<{ model: string; displayName: string; efforts: string[]; defaultEffort: string | null }>>;
  attachSession?(nativeId: string): Promise<{ sessionKey: string; ownerId: string }>;
  refreshAuth?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface SessionSummary {
  sessionKey: string;
  nativeSessionId: string;
  harnessPluginId: string;
  harnessInstanceId: string;
  title: string;
  preview: string;
  cwd: string;
  workspaceId?: string;
  readOnly: boolean;
  ownerId: string | null;
  status: 'idle' | 'busy' | 'error';
  activeTurnId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionMessage { role: 'agent'; text: string; turnId: string; receivedAt: number; truncated: boolean }

export interface SessionServiceOptions {
  hostId: string;
  journal: CommandJournal;
  now?: () => number;
  metadata?: SessionMetadataPort;
}

export interface SessionMetadataPort {
  get(sessionKey: string): Pick<SessionSummary, 'title' | 'cwd' | 'createdAt' | 'workspaceId'> | undefined;
  remember(summary: SessionSummary): void;
}

export class SessionFault extends Error {
  constructor(readonly code: string, message?: string) {
    super(message || `Session error: ${code}`);
    this.name = 'SessionFault';
  }
}

/**
 * SessionService (MW.05.02.01.01)
 *
 * Coordinates session lifecycle across multiple harness adapters, enforces:
 * - Read-only vs owned session separation: observation alone does not connect a session; explicit attachment enables commands.
 * - R-TARGET / J03: in-flight drafts and pending decisions have immutable destinations;
 *   switching controller selection never mutates destination.
 * - Turn and decision state normalization across harnesses.
 * - Local vertical-slice round-trip with zero hardware devices.
 */
export class SessionService extends EventEmitter {
  readonly hostId: string;
  readonly journal: CommandJournal;
  private readonly now: () => number;
  private readonly metadata?: SessionMetadataPort;
  private readonly adapters = new Map<string, HarnessAdapter>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly disabledAdapters = new Set<string>();
  private readonly sessions = new Map<string, SessionSummary>();
  private readonly controllers = new Map<string, ControllerContext>();
  private readonly messages = new Map<string, SessionMessage[]>();
  private readonly completedTurns = new Set<string>();

  constructor(options: SessionServiceOptions) {
    super();
    this.hostId = parseHostId(options.hostId);
    this.journal = options.journal;
    this.now = options.now ?? Date.now;
    this.metadata = options.metadata;
    // The durable journal remembers destinations, not a live process lease.
    // Restore only a bounded read-only index; explicit native attach must
    // establish a new owner before any command can be dispatched.
    for (const previous of this.journal.listSessions().slice(-256)) {
      const parts = parseSessionKey(previous.sessionKey);
      if (parts.hostId !== this.hostId) continue;
      const metadata = this.metadata?.get(previous.sessionKey);
      this.sessions.set(previous.sessionKey, {
        sessionKey: previous.sessionKey, nativeSessionId: parts.nativeSessionId,
        harnessPluginId: parts.harness.pluginId, harnessInstanceId: parts.harness.instanceId,
        title: metadata?.title ?? `Session ${parts.nativeSessionId.slice(0, 8)}`, preview: '', cwd: metadata?.cwd ?? '',
        ...(metadata?.workspaceId ? { workspaceId: metadata.workspaceId } : {}),
        readOnly: true, ownerId: null, status: 'error',
        createdAt: metadata?.createdAt ?? this.now(), updatedAt: this.now(),
      });
    }
  }

  registerAdapter(pluginId: string, adapter: HarnessAdapter): void {
    parsePluginId(pluginId);
    const instanceId = parseInstanceId(adapter.status?.().instanceId ?? 'default');
    const bindingKey = pluginId + '/' + instanceId;
    this.subscriptions.get(bindingKey)?.();
    this.adapters.set(bindingKey, adapter);

    // If adapter is an EventEmitter, attach event listeners for normalization
    if (typeof (adapter as unknown as EventEmitter).on === 'function') {
      const emitter = adapter as unknown as EventEmitter;
      const disposers: Array<() => void> = [];
      const on = (name: string, listener: (...args: any[]) => void) => {
        emitter.on(name, listener); disposers.push(() => emitter.off(name, listener));
      };
      this.subscriptions.set(bindingKey, () => disposers.forEach(dispose => dispose()));
      const current = () => this.adapters.get(bindingKey) === adapter && !this.isAdapterDisabled(pluginId, instanceId);
      const accepts = (key: string) => {
        if (!current()) return false;
        try { const p = parseSessionKey(key); return p.hostId === this.hostId && p.harness.pluginId === pluginId && p.harness.instanceId === instanceId && this.sessions.get(key)?.ownerId === adapter.ownerId; } catch { return false; }
      };

      on('event', (e: { sessionKey: string; kind: string; turnId?: string; text?: string; outcome?: string; truncated?: boolean }) => {
        if (!e?.sessionKey || !accepts(e.sessionKey)) return;
        const session = this.sessions.get(e.sessionKey);
        if (session) {
          if (e.kind === 'turn/started') {
            session.status = 'busy';
            session.activeTurnId = e.turnId;
            session.updatedAt = this.now();
          } else if (e.kind === 'turn/completed') {
            if (!session.activeTurnId || session.activeTurnId === e.turnId) {
              session.status = e.outcome === 'failed' ? 'error' : 'idle';
              session.activeTurnId = undefined;
              session.updatedAt = this.now();
            }
            if (e.outcome === 'completed' && typeof e.turnId === 'string') {
              this.completedTurns.add(JSON.stringify([e.sessionKey, adapter.ownerId, e.turnId]));
              if (this.completedTurns.size > 256) this.completedTurns.delete(this.completedTurns.values().next().value!);
              this.reconcileCompletedTurns(e.sessionKey, adapter.ownerId);
            }
          }
          if (e.kind === 'item/agentMessage/delta' && typeof e.text === 'string' && typeof e.turnId === 'string') {
            let messages = this.messages.get(e.sessionKey);
            if (!messages) {
              if (this.messages.size >= 64) this.messages.delete(this.messages.keys().next().value!);
              messages = []; this.messages.set(e.sessionKey, messages);
            }
            let message = messages.at(-1);
            if (!message || message.turnId !== e.turnId) {
              message = { role: 'agent', text: '', turnId: e.turnId, receivedAt: this.now(), truncated: false };
              messages.push(message); if (messages.length > 4) messages.shift();
            }
            const text = message.text + e.text;
            message.text = text.slice(-4096); message.truncated ||= text.length > 4096 || e.truncated === true;
            message.receivedAt = this.now();
          }
        }
        this.emit('sessionEvent', e);
      });

      on('decision', (d: { sessionKey: string; ownerId: string; nativeRequestId: string | number; nativeRevision: string; allowedAnswers: string[] }) => {
        if (!d?.sessionKey || !accepts(d.sessionKey) || d.ownerId !== adapter.ownerId) return;
        const decisionId = `dec_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        this.journal.registerDecision({
          decisionId,
          sessionKey: d.sessionKey,
          ownerId: d.ownerId,
          nativeRequestId: d.nativeRequestId,
          nativeRevision: d.nativeRevision,
          allowedAnswers: d.allowedAnswers,
        });
        this.emit('decisionRequired', { decisionId, ...d });
      });

      on('decisionResolved', (e: { sessionKey: string; ownerId: string; nativeRequestId: string | number; nativeRevision: string }) => {
        if (!e?.sessionKey || !accepts(e.sessionKey) || e.ownerId !== adapter.ownerId) return;
        for (const decision of this.journal.listDecisions()) {
          if (decision.sessionKey !== e.sessionKey || decision.ownerId !== e.ownerId || decision.nativeRequestId !== e.nativeRequestId || decision.nativeRevision !== e.nativeRevision || ['resolved', 'expired'].includes(decision.status)) continue;
          // Clearing a native request closes its UI prompt, but proves no particular answer was delivered.
          this.journal.revalidateDecision({ ...decision, expectedRevision: decision.revision, outcome: 'resolved' });
        }
      });

      on('ownerLost', (e: { sessionKey: string; ownerId: string; reason: string }) => {
        if (!e?.sessionKey || !accepts(e.sessionKey) || e.ownerId !== adapter.ownerId) return;
        const session = this.sessions.get(e.sessionKey);
        if (session) {
          session.readOnly = true;
          session.ownerId = null;
          session.status = 'idle';
          session.activeTurnId = undefined;
          session.updatedAt = this.now();
        }
        this.emit('ownerLost', e);
      });

      on('offline', () => {
        if (!current()) return;
        for (const session of this.sessions.values()) {
          const parts = parseSessionKey(session.sessionKey);
          if (parts.harness.pluginId === pluginId && parts.harness.instanceId === instanceId) {
            session.status = 'error';
            session.updatedAt = this.now();
          }
        }
        this.emit('adapterOffline', { pluginId, instanceId });
      });
    }
  }

  private adapterEntries(pluginId: string, instanceId?: string): Array<[string, HarnessAdapter]> {
    return [...this.adapters].filter(([key]) => instanceId === undefined ? key.startsWith(pluginId + '/') : key === pluginId + '/' + instanceId);
  }

  getAdapter(pluginId: string, instanceId?: string): HarnessAdapter | undefined {
    const matches = this.adapterEntries(pluginId, instanceId);
    // Never choose the first account/installation when the caller omitted an ambiguous instance.
    return matches.length === 1 ? matches[0]![1] : undefined;
  }

  isAdapterDisabled(pluginId: string, instanceId?: string): boolean {
    const selected = instanceId ?? this.getAdapter(pluginId)?.status?.().instanceId ?? 'default';
    return this.disabledAdapters.has(pluginId) || this.disabledAdapters.has(pluginId + '/' + selected);
  }

  disableAdapter(pluginId: string, instanceId?: string): void {
    this.disabledAdapters.add(instanceId === undefined ? pluginId : pluginId + '/' + instanceId);
    for (const session of this.sessions.values()) if (session.harnessPluginId === pluginId && (instanceId === undefined || session.harnessInstanceId === instanceId)) {
      session.status = 'error'; session.updatedAt = this.now();
    }
    this.emit('adapterDisabled', { pluginId, instanceId });
  }

  enableAdapter(pluginId: string, instanceId?: string): void {
    this.disabledAdapters.delete(instanceId === undefined ? pluginId : pluginId + '/' + instanceId);
    for (const session of this.sessions.values()) if (session.harnessPluginId === pluginId && (instanceId === undefined || session.harnessInstanceId === instanceId)) {
      session.status = this.getAdapter(pluginId, session.harnessInstanceId)?.status?.().connected === false ? 'error' : 'idle'; session.updatedAt = this.now();
    }
    this.emit('adapterEnabled', { pluginId, instanceId });
  }

  async removeAdapter(pluginId: string, instanceId?: string): Promise<void> {
    const entries = this.adapterEntries(pluginId, instanceId);
    for (const [key, adapter] of entries) {
      this.subscriptions.get(key)?.(); this.subscriptions.delete(key);
      // Invalidate before awaiting child exit; late async reads cannot revive this binding.
      this.adapters.delete(key); this.disabledAdapters.delete(key);
      await adapter.stop?.().catch(() => {});
    }
    if (instanceId === undefined) this.disabledAdapters.delete(pluginId);
    for (const session of this.sessions.values()) if (session.harnessPluginId === pluginId && (instanceId === undefined || session.harnessInstanceId === instanceId)) {
      session.readOnly = true; session.ownerId = null; session.status = 'idle';
      session.activeTurnId = undefined; session.updatedAt = this.now();
    }
    this.emit('adapterRemoved', { pluginId, instanceId });
  }

  async reconnectAdapter(pluginId: string, newAdapter: HarnessAdapter): Promise<void> {
    const instanceId = parseInstanceId(newAdapter.status?.().instanceId ?? 'default');
    await this.removeAdapter(pluginId, instanceId);
    this.registerAdapter(pluginId, newAdapter);
    this.disabledAdapters.delete(pluginId + '/' + instanceId);
    this.emit('adapterReconnected', { pluginId, instanceId, ownerId: newAdapter.ownerId });
  }

  getControllerContext(controllerId: string): ControllerContext {
    let ctx = this.controllers.get(controllerId);
    if (!ctx) {
      ctx = new ControllerContext(controllerId);
      this.controllers.set(controllerId, ctx);
    }
    return ctx;
  }

  async createSession(
    pluginId: string,
    root: string,
    options: { title?: string; model?: string; ephemeral?: boolean; workspaceId?: string } = {},
    instanceId?: string
  ): Promise<{ sessionKey: string; ownerId: string }> {
    const adapter = this.getAdapter(pluginId, instanceId);
    if (!adapter) throw new SessionFault('adapter_not_found', `No adapter registered for ${pluginId}`);
    const selectedInstance = this.adapterEntries(pluginId, instanceId).find(([, value]) => value === adapter)![0].split('/')[1]!;
    if (this.isAdapterDisabled(pluginId, instanceId)) {
      throw new SessionFault('harness_disabled', `Harness ${pluginId} is currently disabled`);
    }
    if (typeof adapter.createSession !== 'function') {
      throw new SessionFault('create_unsupported', `Adapter ${pluginId} is observe-only and does not support creating sessions`);
    }
    if (this.metadata && (typeof root !== 'string' || root.length > 4096 || options.title !== undefined && (typeof options.title !== 'string' || !options.title.trim() || options.title.length > 128) || options.workspaceId !== undefined && !/^ws_[0-9a-f]{16}$/.test(options.workspaceId))) throw new SessionFault('invalid_session_metadata');

    const { sessionKey, ownerId } = await adapter.createSession(root, options);
    const parts = parseSessionKey(sessionKey);

    if (this.getAdapter(pluginId, selectedInstance) !== adapter || this.isAdapterDisabled(pluginId, instanceId) || parts.hostId !== this.hostId || parts.harness.pluginId !== pluginId || ownerId !== adapter.ownerId || parts.harness.instanceId !== selectedInstance) throw new SessionFault('adapter_identity_mismatch');

    // Register session in CommandJournal
    this.journal.registerSession(sessionKey, ownerId);

    const summary: SessionSummary = {
      sessionKey,
      nativeSessionId: parts.nativeSessionId,
      harnessPluginId: parts.harness.pluginId,
      harnessInstanceId: parts.harness.instanceId,
      title: options.title || `Session ${parts.nativeSessionId.slice(0, 8)}`,
      preview: '',
      cwd: root,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      readOnly: false,
      ownerId,
      status: 'idle',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.sessions.set(sessionKey, summary);
    this.metadata?.remember(summary);

    return { sessionKey, ownerId };
  }

  async attachSession(sessionKey: string): Promise<{ sessionKey: string; ownerId: string }> {
    const parts = parseSessionKey(sessionKey);
    if (parts.hostId !== this.hostId) throw new SessionFault('foreign_host');
    const adapter = this.getAdapter(parts.harness.pluginId, parts.harness.instanceId);
    if (!adapter?.attachSession || this.isAdapterDisabled(parts.harness.pluginId, parts.harness.instanceId)) throw new SessionFault('attach_unavailable');
    const status = adapter.status?.();
    if (status?.instanceId !== parts.harness.instanceId) throw new SessionFault('instance_mismatch');
    const attached = await adapter.attachSession(parts.nativeSessionId);
    if (this.isAdapterDisabled(parts.harness.pluginId, parts.harness.instanceId)) throw new SessionFault('harness_disabled');
    if (this.getAdapter(parts.harness.pluginId, parts.harness.instanceId) !== adapter || attached.sessionKey !== sessionKey || attached.ownerId !== adapter.ownerId) throw new SessionFault('adapter_identity_mismatch');
    this.journal.registerSession(sessionKey, attached.ownerId);
    const existing = this.sessions.get(sessionKey);
    const summary: SessionSummary = { sessionKey, nativeSessionId: parts.nativeSessionId, harnessPluginId: parts.harness.pluginId, harnessInstanceId: parts.harness.instanceId, title: existing?.title ?? parts.nativeSessionId, preview: existing?.preview ?? '', cwd: existing?.cwd ?? '', ...(existing?.workspaceId ? { workspaceId: existing.workspaceId } : {}), readOnly: false, ownerId: attached.ownerId, status: 'idle', createdAt: existing?.createdAt ?? this.now(), updatedAt: this.now() };
    this.sessions.set(sessionKey, summary);
    this.metadata?.remember(summary);
    return attached;
  }

  async listModels(pluginId: string, instanceId: string) {
    const adapter = this.getAdapter(pluginId, instanceId);
    if (!adapter && this.adapterEntries(pluginId).length) throw new SessionFault('instance_mismatch');
    if (!adapter?.listModels || this.isAdapterDisabled(pluginId, instanceId)) throw new SessionFault('models_unavailable');
    if (adapter.status?.().instanceId !== instanceId) throw new SessionFault('instance_mismatch');
    return adapter.listModels();
  }

  async listSessions(pluginId?: string): Promise<SessionSummary[]> {
    // If adapter supports listing, fetch sessions from it
    for (const [bindingKey, adapter] of this.adapters) {
      const [id, instanceId] = bindingKey.split('/') as [string, string];
      if (pluginId && id !== pluginId || this.isAdapterDisabled(id, instanceId)) continue;
      if (typeof adapter.listSessions === 'function') {
        try {
          const list = await adapter.listSessions();
          if (this.adapters.get(bindingKey) !== adapter || this.isAdapterDisabled(id, instanceId)) continue;
          for (const s of list) {
            const sessionKey = s.sessionKey || formatSessionKey({
              hostId: this.hostId,
              harness: { pluginId: id, instanceId },
              nativeSessionId: s.nativeId,
            });

            const candidate = parseSessionKey(sessionKey);
            if (candidate.hostId !== this.hostId || candidate.harness.pluginId !== id || candidate.harness.instanceId !== instanceId) continue;
            const known = this.sessions.get(sessionKey);
            if (known?.readOnly) {
              known.cwd = s.cwd || known.cwd;
              known.preview = s.preview || known.preview;
              known.status = 'idle'; known.updatedAt = this.now();
            } else if (!known) {
              const parts = parseSessionKey(sessionKey);
              this.sessions.set(sessionKey, {
                sessionKey,
                nativeSessionId: parts.nativeSessionId,
                harnessPluginId: parts.harness.pluginId,
                harnessInstanceId: parts.harness.instanceId,
                title: s.preview ? s.preview.slice(0, 32) : `Session ${s.nativeId.slice(0, 8)}`,
                preview: s.preview || '',
                cwd: s.cwd || '',
                readOnly: true,
                ownerId: null,
                status: 'idle',
                createdAt: this.now(),
                updatedAt: this.now(),
              });
            }
          }
        } catch {}
      }
    }

    const all = Array.from(this.sessions.values(), s => structuredClone(s));
    if (pluginId) {
      return all.filter(s => s.harnessPluginId === pluginId);
    }
    return all;
  }

  snapshotSessions(): SessionSummary[] { return Array.from(this.sessions.values(), s => structuredClone(s)); }
  snapshotMessages(): Record<string, SessionMessage[]> { return Object.fromEntries(Array.from(this.messages, ([key, messages]) => [key, structuredClone(messages)])); }
  snapshotAdapters() {
    return Array.from(this.adapters, ([bindingKey, adapter]) => {
      const [pluginId, instanceId] = bindingKey.split('/') as [string, string];
      const status = adapter.status?.() ?? {};
      return { pluginId, instanceId,
        connected: status.connected === true, auth: typeof status.auth === 'string' ? status.auth : 'unknown',
        sessionListTruncated: status.sessionListTruncated === true, disabled: this.isAdapterDisabled(pluginId, instanceId),
        canAttach: typeof adapter.attachSession === 'function', canCreate: typeof adapter.createSession === 'function', canListModels: typeof adapter.listModels === 'function' };
    });
  }

  private reconcileCompletedTurns(sessionKey: string, ownerId: string): void {
    for (const command of this.journal.listCommands()) {
      if (command.input.sessionKey !== sessionKey || command.input.ownerId !== ownerId || command.input.operation !== 'sessions.send' || command.status !== 'acknowledged' || !command.correlationId) continue;
      const key = JSON.stringify([sessionKey, ownerId, command.correlationId]);
      if (!this.completedTurns.has(key)) continue;
      this.journal.reconcileCommand({ commandId: command.input.commandId, sessionKey, ownerId, correlationId: command.correlationId, outcome: 'completed' });
      this.completedTurns.delete(key);
    }
  }

  getSession(sessionKey: string): SessionSummary | undefined {
    const session = this.sessions.get(sessionKey);
    return session ? structuredClone(session) : undefined;
  }

  /**
   * Enqueues a prompt to the specified session, ensuring destination invariance (R-TARGET).
   */
  async sendPrompt(
    controllerId: string,
    sessionKey: string,
    text: string,
    settings: { model?: string; effort?: string } = {}
  ): Promise<{ commandId: string; status: string }> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new SessionFault('session_not_found');
    if (session.readOnly || !session.ownerId) {
      throw new SessionFault('read_only_session', 'Cannot send prompt to a read-only or foreign session');
    }

    const parts = parseSessionKey(sessionKey);
    if (this.isAdapterDisabled(parts.harness.pluginId, parts.harness.instanceId)) {
      throw new SessionFault('harness_disabled', `Harness ${parts.harness.pluginId} is currently disabled`);
    }
    const adapter = this.getAdapter(parts.harness.pluginId, parts.harness.instanceId);
    if (!adapter) throw new SessionFault('adapter_not_found');

    const commandId = `cmd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const journalSession = this.journal.session(sessionKey);
    if (!journalSession) throw new SessionFault('session_not_registered');

    const input = {
      commandId,
      actorId: controllerId,
      sessionKey,
      ownerId: session.ownerId,
      operation: 'sessions.send',
      payload: { text, ...(settings.model !== undefined ? { model: settings.model } : {}), ...(settings.effort !== undefined ? { effort: settings.effort } : {}) },
      expectedRevision: journalSession.revision,
    };

    const enqueueResult = this.journal.enqueue(input);
    return { commandId, status: enqueueResult.command.status };
  }

  /**
   * Dispatches next queued command for a session to its corresponding adapter.
   */
  async dispatchNext(sessionKey: string): Promise<CommandRecord | undefined> {
    const session = this.sessions.get(sessionKey);
    if (!session || session.readOnly || !session.ownerId) {
      throw new SessionFault('session_read_only_or_unowned');
    }

    const parts = parseSessionKey(sessionKey);
    const adapter = this.getAdapter(parts.harness.pluginId, parts.harness.instanceId);
    if (!adapter) {
      throw new SessionFault('adapter_not_found');
    }

    if (this.isAdapterDisabled(parts.harness.pluginId, parts.harness.instanceId)) throw new SessionFault('harness_disabled');
    const result = await this.journal.dispatchNext(sessionKey, adapter);
    if (this.getAdapter(parts.harness.pluginId, parts.harness.instanceId) === adapter) this.reconcileCompletedTurns(sessionKey, adapter.ownerId);
    return result ? this.journal.command(result.input.commandId) : undefined;
  }

  /**
   * Resolves a pending decision (approval request).
   */
  async resolveDecision(
    controllerId: string,
    decisionId: string,
    answer: string
  ): Promise<{ commandId: string; status: string; dispatched?: CommandRecord }> {
    const decision = this.journal.decision(decisionId);
    if (!decision) throw new SessionFault('decision_not_found');

    const session = this.sessions.get(decision.sessionKey);
    if (!session || session.readOnly || !session.ownerId) throw new SessionFault('session_unowned');
    if (this.isAdapterDisabled(session.harnessPluginId, session.harnessInstanceId)) throw new SessionFault('harness_disabled');

    const commandId = `cmd_dec_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const journalSession = this.journal.session(decision.sessionKey);
    if (!journalSession) throw new SessionFault('session_not_registered');

    const input = {
      commandId,
      actorId: controllerId,
      sessionKey: decision.sessionKey,
      ownerId: session.ownerId,
      operation: 'decisions.resolve',
      payload: { answer },
      expectedRevision: journalSession.revision,
      decision: {
        decisionId,
        expectedRevision: decision.revision,
      },
    };

    const enqueueResult = this.journal.enqueue(input);
    const parts = parseSessionKey(decision.sessionKey);
    const adapter = this.getAdapter(parts.harness.pluginId, parts.harness.instanceId);
    if (!adapter) throw new SessionFault('adapter_not_found');

    const dispatched = await this.journal.dispatchNext(decision.sessionKey, adapter);
    return { commandId, status: enqueueResult.command.status, dispatched };
  }

  /**
   * Interrupts an active turn on the session.
   */
  async interruptTurn(
    controllerId: string,
    sessionKey: string,
    turnId: string
  ): Promise<{ commandId: string; status: string; dispatched?: CommandRecord }> {
    const session = this.sessions.get(sessionKey);
    if (!session || session.readOnly || !session.ownerId) {
      throw new SessionFault('session_read_only_or_unowned');
    }

    if (this.isAdapterDisabled(session.harnessPluginId, session.harnessInstanceId)) throw new SessionFault('harness_disabled');
    const commandId = `cmd_int_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const journalSession = this.journal.session(sessionKey);
    if (!journalSession) throw new SessionFault('session_not_registered');

    const input = {
      commandId,
      actorId: controllerId,
      sessionKey,
      ownerId: session.ownerId,
      operation: 'sessions.interrupt',
      payload: { turnId },
      expectedRevision: journalSession.revision,
    };

    const enqueueResult = this.journal.enqueue(input);
    const parts = parseSessionKey(sessionKey);
    const adapter = this.getAdapter(parts.harness.pluginId, parts.harness.instanceId);
    if (!adapter) throw new SessionFault('adapter_not_found');

    const dispatched = await this.journal.dispatchNext(sessionKey, adapter);
    return { commandId, status: enqueueResult.command.status, dispatched };
  }
}
