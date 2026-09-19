import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { formatSessionKey, parseSessionKey, type DispatchPort, type DispatchReceipt, type CommandRecord, type DecisionRecord } from '@snowball/core';
import { CodexFault, CodexStdio, type CodexLaunch, type RpcPort } from './transport.js';
export { CodexFault, codexLaunchDigest, CodexStdio, type CodexLaunch, type RpcPort } from './transport.js';
export { codexManifest } from './manifest.js';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);
const key = (value: string | number) => JSON.stringify(value);
interface NativeDecision { id: string | number; threadId: string; turnId: string; revision: string; answers: string[]; claimed: boolean; }
export interface CodexBinding { hostId: string; instanceId: string; codexHome: string; }

/** Trusted adapter boundary. Consumers dispatch mutations through CommandJournal, not raw RPC. */
export class CodexOwnedAdapter extends EventEmitter implements DispatchPort {
  readonly ownerId = `codex-owner:${randomUUID()}`;
  readonly #binding: CodexBinding;
  #ready = false;
  #auth: 'unknown' | 'needs_auth' | 'available' | 'not_required' = 'unknown';
  #owned = new Set<string>();
  #turns = new Map<string, string>();
  #completedTurns = new Set<string>();
  #decisions = new Map<string, NativeDecision>();
  #answers = new Map<string, { resolve(value: DispatchReceipt): void; reject(error: Error): void; dispose(): void }>();
  #busy = new Set<string>();
  constructor(private readonly rpc: RpcPort, binding: CodexBinding) {
    super(); this.#binding = structuredClone(binding);
    formatSessionKey({ hostId: binding.hostId, harness: { pluginId: 'snowball.codex', instanceId: binding.instanceId }, nativeSessionId: 'validation' });
    rpc.on('notification', value => this.notification(value));
    rpc.on('request', value => this.serverRequest(value));
    rpc.on('fault', () => this.disconnected());
  }
  static async connect(launch: CodexLaunch, approvedDigest: string, binding: Omit<CodexBinding, 'codexHome'>): Promise<CodexOwnedAdapter> {
    const rpc = await CodexStdio.start(launch, approvedDigest);
    const adapter = new CodexOwnedAdapter(rpc, { ...binding, codexHome: launch.codexHome });
    try { await adapter.initialize(launch.version); return adapter; } catch (error) { await rpc.stop(); throw error; }
  }
  async initialize(expectedVersion = '0.153.4'): Promise<void> {
    if (this.#ready) throw new CodexFault('already_connected');
    const hello = await this.rpc.request('initialize', { clientInfo: { name: 'snowball_middleware', title: 'Snowball Middleware', version: '0.1.0' } });
    if (!record(hello) || typeof hello.userAgent !== 'string' || !hello.userAgent.split(/[^A-Za-z0-9.+-]/).includes(expectedVersion) || typeof hello.codexHome !== 'string' || path.normalize(hello.codexHome) !== path.normalize(this.#binding.codexHome)) throw new CodexFault('incompatible_handshake');
    this.rpc.notify('initialized'); this.#ready = true;
    await this.refreshAuth();
  }
  status() { return { connected: this.#ready, auth: this.#auth, ownerId: this.ownerId, instanceId: this.#binding.instanceId, surface: 'owned-stdio', credentialSource: 'selected-codex-home', existingDesktopControl: false, ownedSessionCount: this.#owned.size, runtimeProcessId: this.rpc.processId ?? null }; }
  async refreshAuth(): Promise<void> {
    this.ready(); const account = await this.rpc.request('account/read', { refreshToken: false });
    if (!record(account) || typeof account.requiresOpenaiAuth !== 'boolean') throw new CodexFault('invalid_account_state');
    this.#auth = account.requiresOpenaiAuth === false ? 'not_required' : record(account.account) && ['apiKey', 'chatgpt'].includes(account.account.type) ? 'available' : 'needs_auth';
    // Account availability is not proof that the next cloud inference succeeds. Never return email/tokens.
  }
  private ready(): void { if (!this.#ready) throw new CodexFault('not_connected'); }
  private sessionKey(threadId: string): string { return formatSessionKey({ hostId: this.#binding.hostId, harness: { pluginId: 'snowball.codex', instanceId: this.#binding.instanceId }, nativeSessionId: threadId }); }
  async createSession(root: string, options: { ephemeral?: boolean; model?: string } = {}): Promise<{ sessionKey: string; ownerId: string }> {
    this.ready(); if (this.#auth === 'needs_auth' || this.#auth === 'unknown') throw new CodexFault('needs_auth');
    if (!path.isAbsolute(root) || options.model !== undefined && !id(options.model) || this.#owned.size >= 128) throw new CodexFault('invalid_session_request');
    const cwd = await realpath(root);
    const value = await this.rpc.request('thread/start', { cwd, ephemeral: options.ephemeral === true, approvalPolicy: 'on-request', sandbox: 'read-only', ...(options.model ? { model: options.model } : {}) });
    if (!record(value) || !record(value.thread) || !id(value.thread.id) || this.#owned.has(value.thread.id)) throw new CodexFault('invalid_thread_response', 'unknown');
    this.#owned.add(value.thread.id);
    return { sessionKey: this.sessionKey(value.thread.id), ownerId: this.ownerId };
  }
  async listSessions(): Promise<{ nativeId: string; sessionKey: string; ownerId: string | null; readOnly: boolean; cwd: string }[]> {
    this.ready(); const result = await this.rpc.request('thread/list', { limit: 100 });
    if (!record(result) || !Array.isArray(result.data) || result.data.length > 100) throw new CodexFault('invalid_thread_list');
    return result.data.filter((t: unknown) => record(t) && id(t.id)).map((t: any) => ({ nativeId: t.id, sessionKey: this.sessionKey(t.id), ownerId: this.#owned.has(t.id) ? this.ownerId : null, readOnly: !this.#owned.has(t.id), cwd: typeof t.cwd === 'string' ? t.cwd.slice(0, 4096) : '' }));
  }
  async readSession(threadId: string): Promise<{ nativeId: string; readOnly: boolean }> {
    this.ready(); if (!id(threadId)) throw new CodexFault('invalid_thread');
    const value = await this.rpc.request('thread/read', { threadId, includeTurns: false });
    if (!record(value) || !record(value.thread) || value.thread.id !== threadId) throw new CodexFault('invalid_thread_response');
    return { nativeId: threadId, readOnly: !this.#owned.has(threadId) };
  }
  async execute(envelope: { command: CommandRecord; decision?: DecisionRecord }, signal: AbortSignal): Promise<DispatchReceipt> {
    const input = envelope.command.input;
    const no = (reason: string): DispatchReceipt => ({ status: 'not_sent', reason });
    if (!this.#ready || signal.aborted) return no('not_connected_or_cancelled');
    const target = parseSessionKey(input.sessionKey);
    if (input.ownerId !== this.ownerId || target.hostId !== this.#binding.hostId || target.harness.instanceId !== this.#binding.instanceId || target.harness.pluginId !== 'snowball.codex' || !this.#owned.has(target.nativeSessionId)) return no('owner_mismatch');
    const threadId = target.nativeSessionId; const payload: unknown = input.payload;
    if (!record(payload)) return no('invalid_payload');
    if (input.operation === 'sessions.send') {
      if (this.#auth === 'needs_auth' || this.#auth === 'unknown') return no('needs_auth');
      if (this.#busy.has(threadId) || this.#turns.has(threadId)) return no('turn_already_active');
      if (typeof payload.text !== 'string' || !payload.text.trim() || Buffer.byteLength(payload.text) > 60000 || Object.keys(payload).some(k => k !== 'text')) return no('invalid_message');
      this.#busy.add(threadId);
      try {
        const result = await this.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: payload.text }], clientUserMessageId: input.commandId }, signal);
        if (!record(result) || !record(result.turn) || !id(result.turn.id)) throw new CodexFault('invalid_turn_response', 'unknown');
        if (!this.#completedTurns.has(JSON.stringify([threadId, result.turn.id])) && !['completed', 'interrupted', 'failed'].includes(result.turn.status)) this.#turns.set(threadId, result.turn.id);
        return { status: 'acknowledged', correlationId: result.turn.id };
      } finally { this.#busy.delete(threadId); }
    }
    if (input.operation === 'sessions.interrupt') {
      if (!id(payload.turnId) || Object.keys(payload).some(k => k !== 'turnId') || this.#turns.get(threadId) !== payload.turnId) return no('stale_turn');
      await this.rpc.request('turn/interrupt', { threadId, turnId: payload.turnId }, signal);
      return { status: 'acknowledged', correlationId: payload.turnId };
    }
    if (input.operation === 'decisions.resolve') {
      const decision = envelope.decision;
      if (!decision || decision.ownerId !== this.ownerId || decision.sessionKey !== input.sessionKey || !input.decision || input.decision.decisionId !== decision.decisionId || typeof payload.answer !== 'string' || Object.keys(payload).some(k => k !== 'answer')) return no('invalid_decision');
      const native = this.#decisions.get(key(decision.nativeRequestId));
      if (!native || native.claimed || native.threadId !== threadId || native.revision !== decision.nativeRevision || !native.answers.includes(payload.answer) || this.#turns.get(threadId) !== native.turnId) return no('stale_decision');
      native.claimed = true;
      return this.answer(native, payload.answer, signal);
    }
    return no('unsupported_operation');
  }
  private answer(decision: NativeDecision, answer: string, signal: AbortSignal): Promise<DispatchReceipt> {
    const requestKey = key(decision.id);
    return new Promise((resolve, reject) => {
      const fail = () => { const pending = this.#answers.get(requestKey); if (!pending) return; this.#answers.delete(requestKey); pending.dispose(); reject(new CodexFault('decision_delivery_unknown', 'unknown')); };
      const timer = setTimeout(fail, 5000);
      this.#answers.set(requestKey, { resolve, reject, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', fail); } });
      signal.addEventListener('abort', fail, { once: true });
      try { this.rpc.respond(decision.id, { decision: answer }); } catch { fail(); }
    });
  }
  private serverRequest(value: unknown): void {
    if (!record(value) || !(typeof value.id === 'string' && id(value.id) || Number.isSafeInteger(value.id)) || !record(value.params)) return;
    const p = value.params;
    if (!this.#owned.has(p.threadId) || !id(p.turnId) || !id(p.itemId)) { this.emit('unsupportedRequest', { reason: 'unowned_or_invalid_request' }); return; }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(value.method) || this.#decisions.size >= 64 || this.#decisions.has(key(value.id))) { this.emit('unsupportedRequest', { reason: 'unsupported_decision' }); return; }
    if (this.#turns.get(p.threadId) !== p.turnId) { this.emit('unsupportedRequest', { reason: 'unconfirmed_turn' }); return; }
    const answers = ['accept', 'decline', 'cancel'].filter(answer => !Array.isArray(p.availableDecisions) || p.availableDecisions.includes(answer));
    if (!answers.length) { this.emit('unsupportedRequest', { reason: 'unsupported_answers' }); return; }
    const native: NativeDecision = { id: value.id, threadId: p.threadId, turnId: p.turnId, revision: randomUUID(), answers, claimed: false };
    this.#decisions.set(key(value.id), native);
    this.emit('decision', { sessionKey: this.sessionKey(p.threadId), ownerId: this.ownerId, nativeRequestId: native.id, nativeRevision: native.revision, allowedAnswers: [...answers] });
  }
  private notification(value: unknown): void {
    if (!record(value) || !record(value.params)) return; const p = value.params;
    if (value.method === 'account/updated') { this.#auth = 'unknown'; this.emit('authChanged', { requiresRecheck: true }); return; }
    if (!this.#owned.has(p.threadId)) return;
    if (value.method === 'turn/started' && record(p.turn) && id(p.turn.id)) {
      if (!this.#busy.has(p.threadId) && this.#turns.get(p.threadId) !== p.turn.id) {
        this.#owned.delete(p.threadId); this.#turns.delete(p.threadId);
        this.emit('ownerLost', { sessionKey: this.sessionKey(p.threadId), ownerId: this.ownerId, reason: 'unexpected_native_turn' }); return;
      }
      this.#turns.set(p.threadId, p.turn.id);
    }
    if (value.method === 'turn/completed' && record(p.turn) && id(p.turn.id)) {
      this.#completedTurns.add(JSON.stringify([p.threadId, p.turn.id]));
      if (this.#completedTurns.size > 256) this.#completedTurns.delete(this.#completedTurns.values().next().value!);
      if (this.#turns.get(p.threadId) === p.turn.id) this.#turns.delete(p.threadId);
      for (const [k, decision] of this.#decisions) if (decision.threadId === p.threadId && decision.turnId === p.turn.id) this.#decisions.delete(k);
    }
    if (value.method === 'serverRequest/resolved') {
      const k = key(p.requestId); const native = this.#decisions.get(k);
      if (native && native.threadId === p.threadId) {
        this.#decisions.delete(k); const pending = this.#answers.get(k);
        // This notification also covers automatic clearing. It cannot prove our exact answer was accepted.
        if (pending) { this.#answers.delete(k); pending.dispose(); pending.reject(new CodexFault('decision_resolution_not_acceptance_proof', 'unknown')); }
        this.emit('decisionResolved', { sessionKey: this.sessionKey(p.threadId), nativeRequestId: p.requestId, nativeRevision: native.revision });
      }
    }
    if (['turn/started', 'turn/completed', 'item/agentMessage/delta'].includes(value.method)) {
      this.emit('event', { sessionKey: this.sessionKey(p.threadId), ownerId: this.ownerId, kind: value.method, turnId: record(p.turn) ? p.turn.id : p.turnId, ...(value.method === 'item/agentMessage/delta' && typeof p.delta === 'string' ? { text: p.delta.slice(0, 65536) } : {}) });
    }
  }
  private disconnected(): void {
    this.#ready = false; this.#auth = 'unknown'; this.#owned.clear(); this.#turns.clear(); this.#decisions.clear();
    for (const p of this.#answers.values()) { p.dispose(); p.reject(new CodexFault('disconnected', 'unknown')); } this.#answers.clear();
    this.emit('offline', { ownerId: this.ownerId });
  }
  async stop(): Promise<void> { this.disconnected(); await this.rpc.stop(); }
}
