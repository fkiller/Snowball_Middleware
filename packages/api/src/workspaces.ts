import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { WorkspaceRegistry, type WorkspaceAccess, type RegisteredWorkspace, type WorkspaceStatus, type ProjectCandidate } from '@snowball/core';

export interface WorkspaceSummary { workspaceId: string; projectId: string; displayName: string; status: WorkspaceStatus }
const summarize = (entry: RegisteredWorkspace): WorkspaceSummary => ({ workspaceId: entry.workspaceId,
  projectId: entry.project.projectId, displayName: entry.displayName, status: entry.status });

/** Explicitly registered local roots only. No client-supplied root registration. */
export class WorkspaceFiles {
  private constructor(private readonly registry: WorkspaceAccess) {}
  static fromRegistry(registry: WorkspaceAccess): WorkspaceFiles { return new WorkspaceFiles(registry); }
  static async create(entries: readonly { workspaceId: string; root: string }[]): Promise<WorkspaceFiles> {
    const registry = new WorkspaceRegistry();
    for (const entry of entries) {
      await registry.register(entry.root, path.basename(entry.root) || 'Workspace', entry.workspaceId);
    }
    return new WorkspaceFiles(registry);
  }
  list(): { workspaceId: string }[] { return this.registry.list().map(({ workspaceId }) => ({ workspaceId })); }
  describe(): WorkspaceSummary[] { return this.registry.list().map(summarize); }
  listCandidates(): ProjectCandidate[] { return this.registry.listCandidates?.() ?? []; }
  subscribe(listener: () => void): () => void { return this.registry.subscribe(listener); }
  async recheck(workspaceId: string): Promise<WorkspaceSummary> { return summarize(await this.registry.refresh(workspaceId)); }
  async read(workspaceId: string, relative: string): Promise<{ text: string }> {
    const registration = await this.registry.assertReadable(workspaceId);
    const root = registration.canonical;
    // Reject traversal, absolute/drive/UNC paths, Windows ADS and ambiguous separators on every OS.
    if (!relative || relative.length > 1024 || /[\x00-\x1f\\:]/.test(relative) || path.posix.isAbsolute(relative) || relative.split('/').some(p => !p || /[. ]$/.test(p) || p.toLowerCase() === '.git' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('File not available');
    const resolve = async () => {
      let candidate = root;
      for (const segment of relative.split('/')) {
        candidate = path.join(candidate, segment);
        if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error('File not available');
      }
      const resolved = await fs.realpath(candidate);
      // Compare actual canonical spelling, not platform-wide case folding.
      if (!resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) throw new Error('File not available');
      return resolved;
    };
    const resolved = await resolve();
    const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > 256n * 1024n) throw new Error('File not available');
      const buffer = Buffer.alloc(256 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > 256 * 1024 || buffer.subarray(0, length).includes(0)) throw new Error('File not available');
      const current = await this.registry.assertReadable(workspaceId);
      if (current.canonical !== root || JSON.stringify(current.identity) !== JSON.stringify(registration.identity)) throw new Error('File not available');
      const afterPath = await resolve();
      const after = await fs.stat(afterPath, { bigint: true });
      if (afterPath !== resolved || after.dev !== stat.dev || after.ino !== stat.ino || after.birthtimeNs !== stat.birthtimeNs) throw new Error('File not available');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) };
    } finally { await handle.close(); }
  }
}
