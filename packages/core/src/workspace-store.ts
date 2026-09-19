import fs from 'node:fs';
import path from 'node:path';
import { DurableLog, JournalFault } from './durable-log.js';
import { parseHostId } from './identity.js';
import { WorkspaceRegistry, localWorkspaceIO, type RegisteredWorkspace, type WorkspaceIO } from './workspaces.js';

export type WorkspaceAccess = Pick<WorkspaceRegistry, 'list' | 'refresh' | 'assertReadable' | 'subscribe'>;
export interface WorkspaceStoreOptions {
  /** Dedicated directory in the current user's private application data, never supplied by HTTP. */
  directory: string;
  hostId: string;
  io?: WorkspaceIO;
  maxBytes?: number;
}

/** Write-ahead snapshots: persist and fsync a grant/removal before publishing it. */
export class WorkspaceStore implements WorkspaceAccess {
  private readonly log: DurableLog;
  private current: WorkspaceRegistry;
  private readonly io: WorkspaceIO;
  private readonly listeners = new Set<() => void>();
  private detach: () => void = () => {};
  private busy = false;
  private closed = false;
  private failed = false;
  private readonly hostId: string;

  constructor(options: WorkspaceStoreOptions) {
    this.hostId = parseHostId(options.hostId); this.io = options.io ?? localWorkspaceIO;
    if (!path.isAbsolute(options.directory)) throw new Error('Absolute private state directory required');
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(options.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private state directory must not be a link');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw new Error('State directory must belong to the current user with mode 0700');
    for (const name of ['commands.lock', 'commands.v1.jsonl']) {
      const file = path.join(options.directory, name);
      try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('State file must not be a link'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.log = new DurableLog(options.directory, options.maxBytes);
    this.current = new WorkspaceRegistry(this.io);
    try {
      for (const record of this.log.records) {
        const item = record as { kind?: unknown; hostId?: unknown; snapshot?: unknown } | null;
        if (!item || item.kind !== 'workspaces.v1' || item.hostId !== this.hostId || typeof item.snapshot !== 'string') throw new Error('Invalid or foreign workspace state');
        this.current = WorkspaceRegistry.restore(item.snapshot, this.io);
      }
      if (!this.log.records.length) this.persist(this.current);
      this.observe();
    } catch (error) { this.log.close(); throw error; }
  }
  private assertOpen(): void { if (this.closed || this.failed) throw new Error('Workspace storage unavailable'); }
  private changed(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Committed state cannot be rolled back by an observer. */ } } }
  private observe(): void { this.detach(); this.detach = this.current.subscribe(() => this.changed()); }
  private persist(registry: WorkspaceRegistry): void {
    const snapshot = registry.serialize();
    // Validate exactly what restart will accept before committing any bytes.
    WorkspaceRegistry.restore(snapshot, this.io);
    try { this.log.append({ kind: 'workspaces.v1', hostId: this.hostId, snapshot }); }
    catch (error) {
      if (error instanceof JournalFault && ['io', 'unavailable'].includes(error.code)) this.failed = true;
      throw error;
    }
  }
  private async transaction<T>(change: (staged: WorkspaceRegistry) => Promise<T>, signal?: AbortSignal, beforeCommit?: () => void): Promise<T> {
    this.assertOpen();
    if (this.busy) throw new Error('Workspace change already in progress');
    if (signal?.aborted) throw new Error('Workspace change cancelled');
    this.busy = true;
    try {
      const staged = WorkspaceRegistry.restore(this.current.serialize(), this.io);
      const result = await change(staged);
      this.assertOpen();
      if (signal?.aborted) throw new Error('Workspace change cancelled');
      beforeCommit?.();
      this.persist(staged);
      this.current = staged; this.observe(); this.changed();
      return result;
    } finally { this.busy = false; }
  }
  /** Trusted native/CLI user selection only. Provider candidates and browser strings are not grants. */
  registerSelected(root: string, displayName: string, signal?: AbortSignal, beforeCommit?: () => void): Promise<RegisteredWorkspace> {
    return this.transaction(registry => registry.register(root, displayName), signal, beforeCommit);
  }
  relocateSelected(workspaceId: string, root: string, signal?: AbortSignal): Promise<RegisteredWorkspace> {
    return this.transaction(registry => registry.relocate(workspaceId, root), signal);
  }
  remove(workspaceId: string, signal?: AbortSignal): Promise<void> {
    return this.transaction(async registry => { registry.remove(workspaceId); }, signal);
  }
  list(): RegisteredWorkspace[] { this.assertOpen(); return this.current.list(); }
  subscribe(listener: () => void): () => void { this.assertOpen(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async refresh(workspaceId: string): Promise<RegisteredWorkspace> {
    this.assertOpen(); const original = this.current;
    const result = await original.refresh(workspaceId);
    this.assertOpen(); if (original !== this.current) throw new Error('Workspace registration changed');
    return result;
  }
  async assertReadable(workspaceId: string): Promise<RegisteredWorkspace> {
    const result = await this.refresh(workspaceId);
    if (result.status !== 'ready' && result.status !== 'empty') throw new Error('Workspace requires repair');
    return result;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.detach(); this.listeners.clear(); this.log.close();
  }
}
