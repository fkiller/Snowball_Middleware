import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { isWorkspaceId, isWithinRoot } from '@snowball/core';

/** Explicitly registered local roots only. No client-supplied root registration. */
export class WorkspaceFiles {
  private constructor(private readonly roots: ReadonlyMap<string, string>) {}
  static async create(entries: readonly { workspaceId: string; root: string }[]): Promise<WorkspaceFiles> {
    const roots = new Map<string, string>();
    for (const entry of entries) {
      if (!isWorkspaceId(entry.workspaceId) || roots.has(entry.workspaceId) || !path.isAbsolute(entry.root)) throw new Error('Invalid workspace registration');
      const root = await fs.realpath(entry.root);
      if (!(await fs.stat(root)).isDirectory()) throw new Error('Workspace must be a directory');
      roots.set(entry.workspaceId, root);
    }
    return new WorkspaceFiles(roots);
  }
  list(): { workspaceId: string }[] { return [...this.roots.keys()].map(workspaceId => ({ workspaceId })); }
  async read(workspaceId: string, relative: string): Promise<{ text: string }> {
    const root = this.roots.get(workspaceId);
    // Reject traversal, absolute/drive/UNC paths, Windows ADS and ambiguous separators on every OS.
    if (!root || !relative || relative.length > 1024 || /[\x00-\x1f\\:]/.test(relative) || path.posix.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('File not available');
    let candidate = root;
    for (const segment of relative.split('/')) {
      candidate = path.join(candidate, segment);
      if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error('File not available');
    }
    const resolved = await fs.realpath(candidate);
    if (!isWithinRoot(root, resolved)) throw new Error('File not available');
    const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('File not available');
      const buffer = Buffer.alloc(256 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > 256 * 1024 || buffer.subarray(0, length).includes(0)) throw new Error('File not available');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) };
    } finally { await handle.close(); }
  }
}
