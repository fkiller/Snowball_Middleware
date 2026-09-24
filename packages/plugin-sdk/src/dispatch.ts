/** Data-only dispatch contract. Admission, persistence and proof validation remain core-owned. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CommandStatus = 'queued' | 'dispatched' | 'acknowledged' | 'completed' | 'failed' | 'unknown' | 'cancelled';
export type DecisionStatus = 'pending' | 'claimed' | 'needs_review' | 'unknown' | 'resolved' | 'expired';
export interface CommandInput {
  commandId: string; actorId: string; sessionKey: string; ownerId: string;
  expectedRevision: number; operation: string; payload: Json;
  decision?: { decisionId: string; expectedRevision: number };
  expiresAt?: number;
}
export interface CommandRecord {
  input: CommandInput; fingerprint: string; status: CommandStatus; revision: number;
  order: number; createdAt: number; updatedAt: number; reason?: string; correlationId?: string;
}
export interface SessionRecord { sessionKey: string; ownerId: string; revision: number }
export interface DecisionInput {
  decisionId: string; sessionKey: string; ownerId: string; nativeRequestId: string | number;
  nativeRevision: string; allowedAnswers: string[]; expiresAt?: number;
}
export interface DecisionRecord extends DecisionInput {
  status: DecisionStatus; revision: number; updatedAt: number; claimCommandId?: string;
}

export type DispatchReceipt = { status: 'acknowledged' | 'completed'; correlationId: string } | { status: 'not_sent'; reason: string };
export interface DispatchPort {
  ownerId: string;
  execute(envelope: { command: CommandRecord; decision?: DecisionRecord }, signal: AbortSignal): Promise<DispatchReceipt>;
}
