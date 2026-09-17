import { parseHostId, parseSessionKey } from './identity.js';
import { DurableLog, JournalFault } from './durable-log.js';
import { commandInput, decisionInput, copy, fingerprint, isRecord, requireThat, nonnegative, opaque, type CommandInput, type CommandRecord, type DecisionInput, type DecisionRecord, type SessionRecord, type JournalTransaction } from './journal-model.js';

export interface JournalOptions {
  directory: string; hostId: string; now?: () => number;
  maxSessionPending?: number; maxTotalPending?: number; maxJournalBytes?: number; dispatchTimeoutMs?: number;
}
export type DispatchReceipt = { status: 'acknowledged' | 'completed'; correlationId: string } | { status: 'not_sent'; reason: string };
export interface DispatchPort {
  ownerId: string;
  execute(envelope: { command: CommandRecord; decision?: DecisionRecord }, signal: AbortSignal): Promise<DispatchReceipt>;
}
export interface CommandProof {
  commandId: string; sessionKey: string; ownerId: string; correlationId: string;
  outcome: 'acknowledged' | 'completed' | 'not_delivered';
}
export interface DecisionProof {
  decisionId: string; sessionKey: string; ownerId: string; expectedRevision: number;
  nativeRequestId: string | number; nativeRevision: string; outcome: 'pending' | 'resolved' | 'expired';
}
const terminal = (c: CommandRecord) => ['completed', 'failed', 'cancelled'].includes(c.status);
const active = (c: CommandRecord) => !terminal(c);
const barrier = (c: CommandRecord) => c.status === 'dispatched' || c.status === 'unknown';

/** Core-only capability. Do not expose registration/proof/dispatch methods as arbitrary client routes. */
export class CommandJournal {
  private readonly log: DurableLog;
  private readonly commands = new Map<string, CommandRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly decisions = new Map<string, DecisionRecord>();
  private readonly verifiedSessions = new Set<string>();
  private readonly hostId: string;
  private readonly now: () => number;
  private readonly maxSession: number;
  private readonly maxTotal: number;
  private readonly timeout: number;
  private order = 0;
  private closed = false;
  private poisoned = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: JournalOptions) {
    this.hostId = parseHostId(options.hostId);
    this.now = options.now ?? Date.now;
    this.maxSession = options.maxSessionPending ?? 32; this.maxTotal = options.maxTotalPending ?? 1024;
    this.timeout = options.dispatchTimeoutMs ?? 5000;
    for (const limit of [this.maxSession, this.maxTotal, this.timeout]) requireThat(Number.isSafeInteger(limit) && limit > 0, 'Invalid journal limit');
    this.log = new DurableLog(options.directory, options.maxJournalBytes);
    try {
      for (const record of this.log.records) this.apply(this.validate(record));
      if (this.log.records.length === 0) this.commit({});
      this.log.records.length = 0;
      this.recover();
    } catch (error) { this.log.close(); throw error; }
  }
  private checkOpen(): void { requireThat(!this.closed && !this.poisoned, 'Journal unavailable; reopen and inspect before dispatch', 'unavailable'); }
  private time(): number { return nonnegative(this.now(), 'clock'); }
  private validate(raw: unknown): JournalTransaction {
    requireThat(isRecord(raw) && raw.schema === 1 && raw.hostId === this.hostId, 'Journal schema or host mismatch', 'schema');
    requireThat(Array.isArray(raw.sessions) && Array.isArray(raw.commands) && Array.isArray(raw.decisions), 'Invalid journal transaction', 'corrupt');
    const sessions = raw.sessions.map(value => {
      requireThat(isRecord(value), 'Invalid session record');
      const sessionKey = String(value.sessionKey);
      requireThat(parseSessionKey(sessionKey).hostId === this.hostId, 'Foreign session');
      return { sessionKey, ownerId: opaque(value.ownerId, 'owner'), revision: nonnegative(value.revision, 'revision') };
    });
    const commands = raw.commands.map(value => {
      requireThat(isRecord(value), 'Invalid command record');
      const input = commandInput(value.input, this.hostId);
      requireThat(value.fingerprint === fingerprint(input), 'Command fingerprint mismatch', 'corrupt');
      requireThat(['queued', 'dispatched', 'acknowledged', 'completed', 'failed', 'unknown', 'cancelled'].includes(String(value.status)), 'Invalid command state');
      const c: CommandRecord = { input, fingerprint: String(value.fingerprint), status: value.status as CommandRecord['status'], revision: nonnegative(value.revision, 'revision'), order: nonnegative(value.order, 'order'), createdAt: nonnegative(value.createdAt, 'createdAt'), updatedAt: nonnegative(value.updatedAt, 'updatedAt') };
      if (value.reason !== undefined) c.reason = opaque(value.reason, 'reason');
      if (value.correlationId !== undefined) c.correlationId = opaque(value.correlationId, 'correlation');
      return c;
    });
    const decisions = raw.decisions.map(value => {
      requireThat(isRecord(value), 'Invalid decision record');
      const input = decisionInput(value, this.hostId);
      requireThat(['pending', 'claimed', 'needs_review', 'unknown', 'resolved', 'expired'].includes(String(value.status)), 'Invalid decision state');
      const d: DecisionRecord = { ...input, status: value.status as DecisionRecord['status'], revision: nonnegative(value.revision, 'revision'), updatedAt: nonnegative(value.updatedAt, 'updatedAt') };
      if (value.claimCommandId !== undefined) d.claimCommandId = opaque(value.claimCommandId, 'claim');
      return d;
    });
    for (const [updates, existing, id] of [
      [sessions, this.sessions, 'sessionKey'], [commands, this.commands, 'input'], [decisions, this.decisions, 'decisionId'],
    ] as const) {
      const seen = new Set<string>();
      for (const item of updates) {
        const key = id === 'input' ? (item as CommandRecord).input.commandId : String((item as unknown as Record<string, unknown>)[id]);
        requireThat(!seen.has(key), 'Duplicate record in transaction', 'corrupt'); seen.add(key);
        const previous = existing.get(key);
        requireThat(item.revision === (previous ? previous.revision + 1 : 0), 'Invalid record revision', 'corrupt');
      }
    }
    for (const c of commands) {
      const previous = this.commands.get(c.input.commandId);
      requireThat(!previous || (previous.fingerprint === c.fingerprint && previous.order === c.order && previous.createdAt === c.createdAt), 'Command identity changed', 'corrupt');
      requireThat(sessions.some(s => s.sessionKey === c.input.sessionKey) || this.sessions.has(c.input.sessionKey), 'Command missing session', 'corrupt');
    }
    for (const d of decisions) {
      const previous = this.decisions.get(d.decisionId);
      requireThat(!previous || fingerprint(decisionInput(previous, this.hostId)) === fingerprint(decisionInput(d, this.hostId)), 'Decision identity changed', 'corrupt');
      requireThat(sessions.some(s => s.sessionKey === d.sessionKey) || this.sessions.has(d.sessionKey), 'Decision missing session', 'corrupt');
      const claim = commands.find(c => c.input.commandId === d.claimCommandId) ?? this.commands.get(d.claimCommandId ?? '');
      requireThat(!d.claimCommandId || (claim && claim.input.decision?.decisionId === d.decisionId && claim.input.sessionKey === d.sessionKey && claim.input.ownerId === d.ownerId), 'Decision claim mismatch', 'corrupt');
      requireThat(d.status !== 'claimed' || !!d.claimCommandId, 'Claimed decision missing command', 'corrupt');
    }
    return { schema: 1, hostId: this.hostId, sessions, commands, decisions };
  }
  private apply(tx: JournalTransaction): void {
    for (const s of tx.sessions) this.sessions.set(s.sessionKey, s);
    for (const c of tx.commands) { this.commands.set(c.input.commandId, c); this.order = Math.max(this.order, c.order); }
    for (const d of tx.decisions) this.decisions.set(d.decisionId, d);
  }
  private commit(changes: Partial<Pick<JournalTransaction, 'sessions' | 'commands' | 'decisions'>>): void {
    this.checkOpen();
    const tx = this.validate({ schema: 1, hostId: this.hostId, sessions: [], commands: [], decisions: [], ...changes });
    try { this.log.append(tx); } catch (error) { this.poisoned = true; throw error; }
    this.apply(tx); // Published only AFTER durable write succeeds.
    for (const listener of this.listeners) { try { listener(); } catch { /* An observer cannot undo a durable commit. */ } }
  }
  private changeCommand(c: CommandRecord, status: CommandRecord['status'], reason?: string): CommandRecord {
    return { ...copy(c), status, revision: c.revision + 1, updatedAt: this.time(), ...(reason ? { reason } : {}) };
  }
  private changeDecision(d: DecisionRecord, status: DecisionRecord['status']): DecisionRecord {
    return { ...copy(d), status, revision: d.revision + 1, updatedAt: this.time() };
  }
  private recover(): void {
    for (const c of this.commands.values()) {
      if (c.status === 'queued') this.finish(c, 'cancelled', 'restart_before_dispatch');
      else if (c.status === 'dispatched' || c.status === 'acknowledged') this.finish(c, 'unknown', 'restart_after_dispatch');
    }
    for (const d of this.decisions.values()) {
      if (d.status === 'resolved' || d.status === 'expired') continue;
      const command = this.commands.get(d.claimCommandId ?? '');
      const next = this.changeDecision(d, command && active(command) ? 'unknown' : 'needs_review');
      if (!command || terminal(command)) delete next.claimCommandId;
      if (next.status !== d.status || next.claimCommandId !== d.claimCommandId) this.commit({ decisions: [next] });
    }
  }
  session(sessionKey: string): SessionRecord | undefined { const s = this.sessions.get(sessionKey); return s ? copy(s) : undefined; }
  command(commandId: string): CommandRecord | undefined { const c = this.commands.get(commandId); return c ? copy(c) : undefined; }
  decision(decisionId: string): DecisionRecord | undefined { const d = this.decisions.get(decisionId); return d ? copy(d) : undefined; }
  listCommands(): CommandRecord[] { return [...this.commands.values()].map(copy); }
  listDecisions(): DecisionRecord[] { return [...this.decisions.values()].map(copy); }
  listSessions(): SessionRecord[] { return [...this.sessions.values()].map(copy); }
  subscribe(listener: () => void): () => void {
    this.checkOpen(); this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }

  /** Trusted adapter observation; not a client selection or discovery result. */
  registerSession(sessionKey: string, ownerId: string): SessionRecord {
    this.checkOpen();
    requireThat(parseSessionKey(sessionKey).hostId === this.hostId, 'Foreign host'); opaque(ownerId, 'owner');
    const old = this.sessions.get(sessionKey);
    if (old?.ownerId === ownerId) { this.verifiedSessions.add(sessionKey); return copy(old); }
    const s: SessionRecord = { sessionKey, ownerId, revision: old ? old.revision + 1 : 0 };
    // Each bounded transaction is restart-safe. Never pack an entire full queue into one WAL frame.
    this.commit({ sessions: [s] });
    for (const c of this.commands.values()) {
      if (c.input.sessionKey === sessionKey && active(c)) this.finish(c, c.status === 'queued' ? 'cancelled' : 'unknown', 'owner_changed');
    }
    for (const d of this.decisions.values()) {
      if (d.sessionKey !== sessionKey || d.status === 'resolved' || d.status === 'expired') continue;
      const cmd = this.commands.get(d.claimCommandId ?? '');
      const next = this.changeDecision(d, cmd && active(cmd) ? 'unknown' : 'needs_review');
      if (!cmd || terminal(cmd)) delete next.claimCommandId;
      if (next.status !== d.status || next.claimCommandId !== d.claimCommandId) this.commit({ decisions: [next] });
    }
    this.verifiedSessions.add(sessionKey); return copy(s);
  }
  private owner(sessionKey: string, ownerId: string): SessionRecord {
    const s = this.sessions.get(sessionKey);
    requireThat(s && s.ownerId === ownerId && this.verifiedSessions.has(sessionKey), 'Owner not verified for this session', 'owner_unavailable');
    return s;
  }
  registerDecision(raw: DecisionInput): DecisionRecord {
    this.checkOpen(); const input = decisionInput(raw, this.hostId); this.owner(input.sessionKey, input.ownerId);
    const existing = this.decisions.get(input.decisionId);
    if (existing) {
      requireThat(fingerprint(decisionInput(existing, this.hostId)) === fingerprint(input), 'Decision identity conflict', 'conflict');
      return copy(existing); // Refresh is a separate revision-bound read proof.
    }
    const duplicate = [...this.decisions.values()].some(d => d.sessionKey === input.sessionKey && d.ownerId === input.ownerId && d.nativeRequestId === input.nativeRequestId && d.nativeRevision === input.nativeRevision);
    requireThat(!duplicate, 'Native decision already registered under another local ID', 'conflict');
    requireThat(this.decisions.size < 10000, 'Decision history capacity reached', 'capacity');
    const d: DecisionRecord = { ...input, status: input.expiresAt !== undefined && input.expiresAt <= this.time() ? 'expired' : 'pending', revision: 0, updatedAt: this.time() };
    this.commit({ decisions: [d] }); return copy(d);
  }
  enqueue(raw: CommandInput): { command: CommandRecord; replayed: boolean } {
    this.checkOpen(); const input = commandInput(raw, this.hostId); const hash = fingerprint(input);
    const prior = this.commands.get(input.commandId);
    if (prior) { requireThat(prior.fingerprint === hash, 'Same command ID with different intent', 'idempotency_conflict'); return { command: copy(prior), replayed: true }; }
    const s = this.owner(input.sessionKey, input.ownerId);
    requireThat(s.revision === input.expectedRevision, 'Session revision changed', 'stale_revision');
    const pending = [...this.commands.values()].filter(active);
    requireThat(pending.length < this.maxTotal && pending.filter(c => c.input.sessionKey === input.sessionKey).length < this.maxSession && this.commands.size < 10000, 'Queue/history capacity reached; new command rejected', 'capacity');
    requireThat(input.expiresAt === undefined || input.expiresAt > this.time(), 'Command already expired', 'expired');
    const decisions: DecisionRecord[] = [];
    if (input.decision) {
      const d = this.decisions.get(input.decision.decisionId);
      requireThat(d && d.sessionKey === input.sessionKey && d.ownerId === input.ownerId, 'Decision target/owner mismatch', 'stale_decision');
      requireThat(d.status === 'pending' && d.revision === input.decision.expectedRevision && !d.claimCommandId, 'Decision no longer pending at this revision', 'stale_decision');
      requireThat(d.expiresAt === undefined || d.expiresAt > this.time(), 'Decision expired', 'expired');
      requireThat(isRecord(input.payload) && Object.keys(input.payload).length === 1 && typeof input.payload.answer === 'string' && d.allowedAnswers.includes(input.payload.answer), 'Answer is not a canonical allowed option');
      decisions.push({ ...this.changeDecision(d, 'claimed'), claimCommandId: input.commandId });
    }
    const c: CommandRecord = { input, fingerprint: hash, status: 'queued', revision: 0, order: this.order + 1, createdAt: this.time(), updatedAt: this.time() };
    this.commit({ sessions: [{ ...s, revision: s.revision + 1 }], commands: [c], decisions });
    return { command: copy(c), replayed: false };
  }
  private finish(c: CommandRecord, status: CommandRecord['status'], reason?: string, correlationId?: string): CommandRecord {
    const next = this.changeCommand(c, status, reason);
    if (correlationId !== undefined) next.correlationId = opaque(correlationId, 'correlation');
    const decisions: DecisionRecord[] = [];
    const d = c.input.decision ? this.decisions.get(c.input.decision.decisionId) : undefined;
    if (d && d.claimCommandId === c.input.commandId && d.status !== 'resolved' && d.status !== 'expired') {
      const updated = this.changeDecision(d, status === 'completed' || status === 'acknowledged' ? 'resolved' : status === 'failed' || status === 'cancelled' ? 'needs_review' : 'unknown');
      if (status === 'failed' || status === 'cancelled') delete updated.claimCommandId;
      decisions.push(updated);
    }
    this.commit({ commands: [next], decisions }); return copy(next);
  }
  async dispatchNext(sessionKey: string, port: DispatchPort): Promise<CommandRecord | undefined> {
    this.checkOpen(); this.owner(sessionKey, port.ownerId);
    const records = [...this.commands.values()].filter(c => c.input.sessionKey === sessionKey);
    requireThat(!records.some(barrier), 'Session has dispatched/unknown delivery; reconcile before another dispatch', 'delivery_barrier');
    const c = records.filter(c => c.status === 'queued').sort((a, b) => a.order - b.order)[0];
    if (!c) return undefined;
    requireThat(c.input.ownerId === port.ownerId, 'Pinned owner changed', 'owner_unavailable');
    const d = c.input.decision ? this.decisions.get(c.input.decision.decisionId) : undefined;
    if ((c.input.expiresAt !== undefined && c.input.expiresAt <= this.time()) || (d?.expiresAt !== undefined && d.expiresAt <= this.time())) return this.finish(c, 'cancelled', 'expired_before_dispatch');
    if (c.input.decision) requireThat(d?.status === 'claimed' && d.claimCommandId === c.input.commandId, 'Decision claim changed', 'stale_decision');
    const dispatched = this.changeCommand(c, 'dispatched');
    this.commit({ commands: [dispatched] }); // Critical write-ahead boundary: no adapter call before fsync.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let receipt: DispatchReceipt;
    try {
      receipt = await Promise.race([
        Promise.resolve().then(() => {
          this.checkOpen(); this.owner(sessionKey, port.ownerId);
          requireThat(this.commands.get(c.input.commandId)?.status === 'dispatched', 'Dispatch invalidated before adapter call', 'conflict');
          return port.execute({ command: copy(dispatched), ...(d ? { decision: copy(d) } : {}) }, controller.signal);
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, this.timeout); }),
      ]);
      requireThat(isRecord(receipt) && ['acknowledged', 'completed', 'not_sent'].includes(String(receipt.status)), 'Invalid dispatch receipt');
      if (receipt.status !== 'not_sent') opaque(receipt.correlationId, 'correlation');
      else opaque(receipt.reason, 'reason');
    } catch {
      if (this.closed || this.poisoned) throw new JournalFault('unavailable', 'Dispatch outcome must be recovered from durable state');
      const current = this.commands.get(c.input.commandId)!;
      return terminal(current) ? copy(current) : this.finish(current, 'unknown', 'dispatch_uncertain');
    } finally { if (timer !== undefined) clearTimeout(timer); }
    this.checkOpen();
    const current = this.commands.get(c.input.commandId)!;
    if (terminal(current)) return copy(current);
    return receipt.status === 'not_sent' ? this.finish(current, 'failed', receipt.reason) : this.finish(current, receipt.status, undefined, receipt.correlationId);
  }
  /** Trusted correlated read evidence, never a substring/transcript guess or a retry operation. */
  reconcileCommand(proof: CommandProof): CommandRecord {
    this.checkOpen(); const c = this.commands.get(proof.commandId);
    requireThat(c && c.input.sessionKey === proof.sessionKey && c.input.ownerId === proof.ownerId, 'Read proof targets a different command/owner', 'proof_mismatch');
    opaque(proof.correlationId, 'correlation');
    requireThat(!c.correlationId || c.correlationId === proof.correlationId, 'Receipt correlation mismatch', 'proof_mismatch');
    requireThat(['acknowledged', 'completed', 'not_delivered'].includes(proof.outcome), 'Invalid proof outcome');
    if (terminal(c)) {
      requireThat((c.status === 'completed' && proof.outcome === 'completed') || (c.status === 'failed' && proof.outcome === 'not_delivered'), 'Contradictory terminal proof', 'proof_mismatch');
      return copy(c);
    }
    requireThat(c.status === 'unknown' || c.status === 'acknowledged', 'Command does not need read reconciliation', 'conflict');
    requireThat(!((c.status === 'acknowledged' || c.correlationId) && proof.outcome === 'not_delivered'), 'ACK cannot become not-delivered', 'proof_mismatch');
    return this.finish(c, proof.outcome === 'not_delivered' ? 'failed' : proof.outcome, 'owner_read_proof', proof.correlationId);
  }
  revalidateDecision(proof: DecisionProof): DecisionRecord {
    this.checkOpen(); const d = this.decisions.get(proof.decisionId);
    requireThat(d && d.sessionKey === proof.sessionKey && d.ownerId === proof.ownerId && d.nativeRequestId === proof.nativeRequestId && d.nativeRevision === proof.nativeRevision, 'Decision read proof identity mismatch', 'proof_mismatch');
    requireThat(d.revision === proof.expectedRevision, 'Decision proof is stale', 'stale_revision');
    requireThat(['pending', 'resolved', 'expired'].includes(proof.outcome), 'Invalid decision proof');
    if (d.status === 'resolved' || d.status === 'expired') { requireThat(d.status === proof.outcome, 'Terminal decision cannot reopen', 'conflict'); return copy(d); }
    if (proof.outcome === 'pending') {
      this.owner(d.sessionKey, d.ownerId);
      requireThat(!d.claimCommandId && d.status === 'needs_review', 'A pending observation cannot undo an uncertain claim', 'conflict');
    }
    const next = this.changeDecision(d, proof.outcome === 'pending' && d.expiresAt !== undefined && d.expiresAt <= this.time() ? 'expired' : proof.outcome);
    const commands: CommandRecord[] = [];
    const claimed = d.claimCommandId ? this.commands.get(d.claimCommandId) : undefined;
    // A generic resolved native request does NOT prove which controller answered it.
    if (claimed?.status === 'queued') commands.push(this.changeCommand(claimed, 'cancelled', 'decision_resolved_externally'));
    this.commit({ decisions: [next], commands }); return copy(next);
  }
  close(): void { if (!this.closed) { this.closed = true; this.listeners.clear(); this.log.close(); } }
}
