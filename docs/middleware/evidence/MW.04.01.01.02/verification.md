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
- **Status:** PASSED
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
