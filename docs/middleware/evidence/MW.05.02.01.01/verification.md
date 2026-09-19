# MW.05.02.01.01 — 기존 작업 attach와 새 task 전체 왕복 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.05.02.01.01
- **Scenarios**: H08, H09, J03

## 1. Implemented Components

1. **`packages/core/src/sessions.ts` (`SessionService`)**:
   - Manages and normalizes sessions across multiple harness adapters (`HarnessAdapter` implementing `DispatchPort`).
   - Distinguishes owned sessions from read-only/foreign sessions:
     - Only owned sessions registered with matching `ownerId` can receive commands.
     - Foreign and historical sessions are marked `readOnly: true` with `ownerId: null`. Mutation attempts fail with `read_only_session`.
   - Normalizes turn lifecycle:
     - `turn/started` transitions session status to `busy` and records `activeTurnId`.
     - `turn/completed` and `turn/interrupted` transition session status back to `idle` and clear `activeTurnId`.
   - Normalizes decision lifecycle:
     - Harness `decision` events are registered into `CommandJournal` as `DecisionRecord` (`pending`).
     - Resolution commands (`decisions.resolve`) are enqueued, revision-checked, and dispatched.
   - Enforces **R-TARGET / J03 (Destination Invariance)**:
     - In-flight drafts and pending decisions have immutable destination keys.
     - Changing controller selection (`selectScope`) never retargets in-flight drafts or active commands.
   - Enables full local vertical-slice round-trip with zero hardware devices (G1 gate).

## 2. Acceptance Verification

### MW.05.02.01.01.A1 (PASS)
- **Title**: 장치 0개로 실제 local harness task create→send→events→decision→cancel/recovery 흐름을 완료한다.
- **Procedure**: `node --test tests/sessions-roundtrip.test.mjs`
- **Result**:
  - Session created without physical hardware.
  - Prompt sent via `sendPrompt`, enqueued into `CommandJournal`, dispatched to adapter.
  - Asynchronous turn events (`turn/started`, `item/agentMessage/delta`) received and normalized to session state (`busy`).
  - Decision request registered, tracked in journal, and resolved (`accept`).
  - Active turn interrupted, verified cancel receipt, and recovered session state to `idle`.

### MW.05.02.01.01.A2 (PASS)
- **Title**: 기존 owner 접근 불가 시 read-only이고 scope 변경/새 task 선택이 pending 목적지를 바꾸지 않는다.
- **Procedure**: `node --test tests/sessions-roundtrip.test.mjs`
- **Result**:
  - Foreign/historical sessions without ownership access are strictly `readOnly: true` and reject prompt sends and interrupts (`SessionFault`).
  - Controller context binds draft to session A, switches selection to session B while draft is in recording/transcribing phase.
  - Draft destination remains immutable to session A (R-TARGET / J03).
  - Subsequent prompt send routes strictly to session A without retargeting.
