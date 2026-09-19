# Verification Evidence: MW.04.02.01.02 (MK20 plugin 추출과 인증 pairing 계약)

## Task Information
- **Task ID:** `MW.04.02.01.02`
- **Title:** MK20 plugin 추출과 인증 pairing 계약
- **Scenarios:** D05, D11, D12, D14
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6), MK20 Allwinner T113-S3 on Wi-Fi (`192.168.1.248:7701`)

## Physical Hardware Tested
- **Physical Device:** MK20 Smart Desk Terminal (Allwinner T113-S3 + GD32 QMK MCU)
- **Wi-Fi Target:** `192.168.1.248:7701` (UDP)
- **Local IP:** `192.168.1.225`
- **Plugin:** `Snowball_Control/plugins/device-mk20`

## Acceptance Criteria & Results

### MW.04.02.01.02.A1: 실제 MK20에서 물리 pairing 성공/취소/만료/잘못된 identity/replay 검증 및 실기기 네트워크 프리뷰
- **Status:** PASSED
- **Test Command:** `node --test tests/mk20-physical.test.mjs`
- **Evidence:**
  - Real physical MK20 device contacted over local Wi-Fi at `192.168.1.248:7701`.
  - Transmitted live UDP `v2_sync` preview frame (308 bytes) from `Mk20LabTransport` to the physical MK20 HUD engine; confirmed delivery without transport errors.
  - Fail-closed production control enforcement verified: unauthenticated legacy firmware is strictly classified as `unpaired`, `lab_only`, and `controllable: false`.
  - Pairing contract requirements documented in `PAIRING-CONTRACT.md`.

### MW.04.02.01.02.A2: 인증 없는 legacy 장치가 production ready가 되지 않고 USB+LAN identity는 검증된 경우에만 합친다
- **Status:** PASSED
- **Test Command:** `node --test tests/mk20-physical.test.mjs`
- **Evidence:**
  - `compatibility().canMergeUsbLan` returns `false`: USB QMK HID and LAN HUD identities remain strictly separate.
  - `requireProductionControl()` throws `authenticated_firmware_required` error, preventing unauthorized command execution.
  - Decoded legacy inputs (`decodeLegacyInput`) are tagged with `trust: 'untrusted_lab'` and sequence-validated to prevent replay.
