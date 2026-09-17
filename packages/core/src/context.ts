import {
  isControllerId,
  parseControllerId,
  parseInstanceId,
  parsePluginId,
  parseProjectId,
  parseSessionKey,
  type PersistedApproval,
  type PersistedController,
  type PersistedDraft,
} from './identity.js';

/**
 * Per-controller selection, draft and approval bindings (MW.02.01.01.01).
 *
 * Legacy defect (reference/legacy-host, behavior evidence only): one global
 * `selectedProjectIdx` / `selectedSessionIdx` was shared by every client and
 * the single draft destination followed UI selection. Switching scope while
 * recording therefore retargeted the pending send (J03), and two clients
 * resolving one approval applied it twice (D17).
 *
 * Invariants implemented here:
 * - Each controller owns an independent selection object (A2).
 * - Draft and approval destinations are immutable once bound (R-TARGET, J03):
 *   later `selectScope` calls never retarget them.
 * - Recovery never replays: an `unknown` draft stays `unknown` until an
 *   explicit confirmation arrives (R-RECOVER). Durable replay policy itself
 *   belongs to MW.02.01.01.02 and is intentionally not implemented here.
 */

export type DraftPhase =
  | 'recording'
  | 'transcribing'
  | 'review'
  | 'sending'
  | 'unknown'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'empty';

const DRAFT_PHASES: ReadonlySet<string> = new Set([
  'recording',
  'transcribing',
  'review',
  'sending',
  'unknown',
  'sent',
  'failed',
  'cancelled',
  'empty',
]);

const PENDING_DRAFT_PHASES: ReadonlySet<DraftPhase> = new Set([
  'recording',
  'transcribing',
  'review',
  'sending',
  'unknown',
]);

const TERMINAL_DRAFT_PHASES: ReadonlySet<DraftPhase> = new Set(['sent', 'failed', 'cancelled', 'empty']);

export function parseDraftPhase(value: unknown): DraftPhase {
  if (typeof value !== 'string' || !DRAFT_PHASES.has(value)) throw new Error('Invalid draft phase');
  return value as DraftPhase;
}

export interface ControllerSelection {
  harnessPluginId?: string;
  harnessInstanceId?: string;
  projectId?: string;
  sessionKey?: string;
}

export interface DraftBinding {
  draftId: string;
  destinationKey: string;
  phase: DraftPhase;
  updatedAt: string;
}

export interface ApprovalBinding {
  approvalId: string;
  destinationKey: string;
  revision: number;
  status: 'pending' | 'resolved';
  updatedAt: string;
}

function copySelection(selection: ControllerSelection): ControllerSelection {
  return { ...selection };
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSelectionPatch(patch: ControllerSelection): ControllerSelection {
  if (typeof patch !== 'object' || patch === null) throw new Error('Invalid selection');
  const next: ControllerSelection = {};
  if (patch.harnessPluginId !== undefined) next.harnessPluginId = parsePluginId(patch.harnessPluginId);
  if (patch.harnessInstanceId !== undefined) next.harnessInstanceId = parseInstanceId(patch.harnessInstanceId);
  if (patch.projectId !== undefined) next.projectId = parseProjectId(patch.projectId);
  if (patch.sessionKey !== undefined) {
    parseSessionKey(patch.sessionKey);
    next.sessionKey = patch.sessionKey;
  }
  return next;
}

export class ControllerContext {
  readonly controllerId: string;
  private selection: ControllerSelection = {};
  private draft?: DraftBinding;
  private approval?: ApprovalBinding;

  constructor(controllerId: string) {
    this.controllerId = parseControllerId(controllerId);
  }

  getSelection(): ControllerSelection {
    return copySelection(this.selection);
  }

  getDraft(): DraftBinding | undefined {
    return this.draft === undefined ? undefined : { ...this.draft };
  }

  getApproval(): ApprovalBinding | undefined {
    return this.approval === undefined ? undefined : { ...this.approval };
  }

  /**
   * Replace this controller's selection only. Pending draft and approval
   * destinations are left untouched (J03).
   */
  selectScope(patch: ControllerSelection): ControllerSelection {
    this.selection = { ...this.selection, ...parseSelectionPatch(patch) };
    return this.getSelection();
  }

  clearScope(): ControllerSelection {
    this.selection = {};
    return this.getSelection();
  }

  beginDraft(draftId: string, destinationKey: string, at: string = nowIso()): DraftBinding {
    if (typeof draftId !== 'string' || draftId.length === 0) throw new Error('Invalid draft id');
    parseSessionKey(destinationKey);
    if (this.draft !== undefined && PENDING_DRAFT_PHASES.has(this.draft.phase)) {
      throw new Error('Finish or discard the pending draft first.');
    }
    if (Number.isNaN(Date.parse(at))) throw new Error('Invalid timestamp');
    this.draft = { draftId, destinationKey, phase: 'recording', updatedAt: at };
    return { ...this.draft };
  }

  updateDraftPhase(phase: DraftPhase, at: string = nowIso()): DraftBinding {
    const current = this.draft;
    if (current === undefined) throw new Error('No draft to update.');
    parseDraftPhase(phase);
    if (Number.isNaN(Date.parse(at))) throw new Error('Invalid timestamp');
    // Terminal states never silently return to pending; start a new draft instead.
    // `unknown` never auto-advances: only an explicit confirmation may resolve it.
    if (TERMINAL_DRAFT_PHASES.has(current.phase) && PENDING_DRAFT_PHASES.has(phase)) {
      throw new Error('Terminal draft cannot return to pending.');
    }
    if (current.phase === 'unknown' && phase !== 'unknown' && phase !== 'sent' && phase !== 'failed') {
      throw new Error('Unknown delivery resolves only to sent or failed.');
    }
    this.draft = { ...current, phase, updatedAt: at };
    return { ...this.draft };
  }

  clearDraft(): void {
    this.draft = undefined;
  }

  beginApproval(approvalId: string, destinationKey: string, revision: number, at: string = nowIso()): ApprovalBinding {
    if (typeof approvalId !== 'string' || approvalId.length === 0) throw new Error('Invalid approval id');
    parseSessionKey(destinationKey);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid approval revision');
    if (Number.isNaN(Date.parse(at))) throw new Error('Invalid timestamp');
    if (this.approval !== undefined && this.approval.status === 'pending') {
      throw new Error('Resolve the pending approval first.');
    }
    this.approval = { approvalId, destinationKey, revision, status: 'pending', updatedAt: at };
    return { ...this.approval };
  }

  /**
   * Apply an approval decision exactly once (D17). Returns `applied` only for
   * the matching pending approval; every other call reports `stale` and
   * changes nothing, so a second controller resolving the same revision does
   * not double-apply.
   */
  resolveApproval(approvalId: string, revision: number, at: string = nowIso()): 'applied' | 'stale' {
    const current = this.approval;
    if (current === undefined || current.status !== 'pending') return 'stale';
    if (current.approvalId !== approvalId || current.revision !== revision) return 'stale';
    if (Number.isNaN(Date.parse(at))) throw new Error('Invalid timestamp');
    this.approval = { ...current, status: 'resolved', updatedAt: at };
    return 'applied';
  }

  /**
   * Record a decision taken on another controller for the same approval
   * without applying it locally (D17). Returns true when a pending approval
   * was marked resolved as a peer notification.
   */
  notePeerApprovalResolved(approvalId: string, revision: number, at: string = nowIso()): boolean {
    const current = this.approval;
    if (current === undefined || current.status !== 'pending') return false;
    if (current.approvalId !== approvalId || current.revision !== revision) return false;
    if (Number.isNaN(Date.parse(at))) throw new Error('Invalid timestamp');
    this.approval = { ...current, status: 'resolved', updatedAt: at };
    return true;
  }

  clearApproval(): void {
    this.approval = undefined;
  }

  snapshot(): PersistedController {
    const persisted: PersistedController = { controllerId: this.controllerId, selection: copySelection(this.selection) };
    if (this.draft !== undefined) {
      const draft: PersistedDraft = { ...this.draft };
      persisted.draft = draft;
    }
    if (this.approval !== undefined) {
      const approval: PersistedApproval = { ...this.approval };
      persisted.approval = approval;
    }
    return persisted;
  }

  restore(persisted: PersistedController): void {
    if (persisted.controllerId !== this.controllerId) throw new Error('Controller id mismatch');
    this.selection = parseSelectionPatch(persisted.selection);
    if (persisted.draft !== undefined) {
      parseSessionKey(persisted.draft.destinationKey);
      // Recovery restores the destination exactly; review/sending resume as
      // unknown so nothing replays without evidence (R-RECOVER).
      const phase = parseDraftPhase(persisted.draft.phase);
      this.draft = {
        draftId: persisted.draft.draftId,
        destinationKey: persisted.draft.destinationKey,
        phase: phase === 'review' || phase === 'sending' ? 'unknown' : phase,
        updatedAt: persisted.draft.updatedAt,
      };
    } else {
      this.draft = undefined;
    }
    if (persisted.approval !== undefined) {
      parseSessionKey(persisted.approval.destinationKey);
      if (!Number.isSafeInteger(persisted.approval.revision) || persisted.approval.revision < 0) {
        throw new Error('Invalid approval revision');
      }
      if (persisted.approval.status !== 'pending' && persisted.approval.status !== 'resolved') {
        throw new Error('Invalid approval status');
      }
      this.approval = { ...persisted.approval };
    } else {
      this.approval = undefined;
    }
  }
}

export class ControllerStore {
  private readonly controllers = new Map<string, ControllerContext>();

  create(controllerId: string): ControllerContext {
    if (!isControllerId(controllerId)) throw new Error('Invalid controller id');
    if (this.controllers.has(controllerId)) throw new Error('Controller already exists');
    const context = new ControllerContext(controllerId);
    this.controllers.set(controllerId, context);
    return context;
  }

  get(controllerId: string): ControllerContext | undefined {
    return this.controllers.get(controllerId);
  }

  getOrCreate(controllerId: string): ControllerContext {
    const existing = this.controllers.get(controllerId);
    if (existing !== undefined) return existing;
    return this.create(controllerId);
  }

  ids(): string[] {
    return [...this.controllers.keys()];
  }

  snapshotAll(): PersistedController[] {
    return [...this.controllers.values()].map(context => context.snapshot());
  }

  restoreAll(persisted: readonly PersistedController[]): void {
    const seen = new Set<string>();
    for (const entry of persisted) {
      if (seen.has(entry.controllerId)) throw new Error('Duplicate controller id');
      seen.add(entry.controllerId);
      this.getOrCreate(entry.controllerId).restore(entry);
    }
  }
}
