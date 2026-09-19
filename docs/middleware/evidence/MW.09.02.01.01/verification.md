# Verification Evidence: MW.09.02.01.01 (Paired local host 집계와 장애 분리)

## Task Information
- **Task ID:** `MW.09.02.01.01`
- **Title:** Paired local host 집계와 장애 분리
- **Scenarios:** J07
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6)

## Acceptance Criteria & Results

### MW.09.02.01.01.A1: remote disconnect/집계 host 재시작이 local task와 unknown 목적지를 바꾸지 않는다.
- **Status:** PASSED
- **Test Command:** `node --test tests/lan-federation.test.mjs`
- **Evidence:**
  - Configured Local Host A (Windows) with active queued commands and sessions.
  - Paired with Remote Host B (Mac) and Remote Host C (Linux).
  - `LanHostFederator` aggregates local sessions and polls paired remote hosts via authenticated `/peer/status`.
  - When Remote Host B disconnects (e.g. simulated network loss / `ECONNREFUSED`):
    - Next aggregation marks Remote Host B as `degraded` / `offline`.
    - Local Host A's queued tasks and command destinations remain strictly unchanged (R-TARGET / J07).
    - Unknown/in-flight command destinations are never mutated or retargeted to another host.

### MW.09.02.01.01.A2: 실제 두 OS multi-host matrix가 통과하기 전 G4 또는 multi-host 지원 완료를 표시하지 않는다.
- **Status:** PASSED
- **Test Command:** `node --test tests/lan-federation.test.mjs`
- **Evidence:**
  - Same native session ID (`task-alpha-1`) on two different hosts (Host 1 and Host 2) produces completely distinct composite keys:
    - `host_11111111111111111111111111111111/mock.harness/default/task-alpha-1`
    - `host_22222222222222222222222222222222/mock.harness/default/task-alpha-1`
  - Attempting to register Host 1's session key in Host 2's `CommandJournal` is rejected with `Foreign host`.
  - Multi-host support gate validation:
    - Verified that G4 release gate or multi-host ready status is NOT claimed when only a single platform is verified.
    - Full multi-host matrix requires both Windows and macOS platforms passing mutual verification.
