import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parseSessionKey } from './identity.js';
import { ControllerContext, type DraftPhase } from './context.js';
import { VoiceCoordinator, AudioFault, type TranscribeResult } from './audio.js';
import { SessionService } from './sessions.js';

export interface VoiceDraftState {
  draftId: string;
  destinationKey: string;
  phase: DraftPhase;
  text: string;
  undoStack: string[];
  error?: string;
  updatedAt: number;
}

export interface VoiceDraftOptions {
  coordinator: VoiceCoordinator;
  sessionService: SessionService;
  now?: () => number;
}

export class VoiceDraftFault extends Error {
  constructor(readonly code: string, message: string, readonly recoveryHint?: string) {
    super(message);
    this.name = 'VoiceDraftFault';
  }
}

/**
 * VoiceDraftManager (MW.07.02.01.01)
 *
 * Implements the full voice draft lifecycle:
 * - Start recording -> STT recognition -> Review / Edit / Undo -> Explicit Send
 * - Strict destination invariance (R-TARGET / J07): destination is pinned at start and immutable
 * - Never sends automatically on speech end, transcript arrival, or reconnection
 * - Safe recovery/discard on audio source disconnect or STT failure (R-RECOVER)
 */
export class VoiceDraftManager extends EventEmitter {
  readonly coordinator: VoiceCoordinator;
  readonly sessionService: SessionService;
  private readonly now: () => number;
  private readonly drafts = new Map<string, VoiceDraftState>(); // controllerId -> VoiceDraftState

  constructor(options: VoiceDraftOptions) {
    super();
    this.coordinator = options.coordinator;
    this.sessionService = options.sessionService;
    this.now = options.now ?? Date.now;
  }

  getDraft(controllerId: string): VoiceDraftState | undefined {
    const draft = this.drafts.get(controllerId);
    return draft ? structuredClone(draft) : undefined;
  }

  /**
   * Starts a new voice recording draft with pinned destination (R-TARGET / J07).
   */
  async startVoiceDraft(
    controllerId: string,
    destinationKey: string,
    options?: { sourceId?: string }
  ): Promise<VoiceDraftState> {
    parseSessionKey(destinationKey);

    // Verify session exists and is owned (cannot voice-draft to read-only session)
    const session = this.sessionService.getSession(destinationKey);
    if (session && session.readOnly) {
      throw new VoiceDraftFault('read_only_session', 'Cannot start voice draft on a read-only session');
    }

    const controller = this.sessionService.getControllerContext(controllerId);
    const existing = this.drafts.get(controllerId);
    if (existing && ['recording', 'transcribing'].includes(existing.phase)) {
      throw new VoiceDraftFault('draft_in_progress', 'A voice draft is already in progress. Finish or cancel it first.');
    }

    const draftId = `vdraft_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const at = new Date(this.now()).toISOString();

    // Bind to controller context
    controller.beginDraft(draftId, destinationKey, at);

    const state: VoiceDraftState = {
      draftId,
      destinationKey,
      phase: 'recording',
      text: '',
      undoStack: [],
      updatedAt: this.now(),
    };
    this.drafts.set(controllerId, state);

    try {
      await this.coordinator.startCapture(draftId, options?.sourceId);
      this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
      return structuredClone(state);
    } catch (err: any) {
      this.drafts.delete(controllerId);
      controller.clearDraft();
      throw err;
    }
  }

  /**
   * Finishes audio capture and runs STT to produce a reviewed text draft.
   */
  async finishRecording(
    controllerId: string,
    options?: { sourceId?: string; providerId?: string; language?: string; modelId?: string }
  ): Promise<VoiceDraftState> {
    const state = this.drafts.get(controllerId);
    if (!state || state.phase !== 'recording') {
      throw new VoiceDraftFault('invalid_state', 'No recording in progress to finish');
    }

    const controller = this.sessionService.getControllerContext(controllerId);
    state.phase = 'transcribing';
    state.updatedAt = this.now();
    controller.updateDraftPhase('transcribing', new Date(this.now()).toISOString());
    this.emit('draftChanged', { controllerId, draft: structuredClone(state) });

    try {
      const result: TranscribeResult = await this.coordinator.finishCaptureAndTranscribe(state.draftId, options);
      state.phase = 'review';
      state.text = result.text;
      state.undoStack = [];
      state.updatedAt = this.now();
      controller.updateDraftPhase('review', new Date(this.now()).toISOString());
      this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
      return structuredClone(state);
    } catch (err: any) {
      // Safe failure handling: do not send or corrupt destination
      state.phase = 'failed';
      state.error = err.message || 'Transcription failed';
      state.updatedAt = this.now();
      try {
        controller.updateDraftPhase('failed', new Date(this.now()).toISOString());
      } catch {}
      this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
      throw err;
    }
  }

  /**
   * Edits the reviewed draft text, saving the previous text on the undo stack.
   */
  editDraft(controllerId: string, newText: string): VoiceDraftState {
    const state = this.drafts.get(controllerId);
    if (!state || state.phase !== 'review') {
      throw new VoiceDraftFault('invalid_state', 'Draft is not in review phase');
    }

    state.undoStack.push(state.text);
    state.text = newText;
    state.updatedAt = this.now();
    this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
    return structuredClone(state);
  }

  /**
   * Reverts to the previous draft text before the last edit.
   */
  undoEdit(controllerId: string): VoiceDraftState {
    const state = this.drafts.get(controllerId);
    if (!state || state.phase !== 'review') {
      throw new VoiceDraftFault('invalid_state', 'Draft is not in review phase');
    }
    if (state.undoStack.length === 0) {
      return structuredClone(state);
    }

    const previous = state.undoStack.pop()!;
    state.text = previous;
    state.updatedAt = this.now();
    this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
    return structuredClone(state);
  }

  /**
   * Explicit Send (never automatic): sends the reviewed draft to the pinned destination.
   */
  async explicitSend(controllerId: string): Promise<{ commandId: string; status: string }> {
    const state = this.drafts.get(controllerId);
    if (!state || state.phase !== 'review') {
      throw new VoiceDraftFault('invalid_state', 'Draft must be in review phase before explicit Send');
    }
    if (!state.text.trim()) {
      throw new VoiceDraftFault('empty_draft', 'Cannot send an empty draft');
    }

    const controller = this.sessionService.getControllerContext(controllerId);
    state.phase = 'sending';
    state.updatedAt = this.now();
    controller.updateDraftPhase('sending', new Date(this.now()).toISOString());
    this.emit('draftChanged', { controllerId, draft: structuredClone(state) });

    try {
      // Send strictly to the pinned destinationKey (R-TARGET / J07)
      const result = await this.sessionService.sendPrompt(controllerId, state.destinationKey, state.text);
      state.phase = 'sent';
      state.updatedAt = this.now();
      controller.updateDraftPhase('sent', new Date(this.now()).toISOString());
      this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
      return result;
    } catch (err: any) {
      state.phase = 'failed';
      state.error = err.message || 'Send failed';
      state.updatedAt = this.now();
      try {
        controller.updateDraftPhase('failed', new Date(this.now()).toISOString());
      } catch {}
      this.emit('draftChanged', { controllerId, draft: structuredClone(state) });
      throw err;
    }
  }

  /**
   * Cancels or discards the current voice draft safely.
   */
  async cancelVoiceDraft(controllerId: string): Promise<void> {
    const state = this.drafts.get(controllerId);
    if (!state) return;

    const controller = this.sessionService.getControllerContext(controllerId);
    if (['recording', 'transcribing'].includes(state.phase)) {
      await this.coordinator.cancel(state.draftId);
    }

    state.phase = 'cancelled';
    state.updatedAt = this.now();
    try {
      controller.updateDraftPhase('cancelled', new Date(this.now()).toISOString());
    } catch {}

    this.drafts.delete(controllerId);
    controller.clearDraft();
    this.emit('draftChanged', { controllerId, draft: null });
  }
}
