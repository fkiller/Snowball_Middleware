import { createHash } from 'node:crypto';
import { parseControllerId, parseSessionKey } from './identity.js';
import { JournalFault } from './durable-log.js';

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
export interface JournalTransaction {
  schema: 1; hostId: string; sessions: SessionRecord[]; commands: CommandRecord[]; decisions: DecisionRecord[];
}
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function requireThat(condition: unknown, message: string, code = 'invalid'): asserts condition {
  if (!condition) throw new JournalFault(code, message);
}
export function opaque(value: unknown, name: string): string {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), `Invalid ${name}`);
  return value;
}
export function nonnegative(value: unknown, name: string): number {
  requireThat(Number.isSafeInteger(value) && Number(value) >= 0, `Invalid ${name}`);
  return Number(value);
}
export function canonical(value: unknown, depth = 0): string {
  requireThat(depth <= 32, 'JSON nesting limit exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'Invalid JSON number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + Array.from(value, entry => canonical(entry, depth + 1)).join(',') + ']';
  requireThat(isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'Plain JSON required');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const fingerprint = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export function commandInput(value: unknown, hostId: string): CommandInput {
  requireThat(isRecord(value), 'Command object required');
  const sessionKey = String(value.sessionKey);
  requireThat(parseSessionKey(sessionKey).hostId === hostId, 'Command belongs to another host');
  requireThat(typeof value.operation === 'string' && /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(value.operation) && value.operation.length <= 128, 'Invalid operation');
  const payload = canonical(value.payload);
  requireThat(Buffer.byteLength(payload) <= 64 * 1024, 'Command payload exceeds 64 KiB', 'capacity');
  const input: CommandInput = { commandId: opaque(value.commandId, 'commandId'), actorId: parseControllerId(value.actorId), sessionKey, ownerId: opaque(value.ownerId, 'ownerId'), expectedRevision: nonnegative(value.expectedRevision, 'expected revision'), operation: value.operation, payload: JSON.parse(payload) as Json };
  if (value.expiresAt !== undefined) input.expiresAt = nonnegative(value.expiresAt, 'expiry');
  if (value.decision !== undefined) {
    requireThat(isRecord(value.decision), 'Invalid decision reference');
    input.decision = { decisionId: opaque(value.decision.decisionId, 'decisionId'), expectedRevision: nonnegative(value.decision.expectedRevision, 'decision revision') };
  }
  requireThat((input.operation === 'decisions.resolve') === (input.decision !== undefined), 'Decision operation and reference must match');
  const allowed = new Set(['commandId', 'actorId', 'sessionKey', 'ownerId', 'expectedRevision', 'operation', 'payload', 'decision', 'expiresAt']);
  requireThat(Object.keys(value).every(key => allowed.has(key)), 'Unknown command field');
  return input;
}
export function decisionInput(value: unknown, hostId: string): DecisionInput {
  requireThat(isRecord(value), 'Decision object required');
  const sessionKey = String(value.sessionKey);
  requireThat(parseSessionKey(sessionKey).hostId === hostId, 'Decision belongs to another host');
  requireThat((typeof value.nativeRequestId === 'string' && value.nativeRequestId.length > 0 && value.nativeRequestId.length <= 256) || (Number.isSafeInteger(value.nativeRequestId)), 'Invalid native request id');
  requireThat(Array.isArray(value.allowedAnswers) && value.allowedAnswers.length > 0 && value.allowedAnswers.length <= 64 && value.allowedAnswers.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256), 'Invalid decision answers');
  requireThat(new Set(value.allowedAnswers).size === value.allowedAnswers.length, 'Duplicate decision answer');
  const input: DecisionInput = { decisionId: opaque(value.decisionId, 'decisionId'), sessionKey, ownerId: opaque(value.ownerId, 'ownerId'), nativeRequestId: value.nativeRequestId as string | number, nativeRevision: opaque(value.nativeRevision, 'nativeRevision'), allowedAnswers: [...value.allowedAnswers] as string[] };
  if (value.expiresAt !== undefined) input.expiresAt = nonnegative(value.expiresAt, 'expiry');
  return input;
}
