# Verification Evidence: MW.04.03.01.01 (장치 재접속·plugin 장애·제거)

## Task Information
- **Task ID:** `MW.04.03.01.01`
- **Title:** 장치 재접속·plugin 장애·제거
- **Scenarios:** D08, D13, D15, D16, D17, D18
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6)

## Acceptance Criteria & Results

### MW.04.03.01.01.A1: unplug/reset/crash 뒤 안전 복구하고 오래된 button event/unknown 명령을 replay하지 않는다.
- **Status:** PASSED
- **Test Command:** `node --test tests/device-lifecycle.test.mjs`
- **Evidence:**
  - Verified device registration with `verifiedIdentity`.
  - Disconnect / unplug: device state transitions to `offline`, lease cleared.
  - Inputs while disconnected are rejected (`Device lease unavailable`).
  - Stale events (timestamp > 2s old or sequence <= lastSequence) are rejected (`Stale/replayed input`).
  - Reconnect after replug: succeeds with matching verifiedIdentity and revision; fresh lease minted.
  - Reconnect with mismatched identity (e.g. factory reset or spoof attempt) is rejected with `needs_identification` / `Physical identity must be confirmed again`.

### MW.04.03.01.01.A2: 두 장치+Web 동시 조작과 revoke가 타 controller 또는 실행 중 harness task를 종료시키지 않는다.
- **Status:** PASSED
- **Test Command:** `node --test tests/device-lifecycle.test.mjs`
- **Evidence:**
  - Multi-controller operation (Device 1, Device 2, Web client) on `CommandJournal`:
    - Device 1 and Web client attempt to resolve the same pending decision concurrently.
    - Device 1's claim resolves the decision; Web's attempt at stale revision 0 is rejected with `stale_decision`.
  - Revoking Device 1 (`registry.revoke(dev1.deviceId)`):
    - Device 1 lease is immediately invalidated; subsequent inputs are rejected.
    - Device 2 and Web client continue operating normally.
    - Running harness command in `CommandJournal` remains in `queued`/active state, NOT cancelled (D16).
  - Plugin crash (`registry.handlePluginCrash('mock.hid')`):
    - Marks only that plugin's devices as `degraded`, leaving other devices intact.
