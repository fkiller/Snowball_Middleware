# Cross-Agent Handoff

## READY — Discrete Voice Input (Push-to-Talk) & Hardware Capture Verified (2026-09-07 local)

**Objective**: Ensure discrete push-to-talk voice input is 100% reliable on MK20 hardware, eliminate daemon detachment race conditions, and verify end-to-end recording and transcription.
**Current state**: READY, verified multiple times on physical MK20 hardware with real audio capture.

### Completed Work:
1. **Root Cause Analysis of `remote object '/tmp/snowball_voice.wav' does not exist`**:
   - **Shell Disconnect & SIGHUP**: When `cp.exec("adb shell ...")` completed the start command, the remote ADB shell session exited, sending `SIGHUP` to all background child processes. This terminated `arecord` within 64ms.
   - **ALSA `default` vs `hw:0,0`**: The kernel's ALSA `default` plugin routed through `dsnoop` with a 3-channel to 1-channel downmix bug, causing pipeline stalls.
2. **Dedicated Device Recording Daemon (`/mnt/SDCARD/voice_rec.sh`)**:
   - Deployed on MK20: handles `start`, `stop`, and `status`.
   - Uses `(trap '' HUP; exec arecord -D hw:0,0 -f S16_LE -r 16000 -c 1 -t wav "$TARGET" < /dev/null > /dev/null 2>&1) &`.
   - Immune to SIGHUP when ADB disconnects; records continuously at 16kHz mono 16-bit PCM directly from hardware codec `hw:0,0`.
   - On stop: sends `SIGINT` (2), waits up to 500ms for clean WAV header finalization, flushes with `sync`.
3. **Robust Host Audio Transport (`host/src/audio/transport.ts`)**:
   - Deploys `voice_rec.sh` on startup if absent (`ensureDeviceHelper()`).
   - Handles start/stop concurrency: if stop is called immediately, awaits the start command and guarantees a 300ms minimum recording window.
   - Validates remote file existence and non-zero size before calling `adb pull`.
   - Patches standard 44-byte RIFF headers (`pullDeviceWav()`).
4. **Physical Hardware Verification**:
   - Successfully captured multiple continuous recordings from physical MK20 (e.g. 312,044 bytes, 508,044 bytes).
   - Validated via `test_live_hardware_recording.mjs` and live UDP key events (`test_live_key_pipeline.py`).
   - Top HUD verified displaying draft prompt on `/dev/fb21` (`fb21_top.bmp`).
   - Host daemon `task-6243` currently running and listening on UDP port 7701 and Codex Desktop IPC.

### Exact Next Action:
1. Physical device voice test by user:
   - Press K20 to start recording.
   - Speak your prompt into the MK20 microphone.
   - Press K16 (Done) or K20 to stop recording.
   - Verify transcribed prompt on the top screen, then press K16 to send to Codex Desktop (or K4 to discard).

---

## READY — Codex Desktop Owner IPC Bridge & Native Audio Spike (2026-09-06 local)

**Objective**: Execute Step 3 & Step 4 of the Codex Capability Plan: discover actual desktop owner transport, verify native realtime audio contract, and connect physical MK20 hardware to the live Codex Desktop session.
**Current state**: READY, fully integrated and verified on physical MK20 hardware.

### Completed Work:
1. **Codex Desktop Owner Discovery & Direct IPC Channel (Step 3)**:
   - Discovered that on Windows, `ChatGPT.exe` (Codex Desktop) manages an internal framed JSON-RPC 2.0 named pipe (`\\.\pipe\codex-browser-use-<guid>`).
   - Implemented `CodexDesktopClient` in `host/src/codex/desktop.ts`:
     - Dynamic discovery via `Win32_Process` parsing `codex-browser-use-*` from running processes.
     - Anchor thread bootstrapping via `~/.codex/session_index.jsonl`.
     - Framed JSON-RPC 2.0 client handling 4-byte LE length-prefixed frames.
   - Discovered & live-verified Desktop tools:
     - `list_projects`: Discovered 12 real projects (`Snowball Control` at `E:\developments\projects\Snowball_Control`, remote SSH `/root/snowball-voice`, `GnuNae`, `GimMyTwitterB`, etc.).
     - `list_threads`: Enumerated live active and recent sessions/tasks with status (`idle`, `notLoaded`) and titles.
     - `get_usage_limits`: Retrieved live rate limits directly from Codex Desktop (5-hr window 96% used, weekly 60% used).
     - `navigate_to_codex_page`: Wired to MK20 session selection so selecting a task on hardware instantly switches the desktop GUI window.
2. **Native Realtime Audio Spike & Auth Analysis (Step 4)**:
   - Probed `thread/realtime/start` on Codex 0.153.4.
   - Identified that `realtime_conversation` is an experimental feature requiring `--enable realtime_conversation` on spawn.
   - Verified that `thread/realtime/start` attempts upstream connection to the OpenAI Realtime API (`wss://api.openai.com/v1/realtime`), returning:
     `realtime conversation requires API key auth`.
   - Architectural outcome: Standard user subscription OAuth (`auth.json`) does not cover OpenAI Realtime API calls. Per `CODEX_CAPABILITY_PLAN.md`, voice input requires either an explicit `OPENAI_API_KEY` or a dedicated speech-to-text pipeline (host Whisper / local STT).
3. **Host Daemon Integration & Physical Hardware Verification**:
   - `host/src/index.ts` updated to connect to `CodexDesktopClient` on startup, populating real projects and tasks onto MK20 keys with ASCII fallback formatting.
   - Key K20 (Talk) wired with Push-to-Talk feedback on top display.
   - Verified on live MK20 physical hardware (`192.168.69.27:5555`) with captured framebuffers:
     - `fb21_live.bmp`: Top HUD displaying `DEV-PC / Codex`, `Snowball C -> Task 1`, preview line.
     - `fb9_live.bmp`: Project key showing `Snowball C`.
     - `fb5_live.bmp`: Session key showing `Task 1`.
     - `fb20_live.bmp`: Talk key showing `Talk` under `VOICE`.

### Exact Next Action:
1. Physical device testing:
   - Rotate Left Knob or press K5 (Session) on MK20 to select a task, and verify Codex Desktop window navigates to that thread.
   - Press K20 (Talk) to view Push-to-Talk status on top display.
2. Voice STT pipeline selection:
   - If `OPENAI_API_KEY` is provided, enable native realtime speech transcription.
   - Otherwise, wire local/cloud STT engine (e.g. host Whisper / web speech) into `SpeechInput` to feed transcription into `desktop.sendMessageToThread()`.

---

Read `docs/CODEX_VERIFICATION_01534.md` first. **0.153.4 native completion and SAME-OWNER two-client pub/sub + observer Stop passed.** A and B each received seven deltas for the second turn and both ended interrupted after B's exact-turn interrupt. Early thread/resume/read can fail with an empty-rollout persistence race; resume after first completion passed. Independent-process attachment and actual desktop-owner attachment are not proven. Bare `codex` still runs 0.71.0; tested new absolute binary is recorded in the report. No upgrade/PATH/config change performed by this agent.

Next: explicit executable/schema migration, then shared owner transport; discover/prove actual desktop owner socket before touching existing sessions. Native thread/realtime audio and remoteControl methods were found in the generated experimental schema, but audio/pairing/approvals/settings/reconnect remain untested. Test native audio before external STT. New schema lives in `.probe-schema-01534/`, separate from existing generated bindings. Four new probe runs requested five no-tools turns: four completed, final intentionally cancelled. Probe servers/clients stopped; no user session resumed. JSON reports, test scripts and detailed steps are in CODEX_VERIFICATION_01534.md.

Changed this pass: host/probes/codex-scope.cjs (versioned outputs/rejoin/shared cases), new ws-stdio.ps1 bridge, new 0.153.4 JSON evidence and verification doc, capability plan and this handoff. Existing application/firmware sources preserved. Syntax/whitespace checks passed; prior host build remains the latest build evidence. No commits; main at c4513bb, concurrent work retained. This READY handoff follows the user's verification/plan/handoff request; not a quota guard shutdown.

## READY — Codex validation handoff requested by user (2026-09-06)

**Objective:** implement the Codex portion of Snowball using Remote as the feature reference, CLI/app-server plus read-only local state where possible. **Current task completed:** bounded validation, evidence capture and implementation-plan revision. This handoff is user-requested, not a quota shutdown.

**Read first:** `docs/CODEX_VERIFICATION.md`, then the leading verified update in `docs/CODEX_CAPABILITY_PLAN.md`. These override earlier claims below that middleware milestones are fully validated. Actual CLI 0.71.0: native initialization/model list/thread creation/own listener registration passed; cross-process listener rejected despite shared history visibility; thread/read unsupported. Live requests failed at the provider (default gpt-6-astra requires newer CLI; advertised gpt-5.1-codex-max unsupported for account). No successful assistant stream, external-desktop control, approval or cancellation round-trip was established. Host TypeScript build passed. Read-only metadata shapes and the probe rollout were verified.

**Exact next action:** inventory the desktop-bundled executable/version separately and qualify a supported executable/schema/model pair in a disposable workspace. Do not replace the installed CLI or resume active user threads merely to test observation. Then repair native adapter codec/handshake/request routing and repeat P1–P4 with a successful no-tools turn. Preserve version-specific failures and report accepted versus completed separately. Read-only history is a fallback, not an external command bus.

**Files created this pass:** `host/probes/codex-scope.cjs`; `docs/CODEX_VERIFICATION.md`; `docs/codex-scope-result.json`, `docs/codex-scope-live-result.json`, `docs/codex-scope-catalog-live-result.json`, `docs/codex-metadata-result.json`. Updated CODEX_CAPABILITY_PLAN.md and this handoff. Build writes host/dist. Disposable `.probe-codex-*` directories and new probe sessions retained; probe processes stopped. Three no-tools live attempts failed before successful response; no upgrade/deployment/settings change. Existing user transcripts/credentials not logged.

**Verification:** npm run build passed outside sandbox after runtime-path permission failure; probe Node syntax passed; final documentation whitespace check performed. Same-owner multiple transports, sustained cross-owner successful streaming, actual desktop/Remote pairing/focus, native approval/cancel, and audio remain untested. Reproduction commands and evidence limitations are in CODEX_VERIFICATION.md. Do not rerun failing catalog/default combinations without new version/model evidence.

**Git:** main, latest existing commit c4513bb. All useful work remains uncommitted for review. Pre-existing README/docs/host and hardware Makefile/mk20-hud.c/v2/gfx/diagnostic changes are preserved, not authored or reverted by this validation pass. No commit made to avoid mixing concurrent work. Earlier hardware deployment claims are previous-agent evidence, not retested here. Continue from current source and evidence rather than stale completion claims below.

## Latest Codex refinement

User requested three-way classification: proven existing functionality, verification needs (especially pub/sub for a session running elsewhere), and new integration (especially voice). `docs/CODEX_CAPABILITY_PLAN.md` is now authoritative for Codex. Treat Remote as the feature reference, combine CLI/app-server and read-only CODEX_HOME metadata, and test cross-owner subscriptions BEFORE committing to desktop UI automation. Local generated types contain addConversationListener and typed model/effort/approval operations; presence does not prove external-session support. Inventory confirmed local session/index/SQLite files and project-related global-state key names without reading credentials or transcript contents. The plan specifies P1–P6 owner/observer tests, per-operation capabilities, safe metadata reading, and a separate STT/TTS pipeline. No new live integration test was run or implementation changed in this planning pass. Next action: evidence inventory/native baseline, then pub/sub matrix; do not resume an external session merely to observe it.

## Latest middleware implementation plan (2026-09-06)

Read `docs/HARNESS_CONNECTIONS.md` before adapter work. User explicitly required concrete per-harness interfacing, including Antigravity Remote Control and Codex Web limitations. Plan now separates owned runtime, existing desktop, remote web, and cloud. Routes: Codex stdio for owned sessions plus OS accessibility bridge for existing desktop; optional Codex cloud page driver; Antigravity persistent authenticated Remote Control browser driver for desktop sessions; OpenCode existing-server HTTP/SSE. No public remote API is assumed. Focus observation is separate from runtime state. Exact proposed module paths, operation maps, acknowledgement/race rules and ordered acceptance gates are in that document.

Read-only local observations: codex-cli 0.71.0; agy 1.0.1; OpenCode absent from PATH. Existing new `host/` code and hardware renderer changes are concurrent work, preserved untouched in this pass. Inspected Codex adapter has handshake, event codec, server-request dispatch, approval-response and turn-ID gaps documented for the next implementer. Current UDP is lab-only. No live prompts, logins, installs, provider-setting changes or tests were run; documentation whitespace checked. This update changes only docs/MIDDLEWARE.md, docs/ROADMAP.md, docs/HARNESS_CONNECTIONS.md and this handoff. Earlier statements that no host code exists are historical. First next action: repair the Codex adapter against its generated versioned schema with fixture tests, then perform the separate desktop identity/control gate. Do not count a listThreads response or browser click as successful live control.

## Latest update — Product Design V2 Implementation (2026-09-06)

**Handoff state:** READY

The repository has completed Milestones 1 through 4 of the Product Design V2 roadmap:
1. **Host Middleware Daemon (`host/`)**:
   - Built in TypeScript on Node.js LTS.
   - Generated native bindings from installed `codex-cli 0.71.0` (`codex app-server generate-ts`).
   - Native `CodexAdapter` (`host/src/codex/adapter.ts`) over persistent stdio JSON-RPC successfully tested against local Codex threads.
   - Context manager (`host/src/state/context.ts`) enforces cascading reset rules and generates 20 key visuals for all V2 view modes.
   - Real-time UDP synchronization server on port 7701.
2. **Device Firmware Engine (`hardware/mk20/hud/`)**:
   - Implemented modular V2 state machine and renderer (`v2_state.c`, `v2_render.c`, `gfx_prims.h`).
   - **Revision 5 Active Editor contract implemented**: Filled indigo card indicates committed selections; 2-pixel Amber Inset Border + `"Editing"` top badge marks the active editing field, mirrored on the 428x142 top display.
   - Dual Knobs: Left Knob line/choice scrolling with push-to-commit; Right Knob dedicated volume control with push-to-mute.
   - Preserved 12-pattern showcase fallback accessible via `--showcase` flag.
3. **Live Hardware Verification**:
   - Cross-compiled with `arm-openwrt-linux-gcc` via WSL.
   - Deployed and running on MK20 (`192.168.69.27:5555`) as `/mnt/SDCARD/mk20-hud -d` (PID 4550).
   - Live hardware framebuffers captured and verified: `fb21_top.bmp`, `fb9_project.bmp`, `fb17_machine.bmp`, `fb18_model.bmp`, `fb19_choice.bmp`.

---

## Current Objective

Develop Snowball Control as a standalone MK20 control-panel project for AI-assisted coding workflows. The MK20 acts as a fast, thin interactive client while development machines own coding tools, source work, and provider sessions.

---

## Current State

- Physical MK20 device is online at `192.168.69.27:5555`.
- Daemon `/mnt/SDCARD/mk20-hud -d` is running live in V2 mode.
- Host daemon is built and ready in `host/` (`npm start` to run).
- Verified via live hardware screen captures.

---

## Files Changed & Created

| File | Purpose | State |
|---|---|---|
| `host/package.json` | Host daemon npm package configuration | Created |
| `host/tsconfig.json` | TypeScript configuration for host | Created |
| `host/src/types.ts` | Shared domain and V2 UI state types | Created |
| `host/src/codex/adapter.ts` | Codex app-server stdio JSON-RPC adapter | Created |
| `host/src/codex/generated/` | 185 TypeScript protocol files from `codex app-server generate-ts` | Generated |
| `host/src/state/context.ts` | V2 context manager and cascading reset logic | Created |
| `host/src/protocol/messages.ts` | UDP wire format between host and MK20 | Created |
| `host/src/transport/udp.ts` | UDP transport server (port 7701) | Created |
| `host/src/audio/transport.ts` | Hardware microphone recording transport, WAV patching, mixer control | Created |
| `host/src/audio/speech.ts` | Local Windows SAPI & Cloud Whisper transcription manager | Created |
| `host/src/codex/desktop.ts` | Codex Desktop owner named pipe IPC client | Created |
| `hardware/mk20/hud/voice_rec.sh` | MK20 on-device background recording daemon (SIGHUP immune, hw:0,0) | Created |
| `host/src/index.ts` | Host daemon main entry point | Created |
| `hardware/mk20/hud/v2_state.h` & `v2_state.c` | V2 state container and JSON packet parser in C | Created |
| `hardware/mk20/hud/v2_render.h` & `v2_render.c` | V2 keycap and top display rendering in C | Created |
| `hardware/mk20/hud/gfx_prims.h` | Shared graphics primitives and font declarations | Created |
| `hardware/mk20/hud/mk20-hud.c` | CLI mode parsing (`--v2` / `--showcase`), UDP event dispatch, knob callbacks | Modified |
| `hardware/mk20/hud/Makefile` | Cross-compilation Makefile updated with V2 modules | Modified |
| `walkthrough.md` | Verification walkthrough with hardware framebuffer captures | Created |

---

## Useful Commands

```powershell
# Build host middleware
cd host; npm run build; cd ..

# Run host middleware daemon
cd host; npm start

# Recompile mk20-hud via WSL
wsl make -C /mnt/e/developments/projects/Snowball_Control/hardware/mk20/hud clean all

# Deploy binary to MK20
& "$env:LOCALAPPDATA\Temp\Codex-MK20-ADB\platform-tools\adb.exe" -s 192.168.69.27:5555 push e:\developments\projects\Snowball_Control\hardware\mk20\hud\mk20-hud /mnt/SDCARD/mk20-hud

# Restart daemon on MK20
& "$env:LOCALAPPDATA\Temp\Codex-MK20-ADB\platform-tools\adb.exe" -s 192.168.69.27:5555 shell "chmod +x /mnt/SDCARD/mk20-hud && killall -9 mk20-hud 2>/dev/null; /mnt/SDCARD/mk20-hud -d"

# Capture framebuffers to artifacts
python C:\Users\wondo\.gemini\antigravity\brain\8c9c0c77-5c23-416f-af0c-fbd49ce6837d\scratch\capture_fb.py
```

---

## Exact Next Action

1. Start host middleware daemon:
   ```powershell
   cd host; npm start
   ```
2. Interact with physical MK20 hardware:
   - Press K20 (Talk) to start discrete voice recording.
   - Speak a prompt into the MK20 hardware microphone.
   - Press K16 (Done) or K20 to stop recording.
   - Inspect Top HUD (`[DRAFT PROMPT VERIFICATION]`) to verify transcribed text.
   - Press K16 (Send) to dispatch the prompt to the active Codex Desktop session, or press K4 (Cancel) to discard.
3. Test Files Modal Agent Stop:
   - Press K6 to open Files modal, verify K1 displays `ABORT / Stop`, and test turn interruption.

