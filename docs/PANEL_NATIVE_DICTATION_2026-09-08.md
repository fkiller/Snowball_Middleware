# MK20 panel → native dictation PoC — 2026-09-08

## Implemented

Windows PoC can own the existing laboratory UDP 7701 panel connection using --panel or the 장치 연결 button. It refuses a conflicting bind rather than starting a second owner. Only packets from 192.168.69.27:7701 are accepted; malformed packets and repeated key-down without release are ignored. This source filter is not secure pairing; no production trust claim.

K20 Talk starts the owned MK20 live PCM / virtual cable / normal Codex dictation route. K20 or K16 finishes. K4 Cancel stops the capture and quarantines late insertion, restoring the draft that existed before capture. Cancel during preparation is queued. After cancellation the user must confirm native dictation has finished before Reset; a global toggle has no authoritative native cancel acknowledgment. Editing while quarantined is intentionally blocked by draft restoration. No agent Send operation exists.

The panel shows a clearly separate VOICE TEST / DRAFT PAD context, not real project/session controls. Other keys are disabled. The top screen shows phase and instructions, not Korean transcript rendering; review/edit is in Windows. It publishes every second so the HUD heartbeat can distinguish an absent owner. Closing the app releases the port and the HUD becomes disconnected after its timeout.

## Running state

Initial panel build launched with --panel as PID 44264 (verify fresh before any process action). UDP 7701 ownership observed. The user was asked for a physical Talk → Korean-English utterance → Finish trial. Result is pending; do not infer native MK20 success from transport or earlier fixture success.

Current source and newer build at artifacts/panel-next additionally retain Cancel after a completed draft and show Review draft in Windows. The already running artifacts/panel process has not been interrupted, to preserve a user trial/draft. After finishing the trial, close that app normally and launch panel-next with --panel, or click 장치 연결. Do not run competing panel owners.

## Build / verification

`& host/poc/native-dictation/Build-Poc.ps1 -OutputDirectory host/poc/native-dictation/artifacts/panel-next`

`dotnet host/poc/native-dictation/artifacts/panel-next/Snowball.Dictation.Poc.dll --probe-panel docs/panel-protocol-result.json`

`& host/poc/native-dictation/artifacts/panel-next/Snowball.Dictation.Poc.exe --panel`

Release build passed, zero warnings/errors. Loopback protocol probe passed: expected key events [20,20,16], 1379-byte 20-key sync, foreign endpoint rejected, duplicate downs suppressed, release re-arms, malformed/out-of-range messages ignored. This test performs no hardware actions or dictation. Previously passed MK20+Cable transport and user fixture-to-Codex tests remain separate evidence.

Physical Talk, Finish, Cancel before/after transcript, late-result quarantine, focus changes, error recovery, and full live recognition still require acceptance. No Windows UI screenshot verification this step. Current native shortcut remains Ctrl+Alt+Shift+F9 and Codex input CABLE Output; setup is not automatic. Existing host TypeScript destination-bound draft module remains separate from this isolated PoC. Do not start its legacy shared-file recorder/global-stop implementation concurrently.
