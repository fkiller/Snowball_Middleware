import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspace, createProject, isWorkspaceId, parseWorkspace, parseProject, parseHarnessRef, type HarnessRef, type Project, type Workspace } from './identity.js';

export interface DirectoryIdentity { device: string; inode: string; birth: string }
export interface WorkspaceFact { canonical: string; identity: DirectoryIdentity; empty: boolean }
/** Trusted platform adapter; candidate providers cannot supply filesystem facts. */
export interface WorkspaceIO { inspect(root: string): Promise<WorkspaceFact> }
export type WorkspaceStatus = 'ready' | 'empty' | 'missing' | 'needs_permission' | 'needs_review' | 'unavailable';
export interface RegisteredWorkspace extends Workspace {
  canonical: string;
  identity: DirectoryIdentity;
  project: Project;
  status: WorkspaceStatus;
}
export interface ProjectCandidate {
  candidateId: string;
  harness: HarnessRef;
  nativeProjectId: string;
  root: string;
  displayName: string;
}
const copy = <T>(value: T): T => structuredClone(value);
const sameIdentity = (a: DirectoryIdentity, b: DirectoryIdentity) =>
  a.device === b.device && a.inode === b.inode && a.birth === b.birth;
function validFact(fact: WorkspaceFact): void {
  if (!path.isAbsolute(fact.canonical) || typeof fact.empty !== 'boolean' ||
      ![fact.identity.device, fact.identity.inode, fact.identity.birth].every(v => typeof v === 'string' && /^\d+$/.test(v)) ||
      fact.identity.inode === '0') throw new Error('Filesystem identity unavailable');
}
function failure(error: unknown): WorkspaceStatus {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' :
    code === 'EACCES' || code === 'EPERM' ? 'needs_permission' : 'unavailable';
}
export const localWorkspaceIO: WorkspaceIO = {
  async inspect(root) {
    const canonical = await fs.realpath(root);
    const before = await fs.stat(canonical, { bigint: true });
    if (!before.isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
    // Read at most one entry; registration never recursively discovers projects.
    const directory = await fs.opendir(canonical);
    let empty: boolean;
    try { empty = await directory.read() === null; } finally { await directory.close(); }
    const after = await fs.stat(canonical, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs ||
        await fs.realpath(root) !== canonical) throw new Error('Directory changed during inspection');
    return { canonical, identity: { device: before.dev.toString(), inode: before.ino.toString(), birth: before.birthtimeNs.toString() }, empty };
  },
};

/** Per-current-user, trusted local service. Registration is not a provider or browser capability. */
export class WorkspaceRegistry {
  private readonly listeners = new Set<() => void>();
  private readonly entries = new Map<string, RegisteredWorkspace>();
  private candidates: ProjectCandidate[] = [];
  private readonly associations = new Map<string, string>();
  private readonly links = new Set<string>();
  constructor(private readonly io: WorkspaceIO = localWorkspaceIO) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot undo a grant/revocation. */ } } }

  list(): RegisteredWorkspace[] { return copy([...this.entries.values()]); }
  listCandidates(): ProjectCandidate[] { return copy(this.candidates); }
  listAssociations(): { candidateId: string; workspaceId: string }[] {
    return [...this.associations].map(([candidateId, workspaceId]) => ({ candidateId, workspaceId }));
  }
  listProjectLinks(): [string, string][] { return [...this.links].map(key => JSON.parse(key)); }

  /** Store only in the current user's protected state directory; never accept from an API client. */
  serialize(): string {
    return JSON.stringify({ version: 1, entries: this.list(), links: this.listProjectLinks() });
  }
  static restore(serialized: string, io: WorkspaceIO = localWorkspaceIO): WorkspaceRegistry {
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Workspace state too large');
    const state = JSON.parse(serialized);
    if (state?.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 128 ||
        !Array.isArray(state.links) || state.links.length > 256) throw new Error('Invalid workspace state');
    const registry = new WorkspaceRegistry(io);
    const projects = new Set<string>();
    for (const raw of state.entries) {
      const workspace = parseWorkspace(raw);
      validFact({ canonical: raw.canonical, identity: raw.identity, empty: false });
      const project = parseProject(raw.project, [{ ...workspace, root: raw.canonical }]);
      if (registry.entries.has(workspace.workspaceId) || projects.has(project.projectId) || project.root !== raw.canonical) throw new Error('Invalid workspace state');
      projects.add(project.projectId);
      registry.entries.set(workspace.workspaceId, { ...workspace, canonical: raw.canonical,
        identity: copy(raw.identity), project, status: 'unavailable' });
    }
    for (const link of state.links) {
      if (!Array.isArray(link) || link.length !== 2) throw new Error('Invalid project link');
      registry.linkProjects(link[0], link[1]);
    }
    return registry;
  }

  /** Metadata only: even an absolute root is not inspected until explicit selection. */
  reportCandidates(candidates: readonly ProjectCandidate[]): void {
    if (candidates.length > 100) throw new Error('Too many project candidates');
    const ids = new Set<string>();
    const next = candidates.map(candidate => {
      for (const value of [candidate.candidateId, candidate.nativeProjectId, candidate.root, candidate.displayName]) {
        if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid project candidate');
      }
      if (ids.has(candidate.candidateId)) throw new Error('Duplicate project candidate');
      ids.add(candidate.candidateId);
      return { candidateId: candidate.candidateId, nativeProjectId: candidate.nativeProjectId,
        root: candidate.root, displayName: candidate.displayName, harness: parseHarnessRef(candidate.harness) };
    });
    // A refreshed provider claim cannot inherit an association to an earlier path/owner.
    for (const [id] of this.associations) {
      if (JSON.stringify(this.candidates.find(c => c.candidateId === id)) !== JSON.stringify(next.find(c => c.candidateId === id))) this.associations.delete(id);
    }
    this.candidates = next;
    this.changed();
  }

  async register(root: string, displayName: string, workspaceId?: string): Promise<RegisteredWorkspace> {
    if (!path.isAbsolute(root) || /[\x00-\x1f]/.test(root) || root.length > 4096) throw new Error('Invalid workspace root');
    const workspace = createWorkspace(root, displayName);
    if (workspaceId !== undefined) {
      if (!isWorkspaceId(workspaceId)) throw new Error('Invalid workspace ID');
      workspace.workspaceId = workspaceId;
    }
    const fact = await this.io.inspect(workspace.root); validFact(fact);
    // Recheck after await: simultaneous registration cannot overwrite an existing grant.
    if (this.entries.has(workspace.workspaceId) || this.entries.size >= 128) throw new Error('Workspace registration limit or duplicate ID');
    const entry: RegisteredWorkspace = { ...workspace, canonical: fact.canonical, identity: copy(fact.identity),
      project: createProject({ ...workspace, root: fact.canonical }, fact.canonical, displayName),
      status: fact.empty ? 'empty' : 'ready' };
    // No auto-merge, including aliases, case variants and worktrees sharing a git directory.
    this.entries.set(entry.workspaceId, entry);
    this.changed();
    return copy(entry);
  }

  async refresh(workspaceId: string): Promise<RegisteredWorkspace> {
    const entry = this.require(workspaceId);
    let status: WorkspaceStatus;
    try {
      const fact = await this.io.inspect(entry.root); validFact(fact);
      status = fact.canonical !== entry.canonical || !sameIdentity(fact.identity, entry.identity)
        ? 'needs_review' : fact.empty ? 'empty' : 'ready';
    } catch (error) { status = failure(error); }
    if (this.entries.get(workspaceId) !== entry) throw new Error('Workspace registration changed');
    if (entry.status !== status) { entry.status = status; this.changed(); }
    return copy(entry);
  }

  async assertReadable(workspaceId: string): Promise<RegisteredWorkspace> {
    const entry = await this.refresh(workspaceId);
    if (entry.status !== 'ready' && entry.status !== 'empty') throw new Error('Workspace requires repair');
    return entry;
  }

  /** Explicit relocation preserves IDs only for the same physical directory. Copies register anew. */
  async relocate(workspaceId: string, root: string): Promise<RegisteredWorkspace> {
    const entry = this.require(workspaceId);
    const normalized = createWorkspace(root, entry.displayName).root;
    const fact = await this.io.inspect(normalized); validFact(fact);
    if (this.entries.get(workspaceId) !== entry || !sameIdentity(fact.identity, entry.identity)) throw new Error('Relocation identity mismatch');
    const next = { ...entry, root: normalized, canonical: fact.canonical,
      project: { ...entry.project, root: fact.canonical }, status: fact.empty ? 'empty' as const : 'ready' as const };
    this.entries.set(workspaceId, next);
    this.clearAssociations(workspaceId);
    this.changed();
    return copy(next);
  }

  /** Explicit matching does not add a read root or grant harness command ownership. */
  async associateCandidate(candidateId: string, workspaceId: string): Promise<void> {
    const candidate = this.candidates.find(c => c.candidateId === candidateId);
    if (!candidate || !path.isAbsolute(candidate.root)) throw new Error('Project candidate unavailable');
    const entry = this.require(workspaceId);
    await this.assertReadable(workspaceId);
    const fact = await this.io.inspect(candidate.root); validFact(fact);
    if (this.entries.get(workspaceId) !== entry || !this.candidates.includes(candidate) ||
        !sameIdentity(fact.identity, entry.identity) || fact.canonical !== entry.canonical) throw new Error('Project root mismatch');
    this.associations.set(candidateId, workspaceId);
    this.changed();
  }

  /** Logical relationship only: both roots, project IDs and command contexts remain distinct. */
  linkProjects(first: string, second: string): void {
    if (first === second || ![first, second].every(id => [...this.entries.values()].some(e => e.project.projectId === id))) throw new Error('Invalid project link');
    if (this.links.size >= 256) throw new Error('Project link limit');
    this.links.add(JSON.stringify([first, second].sort()));
    this.changed();
  }
  unlinkProjects(first: string, second: string): void { if (this.links.delete(JSON.stringify([first, second].sort()))) this.changed(); }
  remove(workspaceId: string): void {
    const entry = this.require(workspaceId);
    this.entries.delete(workspaceId); this.clearAssociations(workspaceId);
    for (const key of this.links) if ((JSON.parse(key) as string[]).includes(entry.project.projectId)) this.links.delete(key);
    this.changed();
  }
  private clearAssociations(workspaceId: string): void {
    for (const [candidateId, id] of this.associations) if (id === workspaceId) this.associations.delete(candidateId);
  }
  private require(workspaceId: string): RegisteredWorkspace {
    const entry = this.entries.get(workspaceId);
    if (!entry) throw new Error('Workspace not registered');
    return entry;
  }
}
