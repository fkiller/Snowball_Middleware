# MK20 native dictation verification — 2026-09-08

## Evidence and limits

| Stage | Result | Evidence |
|---|---|---|
| PC microphone → native Codex dictation → external editable draft | User verified, September 7 | Korean-English utterance recorded in PoC README; one observed Stop-to-draft change of 1.7s |
| MK20 MIC3 → framed TCP → Windows PCM | Passed | mk20-stream-mic3-result.json: 66560 bytes, 104 frames, sample-clock ratio 0.965 |
| Wrong nonce rejected; disconnected client cleans up | Passed | mk20-stream-reject-result.json, mk20-stream-disconnect-result.json |
| Windows C# streaming client and owned Stop | Passed | mk20-live-client-result.json |
| CABLE Input → CABLE Output | Blocked | September 8 device inventory has no VB-CABLE endpoints; probe fails with exit 1 |
| MK20 → virtual microphone → Codex transcript | NOT VERIFIED | Requires driver installation, native microphone selection, and spoken acceptance |

The firmware emits about three times the expected bytes when asked for mono. Capture now explicitly requests three channels at 16kHz and selects MIC3 from each six-byte frame. Earlier mono capture/framing reports do not establish correct audio timing; mk20-stream-result.json and mk20-owned-capture-result.json are superseded for sample-clock acceptance. MIC3 was chosen from ambient levels, not a spoken quality comparison.

## Implemented route

MK20 arecord (owned child, 60-second bound) → pcm-stream helper (loopback only, single-use random nonce) → ephemeral ADB forward → C# framed PCM reader → NAudio CABLE Input → Codex-selected CABLE Output → normal global dictation shortcut → editable PoC draft.

Binary audio never passes through legacy ADB shell text. No global killall, mixer changes, HUD replacement, credential extraction, private API invocation, or agent submission. The ADB route is a laboratory transport, not production pairing/TLS. Live audio stays in memory; bounded recording mode temporarily uses uniquely owned device/local files and removes them during cleanup.

## Exact acceptance sequence

1. Install official VB-CABLE through its normal Windows administrator prompt. Prepared signed installer: `%LOCALAPPDATA%\SnowballControl\dependencies\vb-cable\VBCABLE_Setup_x64.exe`. Prior signature check: Valid, BUREL VINCENT. Reboot if the installer requires it. No installation success has been observed.
2. Build the PoC and run `--probe-cable report.json`. Require pass=true and exit 0. This synthetic-tone loopback is not a transcription test.
3. In Codex Voice settings choose CABLE Output and toggle shortcut Ctrl+Alt+Shift+F9. Preserve the original microphone selection for restoration; do not change Windows default audio devices.
4. Run the PoC; press 시험 음성 전사. Observe the native overlay and known fixture text in the draft. Do not type the expected text as evidence.
5. Test MK20 bounded recording, then live mode. Speak Korean-English coding text only after ready appears. Stop, inspect/edit draft, verify no coding turn was submitted.
6. Record accuracy, missing initial/final words, timing, disconnection recovery and repeated runs. Only then integrate into destination-bound middleware draft lifecycle.

## Current limitations

The native shortcut provides no authoritative start/stop acknowledgment. Fixed startup delay is provisional; an error or focus change requires inspection of the native overlay, not blind toggle retries. September 7 UI automation returned black screenshots/access denied; no expanded PoC visual acceptance has been recorded. September 8 rechecked audio endpoints still lack the driver. Native insertion target is focus-dependent. Product-grade destination ownership, secure multi-host transport and model/effort/access remain independent work described in REVIEW_2026-09-07.md and VOICE_ARCHITECTURE.md.

## Latest validation

September 8: .NET Release build and local speech fixture generation passed, zero warnings/errors. Missing-driver diagnostic returns pass=false and process exit 1. Startup completion observation now runs after releasing the busy guard; resetting a timed-out draft also re-enables bridge controls. These UI recovery changes are build-checked, not visually exercised. No broad host daemon or unrelated test suite was started.
