# MW.03.02.01.03 — Harness 재연결·변경·disable/remove 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.03.02.01.03
- **Scenarios**: H12, H13, H14

## 1. Implemented Components

1. **`SessionService` Lifecycle Methods (`packages/core/src/sessions.ts`)**:
   - `reconnectAdapter(pluginId, newAdapter)`:
     - Handles harness restart after crash or sleep/wake (H12 / H13).
     - When a new process reconnects with a new `ownerId`, all previous sessions are cleanly marked `readOnly = true`, `ownerId = null` to prevent cross-process owner contamination.
     - New sessions belong cleanly to the new owner.
   - `disableAdapter(pluginId)` / `enableAdapter(pluginId)`:
     - Disabling a harness marks its sessions as unavailable and prevents new commands with `SessionFault('harness_disabled')`.
     - In-flight drafts retain their original destination key (R-TARGET). They are never retargeted to a foreign harness.
   - `removeAdapter(pluginId)`:
     - Stops the adapter and removes it.
     - Preserves historical session records as read-only (R-TRUTH / H14).
     - Rejects mutation commands safely with `read_only_session`.

## 2. Acceptance Verification

### MW.03.02.01.03.A1 (PASS)
- **Title**: Harness 프로세스 충돌/sleep 후 restart 시 기존 작업 소유권이 오염 없이 갱신된다.
- **Procedure**: `node --test tests/harness-lifecycle.test.mjs`
- **Result**:
  - Original session created with owner PID 101.
  - Harness restarts with owner PID 202.
  - Prior session safely converted to read-only; mutations rejected.
  - New session created on reconnected adapter belongs cleanly to PID 202; commands dispatch normally.

### MW.03.02.01.03.A2 (PASS)
- **Title**: Harness disable/remove 시 pending draft가 foreign harness로 오송신되지 않는다.
- **Procedure**: `node --test tests/harness-lifecycle.test.mjs`
- **Result**:
  - Draft bound to harness.alpha retains its destination when harness.alpha is disabled; commands fail with `harness_disabled` and are never sent to harness.beta.
  - Re-enabling harness.alpha restores command delivery to harness.alpha.
  - Completely removing harness.alpha converts sessions to read-only; commands rejected without foreign dispatch.
