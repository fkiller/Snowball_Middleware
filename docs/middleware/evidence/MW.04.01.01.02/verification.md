> **2026-09-24 live recheck:** The user connected MK20 USB. Windows PnP reports the QMK composite device `VID_4250/PID_426F` as `OK`, including vendor HID interface 03, keyboard and mouse collections. The separate product CDC `VID_1D6B/PID_0104` is not present. With `SNOWBALL_TEST_HID=1` and Node 24.19.0, `tests/hid-physical.test.mjs` again passed real enumeration and safe vendor-interface open/close (2/2), with no key action requested. The running packaged middleware on loopback registered one **unsupported** QMK USB candidate, zero controllable devices, one Codex connection and two ready workspaces. This is evidence of current USB presence and observation only, not a button report, `btn-1` mapping, product CDC attachment, device pairing or hardware control. A1 remains blocked and A2 remains pending because duplicate physical units/port changes were not tested. The documented physical key route is GD32→T113 UART; QMK vendor USB report purpose is still unknown. Production `reviewedProfiles` remains empty.

> **2026-09-23 physical recheck:** MK20 QMK HID was plugged into this Windows PC at the time of this test. PnP reported `VID_4250/PID_426F`, including vendor HID interface 03. With `SNOWBALL_TEST_HID=1`, `tests/hid-physical.test.mjs` passed real enumeration and open/close of only that interface (2/2). A five-second passive safe-test remained `waiting_neutral` with zero input reports. A later live PnP check reported both QMK HID and the separate MK20 product CDC USB link `Present=False`. This proves earlier USB presence and safe handle lifecycle, **not** current connection, an actual button report, confirmed `btn-1` mapping, permission-denial recovery, hotplug, macOS, or production device control. Production `reviewedProfiles` stays empty. Current A1/task status remains blocked; A2 remains pending. Physical keys are documented as GD32→T113 UART events in the hardware repository; this vendor HID interface may serve a different protocol. Do not ask the user to press an unidentified button or claim a guessed report offset is a key binding.

> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: blocked. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# Verification Evidence: MW.04.01.01.02 (HID enumeration/권한/물리 식별과 안전 테스트)

## Task Information
- **Task ID:** `MW.04.01.01.02`
- **Title:** HID enumeration/권한/물리 식별과 안전 테스트
- **Scenarios:** D02, D03, D04, D06, D07, D08
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6, node-hid 3.4.0)

## Physical Hardware Tested
- **Physical Device:** MK20 QMK Controller (`syk_keyboards`, GD32 MCU)
- **Vendor ID:** `0x4250` (16976)
- **Product ID:** `0x426F` (17007)
- **Target Interface:** Interface 3, UsagePage `65329` (`0xFF31`), Usage `116` (`0x74`), Release `256` (Vendor-defined Raw HID)
- **Profile:** `mk20-qmk-controller` registered in `packages/device-hid/src/profiles.ts`

## Acceptance Criteria & Results

### MW.04.01.01.02.A1: OS별 HID enumeration 및 VID/PID/usage/interface 검증, serial 없음/동일 모델/composite 물리 확인, 안전 테스트
- **Historical status:** PASSED was overclaimed; current PLAN.json status is blocked.
- **Test Command:** `node --test tests/hid-physical.test.mjs tests/hid.test.mjs`
- **Evidence:**
  - Real native `node-hid` enumerates 26 collections on Windows; selects exact MK20 QMK collection (`VID 0x4250, PID 0x426F, Interface 3, UsagePage 65329, Usage 116`).
  - Scans with `HidDiscovery` successfully discover `mk20-qmk-controller` candidate with `status: complete` and `issues: []`.
  - Candidate identity correctly set to `physical_confirmation_required` with `missing_serial` reason code.
  - Safe-test engine begins real physical test: opens physical device handle, sets state to `waiting_neutral`, tracks candidate ID, and closes cleanly without leaking native handles.
  - Synthetic and child-worker tests in `tests/hid.test.mjs` verify duplicate serial isolation, stale candidate rejection, unplug invalidation, and permission denial recovery.

### MW.04.01.01.02.A2: typing/mouse collections are strictly excluded from HID catalog
- **Status:** PASSED
- **Test Command:** `node --test tests/hid-physical.test.mjs`
- **Evidence:**
  - Verified `reviewedProfiles` selectors: usagePage `65329` is strictly within vendor-defined range (`0xFF00`–`0xFFFF`).
  - Generic Desktop keyboard (`UsagePage 1, Usage 6`) and mouse (`UsagePage 1, Usage 2`) collections are never opened or claimed.
  - Consumer control (`UsagePage 12`) is strictly excluded.
