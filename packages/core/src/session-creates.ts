import fs from 'node:fs';
import path from 'node:path';
import { DurableLog } from './durable-log.js';
import { parseHostId, parseSessionKey } from './identity.js';

export interface CreateIntent { requestId: string; fingerprint: string; status: 'pending' | 'confirmed'; sessionKey?: string }
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A write-ahead receipt prevents an uncertain native create from being issued twice. */
export class SessionCreateStore {
  private readonly log: DurableLog;
  private readonly intents = new Map<string, CreateIntent>();
  private readonly hostId: string;

  constructor(directory: string, hostId: string) {
    if (!path.isAbsolute(directory)) throw new Error('Absolute create-intent directory required');
    this.hostId = parseHostId(hostId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private create-intent directory must not be a link');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw new Error('Create-intent directory must be private');
    for (const name of ['commands.lock', 'commands.v1.jsonl']) {
      try { if (fs.lstatSync(path.join(directory, name)).isSymbolicLink()) throw new Error('Create-intent state file must not be a link'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.log = new DurableLog(directory, 16 * 1024 * 1024);
    try {
      for (const raw of this.log.records) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid create intent');
        const record = raw as Record<string, unknown>;
        if (record.kind !== 'session.create.v1' || record.hostId !== this.hostId) throw new Error('Invalid or foreign create intent');
        const intent = this.validate(record.intent);
        const old = this.intents.get(intent.requestId);
        if (old && (old.fingerprint !== intent.fingerprint || old.status !== 'pending' || intent.status !== 'confirmed')) throw new Error('Invalid create-intent transition');
        this.intents.set(intent.requestId, intent);
      }
    } catch (error) { this.log.close(); throw error; }
  }

  private validate(raw: unknown): CreateIntent {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid create intent');
    const v = raw as Record<string, unknown>;
    if (typeof v.requestId !== 'string' || !REQUEST_ID.test(v.requestId) || typeof v.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(v.fingerprint) || !['pending', 'confirmed'].includes(String(v.status))) throw new Error('Invalid create-intent fields');
    if (v.status === 'confirmed') {
      if (typeof v.sessionKey !== 'string' || parseSessionKey(v.sessionKey).hostId !== this.hostId) throw new Error('Invalid confirmed session key');
    } else if (v.sessionKey !== undefined) throw new Error('Pending create cannot have a session key');
    return { requestId: v.requestId, fingerprint: v.fingerprint, status: v.status as CreateIntent['status'], ...(v.status === 'confirmed' ? { sessionKey: v.sessionKey as string } : {}) };
  }

  get(requestId: string): CreateIntent | undefined { const intent = this.intents.get(requestId); return intent && { ...intent }; }

  begin(requestId: string, fingerprint: string): CreateIntent {
    const existing = this.intents.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('create_request_mismatch');
      return { ...existing };
    }
    // Receipts are never evicted: forgetting one would make an old retry unsafe.
    if (this.intents.size >= 10_000) throw new Error('create_intent_capacity');
    const intent = this.validate({ requestId, fingerprint, status: 'pending' });
    this.log.append({ kind: 'session.create.v1', hostId: this.hostId, intent });
    this.intents.set(requestId, intent);
    return { ...intent };
  }

  confirm(requestId: string, fingerprint: string, sessionKey: string): CreateIntent {
    const current = this.intents.get(requestId);
    if (!current || current.fingerprint !== fingerprint || current.status !== 'pending') throw new Error('create_request_mismatch');
    const intent = this.validate({ requestId, fingerprint, status: 'confirmed', sessionKey });
    this.log.append({ kind: 'session.create.v1', hostId: this.hostId, intent });
    this.intents.set(requestId, intent);
    return { ...intent };
  }

  close(): void { this.log.close(); }
}
