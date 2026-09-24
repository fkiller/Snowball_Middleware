> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: blocked. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# Verification Evidence: MW.08.02.01.02 (로컬 제품 통합 검수와 support matrix)

## Task Information
- **Task ID:** `MW.08.02.01.02`
- **Title:** 로컬 제품 통합 검수와 support matrix
- **Scenarios:** J01, J04, J05, J06, J08
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6)

## Acceptance Criteria & Results

### MW.08.02.01.02.A1: G0-G3 필수 task가 증거와 함께 완료되고 pending/blocked를 pass로 계산하지 않는다.
- **Status:** PASSED
- **Test Command:** `node --test tests/support-matrix.test.mjs`
- **Evidence:**
  - Evaluated `docs/middleware/PLAN.json`:
    - All completed tasks (`status === 'done'`) have non-empty `completedSteps`, tracked `changedFiles`, and verified acceptance checks (`status === 'pass'`).
    - Physical review checkpoints (`MW.04.01.01.02` and `MW.04.02.01.02`) are strictly kept as `blocked` and are NOT claimed as pass.
    - Zero virtual passes are substituted for missing physical devices.

### MW.08.02.01.02.A2: Internet 및 LAN 비활성에서 core 제어 UI가 유지되며 cloud harness 연결 실패는 별도로 표시된다.
- **Status:** PASSED
- **Test Command:** `node --test tests/support-matrix.test.mjs`
- **Evidence:**
  - Zero-config harness discovery runs completely offline with no network or filesystem dependency.
  - OpenCode loopback candidate is reported as `unprobed` with `controllable: false` (R-TRUTH).
  - Core `CommandJournal` and `LocalApi` operate on loopback `127.0.0.1` without requiring internet, central SaaS servers, or LAN connectivity (R-LOCAL, R-NET).
  - Cloud-backed harness connection failures are isolated with distinct reason codes rather than freezing the core supervisor.
