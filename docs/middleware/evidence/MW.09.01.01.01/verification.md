> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: blocked. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# Verification Evidence: MW.09.01.01.01 (선택적 LAN Host pairing과 해제)

## Task Information
- **Task ID:** `MW.09.01.01.01`
- **Title:** 선택적 LAN Host pairing과 해제
- **Scenarios:** J07
- **Date:** 2026-09-19
- **Platform:** Windows 11 x64 (Node.js v20.19.6)

## Acceptance Criteria & Results

### MW.09.01.01.01.A1: 미등록 host/spoof/expired credential이 거부되고 network-off 즉시 discovery/listener가 닫힌다.
- **Status:** PASSED
- **Test Command:** `node --test tests/lan-pairing.test.mjs`
- **Evidence:**
  - Unregistered host attempting to access `/peer/status` is rejected with `401 Unauthorized`.
  - Spoofed signature / wrong public key / altered payload is rejected with `401 Invalid Signature`.
  - Expired credentials / timestamp drift (> 30s) is rejected with `401 Credential Expired`.
  - Network-off (closing `LanHostListener`):
    - Listener immediately terminates with `close()`.
    - All sockets destroyed.
    - Port freed.
    - Subsequent connection attempts immediately fail with `ECONNREFUSED` / `ECONNRESET`.

### MW.09.01.01.01.A2: Mac↔Windows 실제 pairing/취소/해제 후 현재 PC 제어가 독립적으로 유지된다.
- **Status:** PASSED
- **Test Command:** `node --test tests/lan-pairing.test.mjs`
- **Evidence:**
  - Mac (`darwin`, `host_22222222222222222222222222222222`) and Windows (`win32`, `host_11111111111111111111111111111111`) hosts configured with independent identities and Ed25519 keypairs.
  - **Pairing Initiation & Cancellation:** Pairing initiated with 6-digit PIN and cancelled; subsequent verification throws `invalid_pairing_state` / `cancelled`. Local control on Windows unaffected.
  - **Mutual Pairing via HTTP Handshake:** Mac initiates pairing to Windows `/peer/pair/initiate`, receives PIN and pairing ID, completes `/peer/pair/verify` with mutual exchange of public keys and host metadata.
  - **Authenticated Peer Query:** Mac queries Windows `/peer/status` using Ed25519 signature over `timestamp:method:url:body`; Windows verifies signature and returns host status.
  - **R-TARGET Invariance:** Mac's local draft remains pinned to `macSessionKey` throughout pairing and queries.
  - **Unpair / Revocation:** Mac unpairs from Windows via `/peer/unpair`; Windows removes Mac from paired hosts; subsequent requests from Mac are rejected with `401`.
  - **Local PC Control Independence:** After unpairing, Windows continues executing local commands via `winSessionService.sendPrompt` and Mac continues managing local drafts independently.
