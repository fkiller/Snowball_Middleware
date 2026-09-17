# Product roadmap proposal

**Authoritative execution roadmap:** [Local-control-first L0–L5 plan](middleware/PLAN.md), [task tree](middleware/TASK_TREE.md), and [task/evidence ledger](middleware/PLAN.json). Local release precedes optional local-LAN multi-host G4. Use [resume instructions](middleware/RESUME.md) across agents/models; historical priorities below do not override this plan.

**2026-09-17 current priority:** follow [middleware packaging MVP stages and acceptance gates](MIDDLEWARE_PACKAGING_MVP_2026-09-17.md). Hardware-independent core/API/plugin extraction and a hardware-free vertical slice precede installer release. Older milestones below are historical context, not completion claims.

## 2026-09-07 status correction and voice gates

M1–M4 are not complete: capture/UI evidence and a passing host build do not establish native desktop ownership, accurate transcription or authenticated multi-host operation. See [review](REVIEW_2026-09-07.md) and [voice implementation specification](VOICE_ARCHITECTURE.md).

Before further live control: repair P0 wrong-owner/destination, cancellation and false-success paths. M2 includes per-host enrollment, direct separate speech connection and one-worker discovery without a mesh. M4 is now: V1 qualify native Codex dictation (app-managed login, PCM, editable draft, explicit Send); V2 install only one chosen 8GB GPU worker if needed and benchmark Korean-English candidates; V3 optional ~2GB RSS CPU fallback, qualified OS fallback and unavailable-service UX; V4 five-host/two-device disconnect, cancel, edit and single-send acceptance. No native round-trip or model accuracy result is claimed by the static discovery.

Status: proposed, 2026-09-05. Outcomes and gates supersede a misleading feature-completion percentage. Existing code remains a hardware/UI lab; no product or protocol migration is applied by these documents.

## M0: agree interaction and capability boundaries

Confirmed by the user: Codex is first; Antigravity and OpenCode follow. The console must know the session selected in the desktop UI when integration permits; Settings chooses Follow desktop or Manual/pinned. Include U16 focus behavior in acceptance and validate it independently from session runtime status.

Review [current product design](PRODUCT_DESIGN_V2.md) and [middleware](MIDDLEWARE.md). Confirm direct Machine/Harness cycling, scoped remembered/first-valid downstream selection, distinct configured/editing indicators, automatic conversation display, remapped question rows, contextual navigation, conditional Speak, physical readability, and live-session attachment expectations. Inventory installed harness versions and microphone/speaker devices. Exit: each story U01-U16 has a supported first-release behavior or an explicit capability limitation.

## M1: one authoritative host/session path

Build one adapter over its native interface and a small host-side session inspector. List/read history, create a session, send a prompt, receive tool events, handle actual permission requests, cancel, and reconcile effective model/effort/access. Test pre-existing-session attachment separately. Exit: no text-log approval inference, no timeout approval, and view-only sessions cannot dispatch actions.

## M2: paired transport and multiple registrations

Prototype physical enrollment without disrupting vendor CDC; authenticate the product connection; persist host/device registrations; implement revocation and manual discovery fallback. Add command IDs, revisions, reconnect snapshots/cursors, and controller leases. Exit: two devices can observe, only the permitted controller acts, and stale/replayed commands fail. One device can switch between two hosts without redirecting an existing draft.

## M3: complete device interaction

Implement context keys, reader, session creation, capability-driven selectors, approval review, and workspace browser using existing rendering primitives. Keep the showcase separately available. Exit: all applicable U01-U05 and U09-U15 journeys pass on hardware, including offline and ownership changes; long messages remain readable and full diff detail is accessible.

## M4: voice loop

Complete the audio hardware spike; add push-to-talk, transcript review, explicit send, host speech synthesis, device playback, local volume/mute, and interruption handling. Exit: U06-U08 pass on physical hardware; recording cannot transmit to a changed context, no speech auto-submits after reconnection, and audio cannot delay Stop.

## M5: expand harness support and daily reliability

Add adapters in priority order using the same fixtures and capability conformance suite. Verify existing desktop-session bridges independently of newly launched sessions. Harden boot/startup, bounded queues, recovery, diagnostics, and installer/uninstaller. Exit: support matrix names tested harness versions and actual limitations; measured latency meets chosen targets.

## M6: distribution and firmware lifecycle

Reproducible host packages and device builds; secure updates, rollback/power-loss drills, optional USB product failover, and remote-host access. Custom OS slimming follows demonstrated memory/startup constraints. Exit: clean-machine setup and rollback succeed without private developer paths or untracked local dependencies.

## Immediate next action

For Codex, follow [CODEX_CAPABILITY_PLAN.md](CODEX_CAPABILITY_PLAN.md): inventory evidence, repair the native baseline, then run the P1–P6 owner/subscription matrix. Do not select UI automation as the primary external-session route before testing native subscriptions and local metadata coverage. Voice is a separate capture/transcription/review/send work package.

Concrete adapter work and acceptance gates are now specified in [HARNESS_CONNECTIONS.md](HARNESS_CONNECTIONS.md), sections 2–7. Start by repairing the inspected Codex RPC/handshake/event/approval gaps, then prove existing-desktop session identity and UI control separately. Antigravity's existing-session route is its Remote Control web UI bridge; OpenCode attaches to the existing owner's server. A working new app-server session does not satisfy the existing-desktop-session requirement.

Review the control layout, then perform a read-only hardware/audio and harness-version inventory. Implement M1 against one chosen harness before building a generic multi-harness service. Do not change QMK keymaps, start live provider tasks, or deploy this proposed layout as part of the review itself.

## Baseline evidence

- Baseline commit: `c4513bb`; latest knob implementation `d098884`.
- The preceding assessment ran A1 tests (19 passed) and QMK tests (14 passed); QMK fixtures use a different frame format from the current HUD and need alignment before counting as device coverage.
- Adapter imports currently invoke a hardware listener; isolate library imports before treating its suite as host-only verification.
- Local Codex CLI inspected for this proposal: `0.71.0`; do not assume it implements current online app-server documentation.
- Microphone capture, speech recognition, synthesized playback, encrypted MK20 transport, and live multi-device control have not been verified.
- Seven existing untracked hardware diagnostic files are preserved. No application source was changed in this design task.

