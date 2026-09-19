import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parseHostId, parseSessionKey, formatSessionKey, type SessionKeyParts } from './identity.js';
import { CommandJournal, type DispatchPort } from './commands.js';
import { ControllerContext, type ControllerSelection } from './context.js';
import type { CommandRecord, DecisionRecord } from './journal-model.js';

export interface HarnessAdapter extends DispatchPort {
  status?(): Record<string, unknown>;
  listSessions?(): Promise<Array<{ nativeId: string; sessionKey?: string; ownerId?: string | null; readOnly?: boolean; cwd?: string; preview?: string }>>;
  readSession?(id: string): Promise<{ nativeId: string; readOnly?: boolean; turns?: unknown[] }>;
  createSession?(root: string, options?: Record<string, unknown>): Promise<{ sessionKey: string; ownerId: string }>;
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
  readOnly: boolean;
  ownerId: string | null;
  status: 'idle' | 'busy' | 'error';
  activeTurnId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionServiceOptions {
  hostId: string;
  journal: CommandJournal;
  now?: () => number;
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
 * - Read-only vs owned session separation: foreign/historical sessions cannot receive commands.
 * - R-TARGET / J03: in-flight drafts and pending decisions have immutable destinations;
 *   switching controller selection never mutates destination.
 * - Turn and decision state normalization across harnesses.
 * - Local vertical-slice round-trip with zero hardware devices.
 */
export class SessionService extends EventEmitter {
  readonly hostId: string;
  readonly journal: CommandJournal;
  private readonly now: () => number;
  private readonly adapters = new Map<string, HarnessAdapter>();
  private readonly disabledAdapters = new Set<string>();
  private readonly sessions = new Map<string, SessionSummary>();
  private readonly controllers = new Map<string, ControllerContext>();

  constructor(options: SessionServiceOptions) {
    super();
    this.hostId = parseHostId(options.hostId);
    this.journal = options.journal;
    this.now = options.now ?? Date.now;
  }

  registerAdapter(pluginId: string, adapter: HarnessAdapter): void {
    this.adapters.set(pluginId, adapter);

    // If adapter is an EventEmitter, attach event listeners for normalization
    if (typeof (adapter as unknown as EventEmitter).on === 'function') {
      const emitter = adapter as unknown as EventEmitter;

      emitter.on('event', (e: { sessionKey: string; kind: string; turnId?: string; text?: string }) => {
        if (!e?.sessionKey) return;
        const session = this.sessions.get(e.sessionKey);
        if (session) {
          if (e.kind === 'turn/started') {
            session.status = 'busy';
            session.activeTurnId = e.turnId;
            session.updatedAt = this.now();
          } else if (e.kind === 'turn/completed') {
            session.status = 'idle';
            session.activeTurnId = undefined;
            session.updatedAt = this.now();
          }
        }
        this.emit('sessionEvent', e);
      });

      emitter.on('decision', (d: { sessionKey: string; ownerId: string; nativeRequestId: string | number; nativeRevision: string; allowedAnswers: string[] }) => {
        if (!d?.sessionKey) return;
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

      emitter.on('ownerLost', (e: { sessionKey: string; ownerId: string; reason: string }) => {
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

      emitter.on('offline', () => {
        for (const session of this.sessions.values()) {
          const parts = parseSessionKey(session.sessionKey);
          if (parts.harness.pluginId === pluginId) {
            session.status = 'error';
            session.updatedAt = this.now();
          }
        }
        this.emit('adapterOffline', { pluginId });
      });
    }
  }

  getAdapter(pluginId: string): HarnessAdapter | undefined {
    return this.adapters.get(pluginId);
  }

  isAdapterDisabled(pluginId: string): boolean {
    return this.disabledAdapters.has(pluginId);
  }

  disableAdapter(pluginId: string): void {
    this.disabledAdapters.add(pluginId);
    for (const session of this.sessions.values()) {
      if (session.harnessPluginId === pluginId) {
        session.status = 'error';
        session.updatedAt = this.now();
      }
    }
    this.emit('adapterDisabled', { pluginId });
  }

  enableAdapter(pluginId: string): void {
    this.disabledAdapters.delete(pluginId);
    for (const session of this.sessions.values()) {
      if (session.harnessPluginId === pluginId) {
        session.status = 'idle';
        session.updatedAt = this.now();
      }
    }
    this.emit('adapterEnabled', { pluginId });
  }

  async removeAdapter(pluginId: string): Promise<void> {
    const adapter = this.adapters.get(pluginId);
    if (adapter?.stop) {
      await adapter.stop().catch(() => {});
    }
    this.adapters.delete(pluginId);
    this.disabledAdapters.delete(pluginId);

    // Preserve historical sessions as read-only (R-TRUTH / H14)
    for (const session of this.sessions.values()) {
      if (session.harnessPluginId === pluginId) {
        session.readOnly = true;
        session.ownerId = null;
        session.status = 'idle';
        session.activeTurnId = undefined;
        session.updatedAt = this.now();
      }
    }
    this.emit('adapterRemoved', { pluginId });
  }

  async reconnectAdapter(pluginId: string, newAdapter: HarnessAdapter): Promise<void> {
    const oldAdapter = this.adapters.get(pluginId);
    if (oldAdapter?.stop) {
      await oldAdapter.stop().catch(() => {});
    }

    // Register new adapter
    this.registerAdapter(pluginId, newAdapter);
    this.disabledAdapters.delete(pluginId);

    // Ownership update (H12 / H13): If new process has a different owner ID,
    // prior sessions are cleanly marked readOnly = true to prevent ownership contamination
    for (const session of this.sessions.values()) {
      if (session.harnessPluginId === pluginId) {
        if (session.ownerId !== newAdapter.ownerId) {
          session.readOnly = true;
          session.ownerId = null;
          session.activeTurnId = undefined;
        }
        session.status = 'idle';
        session.updatedAt = this.now();
      }
    }

    this.emit('adapterReconnected', { pluginId, ownerId: newAdapter.ownerId });
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
    options: { title?: string; model?: string; ephemeral?: boolean } = {}
  ): Promise<{ sessionKey: string; ownerId: string }> {
    const adapter = this.adapters.get(pluginId);
    if (!adapter) throw new SessionFault('adapter_not_found', `No adapter registered for ${pluginId}`);
    if (this.disabledAdapters.has(pluginId)) {
      throw new SessionFault('harness_disabled', `Harness ${pluginId} is currently disabled`);
    }
    if (typeof adapter.createSession !== 'function') {
      throw new SessionFault('create_unsupported', `Adapter ${pluginId} is observe-only and does not support creating sessions`);
    }

    const { sessionKey, ownerId } = await adapter.createSession(root, options);
    const parts = parseSessionKey(sessionKey);

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
      readOnly: false,
      ownerId,
      status: 'idle',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.sessions.set(sessionKey, summary);

    return { sessionKey, ownerId };
  }

  async listSessions(pluginId?: string): Promise<SessionSummary[]> {
    // If adapter supports listing, fetch sessions from it
    for (const [id, adapter] of this.adapters) {
      if (pluginId && id !== pluginId) continue;
      if (typeof adapter.listSessions === 'function') {
        try {
          const list = await adapter.listSessions();
          for (const s of list) {
            const sessionKey = s.sessionKey || formatSessionKey({
              hostId: this.hostId,
              harness: { pluginId: id, instanceId: 'default' },
              nativeSessionId: s.nativeId,
            });

            if (!this.sessions.has(sessionKey)) {
              const parts = parseSessionKey(sessionKey);
              this.sessions.set(sessionKey, {
                sessionKey,
                nativeSessionId: parts.nativeSessionId,
                harnessPluginId: parts.harness.pluginId,
                harnessInstanceId: parts.harness.instanceId,
                title: s.preview ? s.preview.slice(0, 32) : `Session ${s.nativeId.slice(0, 8)}`,
                preview: s.preview || '',
                cwd: s.cwd || '',
                readOnly: s.readOnly ?? true,
                ownerId: s.ownerId ?? null,
                status: 'idle',
                createdAt: this.now(),
                updatedAt: this.now(),
              });
            }
          }
        } catch {}
      }
    }

    const all = Array.from(this.sessions.values());
    if (pluginId) {
      return all.filter(s => s.harnessPluginId === pluginId);
    }
    return all;
  }

  getSession(sessionKey: string): SessionSummary | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Enqueues a prompt to the specified session, ensuring destination invariance (R-TARGET).
   */
  async sendPrompt(
    controllerId: string,
    sessionKey: string,
    text: string
  ): Promise<{ commandId: string; status: string }> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new SessionFault('session_not_found');
    if (session.readOnly || !session.ownerId) {
      throw new SessionFault('read_only_session', 'Cannot send prompt to a read-only or foreign session');
    }

    const parts = parseSessionKey(sessionKey);
    if (this.disabledAdapters.has(parts.harness.pluginId)) {
      throw new SessionFault('harness_disabled', `Harness ${parts.harness.pluginId} is currently disabled`);
    }
    const adapter = this.adapters.get(parts.harness.pluginId);
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
      payload: { text },
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
    const adapter = this.adapters.get(parts.harness.pluginId);
    if (!adapter) {
      throw new SessionFault('adapter_not_found');
    }

    return this.journal.dispatchNext(sessionKey, adapter);
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
    if (!session || !session.ownerId) throw new SessionFault('session_unowned');

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
    const adapter = this.adapters.get(parts.harness.pluginId);
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
    const adapter = this.adapters.get(parts.harness.pluginId);
    if (!adapter) throw new SessionFault('adapter_not_found');

    const dispatched = await this.journal.dispatchNext(sessionKey, adapter);
    return { commandId, status: enqueueResult.command.status, dispatched };
  }
}
