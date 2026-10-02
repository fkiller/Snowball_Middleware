import fs from 'node:fs';
import path from 'node:path';
import { DurableLog } from './durable-log.js';
import { parseHostId, parseSessionKey } from './identity.js';
import type { SessionMetadataPort, SessionSummary } from './sessions.js';

export interface StoredSessionMetadata {
  title: string;
  cwd: string;
  workspaceId?: string;
  createdAt: number;
  model?: string;
  effort?: string;
  access?: string;
}

/** Private, append-only display metadata. It never grants an owner or command authority. */
export class SessionMetadataStore implements SessionMetadataPort {
  private readonly log: DurableLog;
  private readonly entries = new Map<string, StoredSessionMetadata>();
  private readonly hostId: string;

  constructor(directory: string, hostId: string) {
    if (!path.isAbsolute(directory)) throw new Error('Absolute metadata directory required');
    this.hostId = parseHostId(hostId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private metadata directory must not be a link');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw new Error('Metadata directory must be private');
    for (const name of ['commands.lock', 'commands.v1.jsonl']) {
      try { if (fs.lstatSync(path.join(directory, name)).isSymbolicLink()) throw new Error('Metadata state file must not be a link'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.log = new DurableLog(directory, 8 * 1024 * 1024);
    try {
      for (const raw of this.log.records) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid session metadata');
        const record = raw as Record<string, unknown>;
        if (record.kind !== 'session.metadata.v1' || record.hostId !== this.hostId || typeof record.sessionKey !== 'string') throw new Error('Invalid or foreign session metadata');
        const value = this.validate(record.sessionKey, record.metadata);
        this.entries.delete(record.sessionKey);
        this.entries.set(record.sessionKey, value);
        if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!);
      }
    } catch (error) { this.log.close(); throw error; }
  }

  private validate(key: string, raw: unknown): StoredSessionMetadata {
    if (parseSessionKey(key).hostId !== this.hostId || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid session metadata identity');
    const m = raw as Record<string, unknown>;
    if (typeof m.title !== 'string' || !m.title.trim() || m.title.length > 128 || typeof m.cwd !== 'string' || m.cwd.length > 4096 || !Number.isSafeInteger(m.createdAt) || Number(m.createdAt) < 0 || m.workspaceId !== undefined && (typeof m.workspaceId !== 'string' || !/^ws_[0-9a-f]{16}$/.test(m.workspaceId))) throw new Error('Invalid session metadata fields');
    const model = typeof m.model === 'string' && m.model.length <= 128 ? m.model : undefined;
    const effort = typeof m.effort === 'string' && m.effort.length <= 64 ? m.effort : undefined;
    const access = typeof m.access === 'string' && m.access.length <= 64 ? m.access : undefined;
    return {
      title: m.title,
      cwd: m.cwd,
      ...(m.workspaceId === undefined ? {} : { workspaceId: m.workspaceId as string }),
      createdAt: m.createdAt as number,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(access !== undefined ? { access } : {}),
    };
  }

  get(key: string): StoredSessionMetadata | undefined { const value = this.entries.get(key); return value && { ...value }; }

  remember(summary: SessionSummary): void {
    const metadata = this.validate(summary.sessionKey, summary);
    this.log.append({ kind: 'session.metadata.v1', hostId: this.hostId, sessionKey: summary.sessionKey, metadata });
    this.entries.delete(summary.sessionKey);
    this.entries.set(summary.sessionKey, metadata);
    if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!);
  }

  close(): void { this.log.close(); }
}
