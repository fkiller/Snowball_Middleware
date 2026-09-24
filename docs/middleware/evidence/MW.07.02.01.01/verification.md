> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: needs_review. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# MW.07.02.01.01 — Review/명시 Send와 음성 lifecycle 복구 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.07.02.01.01
- **Scenarios**: J07

## 1. Implemented Components

1. **`packages/core/src/voice-draft.ts` (`VoiceDraftManager`)**:
   - Manages the full voice draft lifecycle:
     - `startVoiceDraft(controllerId, destinationKey)`: pins the destination key immediately, begins capture on `VoiceCoordinator`, sets draft phase to `recording`.
     - `finishRecording(controllerId)`: transitions phase through `transcribing` to `review`, populating `text` from STT.
     - `editDraft(controllerId, newText)` / `undoEdit(controllerId)`: enables full text editing with an undo stack.
     - `explicitSend(controllerId)`: enforces explicit Send (never automatic on speech end, transcript arrival, or reconnection).
   - **Destination Invariance (R-TARGET / J07)**:
     - The target destination key is pinned when the draft is started.
     - Switching controller selection (`selectScope`) never retargets in-flight voice drafts.
     - Explicit send routes strictly to the pinned destination.
   - **Safe Recovery / Discard (R-RECOVER)**:
     - `cancelVoiceDraft(controllerId)` cleanly cancels active audio capture and releases the audio source without dispatching any commands.
     - STT failures transition the draft to `failed`, preserve the error message, and never dispatch accidental or partial commands.

## 2. Acceptance Verification

### MW.07.02.01.01.A1 (PASS)
- **Title**: 음성 시작→인식→검토/편집→명시 Send 전체 lifecycle이 destination 불변으로 동작한다.
- **Procedure**: `node --test tests/voice-draft.test.mjs`
- **Result**:
  - Voice draft created with pinned destination.
  - Recording finished and transcribed to review text.
  - Draft edited and undone cleanly using undo stack.
  - Controller selection switched to a different session; draft destination remained strictly immutable.
  - Explicit Send dispatched command strictly to the pinned destination session.

### MW.07.02.01.01.A2 (PASS)
- **Title**: STT 실패/취소/source 연결 끊김 시 부분 draft 복구 또는 폐기가 안전하게 완료된다.
- **Procedure**: `node --test tests/voice-draft.test.mjs`
- **Result**:
  - Cancellation during active recording cleanly stops audio capture and deletes draft without sending.
  - STT failure marks draft `failed` with error reason, preserves destination, and prevents explicit send.
