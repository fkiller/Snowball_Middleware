# MW.06.02.01.01 — Overview/Attention와 목적지 고정 상세 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.06.02.01.01
- **Scenarios**: H08, H09, J02, J03

## 1. Implemented Components

1. **`apps/supervisor/app.js` (Overview & Attention Surfaces)**:
   - **Attention Surface**:
     - Displays pending decisions (`snapshot.decisions.filter(d => d.status === 'pending')`) at the top of the Overview with `승인 (Accept)` and `거부 (Decline)` action buttons.
     - Displays in-doubt and failed commands (`snapshot.commands.filter(c => c.status === 'unknown' || c.status === 'failed')`) with status tags.
   - **Filter Controls**:
     - Filter buttons by Harness (`전체`, `Codex`, `OpenCode`, `Antigravity`).
     - Session list filtered dynamically according to selected harness.
   - **Target Invariance (R-TARGET / J03)**:
     - When drafting a command for an owned session, `activeDraft` binds and displays the pinned target: `명령 작성 중 · 고정 대상: <sessionKey>`.
     - Switching harness filter or clicking another session does NOT mutate the active draft's destination key.
     - Submitting the draft sends strictly to the pinned destination.

## 2. Acceptance Verification

### MW.06.02.01.01.A1 (PASS)
- **Title**: Supervisor 브라우저에서 Overview(프로젝트/세션 목록, 상태)와 Attention(승인 대기, 오류)이 정확히 표시된다.
- **Procedure**: `node --test tests/supervisor-overview.test.mjs`
- **Result**:
  - Supervisor assets loaded via `loadSupervisorAssets` contain Attention, Overview, filter controls, and destination pinning logic.
  - Pending decisions and unknown/failed commands correctly detected and structured into attention cards.

### MW.06.02.01.01.A2 (PASS)
- **Title**: 필터를 전환하거나 다른 세션을 클릭해도 작성 중인 draft나 승인 카드의 대상이 바뀌지 않는다 (R-TARGET).
- **Procedure**: `node --test tests/supervisor-overview.test.mjs`
- **Result**:
  - Filter switching while draft is active preserves original `destinationKey`.
  - Clicking on other (or read-only) sessions does not retarget the draft.
  - Command dispatch routes strictly to the pinned destination.
