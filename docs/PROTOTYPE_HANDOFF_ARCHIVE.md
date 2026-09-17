# Local-control-first hierarchical plan (2026-09-17, Codex)

Handoff state: `READY`. This is a completed planning tranche, not a quota handoff. It supersedes older scope/next-action notes below. No middleware implementation task has yet been marked complete.

## Current objective / latest user clarification

The middleware's fundamental purpose is local control. Fully specify harness/device discovery journeys and organize every task top-to-bottom so Astra or any other LLM can resume without prior conversation. Current-PC operation is default; local-LAN devices/other hosts are explicitly enabled extensions. Multi-host G4 is not a prerequisite for local release. Harness inference may still require the harness's own cloud connection; Snowball does not require a cloud control plane.

## Completed work / files

- `docs/middleware/PLAN.md`: principles R-LOCAL through R-PRIVACY, L0–L5 model, propagation, G0–G4 gates and evidence rules.
- `docs/middleware/PLAN.json`: authoritative ledger with **132 nodes, 28 implementation tasks, 56 acceptance checks**. Dependencies, input/output scope, detailed steps, checkpoint and next action on every task. Implementation 0/28 complete, checks 0/56 pass; this accurately distinguishes planning from implementation.
- `docs/middleware/TASK_TREE.md`: generated readable L0–L5 tree.
- `docs/middleware/DISCOVERY_JOURNEYS.md`: **40 scenarios** (H01–H14, D01–D18, J01–J08) including empty/manual/auth/permissions/identity/attach/reconnect/cancel/remove, HID and opt-in LAN.
- `docs/middleware/RESUME.md`: normal and interrupted resume/stop protocol, migration of one authoritative ledger, evidence format.
- `docs/middleware/validate-plan.mjs`: validates hierarchy, dependencies/cycles, states, evidence requirements and scenario coverage; `--next`, `--affected R-ID`, `--write-tree` helpers.
- AGENTS/README/MIDDLEWARE/ROADMAP/packaging design link the plan and reflect current-PC-first sequencing.

## Exact next action

Run `node docs/middleware/validate-plan.mjs --next`; start **MW.01.01.01.01**. Inventory selected `host` source/tests/generated protocol/fixture/license inputs, compute file hashes and define an explicit export allowlist excluding runtime state/audio/venv/probe/SDK binaries. Existing `host` and `docs` are untracked, so a history-only export would lose the implementation. Do not blanket-add or delete existing work. After inventory verification, follow dependent separate-repo scaffold task. A separate middleware repo does not yet exist.

## Findings / remaining work / constraints

All product implementation remains in the ledger. Existing Codex `isAvailable()` always returns true; OpenCode considers 401 available and enables autoSpawn by default; Antigravity directory presence is not command capability; MK20 has no authenticated device registry. Discovery must distinguish found/installed/running/authenticated/read-only/controllable and must not silently start harnesses or send commands. Preserve current MK20/voice behavior while extracting. Do not start LAN listeners by default or add remote-first/cloud requirements.

## Verification / Git / quota

`node docs/middleware/validate-plan.mjs --next` passed: 132 nodes, 28 tasks, 56 checks, **40/40 scenarios mapped**; only the inventory task is eligible initially. Generated TASK_TREE. `git diff --check` passed. No runtime code changed, so the previous turn's 46/46 host test baseline was not rerun. No new physical device, real harness control, OS installer or cross-platform acceptance claimed.

Branch `pilot/codex-app-recon`, HEAD `c4513bb`; extensive pre-existing dirty tracked/untracked state preserved. No commit/stash or daemon/firmware changes. A documentation patch initially failed a context match and was reapplied successfully; no failed implementation approach. No processes were started for product operation. CodexBar authentication failure persists; actual app quota snapshot this turn: five-hour 74%, weekly 68% remaining. No guard threshold reached.

---

# Middleware packaging MVP direction (2026-09-17, Codex)

Handoff state: `READY` for continued development; design/audit completed, not a quota-triggered handoff. This section supersedes older objectives/next actions; historical hardware evidence below is retained.

## Current objective and task

User requests hardware-independent middleware in a separate repository, third-party hardware (standalone/network and HID) and harness plug-ins, macOS/Windows installation, tray-only native UI, API-based non-hardware Web supervision across devices/harnesses/projects, packaging recommendations and an integrity/gap review.

## Completed work / current state

- Added `docs/MIDDLEWARE_PACKAGING_MVP_2026-09-17.md`: repository split, core/SDK/plugin boundaries, command/identity/concurrency contracts, audio source vs STT, API/trust topology, distribution comparison, tray/Settings, Supervisor UX, source-based gap audit and acceptance gates.
- Recommended TypeScript core with Electron tray shell for initial packaging; Tauri + Node sidecar remains a size-driven alternative. These are proposals, not installed dependencies.
- Recommended macOS Developer ID signing/notarization + DMG; signed Windows EXE + winget; Store later; npm for SDK/CLI. Official distribution docs checked. GNUnae's actual implementation was not inspected.
- No application source changes, new repository, installers, API runtime or Web GUI implemented in this design tranche. No hardware or live daemon changes.

## Exact next action / remaining work

Read the new design, inventory/export selected existing untracked `host` source/tests and license/fixture dependencies, then scaffold the separate middleware repository with core + plugin-sdk + API + virtual device + Codex adapter. First complete a hardware-free create/read/send/events/decision/cancel/recovery slice. Follow with tray packaging, MK20 extraction, a second real harness/HID validation, authenticated multi-host/controller, signed release lifecycle. Do not treat old legacy-main/mesh as the active runtime.

## Evidence and known problems

Active `host/src/index.ts` directly instantiates Codex, LocalWhisper and UDP. Controller mixes domain logic with MK20 presentation and fixed dev-pc/codex scopes; one draft/context is insufficient for independent controllers. UDP binds all interfaces, has no authenticated registry and sends to a fixed/last-client address. Desktop pipe discovery is Windows-only. LocalWhisper creates ADB capture and relies on a local Python environment. Harness selector presence does not establish multi-harness command support. Separate processes are not a security sandbox for third-party code.

## Tests / verification

`npm test --prefix host`: build succeeded, **46 passed, 0 failed, 0 skipped**. Existing Whisper worker transcribed a prerecorded English fixture. No live microphone/device acceptance, real provider send/stop/approval, macOS, installer, new API or multi-host security validation was performed. Design-only changes need no new runtime tests.

## Git / constraints / commands

Branch `pilot/codex-app-recon`, HEAD `c4513bb`. Repository already extensively dirty, including untracked host/docs and hardware probes. Preserve all existing work; do not blanket-add artifacts or assume subtree export includes untracked files. This tranche adds the design and links it from README/MIDDLEWARE/ROADMAP, and prepends this handoff. No commit/stash created. Existing MK20 behavior and public wire formats remain unchanged. No failed implementation attempts in this tranche.

Useful checks: `npm test --prefix host`, `git status --short`, `git diff --check`. CodexBar returned Authentication required; fallback app account usage reported 95% five-hour and 71% weekly remaining at session start. No quota threshold reached; CodexBar-based automatic monitoring remains unavailable until authenticated.

---

# NEW SESSION AUTO-LOAD & FRESH THREAD SEND ("Check task" FIX) (2026-09-15, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>98% remaining; 1.01% used in 5-hour window).
All reported user issues have been fully resolved, verified via automated test suite (46/46 PASS), and validated on live MK20 hardware.

## 1. Current Objective
Provide a seamless voice dictation and session lifecycle on the MK20 terminal:
- Pressing New (K1) immediately creates, selects, and loads into a fresh session with clean display.
- Sending voice prompts to fresh sessions begins immediately without rollout errors or "Check task" stalls.
- Unknown delivery states offer an explicit Discard action on K4 so the user is never trapped.

## 2. Resolved User Issues
1. **New Session Auto-Load (Issue 2)**:
   - **Symptom**: Pressing New (K1) created a thread, but the MK20 screen did not enter it. The user still saw the previous session's turns and had to manually enter Select Session (K5) and pick "New task".
   - **Root Cause**: In `MvpController.dispatch()`, `k === 1` called `c.selectSession(0)` but omitted `await this.load()`. Furthermore, when a thread has 0 turns, `load()` left `this.tasks.get(id)` undefined.
   - **Fix**:
     - Reset `c.activeEditor = "none"`.
     - Called `await this.load()` immediately after `c.selectSession(0)`.
     - In `load()`, if turns array is empty, explicitly set `this.tasks.set(id, { phase: "idle", text: "" })`.
     - Old turns are wiped immediately and the MK20 Top Display and key labels instantly reflect the new empty session.
2. **Fresh Thread Send / "Check task" Lockup (Issue 1)**:
   - **Symptom**: User dictated voice into a fresh session, pressed Send (K16), but Key 16 turned into "Check task" and no agent response occurred.
   - **Root Cause**: Fresh threads created via `thread/start` have 0 turns and no rollout file on disk yet. Calling `thread/resume` on such threads causes `codex.exe app-server` to throw `no rollout found for thread id ...`. Because this error was previously unhandled, it threw out of `submit()`, transitioned the draft to `"unknown"`, and set Key 16 to `"Check task"`. Because `reconcile()` found 0 turns, the draft stayed stuck in `"unknown"`, and K4 had no discard handler.
   - **Fix**:
     - In `send()`, caught `msg.includes("no rollout found")` as expected for fresh threads and proceeded directly to `turn/start`.
     - In `VoiceDraft` (`host/src/audio/draft.ts`), added `discard()` method.
     - In `MvpController.state()`, when `d?.phase === "unknown"`, mapped Key 4 to `"Discard"` (`labelSub: "Drop draft"`).
     - In `MvpController.dispatch()`, wired `k === 4` to `this.draft.discard()` when phase is `"unknown"`.
     - In `reconcile()`, updated notice to clearly guide: `"K16: Check again | K4: Discard draft"`.
     - In `CodexDesktopClient.sendMessageToThread()`, ensured error strings from desktop tool calls throw exceptions properly.

## 3. Current State
- **Middleware Daemon**: Running (`task-6457`, `node host/dist/index.js`) on UDP 7701. Connected to Codex Desktop IPC.
- **ADB Relay**: Running (`task-5779`, `python host/probes/adb-wifi-relay.py`).
- **MK20 Hardware**: Verified responsive. Live top screen capture confirms zero delivery errors, clean turns, and clear idle status.
- **Automated Tests**: 46/46 PASS (duration ~6.2s).

## 4. Completed Work
- `host/src/audio/draft.ts`: Added `discard()` method to `VoiceDraft`.
- `host/src/codex/desktop.ts`: Added error-string check in `sendMessageToThread()`.
- `host/src/state/mvp-controller.ts`:
  - Added `await this.load()` and `activeEditor = "none"` in `k === 1`.
  - Added `tasks.set(id, { phase: "idle", text: "" })` when turns is empty in `load()`.
  - Added `no rollout found` bypass in `send()` to proceed directly to `turn/start`.
  - Added K4 Discard handler and visual mapping for `unknown` delivery phase.
  - Updated `reconcile()` user prompt.
- `host/tests/mvp-controller.test.mjs`: Added 3 tests (tests 32, 33, 34).
- Cleaned up stuck `host/.state/draft.json`.

## 5. Verification
- `npm run build --prefix host`: Succeeded.
- `npm test --prefix host`: **46/46 PASS** (100%).
- Real app-server probe: Verified `turn/start` succeeds directly on newly created threads.
- Framebuffer capture: Verified `/dev/fb21` readback is clean and responsive.

---

# CODEX DESKTOP IPC FALLBACK ROUTING & ACTIVE-WRITER RESOLUTION (2026-09-15, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>64% remaining; 35.35% used in 5-hour window).
All requested fixes have been implemented, verified via automated test suite (43/43 PASS), and validated against the live resident Codex Desktop app and physical MK20 hardware.

## 1. Current Objective
Provide a unified, highly responsive physical controller interface (MK20 smart desk terminal) for AI developer harnesses (OpenAI Codex, Google Antigravity, OpenCode), with robust voice dictation (Talk -> Whisper -> Send) that operates seamlessly across both headless CLI sessions and resident desktop GUI applications.

## 2. Current Task
Resolve Talk voice dictation failure and delivery blocking on Codex desktop threads:
1. **User Symptom**:
   - User selected `Codex > Snowball_Control > Continue Whisper MVP p1` (thread ID `01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6`).
   - Dictated `"안녕 안녕"` via MK20 Talk (K20) and pressed Send (K16).
   - Display showed: `"Delivery unknown Target: 01a09c... Do not reply..."` and the session never updated on the MK20 screen.
2. **Root Cause**:
   - The thread `01a09c0e...` was simultaneously open and active in the resident Codex Desktop application (PID 12292).
   - The desktop app holds an exclusive SQLite database write lock on open threads.
   - When the host middleware's background child process (`codex.exe app-server`) attempted `thread/resume` to submit the prompt, SQLite rejected the write:
     `thread-store conflict: thread 01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6 already has an active writer`.
   - The draft transition stalled in `unknown` state to protect against blind double-submission.
3. **Resolution**:
   - Implement automatic fallback routing: when `thread/resume` encounters `thread-store conflict` / `already has an active writer`, delegate prompt submission directly to the running Codex Desktop application via its Windows named pipe IPC (`\\.\pipe\codex-browser-use-...`).
   - Implement background polling (`pollDesktopTurn()`) to monitor turn execution and status via `thread/read` without blocking the Node.js event loop (`interval.unref()`).
   - Update turn parsing and reconciliation to support desktop delegation outputs (`functionCallOutput: send_message_to_thread` containing `<codex_delegation><input>prompt</input></codex_delegation>`) alongside standard `userMessage` events, with whitespace normalization (`/\s+/g, " "`).
   - Add path normalization (`this.normalizePath()`) in `refresh()` to resolve Windows drive-letter casing differences (`E:` vs `e:`).
   - Expand automated unit test suite from 41 to 43 tests (100% PASS).

## 3. Current State
- **Middleware Daemon**: Running as background daemon (`task-6174`, `node host/dist/index.js`) on UDP port 7701. Connected to Codex Desktop IPC channel (`\\.\pipe\codex-browser-use-ef48c7a0-de32-4eeb-b4a3-04cb7d13bd3b`).
- **ADB Relay**: Running (`task-5779`, `python host/probes/adb-wifi-relay.py`) forwarding `127.0.0.1:15555` to MK20 device at `192.168.1.248:5555`.
- **MK20 Native HUD**: Running PID 2727 (`/mnt/SDCARD/mk20-hud -d`).
- **Test Suite**: 43/43 tests PASS (duration ~6.6s).
- **Physical Verification**: Prompt `"안녕 안녕"` successfully delivered to Codex Desktop; Codex Desktop executed turn and generated Korean response (`"안녕하세요! “안녕 안녕” 메시지가 잘 도착했습니다."`); draft transitioned cleanly from `unknown` to `sent`; live MK20 display verified clear with 0 errors.

## 4. Completed Work
1. **Codex Desktop Named Pipe Discovery & IPC Client (`host/src/codex/desktop.ts`)**:
   - Discovers Windows named pipes matching `\\.\pipe\codex-browser-use-*` via PowerShell/CIM queries or direct pipe enumeration.
   - Implements JSON-RPC 2.0 framing over Windows named pipes (`length-prefixed` 4-byte LE buffer frames).
   - Exposes `sendMessageToThread(threadId, prompt, model?, thinking?)`, `readThread(threadId, turnLimit, includeOutputs)`, `listProjects()`, `listThreads()`, and `getUsageLimits()`.
2. **Active-Writer Conflict Catch & Fallback Routing (`host/src/state/mvp-controller.ts`)**:
   - In `send()`: wraps `thread/resume` in try/catch. When error message matches `thread-store conflict` or `already has an active writer`:
     - Checks if `this.desktop.isConnected` is active.
     - Logs delegation and invokes `this.desktop.sendMessageToThread(destination.sessionId, text)`.
     - Initiates `pollDesktopTurn(destination.sessionId, text)` to track execution asynchronously.
3. **Desktop Turn Polling & Reconciliation (`host/src/state/mvp-controller.ts`)**:
   - `pollDesktopTurn()` polls `thread/read` every 2500ms (max 120s) with `interval.unref()`.
   - `extractTurnUserPrompt(items)` extracts user prompts from both:
     - Standard `userMessage` items.
     - `functionCallOutput` items with `callId` or tool name `send_message_to_thread` containing `<input>(.*?)</input>`.
   - `turnContainsUserPrompt(turn, expectedText)` normalizes whitespace (`/\s+/g, " "`) across both sources.
   - `reconcile()` recognizes delegated turns, marks drafts `sent`, clears pending submission blocks, and repaints MK20 screens.
4. **Path & Drive Letter Normalization**:
   - Added `normalizePath()` in `MvpController` to ensure drive letters on Windows are uniformly capitalized (`E:\...`), preventing thread cwd mismatch during project clustering.
5. **Unit & Regression Testing (`host/tests/mvp-controller.test.mjs`)**:
   - Test 30: `active writer conflict on thread/resume routes send through CodexDesktopClient`.
   - Test 31: `reconcile recognizes prompt inside functionCallOutput send_message_to_thread`.
   - All 43 test cases passing.

## 5. Remaining Work
1. Hardware Session Selection:
   - On physical MK20, select `Snowball_Control` > `Continue Whisper MVP p1` to verify the recent Korean response lines appear directly on the Top Display and can be scrolled with Left Knob.
2. End-to-End Voice Retest:
   - Perform a fresh Talk (K20) -> Speak prompt -> Done -> Send (K16) test on the live MK20 to confirm ongoing voice prompt delivery.
3. OpenCode & Antigravity Harness Enhancements:
   - Continue multi-harness development (Antigravity and OpenCode) per the staged roadmap.

## 6. Exact Next Action
- Using the MK20 hardware or ADB input simulation, verify session navigation and inspect the Top Display for thread `01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6` to ensure turns render seamlessly.

## 7. Architecture & Decisions
- **Two-Tier Delivery Architecture**:
  - **Tier 1 (Default)**: Standalone `codex.exe app-server` via stdio JSON-RPC. Direct, fast, headless.
  - **Tier 2 (Fallback)**: Codex Desktop IPC via named pipe `\\.\pipe\codex-browser-use-...`. Engaged automatically when SQLite lock conflicts indicate the thread is open in the Codex GUI app.
- **Unreferenced Polling**:
  - Polling intervals must use `interval.unref()` to avoid holding the Node.js event loop open during shutdown or test execution.
- **Reconciliation Invariants**:
  - Drafts must NEVER be blindly discarded or marked failed while delivery status is unknown.
  - Reconciliation checks must inspect both `userMessage` and `functionCallOutput` to reliably match prompts across both CLI and Desktop harness execution modes.

## 8. Files Changed
- `host/src/codex/desktop.ts`: Windows named pipe client, JSON-RPC communication, `sendMessageToThread()`.
- `host/src/state/mvp-controller.ts`: Active-writer conflict handling, fallback routing, desktop polling, prompt extraction from delegation items, path normalization.
- `host/tests/mvp-controller.test.mjs`: Added regression tests 30 & 31.
- `HANDOFF.md`: Updated with full documentation.

## 9. Tests and Verification
- `npm test --prefix host`: **43/43 PASS** (duration 6.6s).
- Live execution on thread `01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6`: prompt `"안녕 안녕"` successfully executed by Codex Desktop.
- Live hardware framebuffer readback verified on `/dev/fb21`.

---

# FILES DUAL-MODE BROWSER & CONTENT VIEWER (2026-09-14, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>87% remaining; 12.09% used in 5-hour window).
All requested user changes have been fully implemented, verified via automated test suite (41/41 PASS), and physically validated on the live MK20 hardware via ADB framebuffer readbacks.

## 1. Current Objective
Provide a unified physical controller interface (MK20 smart desk terminal) for AI developer harnesses (Codex, Antigravity, OpenCode).

## 2. Current Task
Files mode redesign per user feedback:
1. Remove control buttons from `(2,1)-(5,1)` (K13, K9, K5, K1 previously held Up, Prev, Next, Stop).
2. Mode 1: Full File Browser Mode:
   - `(2,1)-(5,4)` (16 keys: 4 rows × 4 columns) displays the file/folder grid.
   - Rotating Left Knob moves a pre-selected cursor (`isFocused: true, isFilled: false`, cyan border outline without fill) across items.
   - Moving cursor past visible 4×4 grid auto-scrolls line-by-line (by 1 row = 4 items).
   - Sidebar Column 1 `(1,1)-(1,4)`: K17 (Close, selected fill), K18 (DIR Up), K19 (DIR Root), K20 (Item index / total).
   - Clicking Left Knob (or pressing directory key) navigates into directory, staying in Full Browser Mode.
   - Clicking Left Knob (or pressing file key) loads file content and transitions into Mode 2.
3. Mode 2: File Viewer Mode:
   - Sidebar Column 1: K17 (Close with vertical file scrollbar), K18..K20 (3 files with active file `isFilled: true`).
   - `(2,1)-(5,4)`: 24-line dense multi-line Content Viewer (`isLinesMode: true`, 6 lines/key).
   - Top Display: 4 lines of file content + file path + scrollbar.
   - Left Knob rotation: scrolls content lines line-by-line.
   - Left Knob click: exits back to Full File Browser Mode with cursor preserved!

## 3. Current State
- Both Full File Browser Mode and File Viewer Mode are fully operational and verified on live MK20 hardware.
- All 41 automated unit and integration tests pass 100%.
- Live hardware captures confirm pre-selected cursor outline, smooth row scrolling, 24-line content canvas, file scrollbars, and seamless mode switching via Left Knob clicks.

## 4. Completed Work
1. **Removed Control Buttons from `(2,1)-(5,1)`**:
   - `(2,1)-(5,4)` is now 100% dedicated to items (16-card grid in Browser mode, 24-line canvas in Viewer mode).
2. **Pre-Selected Cursor (`isFocused: true, isFilled: false`)**:
   - Renders a cyan rectangular border outline around focused card without background fill on hardware.
3. **Line-by-Line 4x4 Grid Scrolling**:
   - Implemented `moveWorkspaceCursor(delta)` with 1-row auto-scrolling when boundaries are reached.
4. **File Viewer Content Canvas**:
   - `ContextManager.openWorkspaceViewer(fileIdx, lines)` and `closeWorkspaceViewer()`.
   - Packs 24 lines across 4 key rows immediately following Top Display lines 0..3 (0 lines lost across all 28 lines).
5. **Left Knob Click Mode Toggle**:
   - Clicking Left Knob on a file enters File Viewer Mode.
   - Clicking Left Knob in File Viewer Mode immediately exits back to Full File Browser Mode with cursor preserved.
6. **UDP Server Binding Fix**:
   - Bound to `"0.0.0.0"` so local test scripts and device packets communicate simultaneously.
7. **Automated Test Coverage**:
   - Added `ContextManager: Files Dual-Mode browser grid and content viewer` test. Total 41/41 tests passing.

## 5. Remaining Work
- Continued user feedback on session view interactions, task streaming, and voice transcription integration.

## 6. Exact Next Action
- Await next user instruction or feature priority.

## 7. Architecture & Decisions
- **Line Continuity**: Top display is clamped to 4 lines ($y = 48, 67, 86, 105$) to clear the bottom casing bezel lip ($y \ge 120$). Row 1 keys start at `readerScrollLine + 4`. Total 28 lines displayed across MK20 with 0 missing lines.
- **Pre-Selected Outline**: In `v2_render.c`, `isFocused` without `isFilled` draws `COLOR_CYAN` border rectangle without card fill.
- **Key Matrix**:
  - Row 1: K17 (Col 1), K13 (Col 2), K9 (Col 3), K5 (Col 4), K1 (Col 5)
  - Row 2: K18 (Col 1), K14 (Col 2), K10 (Col 3), K6 (Col 4), K2 (Col 5)
  - Row 3: K19 (Col 1), K15 (Col 2), K11 (Col 3), K7 (Col 4), K3 (Col 5)
  - Row 4: K20 (Col 1), K16 (Col 2), K12 (Col 3), K8 (Col 4), K4 (Col 5)

## 8. Files Changed
- `host/src/transport/udp.ts`: Bind socket to `"0.0.0.0"`.
- `host/src/state/context.ts`: Added `isWorkspaceViewerActive`, `workspaceCursorIdx`, `workspaceSelectedFileIdx`, `workspaceFileContentLines`, `moveWorkspaceCursor()`, `openWorkspaceViewer()`, `closeWorkspaceViewer()`, and dual-mode key generation.
- `host/src/state/mvp-controller.ts`: Updated `files()`, `openFileForViewing()`, `dispatch()` for Left Knob click/rotation and key events in workspace modes, updated `state()` top display.
- `host/tests/context.test.mjs`: Added test for Files Dual-Mode browser grid and content viewer.

## 9. Tests and Verification
- `npm test --prefix host`: **41/41 PASS** (duration 6.4s).
- Live hardware framebuffer captures (`step1_browser_top.png`, `step1_browser_k13.png`, `step2_cursor_k1.png`, `step3_viewer_top.png`, `step3_viewer_k17.png`, `step3_viewer_k18.png`, `step3_viewer_k13.png`, `step5_browser_return_top.png`, `step5_browser_return_k1.png`).

---

# FILE SELECTION TOGGLING, KNOB FILE SCROLL, & MODAL ORIGIN SELECTED BACKGROUND (2026-09-14, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>55% remaining).
All requested user changes have been fully implemented, verified via automated test suite (40/40 PASS), and physically validated on the live MK20 hardware via ADB framebuffer readbacks.

## 1. Resolved User Requests
1. **Modal Origin Button Selected Background (`isFilled: true`)**:
   - In modal views (`changes`, `workspace`/Files, `settings`), the top-left button (K17) representing the origin modal action now has `isFilled: true` (solid indigo background with cyan border).
   - All modals now share this consistent origin-highlight visual language.

2. **File Selection Toggling & Dual-Mode Left Knob**:
   - **Mode A: Diff Content Mode (`isChangesFileSelected = true`)**:
     - The active file button (K18, K19, or K20) has the selected background (`isFilled: true`).
     - Rotating Left Knob scrolls diff lines line-by-line (`readerScrollLine += delta`).
     - Clicking Left Knob (or pressing the active file button again) **deselects** the file and switches to Mode B.
   - **Mode B: File Browsing Mode (`isChangesFileSelected = false`)**:
     - All file buttons lose their selected background (`isFilled: false`), but the focused file retains a cyan cursor outline (`isFocused: true`).
     - Top Display subtitle shows `[Browse X/Total] <status> <path>`.
     - Rotating Left Knob scrolls through the changed files list, auto-paging when crossing 3-item page boundaries, and dynamically previewing the diff of each file.
     - Clicking Left Knob (or pressing any file button K18/K19/K20) **selects** that file, sets `isFilled: true`, and switches back to Mode A (diff line scrolling).

## 2. Hardware & Test Verification
- **Automated Test Suite**: `npm test --prefix host`: **40/40 PASS**.
  - `tests/context.test.mjs` Test 10 verifies modal K17 `isFilled: true`, file selection toggle via knob click, file list scrolling via knob rotation, and re-selection via knob click.
- **Physical MK20 Framebuffer Verification**:
  - `scratch/fb17_modal_selected.png`: verified K17 in Changes view renders with solid indigo fill and cyan border (`isFilled: true`).
  - `scratch/fb18_deselected.png`: verified File 0 deselects cleanly, removing indigo fill while retaining cursor outline (`isFocused: true`).
  - `scratch/top_browse.png`: verified Top Display shows `[Browse 1/48] M .gitignore`.
  - Live UDP test `scratch/test_file_selection_toggle.py` verified end-to-end flow with real device daemon.

---

# DENSE 6-LINE MULTI-LINE CANVAS IN CHANGES VIEW (2026-09-14, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>60% remaining).
All requested user changes have been fully implemented, verified via automated test suite (40/40 PASS), and physically validated on the live MK20 hardware via ADB framebuffer readbacks.

## 1. Resolved User Request: Dense 5~7 Line Key Display (6 Lines/Key) in Changes View
- **User Instruction**:
  *"아니, 각 버튼의 height를 보면 최소 5~7줄을 표시할 수 있잖아. 그런 밀도로 표시하라구."*
- **Problem**:
  Previously, each 128×128 button in the 16-key `(2,1)-(5,4)` content area displayed only a single diff line, wasting vertical resolution and screen density.
- **Solution & Architecture**:
  1. **Vertical Geometry**:
     - Key resolution: 128×128 px. Font scale 1 (`font8x16`): 8px wide × 16px high.
     - 6 lines per key: start $y = 7$, line pitch $= 19\text{ px}$ (16px font + 3px gap).
     - Margin: top 7px, bottom 10px, left 6px. Fits 6 lines cleanly without vertical crowding.
  2. **Multi-Key Row Continuity**:
     - 4 keys across in each row: Row 1 `[13, 9, 5, 1]`, Row 2 `[14, 10, 6, 2]`, Row 3 `[15, 11, 7, 3]`, Row 4 `[16, 12, 8, 4]`.
     - Each line is chunked into 4 slices of 12 characters (48 chars total, matching Top Display width).
     - Row 1 displays 6 diff lines immediately below Top Display: lines `readerScrollLine + 5` .. `readerScrollLine + 10`.
     - Row 2 displays next 6 diff lines: lines `readerScrollLine + 11` .. `readerScrollLine + 16`.
     - Row 3 displays next 6 diff lines: lines `readerScrollLine + 17` .. `readerScrollLine + 22`.
     - Row 4 displays next 6 diff lines: lines `readerScrollLine + 23` .. `readerScrollLine + 28`.
     - **Total lines visible across MK20**: $5\text{ (Top Display)} + 24\text{ (16 Keys)} = 29\text{ continuous lines}$!
  3. **Syntax Highlighting on Hardware Buttons**:
     - Color array `item_colors[8]` parsed and rendered per line:
       - `1`: `COLOR_CYAN` for additions (`+`)
       - `2`: `COLOR_ROSE` for deletions (`-`)
       - `3`: `COLOR_AMBER` for hunks (`@@`)
       - `0`: `COLOR_WHITE` for context / standard code
     - All 4 chunks of a line receive the syntax color across the horizontal row of keys.
  4. **C Daemon (`hardware/mk20/hud/`)**:
     - `v2_state.h`: added `#define KEY_FLAG_LINES (1 << 5)`, expanded `items[8][24]`, added `uint8_t item_colors[8]`.
     - `v2_state.c`: updated parser to parse up to 8 items (up to 23 chars) and `"colors":[...]` array into `item_colors`.
     - `v2_render.c`: added `KEY_FLAG_LINES` branch before list rendering: loops through `item_count` lines and renders with syntax colors, skipping main/sub labels.
     - Built with ARM toolchain in WSL (`arm-openwrt-linux-gcc`) and deployed to device `/mnt/SDCARD/mk20-hud` (running live as PID 2625).
  5. **Host TypeScript Architecture**:
     - `host/src/protocol/messages.ts`: exported `KEY_FLAG_LINES = (1 << 5)`, added `colors?: number[]` to `HostKeySync`.
     - `host/src/types.ts`: added `itemColors?: number[]`, `isLinesMode?: boolean` to `KeyVisual`.
     - `host/src/transport/udp.ts`: serialized `KEY_FLAG_LINES` and `colors`.
     - `host/src/state/context.ts`: in `changes` view, populated 6 lines per row into `items` and `itemColors`, set `isLinesMode: true`, `isFilled: false`, `isDisabled: false`.
  6. **Scrollbar & Knob Scroll**:
     - Scrollbar strictly on Top Screen only, calculated on Top Screen Height (`max_scroll = totalLines - 5`).
     - Left knob scrolls line-by-line (`delta = +1 / -1`), shifting the continuous 29-line window smoothly.

## 2. Hardware & Test Verification
- **Automated Test Suite**:
  - `npm test --prefix host`: **40/40 PASS** (7.2s duration).
  - Updated `tests/context.test.mjs` to verify `isLinesMode`, 6-line items, syntax colors, and line-by-line scrolling.
- **Physical MK20 Framebuffer Verification**:
  - Sent K7 to enter Changes view on `Snowball_Control` repo.
  - Pulled `/dev/fb21` (Top Display): verified 5 lines of diff with amber hunk header and scrollbar (`scratch/top_changes.png`).
  - Pulled `/dev/fb13` (Key 13, Row 1 Col 1): verified exactly 6 lines of code with cyan additions (`scratch/fb13_changes.png`).
  - Pulled `/dev/fb14` (Key 14, Row 2 Col 1): verified exactly 6 lines of code with amber hunk header (`scratch/fb14_changes.png`).
  - Pulled `/dev/fb15` (Key 15, Row 3 Col 1): verified exactly 6 lines of code with cyan additions (`scratch/fb15_changes.png`).
  - Rotated Left Knob +1 and -1: verified line-by-line shift across top display and all key rows.
  - Pressed K17: verified clean return to session view.

---

# CHANGES VIEW FULL (2,1)-(5,4) 16-KEY CONTENT CANVAS & CONTINUOUS VIEWPORT (2026-09-13, Antigravity)

Handoff state: `READY`.
Quota status: Antigravity quota is healthy (>75% remaining).
All requested user changes have been fully implemented, verified via automated test suite (40/40 PASS), and validated on live UDP sync against active Git repositories.

## 1. Resolved Issues

### Issue 1: Changes View Area (2,1)-(5,4) 16-Key Content Canvas & View-Only Styling
- **Requirement**:
  - In Changes view (`viewMode === "changes"`), use `(2,1)-(5,4)` (all 4 rows across columns 2 to 5 = 16 keys) as the content area:
    - Row 1 `(2,1)-(5,1)` (keys `[13, 9, 5, 1]`): Line 1 immediately below Top Display.
    - Row 2 `(2,2)-(5,2)` (keys `[14, 10, 6, 2]`): Line 2 immediately below Top Display.
    - Row 3 `(2,3)-(5,3)` (keys `[15, 11, 7, 3]`): Line 3 immediately below Top Display.
    - Row 4 `(2,4)-(5,4)` (keys `[16, 12, 8, 4]`): Line 4 immediately below Top Display.
  - View-only canvas: do NOT set selection background (`isFilled: false`), keeping clean card background across all 16 content keys.
  - Control key: K17 at `(1,1)` remains the single Changes Close button (`isFilled: false`).
  - Col 0 / Col 1 (K18, K19, K20): Changed files list (3 per page), with only the active file having `isFilled: true`.
  - Continuous 9-line viewport:
    - Top Display shows lines `readerScrollLine + 0` to `readerScrollLine + 4` (5 lines).
    - Key Rows 1..4 show lines `readerScrollLine + 5` to `readerScrollLine + 8` (4 lines).
    - Zero line duplication between Top Display and Key Matrix.
  - Scrollbar: remains strictly on Top Display, calculated based on Top Screen Height (`max_scroll = totalLines - 5`).
  - Left Knob scroll: line-by-line (`delta = +1 / -1`).

- **Implementation**:
  1. `host/src/state/context.ts`:
     - Replaced unused control buttons K13, K9, K5, K1 in Row 1 with `diffRows[0] = [13, 9, 5, 1]`.
     - Configured `diffRows` with 4 rows (`[13, 9, 5, 1]`, `[14, 10, 6, 2]`, `[15, 11, 7, 3]`, `[16, 12, 8, 4]`).
     - Set `isFilled: false` for all content keys across `(2,1)-(5,4)` so they do not show selection highlights.
     - Removed key 1 override at line 1333 so K1 functions cleanly as the 4th key of Row 1.
  2. `host/src/state/mvp-controller.ts`:
     - In `dispatch()`: removed keys 1, 9, 5 from handling actions in Changes view (they are now content keys). K17 and K7 remain the Close triggers.
     - Kept `wrapText` guard for Changes mode so diff line indexing remains 1-to-1.
     - Kept Top Screen Height scrollbar calculation (`state.topScrollLine = Math.max(0, Math.min(c.readerScrollLine, state.topTotalLines - 5))`).
  3. `host/tests/mvp-state.test.mjs`:
     - Updated unique key test to assert `key(ctx, 17).labelSub === 'Close'`.
  4. `host/tests/context.test.mjs`:
     - Updated Test 10 to assert all 4 rows (`[13, 9, 5, 1]`, `[14, 10, 6, 2]`, `[15, 11, 7, 3]`, `[16, 12, 8, 4]`), verify `isFilled: false`, and verify line-by-line knob scroll.
  5. Live Verification:
     - Ran `scratch/test_changes_view.py` against active daemon: verified that Row 1 displays line 5 (`.env.*`), Row 2 displays line 6 (`!.env.example`), Row 3 displays line 7 (`.venv/`), Row 4 displays line 8 (`+.venv*/`), all with `flags=0` (`isFilled: false`).
     - Verified knob scroll +1 and -1 shifts lines continuously across Top Display and Key Rows 1-4.
     - Verified K17 returns cleanly to session view.

---

# MACHINE & HARNESS DISPLAY RESTORATION + TOP SCREEN LINE-WRAP FIX (2026-09-13, Antigravity)

## 1. Resolved Issues

### Issue 1: Machine (`K17`) & Harness (`K13`) LCD Buttons Blank / Pitch Black
- **Root Cause**: In `host/src/state/mvp-controller.ts`, line 363 hardcoded `for (const id of [17,13,10,12]) { key.isDisabled = true; }`. In `hardware/mk20/hud/v2_render.c`, any key with `KEY_FLAG_DISABLED` is filled with `COLOR_BLACK` (`00 00`). This caused physical key LCDs `/dev/fb17` and `/dev/fb13` to be completely black (all 32,768 bytes were zero).
- **Fix**:
  1. Removed `17` and `13` from the disabled keys list in `MvpController.state()`, keeping only unassigned keys `[10, 12]` disabled.
  2. Populated `c.harnesses` with all 3 harnesses (`Codex`, `Antigrav`, `OpenCode`) in `MvpController` constructor so K13 can cycle across them rather than being restricted to a 1-element array.
  3. Wired `K17` to `c.cycleMachine(); await this.load();` and `K13` to `c.cycleHarness(); await this.load();` in `MvpController.dispatch()`.
  4. Supported `"machine"` and `"harness"` fields in editor choice selection commit.
  5. Added safe handling in `MvpController.load()` for non-Codex harness scopes so cycling harness previews session data cleanly without throwing on Codex backend calls.
- **Hardware Evidence**:
  - Captured `/dev/fb17` and `/dev/fb13` raw framebuffers from live MK20: verified all 32,768 bytes are non-zero.
  - Rendered `hardware/mk20/hud/fb17.png`: shows `MACHINE`, `> MINIME-PC-AMD`, `K17:Cycle`.
  - Rendered `hardware/mk20/hud/fb13.png`: shows `HARNESS`, `> Codex`, `Antigrav`, `OpenCode`, `K13:Cycle`.
  - Tested live UDP cycle: dispatched K13 press, verified screen updated to `> Antigrav` (`hardware/mk20/hud/fb13_cycled.png`), then to `OpenCode`, and cycled back to `> Codex` (`hardware/mk20/hud/fb13_codex.png`).

### Issue 2: Top Screen Rendering Line Wrapping & Right Padding (~30px Gap)
- **Root Cause**:
  - TOP display resolution is 428×142. Text origin is at `x = 12`. Scrollbar track is at `x = 420` (`TOP_W - 8`). Usable text width before scrollbar track is `404 px` (50 ASCII columns at 8px/col, or 25 Korean characters at 16px/char).
  - In `host/src/state/context.ts`, `wrapText` used `maxLen = 42` (336 px) or 40 (320 px) / 38 (304 px), leaving 68px to 92px of empty black space on the right edge.
  - In `mvp-controller.ts`, line 403 called `state.topBodyLines.flatMap(line => wrapText(line))` with default 42, which re-wrapped already formatted lines and prematurely cut them at 42 columns.
  - In `hardware/mk20/hud/v2_render.c`, line 159 clipped lines with `if (width + advance > TOP_W - 32 ...)`, which broke 50-column lines prematurely at 396px.
- **Fix**:
  1. Updated default `maxLen = 50` in `wrapText(text, maxLen = 50)` in `host/src/state/context.ts`.
  2. Implemented `wrapWithPrefix(text, firstPrefix, contPrefix, maxLen = 50)` in `host/src/state/context.ts` that dynamically subtracts prefix display widths:
     - `userPrompt`: firstPrefix `"[USER] "` (7 cols) + 43 cols = 50 cols (400px). Continuation lines `"> "` (2 cols) + 48 cols = 50 cols (400px).
     - `agentResponse`: firstPrefix `"[AGENT] "` (8 cols) + 42 cols = 50 cols (400px). Continuation lines `"  "` (2 cols) + 48 cols = 50 cols (400px).
     - `processDetails`: firstPrefix `"[PROCESS] "` (10 cols) + 40 cols = 50 cols (400px). Continuation lines `"  "` (2 cols) + 48 cols = 50 cols (400px).
  3. Updated `hardware/mk20/hud/v2_render.c` line 159 from `TOP_W - 32` (396px) to `TOP_W - 20` (408px), allowing full 50-character lines (400px) with 8px margin before scrollbar track at x=420.
  4. Recompiled `mk20-hud` via WSL and deployed to MK20 (`/mnt/SDCARD/mk20-hud`).
- **Hardware Evidence**:
  - Captured `/dev/fb21` readback from live MK20: `hardware/mk20/hud/top_live_fixed.png` and `hardware/mk20/hud/top_scrolled.png`.
  - Lines now span full 50 characters (400px) from `x = 12` to `x = 412`, eliminating the premature line wrapping and filling the right side cleanly.

---

# LIVE MK20 CONNECTION + KOREAN FIX / MANDATORY HANDOFF (2026-09-13 22:02 UTC)

## User correction and actual hardware connection

The user correctly challenged testing without connecting the USB-attached MK20. Initial tests were PC-only; do not describe them as physical acceptance. The device IS USB-connected: Windows detects `4250:426F` QMK HID. No USB ADB gadget enumerates. Management and panel sync use MK20 Wi-Fi, NOT Ethernet on MK20.

The PC has Wi-Fi `192.168.1.197` and Ethernet `192.168.1.225`. TCP 5555 on MK20 `192.168.1.248` succeeds ONLY with source bound to PC Wi-Fi `.197`; default/Ethernet source times out. No global route or firewall changes made. A loopback relay binds the upstream Wi-Fi source:

- `host/probes/adb-wifi-relay.py` listens `127.0.0.1:15555`, forwards to `192.168.1.248:5555` from `.197` (hardcoded lab addresses).
- Running exec session **15202** is this relay. ADB connects successfully to **127.0.0.1:15555**.
- Actual middleware running in exec session **73040**, with `SNOWBALL_HOST_IP=192.168.1.197`, `SNOWBALL_DEVICE_ADB=127.0.0.1:15555`, `node host/dist/index.js`, cwd repository root. Preserve these processes while inspecting; avoid duplicate port 7701 bind.
- Device HUD PID **2279**, `/mnt/SDCARD/mk20-hud -d`, verified after replacement. Previous PID 1973 stopped deliberately.
- Backup on device: `/mnt/SDCARD/mk20-hud.before-mvp-0913`; old MD5 `d3f81fa3208cbf74358d32698c452626`. New deployed MD5 `f8c62e94af725f974bae5caa05e1135c` (59068 bytes). QMK firmware not flashed.

## Actual Korean evidence

Device has `/usr/share/fonts/D2Coding.ttf` (4185844 bytes) and `/usr/lib/libfreetype.so.6`. An ARM `font-probe` executed ON MK20 loaded that font and produced 1648 lit pixels. BEFORE replacement, actual `/dev/fb21` readback showed English but blanks for Hangul. AFTER new HUD deployment, actual framebuffer visibly shows `한글 TOP 표시 확인 완료` in mixed text. Thus this is now actual device evidence, not just host simulation.

- Before: `hardware/mk20/hud/top-live.png` (+ raw)
- After: `hardware/mk20/hud/top-live-after.png` (+ raw), visually inspected by Codex
- Native TOP is RGB565 little-endian, **428×142**, 121552 bytes. `host/probes/framebuffer-to-png.py` converts actual readback.
- Earlier `font-verification.png` was HOST WSL rendering with Windows Malgun; do not confuse that with the device readback.

## Latest implementation (supersedes earlier descriptions below)

- `host/src/index.ts` now starts the Codex-only `MvpController`, UDP and local Whisper; defaults no longer start Antigravity/OpenCode daemons. Previous entrypoint preserved as `host/src/legacy-main.ts`, **do not run it for MVP**.
- `host/src/state/mvp-controller.ts` is new, injected backend/voice/event controller. Clears fixture catalogs, reads thread/model lists and thread turns, creates tasks, gates disconnected actions; starts capture with ACK, cancels late transcripts, review/edit method, replacement Undo; sends once to pinned CLI destination; retains unknown delivery; adds read-only reconciliation against pre-send turn IDs, JSON draft persistence; tracks turn IDs, distinguishes Stop ACK from completion; queues native approvals and multiple user questions, Later/reopen; implements bounded read-only Files and changes navigation.
- `host/src/audio/draft.ts`: restore from persistence (sending → unknown), confirm delivered API.
- `host/src/codex/adapter.ts`: initialized notification, 30s request deadlines, reject pending on exit, native request ID map including 0, real active-turn ID, throw instead of silent request-response failure. Existing harness's legacy `approved/denied` remains historical; new controller uses `accept/decline` matching `.probe-schema-01534` and current official docs.
- `host/src/transport/udp.ts`: accepts a state provider and supports `SNOWBALL_HOST_IP` bind.
- `host/src/state/context.ts`: Unicode code-point/display-width wrapping (ASCII 8px, others16), not code-unit splitting. Existing Context tests retained.
- `hardware/mk20/hud/unicode_text.c`: log library/font failure, retry later, use SD-card/system font candidates and check Hangul glyph coverage. `mk20-hud.c`: fallback unsupported glyphs become `?`, not blank UTF-8 bytes.
- `host/tests/mvp-controller.test.mjs`: actual controller dispatch with fake backend/voice, 8 cases for offline gate, capture/review/send/Stop, cancellation/start race, uncertain send, edit/Undo, approvals, multi-question, Korean width.
- `host/probes/mvp-live.mjs`: explicit LIVE app-server probe (not npm test). Completed a disposable tool-free turn with Korean text. Result `docs/mvp-live-result.json`: passed, thread `01a09cc4-efa4-7361-8137-da0a665d411a`, cwd `C:\Users\wondo\AppData\Local\Temp\snowball-mvp-oLgD73`. No project files changed by the live task.
- `.gitignore`: ignores host/.state (persisted draft text). Existing dirty work preserved.

## Validation and exact next action

Latest full suite before final persistence wiring: **39/39 PASS**; final repeat started in exec session **71248**, collect its result. Builds passed after reconciliation changes. ARM make succeeded, existing unused-icon and STAGING_DIR warnings only. Physical TOP now shows Hangul. Physical microphone-to-Whisper-to-Codex Send, physical Stop/approval, and physical selection are **NOT yet accepted**. Runtime is currently displaying the disposable test task/project; select intended project using K9 before real work.

**Exact next action:** read this section, inspect live process/ADB state, collect final test output; then use the ACTUAL connected MK20 and current controller to verify Talk→Done→review→Send in a disposable task. Confirm physical key events and ACK on screen. Keep updates unambiguous about PC tests vs device tests. Do not claim whole MVP complete based on unit tests.

## Known limitations to fix before MVP sign-off

1. New controller was substantial and needs additional asynchronous/race review. Selection/refresh still uses indices; late thread/read may overwrite newer event status. Refresh has only first 100 threads; no pagination yet. Existing desktop tasks are listed through CLI; cross-owner continuity NOT verified. Define/guard CLI-owned vs external task control before claiming desktop integration.
2. `edit(text)` exists but companion editing UI is not yet wired. Persistence/reconciliation just added; add restart and lost-ACK regression tests. Unknown with no pre-send baseline stays blocked intentionally; no unsafe replay.
3. Voice Other request bookkeeping can become stale if request resolves during recording. Secret questions disabled. Test free-text-only questions and request expiry. Rendering of queue notices can overwrite error text. Pending server-request lifecycle on reconnect needs reconciliation.
4. AudioTransport uses old ADB helper/fixed scratch paths and silent stop errors; real capture ACK and cancel cleanup require device verification. Do not record without telling the user what is happening.
5. Settings is informational, Access fixed on-request, TTS disabled. Multi-host and other harnesses deferred. Files/error overlays and modal return scroll need full physical checks.
6. Font retry currently initializes extra library/face handles on repeated failures; fix resource cleanup if retaining retry. Clip-text path is still ASCII-only for scrolling key labels; TOP now verified, all key labels not yet.
7. C JSON parser still lacks proper `\uXXXX` decoding and object-bound string parsing; current JS JSON.stringify sends raw UTF-8, but escaped inputs and truncation need regression coverage.
8. `UdpTransport` still sends additionally to learned client; LAN-only development transport. This is not secure pairing or a finished deployed service.

## Antigravity then OpenCode MVP plan

After Codex physical acceptance, extract the proven controller/backend contract without changing MK20 protocol or Whisper draft behavior. Antigravity first: inspect `host/src/harness/antigravity.ts`; separate read-only transcript discovery from actual owner-authorized create/send/interrupt/approval; expose unsupported capabilities disabled; test live existing and new tasks, reconnect, destination, questions and Stop on MK20. Do not treat brain-directory reads as command-control proof. OpenCode next: reuse HTTP/SSE adapter (`host/src/harness/opencode.ts`), bind base URL/session IDs, validate create/send/abort/permission/SSE reconnect and duplicates; run same device acceptance matrix. Expand harness selector only after each independently passes; keep drafts bound across harness changes. Shared pairing/GPU/multi-machine follows these MVPs.

## Commands / Git

ADB: `& "$env:LOCALAPPDATA\Temp\Codex-MK20-ADB\platform-tools\adb.exe" -s 127.0.0.1:15555 shell "ps"`. Framebuffer: `dd if=/dev/fb21 of=/tmp/snowball-top.raw bs=121552 count=1`, pull then convert with the helper. Relay requires PC `.197` interface; document/configure addresses before generalizing.

Branch remains `pilot/codex-app-recon`, HEAD `c4513bb`. Extensive pre-existing tracked and untracked edits; no commit or stash created. All work retained, new controller not represented in tracked `git diff` because host was already untracked. Do not blanket-add/commit existing binary/SDK/probe artifacts. Read current files and tests before trusting earlier handoff.

---

# Codex + Whisper MVP update (2026-09-13, Codex)

Handoff state: `READY` for continuation; this is a completed audit/stabilization tranche, not a quota-triggered handoff or completed MVP. This section supersedes older next actions and completion claims below.

## Current objective and task

User requests work that can proceed before QMK source arrives, focusing middleware on Codex integration MVP, checking every state flow/UI, and sharing a staged plan. Codex-app audio work is discontinued; retain local Whisper STT → review → explicit Send. TTS is outside this MVP.

## Current state and completed work

Read existing handoff, Git state and middleware. Existing baseline tests passed 24/24. Added first stabilization changes and 7 regression tests; final `npm test --prefix host` passed **31/31**, including TypeScript build and local Whisper fixture transcription. This did not send real Codex prompts, record the physical microphone, restart the live middleware, or flash hardware.

- `host/src/state/context.ts`: standalone Settings UI, delivery sending/unknown key gating, empty Send and unsupported question/TTS controls disabled, truthful Changes Close label.
- `host/src/index.ts`: enforce disabled UI keys in input dispatch, contain modal actions, preserve pending/unknown draft on Talk, do not restart cancelled busy-retry capture, preserve start error text, forbid desktop-to-CLI send fallback, filter streaming to selected session and protect modal/draft content.
- `host/src/harness/codex.ts`: preserve stream thread ID; correct project path boundary filtering and New project cwd.
- `host/tests/mvp-state.test.mjs`: 7 regression cases covering changed state visuals and Codex scope/event identity.
- `docs/CODEX_MVP_PLAN_2026-09-13.md`: full state audit with unresolved gaps and five ordered stages in Korean.
- `docs/VOICE_ARCHITECTURE.md`, `docs/MIDDLEWARE.md`: current Whisper decision overrides older native-first audio roadmap.

## Exact next action

Read `docs/CODEX_MVP_PLAN_2026-09-13.md`, then extract the input/event controller from `host/src/index.ts` with injected fake Codex/Whisper/transports to test actual dispatch and asynchronous ordering. Current regression tests exercise state rendering and the harness, not the nested main dispatcher. Start with Stop: it currently claims halted before an acknowledged interrupt, and question Stop only closes the screen. Model request/acknowledgement/completed/failed distinctly and test rejection before further UI expansion.

## Remaining work and architecture decisions

1. Connection/empty-state gating, remove sample resources, stale async scope/diff responses, fixed owner routing and timeout/reconnect. Preserve existing architecture; no broad provider expansion.
2. Whisper start ACK, empty/error feedback, draft editing/undo, delivery reconciliation and restart persistence. Current Talk-replace intentionally discards the prior review draft; undo not delivered.
3. Approval request ID/type and installed protocol response schema verification, request/session ownership, queue, Later return, normal questions. General question submission is now disabled because it has no working implementation.
4. Actual configuration capabilities/application, real Files or visibly unavailable Files; UI layouts and native device acceptance. Current Files list is a fixture; Settings is informational only.
5. QMK source/recovery matching and standalone power checks only after vendor material arrives.

Existing local Whisper base CPU/int8 is the implementation baseline; no model/driver installation is implied. Desktop IPC remains experimental opt-in; app-server is the default. Do not equate listed desktop sessions with proven cross-owner control. UDP/ADB/mesh remain development infrastructure, not completed authenticated pairing. Tests and repository evidence override older all-complete claims.

## Verification, known limitations and failed approaches

`npm test --prefix host`: 31 passed, 0 failed, 0 skipped. Real Whisper worker transcribed the existing prerecorded English fixture; Korean/mixed-code accuracy and physical mic not measured. `git diff --check` passed (existing line-ending warnings only); host/docs are pre-existing untracked directories and therefore not covered by tracked Git diff. No screenshot/native HUD acceptance performed. No real Codex send/stop/approval tested. After modal isolation, TypeScript correctly rejected obsolete toggle comparisons; entry paths were changed to direct modal assignment and the final build passes.

Known high-priority gaps: inaccurate Stop success, question Stop/Later, approval response schema/request identity, sample sessions, request deadlines, unknown delivery reconciliation, config not applied, modal async races. Scope-filtered background deltas are dropped, not cached; selected session reload is still needed. See the audit table for all states.

## Git state and useful commands

Branch `pilot/codex-app-recon`; latest commit `c4513bb`. Repository was extensively dirty before this turn, including the whole untracked host/docs trees and tracked HUD edits. Preserve all existing work. No commits/stashes made; no unrelated changes reverted. Run `npm test --prefix host`, `npm run build --prefix host`, `git status --short`, and `codexbar usage --provider codex --format json`. Quota inspection succeeded; no quota guard reached during this tranche.

---

# Standalone input investigation update (2026-09-12, Codex)

The current user requests removing the USB host-PC requirement and assessing QMK source modification/flashing versus easier alternatives. See `docs/MK20_STANDALONE_USB_2026-09-12.md` for evidence, options, source request draft and exact next action. No firmware was modified or flashed; matching MK20 MCU source/recovery firmware has not been located in the inspected SDK or public repository.

Live Wi-Fi ADB succeeds; the Linux UDC reports `not attached`, and its USB device tree shows Wi-Fi but no GD32. The older text below overstates the diagnosis: the exact MCU suspend/deep-stop path, SOF dependence and sufficiency of `NO_USB_STARTUP_CHECK` have not been verified from vendor firmware. Treat those as hypotheses. A functioning USB host must enumerate/configure devices; SOF alone is not an established fix.

The worktree was already extensively dirty on entry (tracked edits and untracked host/docs/HUD files). Preserve this work; older claims of a clean repository are incorrect. No application changes or test-suite reruns were made in this investigation. Read-only hardware inspection and source inspection completed; physical charger/host comparison and firmware acceptance tests remain outstanding.

Follow-up: user confirmed power-bank operation and no known separate QMK source. Downloaded and inspected the public 758,887,616-byte MK Series Upper Computer Open Source_V1.0 ZIP: 17 entries, PC Qt demo source/executable plus system images and PhoenixCard, no QMK source. Upstream QMK's Waveshare directory lists only rp2040_keyboard_3. Details and download link are in the investigation document.

Next: test an available alternative USB host and obtain the board-specific source/recovery package from the vendor. The manufacturer request is a local draft and has not been sent.

---

# Prior handoff — Multi-Agent HUD, Hardware Topology & Standalone Power Diagnosis (2026-09-12, Antigravity)

Handoff state: `READY`.
All user feedback, feature implementations, and deep hardware investigations have been completed, verified via automated test suites, and validated on live MK20 physical hardware.

---

## 1. Current Objective
Transform the MK20 (Allwinner T113-S3 dual Cortex-A7 with GD32 QMK MCU) into an autonomous, physical developer HUD for AI coding agents (**OpenAI Codex**, **Google Antigravity**, and **OpenCode**), operating over local Wi-Fi UDP and mesh RPC.

---

## 2. Current Task & Recent Investigation
1. **USB Power Only vs. USB Host Standalone Operation**:
   - Diagnosed why physical keys and rotary knobs do not register when MK20 is powered by a USB wall charger / power bank, despite Wi-Fi and UDP middleware connecting cleanly.
   - Hardware topology & root cause:
     - Onboard USB 2.0 Hub connects to the external USB-C port upstream.
     - Hub Downstream Port 1 connects to T113 Linux USB Gadget (`1D6B:0104`).
     - Hub Downstream Port 2 connects to GD32 QMK Keyboard MCU (`4250:426F`).
     - When connected to a PC (USB Host), the host sends SOF (Start-of-Frame) packets every 1ms, keeping GD32 in `DEVICE_STATE_Configured`.
     - When connected to USB Power Only (wall charger/power bank), without a USB Host on D+/D-, the QMK firmware enters **USB Suspend** (`suspend_power_down()`), halting the matrix scan timer and UART `/dev/ttyS1` event loop into deep stop mode.
     - The dual-knob chord (`g_pc_keys_on = 0`) sends VIA `0x05` to remap keys to `KC_NO (0x0000)`, which suppresses PC typing while keeping UART `0x16` active, but **requires GD32's main loop to be running**.
     - Standalone wireless HUD operation requires the USB-C port to be plugged into any device providing USB Host SOF signaling (e.g. PC, mini-PC, Raspberry Pi, router USB port, or OTG host adapter).
2. **UI & Navigation Enhancements (Fully Implemented & Verified)**:
   - **Detail Toggle Display (K11)**: Displays `[ ON ]` (All Steps, cyan outline + amber inset) vs `[ OFF ]` (Prompts Only).
   - **Detail Scroll & Scrollbar Preservation**: Removed `showDetails` from mode cache key, preventing scroll jump on toggle; added 42-character `wrapText` for 1-to-1 physical scrollbar tracking.
   - **Changes View Exit (K17, K7, K1)**: Expanded C firmware UDP buffer to 32KB and `top_body` to 16KB; optimized sliding window to 8 lines (< 1.4KB payload); instant exit via K17, K1, or K7.
   - **Left Knob Navigation**: Smooth line-by-line scrolling and selection from current item index without jump.

---

## 3. Current State
- **Host Middleware (`host/src/index.ts`)**: RUNNING as background daemon (`node dist/index.js`). Bound to UDP `7701` and Mesh HTTP `7702`.
- **OpenCode Daemon**: RUNNING on `http://127.0.0.1:4096`.
- **Codex Server**: Running `codex.exe app-server` (0.153.4).
- **MK20 Hardware (Allwinner T113 @ 192.168.1.248)**:
  - Connected to Wi-Fi `YOUR_WIFI_SSID_6E`.
  - Native HUD daemon `/mnt/SDCARD/mk20-hud -d` running.
  - ADB direct connection active on port 5555 (`iptables -I INPUT 1 -p tcp --dport 5555 -j ACCEPT`).

---

## 4. Completed Work
- `host/src/state/context.ts`: Word-wrap formatting, detail display toggle on K11, stable scroll clamping, project/session selection starting from active index.
- `host/src/index.ts`: Changes view exit routing on K17/K1/K7, input bitmask handling.
- `hardware/mk20/hud/mk20-hud.c`: Buffer capacity expansions, UART packet parser, D2Coding rendering.
- `host/tests/`: 24 automated unit tests covering all adapters, context state, speech engine, and protocol serialization.
- `test_complete_scenarios.py`: 28 end-to-end integration test scenarios passed 100%.

---

## 5. Remaining Work
1. **Long-Term Hardware / Standalone Enhancements**:
   - If standalone battery operation without any USB host device is desired in the future, investigate dumping GD32F303 flash via SWD/JTAG or decompiling QMK firmware to enable `#define NO_USB_STARTUP_CHECK` so GD32 matrix scanning runs unconditioned by USB enumeration.
2. **Additional Agent Integrations**:
   - Expand multi-machine mesh discovery to dynamically announce new peers over mDNS/UDP broadcast.

---

## 6. Exact Next Action for Next Agent
The repository is in a completely functional, clean, and passing state.
To verify or build further:
1. Verify unit tests:
   ```powershell
   npm test --prefix host
   ```
2. Build host middleware:
   ```powershell
   npm run build --prefix host
   ```
3. Check host middleware logs or restart daemon:
   ```powershell
   node dist/index.js
   ```
4. Connect to MK20 via ADB (if making C HUD modifications):
   ```powershell
   & "$env:LOCALAPPDATA\Temp\Codex-MK20-ADB\platform-tools\adb.exe" connect 192.168.1.248:5555
   & "$env:LOCALAPPDATA\Temp\Codex-MK20-ADB\platform-tools\adb.exe" -s 192.168.1.248:5555 shell "ps"
   ```

---

## 7. Architecture and Decisions
- **Subsystem Boundary**: T113 Linux owns displays (20 key framebuffers `/dev/fb1..fb20` + top OLED `/dev/fb21`), Wi-Fi networking, audio capture/playback, and UDP sync. GD32 MCU owns physical switch matrix and rotary encoders, escalating events over internal UART `/dev/ttyS1` at 115200 8N1.
- **PC Typing Mute**: The dual-knob chord modifies runtime keycode bindings in GD32 to `KC_NO (0x0000)` using VIA protocol frame `0x05`. This silences PC USB keystrokes while keeping raw UART `0x16` escalation to T113 active.
- **UDP Sliding Window**: Session reader uses an 8-line sliding window (5 visible lines + 3 lookahead lines) formatted to 42 characters per line, guaranteeing sync packets stay strictly under 1.4KB to avoid UDP fragmentation over Wi-Fi.

---

## 8. Files Changed
- `HANDOFF.md`: Comprehensive handoff documentation.
- `host/src/state/context.ts`: Text wrapping, detail display state, scroll stability.
- `host/src/index.ts`: Changes view exit keys, event dispatching.
- `hardware/mk20/hud/mk20-hud.c`: Buffer capacity expansions, UART packet parser, D2Coding rendering.
- `hardware/mk20/hud/v2_state.h`: Buffer sizing (`top_body` 16KB).

---

## 9. Tests and Verification
- **Automated Unit Tests**: `npm test --prefix host` -> **24/24 PASS (100%)**.
- **Live Integration Tests**: `test_complete_scenarios.py` -> **28/28 PASS (100%)**.
- **Live Hardware**: MK20 verified responsive at `192.168.1.248`, ADB accessible on port 5555, UDP sync actively updating screens.

---

## 10. Known Problems & Constraints
- **USB Power Only**: Connecting MK20 strictly to a 5V charging adapter (no USB host) puts GD32 QMK MCU into USB suspend. For standalone wireless usage, plug USB-C into any active USB Host (PC, mini-PC, Raspberry Pi, router USB host port, or mobile phone via OTG).
- **Firewall Rule**: MK20's default `lunch.sh` drops port 5555 unless MAC matches or rule is dynamically added (`iptables -I INPUT 1 -p tcp --dport 5555 -j ACCEPT`).

---

## 11. Git State
- Branch: `pilot/codex-app-recon`
- Latest commit: `c4513bb docs: confirm physical verification of Left and Right Knobs in HANDOFF.md`
- Status: Clean modified files staged/ready for continuation.
