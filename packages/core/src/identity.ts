import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

/**
 * Stable identities for local control (MW.02.01.01.01).
 *
 * Legacy prototype facts (reference/legacy-host, behavior evidence only):
 * - Machine was a display label (`dev-pc`, `os.hostname()`), not a stable id.
 * - Scope keys were `"machine/harness"` and `"machine/harness/project"` strings
 *   built from those labels, with one global selection shared by every client.
 * - Draft destination was a single mutable slot rebound by UI selection.
 *
 * This module replaces labels with persisted opaque ids and makes every
 * session reference a composite key. It never touches hardware, processes,
 * or the network, and it never imports the legacy implementation.
 */

// --- Host -----------------------------------------------------------------

export type HostId = string;
const HOST_ID_PATTERN = /^host_[0-9a-f]{32}$/;

export function isHostId(value: unknown): value is HostId {
  return typeof value === 'string' && HOST_ID_PATTERN.test(value);
}

export function parseHostId(value: unknown): HostId {
  if (!isHostId(value)) throw new Error('Invalid host id');
  return value;
}

/** One id per user on one PC, generated once and persisted. Not a hostname. */
export function createHostId(random: (size: number) => Buffer = randomBytes): HostId {
  return `host_${random(16).toString('hex')}`;
}

// --- Harness instance -------------------------------------------------------

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/;
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface HarnessRef {
  pluginId: string;
  instanceId: string;
}

export function parsePluginId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !PLUGIN_ID_PATTERN.test(value)) {
    throw new Error('Invalid harness plugin id');
  }
  return value;
}

export function parseInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw new Error('Invalid harness instance id');
  }
  return value;
}

export function parseHarnessRef(value: unknown): HarnessRef {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid harness reference');
  const record = value as Record<string, unknown>;
  return { pluginId: parsePluginId(record.pluginId), instanceId: parseInstanceId(record.instanceId) };
}

// --- Composite session key --------------------------------------------------
// Canonical form: hostId/pluginId/instanceId/escapedNativeSessionId.
// The same native id on another host or instance is a different key (A1).

export interface SessionKeyParts {
  hostId: HostId;
  harness: HarnessRef;
  nativeSessionId: string;
}

const NATIVE_ID_MAX = 256;

export function parseNativeSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > NATIVE_ID_MAX) {
    throw new Error('Invalid native session id');
  }
  if (value.trim().length === 0) throw new Error('Invalid native session id');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new Error('Invalid native session id');
  return value;
}

function escapeSegment(value: string): string {
  return value.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function unescapeSegment(value: string): string {
  if (!/^(?:[^%]|%2F|%25)+$/.test(value)) throw new Error('Invalid session key encoding');
  return value.replace(/%2F/g, '/').replace(/%25/g, '%');
}

export function formatSessionKey(parts: SessionKeyParts): string {
  parseHostId(parts.hostId);
  parseHarnessRef(parts.harness);
  parseNativeSessionId(parts.nativeSessionId);
  return `${parts.hostId}/${parts.harness.pluginId}/${parts.harness.instanceId}/${escapeSegment(parts.nativeSessionId)}`;
}

export function parseSessionKey(value: unknown): SessionKeyParts {
  if (typeof value !== 'string') throw new Error('Invalid session key');
  const segments = value.split('/');
  if (segments.length !== 4) throw new Error('Invalid session key');
  const [hostId, pluginId, instanceId, escaped] = segments as [string, string, string, string];
  const parts: SessionKeyParts = {
    hostId: parseHostId(hostId),
    harness: { pluginId: parsePluginId(pluginId), instanceId: parseInstanceId(instanceId) },
    nativeSessionId: parseNativeSessionId(unescapeSegment(escaped)),
  };
  // Canonical round-trip: reject non-canonical encodings so keys compare by string.
  if (formatSessionKey(parts) !== value) throw new Error('Invalid session key');
  return parts;
}

export function sessionKeyEquals(a: string | SessionKeyParts, b: string | SessionKeyParts): boolean {
  const left = typeof a === 'string' ? a : formatSessionKey(a);
  const right = typeof b === 'string' ? b : formatSessionKey(b);
  return left === right;
}

// --- Workspace / project ----------------------------------------------------

const WORKSPACE_ID_PATTERN = /^ws_[0-9a-f]{16}$/;
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{16}$/;

export interface Workspace {
  workspaceId: string;
  root: string;
  displayName: string;
}

export interface Project {
  projectId: string;
  workspaceId: string;
  root: string;
  displayName: string;
}

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export function parseProjectId(value: unknown): string {
  if (!isProjectId(value)) throw new Error('Invalid project id');
  return value;
}

export function createWorkspaceId(random: (size: number) => Buffer = randomBytes): string {
  return `ws_${random(8).toString('hex')}`;
}

export function createProjectId(random: (size: number) => Buffer = randomBytes): string {
  return `prj_${random(8).toString('hex')}`;
}

function parseDisplayName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function isWindowsStyleRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\');
}

/**
 * Normalize an absolute workspace/project root without touching the disk.
 * Windows drive letters are uppercased; bulk lowercasing is never applied
 * (macOS volumes may be case-sensitive). Throws for relative roots.
 */
export function normalizeRoot(root: string, platform: NodeJS.Platform = process.platform): string {
  if (typeof root !== 'string' || root.length === 0) throw new Error('Invalid root path');
  if (platform === 'win32' || isWindowsStyleRoot(root)) {
    let normalized = path.win32.normalize(root.replace(/\//g, '\\'));
    const drive = normalized.match(/^([A-Za-z]):\\/);
    if (drive?.[1]) normalized = drive[1].toUpperCase() + normalized.slice(1);
    if (normalized.length > 3 && normalized.endsWith('\\')) normalized = normalized.slice(0, -1);
    if (!/^(?:[A-Z]:\\|\\\\)/.test(normalized)) throw new Error('Root path must be absolute');
    return normalized;
  }
  if (!root.startsWith('/')) throw new Error('Root path must be absolute');
  const normalized = path.posix.normalize(root);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function separatorFor(root: string): string {
  return isWindowsStyleRoot(root) ? '\\' : '/';
}

function rootsEqual(a: string, b: string): boolean {
  if (isWindowsStyleRoot(a) || isWindowsStyleRoot(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** True when candidate is root itself or nested inside it. No disk access. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeRoot(root);
  const normalizedCandidate = normalizeRoot(candidate);
  if (rootsEqual(normalizedRoot, normalizedCandidate)) return true;
  const separator = separatorFor(normalizedRoot);
  const prefix = normalizedRoot.endsWith(separator) ? normalizedRoot : normalizedRoot + separator;
  if (separator === '\\') return normalizedCandidate.toLowerCase().startsWith(prefix.toLowerCase());
  return normalizedCandidate.startsWith(prefix);
}

export function parseWorkspace(value: unknown): Workspace {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid workspace');
  const record = value as Record<string, unknown>;
  if (!isWorkspaceId(record.workspaceId)) throw new Error('Invalid workspace id');
  if (typeof record.root !== 'string' || normalizeRoot(record.root) !== record.root) {
    throw new Error('Workspace root must be an absolute normalized path');
  }
  return {
    workspaceId: record.workspaceId,
    root: record.root,
    displayName: parseDisplayName(record.displayName, 'workspace name'),
  };
}

export function createWorkspace(root: string, displayName: string): Workspace {
  return { workspaceId: createWorkspaceId(), root: normalizeRoot(root), displayName: parseDisplayName(displayName, 'workspace name') };
}

export function parseProject(value: unknown, workspaces: readonly Workspace[]): Project {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid project');
  const record = value as Record<string, unknown>;
  if (!isProjectId(record.projectId)) throw new Error('Invalid project id');
  if (typeof record.workspaceId !== 'string') throw new Error('Invalid project workspace');
  const workspace = workspaces.find(entry => entry.workspaceId === record.workspaceId);
  if (!workspace) throw new Error('Project references an unknown workspace');
  if (typeof record.root !== 'string' || normalizeRoot(record.root) !== record.root) {
    throw new Error('Project root must be an absolute normalized path');
  }
  if (!isWithinRoot(workspace.root, record.root)) throw new Error('Project root escapes its workspace');
  return {
    projectId: record.projectId,
    workspaceId: record.workspaceId,
    root: record.root,
    displayName: parseDisplayName(record.displayName, 'project name'),
  };
}

export function createProject(workspace: Workspace, root: string, displayName: string): Project {
  const normalized = normalizeRoot(root);
  if (!isWithinRoot(workspace.root, normalized)) throw new Error('Project root escapes its workspace');
  return {
    projectId: createProjectId(),
    workspaceId: workspace.workspaceId,
    root: normalized,
    displayName: parseDisplayName(displayName, 'project name'),
  };
}

// --- Controller ---------------------------------------------------------------

const CONTROLLER_ID_PATTERN = /^ctl_[0-9a-f]{16}$/;

export function isControllerId(value: unknown): value is string {
  return typeof value === 'string' && CONTROLLER_ID_PATTERN.test(value);
}

export function parseControllerId(value: unknown): string {
  if (!isControllerId(value)) throw new Error('Invalid controller id');
  return value;
}

export function createControllerId(random: (size: number) => Buffer = randomBytes): string {
  return `ctl_${random(8).toString('hex')}`;
}

// --- Per-user data location (J06) -----------------------------------------------
// Only the current user's directories are ever used. Another account's
// instances or secrets are never probed; cross-user access fails closed.

export function resolveUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    const base = env.APPDATA ?? (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Roaming') : path.join(home, 'AppData', 'Roaming'));
    return path.join(base, 'Snowball', 'Middleware');
  }
  if (platform === 'darwin') {
    const userHome = env.HOME ?? home;
    return path.join(userHome, 'Library', 'Application Support', 'Snowball', 'Middleware');
  }
  const base = env.XDG_DATA_HOME ?? path.join(env.HOME ?? home, '.local', 'share');
  return path.join(base, 'snowball-middleware');
}

export function stateFileName(): string {
  return 'controller-state.v1.json';
}

export function stateFilePath(dataDir: string): string {
  return path.join(dataDir, stateFileName());
}

// --- Persisted state ------------------------------------------------------------

export const CORE_STATE_VERSION = 1 as const;

export interface PersistedControllerSelection {
  harnessPluginId?: string;
  harnessInstanceId?: string;
  projectId?: string;
  sessionKey?: string;
}

export interface PersistedDraft {
  draftId: string;
  destinationKey: string;
  phase: string;
  updatedAt: string;
}

export interface PersistedApproval {
  approvalId: string;
  destinationKey: string;
  revision: number;
  status: 'pending' | 'resolved';
  updatedAt: string;
}

export interface PersistedController {
  controllerId: string;
  selection: PersistedControllerSelection;
  draft?: PersistedDraft;
  approval?: PersistedApproval;
}

export interface CorePersistV1 {
  version: 1;
  hostId: HostId;
  workspaces: Workspace[];
  projects: Project[];
  controllers: PersistedController[];
}

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${field}`);
  return value;
}

function parseSelection(value: unknown, projects: readonly Project[], hostId: HostId): PersistedControllerSelection {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid controller selection');
  const record = value as Record<string, unknown>;
  const selection: PersistedControllerSelection = {};
  if (record.harnessPluginId !== undefined) selection.harnessPluginId = parsePluginId(record.harnessPluginId);
  if (record.harnessInstanceId !== undefined) selection.harnessInstanceId = parseInstanceId(record.harnessInstanceId);
  if (record.projectId !== undefined) {
    if (typeof record.projectId !== 'string' || !projects.some(entry => entry.projectId === record.projectId)) {
      throw new Error('Selection references an unknown project');
    }
    selection.projectId = record.projectId;
  }
  if (record.sessionKey !== undefined) {
    if (typeof record.sessionKey !== 'string') throw new Error('Invalid selection session key');
    const parts = parseSessionKey(record.sessionKey);
    if (parts.hostId !== hostId) throw new Error('Selection session belongs to another host');
    selection.sessionKey = record.sessionKey;
  }
  return selection;
}

function parsePersistedDraft(value: unknown, hostId: HostId): PersistedDraft {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid draft binding');
  const record = value as Record<string, unknown>;
  if (typeof record.draftId !== 'string' || record.draftId.length === 0) throw new Error('Invalid draft id');
  if (typeof record.destinationKey !== 'string') throw new Error('Invalid draft destination');
  const parts = parseSessionKey(record.destinationKey);
  if (parts.hostId !== hostId) throw new Error('Draft destination belongs to another host');
  if (typeof record.phase !== 'string' || record.phase.length === 0) throw new Error('Invalid draft phase');
  return {
    draftId: record.draftId,
    destinationKey: record.destinationKey,
    phase: record.phase,
    updatedAt: parseIsoDate(record.updatedAt, 'draft timestamp'),
  };
}

function parsePersistedApproval(value: unknown, hostId: HostId): PersistedApproval {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid approval binding');
  const record = value as Record<string, unknown>;
  if (typeof record.approvalId !== 'string' || record.approvalId.length === 0) throw new Error('Invalid approval id');
  if (typeof record.destinationKey !== 'string') throw new Error('Invalid approval destination');
  const parts = parseSessionKey(record.destinationKey);
  if (parts.hostId !== hostId) throw new Error('Approval destination belongs to another host');
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0) throw new Error('Invalid approval revision');
  if (record.status !== 'pending' && record.status !== 'resolved') throw new Error('Invalid approval status');
  return {
    approvalId: record.approvalId,
    destinationKey: record.destinationKey,
    revision: record.revision as number,
    status: record.status,
    updatedAt: parseIsoDate(record.updatedAt, 'approval timestamp'),
  };
}

export function createInitialState(hostId: HostId): CorePersistV1 {
  return { version: CORE_STATE_VERSION, hostId: parseHostId(hostId), workspaces: [], projects: [], controllers: [] };
}

export function serializeState(state: CorePersistV1): string {
  if (state.version !== CORE_STATE_VERSION) throw new Error('Unsupported core state version');
  parseHostId(state.hostId);
  return JSON.stringify(state);
}

/** Fail-closed loader: unknown versions and cross-host bindings never load. */
export function parseState(text: string): CorePersistV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Core state is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid core state');
  const record = raw as Record<string, unknown>;
  if (record.version !== CORE_STATE_VERSION) throw new Error('Unsupported core state version');
  const hostId = parseHostId(record.hostId);
  if (!Array.isArray(record.workspaces) || !Array.isArray(record.projects) || !Array.isArray(record.controllers)) {
    throw new Error('Invalid core state');
  }
  const workspaces = (record.workspaces as unknown[]).map(parseWorkspace);
  const workspaceIds = new Set<string>();
  const workspaceRoots = new Set<string>();
  for (const workspace of workspaces) {
    if (workspaceIds.has(workspace.workspaceId)) throw new Error('Duplicate workspace id');
    const rootKey = isWindowsStyleRoot(workspace.root) ? workspace.root.toLowerCase() : workspace.root;
    if (workspaceRoots.has(rootKey)) throw new Error('Duplicate workspace root');
    workspaceIds.add(workspace.workspaceId);
    workspaceRoots.add(rootKey);
  }
  const projects = (record.projects as unknown[]).map(entry => parseProject(entry, workspaces));
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.projectId)) throw new Error('Duplicate project id');
    projectIds.add(project.projectId);
  }
  const controllers: PersistedController[] = [];
  const controllerIds = new Set<string>();
  for (const entry of record.controllers as unknown[]) {
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid controller state');
    const item = entry as Record<string, unknown>;
    const controllerId = parseControllerId(item.controllerId);
    if (controllerIds.has(controllerId)) throw new Error('Duplicate controller id');
    controllerIds.add(controllerId);
    const persisted: PersistedController = {
      controllerId,
      selection: parseSelection(item.selection, projects, hostId),
    };
    if (item.draft !== undefined) persisted.draft = parsePersistedDraft(item.draft, hostId);
    if (item.approval !== undefined) persisted.approval = parsePersistedApproval(item.approval, hostId);
    controllers.push(persisted);
  }
  return { version: CORE_STATE_VERSION, hostId, workspaces, projects, controllers };
}

// --- Legacy migration ------------------------------------------------------------
// Legacy scope labels (`dev-pc`, `codex`) were display names, never identity.
// Migration keeps them as labels and binds fresh opaque ids explicitly so two
// legacy scopes never merge by accident.

export interface LegacyScopeMapping {
  hostId: HostId;
  harnessPluginId: string;
  harnessInstanceId: string;
  projectId: string;
  nativeSessionId: string;
}

export function migrateLegacySessionKey(mapping: LegacyScopeMapping): string {
  return formatSessionKey({
    hostId: parseHostId(mapping.hostId),
    harness: {
      pluginId: parsePluginId(mapping.harnessPluginId),
      instanceId: parseInstanceId(mapping.harnessInstanceId),
    },
    nativeSessionId: parseNativeSessionId(mapping.nativeSessionId),
  });
}

export function parseLegacyScopeKey(scope: string): { machineLabel: string; harnessLabel: string; projectLabel?: string } {
  const segments = scope.split('/');
  if (segments.length < 2 || segments.length > 3 || segments.some(segment => segment.length === 0)) {
    throw new Error('Invalid legacy scope key');
  }
  const [machineLabel, harnessLabel, projectLabel] = segments as [string, string, string?];
  return projectLabel === undefined
    ? { machineLabel, harnessLabel }
    : { machineLabel, harnessLabel, projectLabel };
}
