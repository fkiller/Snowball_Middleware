# Pilot: Codex (ChatGPT) App Recon — Web Control + Audio Input

Branch: `pilot/codex-app-recon` (from `main@c4513bb`). Main WIP untouched; all pilot artifacts live here only.

## Pre-recon facts (this machine, 2026-09-07)

- App: `OpenAI.Codex 26.901.6511.0`, `C:\Program Files\WindowsApps\...\app\ChatGPT.exe` (13 live PIDs seen).
- App dir = Chromium shell: `chrome.dll (322MB)`, `chrome_*.pak`, `resources.pak`, `snapshot_blob.bin`, `v8_context_snapshot.bin`, `chrome_elf.dll`, `libEGL/libGLESv2`, `notification_helper.exe`. Verdict: **Electron-like / Chromium-embedded web UI — hypothesis 1 confirmed structurally.**
- Bundled `Codex.exe (1.1MB)` + `owl-shell-runtime.json` + `tools/` inside app dir — desktop likely shells out to its own Codex runtime, separate from PATH CLI.
- CLI: bare `codex` = 0.71.0 via `C:/nvm4w/nodejs/codex.ps1`; tested 0.153.4 at `...\AppData\Local\OpenAI\Codex\bin\27d6a192e9c98618\codex.exe`; **live now: `8e5b6932251c2c1c\codex.exe` = 0.153.4** (2 PIDs). Two cached bins (`8e5b69…`, `c60635…`) — must pin exact binary per test.
- CORRECTION (2026-09-07, user challenge — accepted): `thread/realtime/*` is NOT the Work voice-input path. Evidence: `HANDOFF.md:62-66` — `thread/realtime/start` dials `wss://api.openai.com/v1/realtime` and fails with `realtime conversation requires API key auth` on subscription OAuth (`auth.json`); needs `--enable realtime_conversation` experimental flag. Schema `.probe-schema-01534/v2/ThreadRealtimeStartParams.ts:14-56` confirms full-duplex session semantics (`outputModality`, `clientManagedHandoffs`, `codexResponsesAsItems`, `delegationAckFiller`, `realtimeStart/EndInstructions`, `transport` with WebRTC SDP in `ThreadRealtimeSdpNotification.ts`) — i.e. voice-to-voice conversation, not discrete utterance → draft → explicit Send. Work requires the latter. So native realtime is demoted to negative-control only; Q2 primary is discrete capture → external STT → text inject.
- Prior gates (read first): `docs/HARNESS_CONNECTIONS.md §3` (desktop = OS UIA helper, not second process), `docs/CODEX_CAPABILITY_PLAN.md` (P1–P6 pub/sub, voice = text-control + missing audio path), `docs/CODEX_VERIFICATION*.md`.

## Pilot goal

Answer, with evidence, not claims:
1. **Q1 Web control:** can Snowball drive the running ChatGPT desktop session via supported/local means (UIA snapshot/setComposer/submit/stop/decision) without resume/fork? Is there a local owner socket (daemon/`proxy --sock`) that beats UIA?
2. **Q2 Discrete voice input (NOT realtime duplex):** what mic/API path does the ChatGPT voice button use (expected: Realtime API, API-key-entitled, out of scope), and can Snowball do push-to-talk-as-a-whole instead — MK20 `arecord` WAV → host STT (SAPI local / Whisper if key) → Top-HUD `[DRAFT PROMPT]` → K16 explicit Send via `desktop.sendMessageToThread()`? Prove review-hold, never auto-handoff.

## Rules

- Disposable sessions only. Never resume/fork your live conversation to test observation.
- Read-only before writes. Writes only with your explicit taped action + fresh revision check.
- No creds/transcripts in repo. Redacted fixtures only (window titles hashed, IDs truncated).
- No installs/upgrades, no PATH replacement, no killing your app, no `proxy --sock` attach to live daemon until owner identity proven.
- Stop on red: unknown session identity, colliding RPC IDs, silent fork, auto-prompt handoff → mark unavailable, keep view-only.

## Track A — Web/UI control (your app activity needed)

- [ ] **A0 Inventory (agent-only, no action from you):** dump `Get-AppxPackageManifest`, `resources/` + `tools/` listing, bundled `Codex.exe --version`, main-window UIA subtree root (processId + AutomationId + class), listening loopback ports/sockets for ChatGPT/Codex PIDs, `~/.codex` vs app CODEX_HOME.
- [ ] **A1 You: open ChatGPT app, focus one disposable test chat, leave it foreground 60s.** Agent captures foreground window, UIA snapshot (composer box, send/stop, decision buttons, session switcher), focus-change events, whether session ID is stable across minimize/restore.
- [ ] **A2 You: type (don't send) `SNOWBALL-PILOT-A1 <time>` in composer.** Agent verifies UIA Value pattern sees it, records revision binding rule.
- [ ] **A3 You: send it, then while streaming press Stop in-app.** Agent checks UIA stop control visibility + whether `thread/list` on owned probe sees same turn (identity mapping, not control).
- [ ] **A4 You: trigger one approval/question prompt in disposable chat (e.g. ask it to write a file). Leave dialog open.** Agent snapshots decision subtree (option IDs/labels/digest), tests read-only `readPendingDecision` mapping. No click yet.
- [ ] **A5 Owner-socket hunt (agent-only):** `codex app-server proxy --sock --help`, managed daemon status, `--enable realtime_conversation` flags on bundled `Codex.exe` vs PATH 0.71.0 vs `8e5b69…` 0.153.4; named-pipe/unix-sock enumeration for desktop owner. If a desktop-owned endpoint is found → P4 gate per CAPABILITY_PLAN; else document gap and keep UIA as conditional fallback.
- [ ] **A6 Gated write (only after A1–A5 pass + your go):** you arm a fresh disposable chat; agent does `setComposer → revalidate revision → submitComposer` once, confirms own-text appears in intended session + status progression. One prompt max per arming.

## Track B — Discrete voice input (your mic activity needed)

- [ ] **B0 Schema pin (agent-only):** record `thread/realtime/*` as negative control (auth failure expected, no live turn). Primary: inventory existing discrete pipeline per `HANDOFF.md:8-33` — `arecord S16_LE 16kHz mono → /tmp/snowball_voice.wav → host/src/audio/speech.ts (SAPI ~600ms / Whisper if OPENAI_API_KEY) → [DRAFT PROMPT] → K16 `desktop.sendMessageToThread()` / K4 discard`.
- [ ] **B1 You: in Windows Settings → mic privacy, confirm ChatGPT entry; in-app start voice mode 10s, speak, stop. Note if transcript lands in composer (review) vs auto-sends + whether it touches your Work thread.** Agent captures WASAPI default-input during window, whether mic stays open idle vs push-to-talk. Expected: voice-mode = Realtime duplex, separate from Work thread — confirms out-of-scope.
- [ ] **B2 Negative control (agent-only, disposable thread, no mic):** rerun `host/probes/audio-spike.cjs <8e5b69…codex.exe>` expecting `realtime conversation requires API key auth`. Logs subscription-OAuth ≠ Realtime-entitlement proof. No retry with key unless you explicitly provide one.
- [ ] **B3 Discrete path test (needs your K20 press on MK20):** press K20 → speak whole utterance → release/press again → verify Top-HUD `[DRAFT PROMPT]` → K16 Send / K4 Discard. Measure capture-to-draft, STT accuracy (Korean/English identifiers), no auto-submit.
- [ ] **B4 Decision:** realtime stays OUT. Ship discrete PTT-as-a-whole. OS virtual-mic hijack of the vendor voice button is explicitly rejected (fights duplex session, breaks review-hold, entitlement-dependent).

## Evidence to collect per step

`pilot/evidence/<date>-<step>.md` + redacted JSON: binary path/version, owner PID, CODEX_HOME, thread/turn IDs, UIA control IDs, event coverage/latency, PASS/FAIL + unknown outcomes. No transcript text beyond `SNOWBALL-PILOT-*` markers.

## User checkpoints (I will ask, you act)

1. Arm disposable chat + foreground app (A1).
2. Type-but-don't-send marker (A2), then send + in-app Stop (A3).
3. Hold open one approval dialog (A4).
4. Voice-mode 10s test + mic-privacy note (B1).
5. Optional virtual-mic install + fixture playback (B3).
6. Final go/no-go for single gated `setComposer/submit` (A6).

Say the word and I start A0+B0 agent-only (no app touches), then prompt you for A1.
