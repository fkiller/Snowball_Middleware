# Harness connection implementation plan

**2026-09-07 Codex correction:** [native dictation investigation](CODEX_DICTATION_2026-09-07.md) identifies a separate first-party PCM/audio-to-draft route; CLI Realtime authentication failure does not rule out desktop dictation. Use [VOICE_ARCHITECTURE.md](VOICE_ARCHITECTURE.md) for native-first qualification, virtual microphone/browser alternatives and shared GPU/CPU fallback. The present private tool-pipe bridge is experimental and is not established as owner pub/sub. Fix host/project/thread scope and prevent alternate-owner send retries per [review](REVIEW_2026-09-07.md) before further control tests.

**Codex-specific revision:** [CODEX_CAPABILITY_PLAN.md](CODEX_CAPABILITY_PLAN.md) now governs Codex implementation. Remote is the functional reference; investigate native owner subscriptions and read-only ~/.codex metadata before selecting a desktop UI bridge. The desktop-first choice in the table below is superseded for Codex. Antigravity/OpenCode decisions remain unchanged.

Date: 2026-09-06. This is the connection decision record, superseding the generic adapter recommendations in MIDDLEWARE.md. It specifies what to build, not a claim of tested interoperability. Current product UX: docs/simulator/README.md. No live prompt, browser login, remote enrollment, or provider setting was changed during this assessment.

## 1. Connect to an execution owner, not just a harness name

Expose Codex/Antigravity/OpenCode as harness names but register instances internally:

```text
HarnessInstance {
  id, hostId, provider, surface, ownerIdentity, version,
  endpointRef, credentialRef, capabilities, health
}
surface = ownedRuntime | desktop | remoteWeb | cloud | server
SessionKey = instanceId + nativeSessionId
```

Names and project paths never establish identity. Remote Control desktop and daemon instances must be registered separately even on one machine. A browser worker may run on a different bridge host from the execution host; maintain both IDs. Do not merge sessions across runtime owners on matching titles. Scope selection memory by device/instance/project. Machine selection is not login: connection/authentication has its own state.

| Surface | Selected implementation | Role and boundary |
|---|---|---|
| Codex sessions started by Snowball | Persistent local app-server, JSONL over stdio | Full native path on a pinned, tested version |
| Existing Codex desktop sessions | Windows UI Automation helper, macOS Accessibility counterpart | Operate the actual app; never silently resume the transcript in another runtime |
| Codex Web/cloud | Optional dedicated browser driver for the actual cloud task UI | Cloud tasks only; not a bridge into arbitrary local desktop sessions |
| Antigravity desktop sessions | Dedicated browser driver for official Remote Control | Primary existing-session route, with internet/account dependency |
| Antigravity CLI sessions started by Snowball | Optional headless JSON stream adapter | Separate mode; not an interactive approval bridge for desktop sessions |
| OpenCode TUI/web/server sessions | HTTP client + SSE to the server owning the UI session | Primary native route; use its installed OpenAPI schema |

There is no universal CLI command, generic scraper, or MCP server that alone solves all these surfaces. MCP normally lets an agent invoke tools; it does not inherently expose the app's selected session, prompt box, or pending approvals to an external controller. Codex's tools available inside this conversation are not an external public API to ship with Snowball.

## 2. Codex native adapter

Build on `host/src/codex/adapter.ts` and generated types, with a version-specific transport/codec. PATH currently resolves to codex-cli 0.71.0; its help does not expose current remote listener options. Do not replace the installed binary or assume the desktop-bundled binary has the same version. Select the executable explicitly in registration; record its version and generated-schema hash.

Implement a single long-lived child process per registered Snowball-owned runtime. Complete initialization before accepting commands. Route JSON messages by shape: method+id is a server request; method without id is a notification; result/error+id is a response. Server and client request IDs may collide and must occupy separate namespaces/maps. Retain the original server request ID and exact response type for approval replies. Apply deadlines, bounded buffers, process-exit rejection of pending promises, and outcome reconciliation.

| Device operation | Adapter work |
|---|---|
| Projects | Host project registry keyed by canonical root/worktree; augment with history cwd metadata |
| Sessions/read | Cursor-based thread/list; thread/read where version supports it. Otherwise read history through a versioned read-only reader; never resume merely to view |
| New | thread/start with registered cwd; store returned native thread identity |
| Send | turn/start, retaining returned active turn ID; bind model/effort/access settings to this destination |
| Output | Decode native agent-message deltas and turn lifecycle into ordered ContentBlock events |
| Stop | turn/interrupt using the exact active thread AND turn ID |
| Question/approval | Keep native server request, render typed choices, send a response under its original RPC ID; remove on native resolution |
| Model/Effort | Discover model capabilities; use the version's supported turn overrides, and report when effective |
| Access | Map to native approval policy AND sandbox separately; never equate an approval mode with filesystem confinement |

Current official protocol covers initialization, thread/turn operations, and request/response events. This is a versioned integration target, not evidence that every operation exists in 0.71.0. [Codex app-server](https://learn.chatgpt.com/docs/app-server).

Local concrete gaps to fix before live M1 testing:

- Adapter sends initialize but lacks the initialized notification; validate handshake against the pinned schema.
- `handleEvent` currently matches legacy snake-case names while the checked-in v2 types describe slash-separated notifications and nested params.
- Incoming numeric IDs are matched against pending client requests before distinguishing server requests; a colliding approval request can be misclassified.
- No complete native approval-response implementation is present in the inspected adapter.
- ThreadStartParams has no top-level effort field; TurnStartParams does. Use generated types instead of loose any payloads.
- TurnInterruptParams requires a turnId; the adapter currently permits null.
- Existing test-codex.ts logs a pass on response ID alone without proving that result succeeded. Add explicit error assertions and deterministic fixtures before relying on it.

For same-owner multi-client use, assess an explicitly configured shared app-server only on a version that supports it and only when the other client can attach to it. A newly launched process reading the same history directory is NOT that shared owner. Do not promise stock desktop attachment through this route.

## 3. Existing Codex desktop and Codex Web

### Desktop bridge: build an OS helper, not a second Codex process

First target Windows because this is the current workstation. Implement a small .NET helper using Windows UI Automation; exchange typed JSON over stdio with the TypeScript host. Resolve the target window by process identity plus registration, inspect only its accessibility subtree, and use Invoke/Value/Selection/Scroll patterns. Subscribe to relevant focus/property/structure changes and coalesce them; use a low-rate reconciliation read for missed events. macOS uses a separate AX helper with the same JSON contract.

The helper exposes snapshot, navigateSession, setComposer, submitComposer, invokeStop, answerVisibleDecision, and chooseVisibleSetting. These are Snowball interfaces to implement, not existing Codex APIs. Bind every write to a fresh observed window/session/layout revision. Do not infer the selected session from the latest modified transcript. If accessibility does not expose a stable session identity, require one-time explicit association with the intended session and invalidate it on navigation; fail closed when association cannot be verified. If required UI controls are inaccessible, mark that operation unavailable. Avoid coordinate-only approval clicks or guessing an ID from a title.

Keep command injection serialized per app window. Revalidate the active session immediately before entering text and again before submission. Human navigation invalidates the operation. Never send by a blind global Enter key. Reads from native history may supplement older content only after identity mapping; they do not grant live ownership. Full transcript extraction from a virtualized UI must load pages explicitly and track coverage.

Desktop focus detection is part of this same helper: report foreground window, observed selected session, source, timestamp, and unknown when not observable. Snowball's pinned session and the desktop's selected session are distinct; Follow UI chooses which to display without silently redirecting in-flight commands. The bridge must not fight the user's keyboard/mouse.

### Web/cloud: separate optional adapter

Use a dedicated browser profile and a deterministic page driver for the actual Codex cloud task page. Register cloud execution as a separate destination; never map its files to the similarly named local working tree. Browser capabilities come from controls actually exposed for that task. Model, effort, local workspace browsing, and approval controls may be absent; do not emulate unsupported settings with prompt text.

Codex Cloud and Remote are different surfaces. Official Remote supports continuing work on connected desktop hosts through supported app clients; that documentation does not establish a public third-party remote-control API for MK20. Therefore the initial product integrates the local app-server or desktop UI directly rather than depending on an undocumented mobile relay. [Codex Cloud](https://learn.chatgpt.com/docs/cloud), [Remote connections](https://learn.chatgpt.com/docs/remote-connections).

Do not replay private HTTP endpoints or copy browser cookies into the host service. If a supported external API becomes available, replace the page driver behind the same instance contract.

## 4. Antigravity: Remote Control is the primary desktop route

Official Remote Control provides browser access to desktop sessions via antigravity.google.com, using the same Google account and selecting the intended instance. Desktop and headless daemon entries are distinct; the daemon is not assumed to attach to an already running desktop. The documentation establishes a supported web product, not a published automation protocol. [Remote Control](https://antigravity.google/docs/remote-control/).

Implement `AntigravityRemoteWebAdapter` using a persistent Playwright Chromium profile on the host/bridge computer. Open headed for user login and MFA; keep credentials in that browser profile with OS protection. Register the chosen Remote Control instance explicitly and verify its stable identity in the UI. Keep the browser warm; MK20 renders semantic content, never a streamed browser framebuffer. No LLM runs per keypress.

Implement versioned page-driver functions:

```text
enumerateInstances() -> visible native instance links/IDs
enumerateProjects(instance) -> identity-bound project records
enumerateSessions(project, cursor) -> loaded records + coverage
openSession(sessionId) -> verified route and visible session
observeConversation() -> MutationObserver-backed normalized changes
fillPrompt(text); submitPrompt(expectedSession, expectedRevision)
readPendingDecision(); answerDecision(expectedDigest, optionIds)
cancelTurn(); readSettings(); chooseSetting(name, exposedValue)
```

These are proposed Snowball functions. Exact DOM locators and native IDs must come from an authenticated UI inspection; this research did not access the user's Remote Control page. Use semantic roles, labels and stable links where available. Record redacted DOM fixtures for the tested version. Never invent selectors or assume every setting exists. After a navigation or UI update, run driver health checks before enabling writes.

Prefer one persistent page per actively observed session, with a bounded pool; serialize commands per page. If the site cannot support independent tabs without changing the desktop's selected session, use a single serialized page and visibly report navigation side effects. Test this before promising background control. Historical list/message virtualization needs explicit paging; observed text is not automatically complete history.

Before any answer, compare native identity (if exposed), question content/option digest and page revision. Re-read immediately before clicking. On stale/ambiguous identity, keep the request pending and require the native UI. Confirm a submitted prompt from its appearance in the intended conversation and status progression; a successful browser click alone is not acknowledgement. A disconnect after click has unknown outcome and must not auto-resend.

Remote-page focus is NOT desktop-app focus. On Windows, add a narrow UIA focus observer for the Antigravity desktop window; correlate only authoritative IDs. If unavailable, offer Follow remote browser separately and label desktop following unavailable. Never treat an SSE/activity event or most recently updated conversation as UI focus.

This route has provider-cloud latency and an internet dependency even if MK20 and the host share a LAN. Keep local knob feedback/cache independent; measure web navigation, submission acknowledgement, and remote event delay separately. The LAN-native acknowledgement budget does not apply to this route.

### CLI/SDK fallback is a different runtime

Use headless CLI only for sessions Snowball intentionally owns, with a separate capability profile. Current headless documentation rejects control_request/control_response stream messages and CLI-handled slash commands; do not send /model as a substitute for a settings API or assume an interactive permission round-trip. Local agy is 1.0.1, so validate installed behavior independently. [Headless input limits](https://antigravity.google/docs/cli/headless/).

## 5. OpenCode: attach to the existing server

Use a configured loopback endpoint for the server behind the user's TUI/web client; register endpoint identity plus directory/worktree context. Do not run opencode serve merely to find existing TUI sessions: it creates another server. On a new managed setup, start the shared owner with a known local endpoint and attach clients to that owner. Read `/doc` and generate/pin a typed client for the installed version. Use authenticated HTTP locally; never expose Basic authentication without protected transport remotely.

Map project/session/history to `/project`, `/session`, and `/session/:id/message`; submit via `/session/:id/prompt_async`, cancel via `/session/:id/abort`, and observe `/event` or `/global/event` SSE. Use the installed schema's permission reply endpoint. This is a documented native multi-client path. [Server API](https://opencode.ai/docs/server/).

Additional implementation rules:

- Validate question list/reply and model-variant/effort fields from `/doc` before implementing; do not invent a universal effort parameter. Resolve native provider/model/variant choices into device selectors.
- Keep per-session overrides per session. Do not PATCH global config for a single session's setting unless the UI clearly requests that scope.
- On SSE reconnect, read a new snapshot and deduplicate event/message IDs. Do not assume replay cursors exist unless the server contract provides them.
- Plugins may help report lifecycle and permission events, but those events do not establish which session the TUI is displaying. [Plugin events](https://opencode.ai/docs/plugins/).
- For web focus, use an opt-in browser extension observing the selected route and tab/window activation, reporting through Native Messaging to the local host. For TUI focus, require a verified client-side selected-session event/extension on the pinned version; server idle/status does not qualify. Without it, manual selection still works and Follow TUI is unavailable.
- OpenCode executable was not found on PATH during this assessment; native capability probes remain to run after installation/registration.

## 6. Shared services and implementation boundaries

Keep device connections independent from provider connections: MK20 -> authenticated Snowball WSS -> registered adapter/bridge. USB enrollment, mDNS hints and per-device revocation remain in MIDDLEWARE.md. A Google/OpenAI browser login does not enroll a device. Provider tokens stay on the host. Browser/OS bridge processes use stdio or authenticated local IPC, never an unauthenticated LAN debug endpoint.

One command coordinator checks destination, capability, freshness and device control lease, then calls the selected instance. Leases serialize Snowball clients but do not prevent a human/native client from acting; reconcile native outcomes. All adapters return accepted/completed/failed/unknown, plus capability-specific limitations. UI bridge acceptance means dispatch only; completion needs observed outcome.

Speech is harness-independent initially: MK20 PCM -> host STT -> device transcript review -> explicit Send -> adapter text prompt. Question dictation uses answerDecision instead. TTS consumes normalized assistant text and streams back to MK20. Do not try to operate three different vendor microphone buttons. Workspace uses registered local roots for local execution, OpenCode file APIs when appropriate, and exposed artifacts only for cloud execution.

Proposed modules (extend existing code; paths are planned):

```text
host/src/adapters/types.ts             capability/instance/session contracts
host/src/codex/adapter.ts              owned-runtime adapter, repaired in place
host/src/bridges/desktop.ts            OS helper client
host/bridges/windows/                 UIA helper and redacted fixtures
host/src/bridges/browser-worker.ts     persistent browser, lifecycle, typed actions
host/src/adapters/antigravity-web.ts   Remote Control page driver
host/src/adapters/codex-web.ts         optional cloud driver
host/src/adapters/opencode.ts          generated-client wrapper and SSE reducer
host/src/focus/                       source-aware focus normalization
host/src/control/                     leases, request lifecycle, unknown outcomes
```

The currently present `host/src/transport/udp.ts` learns its peer from incoming datagrams and has no authenticated enrollment in the inspected path. Keep it a lab transport, not the product control channel for real prompts/approvals. Existing hardware/host files are concurrent work and were not modified in this planning pass.

## 7. Ordered delivery and acceptance gates

1. **Codex native conformance:** fix the concrete adapter gaps above; assert fixtures for handshake, delta, two RPC directions with colliding IDs, approval reply, process loss, and exact-turn cancellation. Then run a disposable-workspace live round-trip. Pass requires native acknowledgement, not log text.
2. **Existing Codex session bridge:** inspect the actual desktop accessibility tree; prove stable identity and prompt/stop/decision controls. Run the same session visibly in desktop and on the device. If identity cannot be established, document that specific failure and do not claim existing-session support; this is a release gate for that story.
3. **Antigravity Remote Control bridge:** user signs in once; inspect two registered instances and an existing session, capture redacted fixtures, test prompt/stop/decision/model controls individually. Test whether remote navigation changes desktop selection. Unsupported controls remain explicitly unavailable.
4. **OpenCode native connection:** obtain the actual server's OpenAPI contract; verify two clients observe/control the same session, plus SSE reconnect and native approval/question replies. Prove focus separately.
5. **Product transport and cross-device tests:** pair two devices/two hosts, revoke one, switch context during dictation, submit a stale decision, lose network after dispatch, and verify no wrong-session send or automatic duplicate.

Each adapter's release report must name installed version, surface, tested operation, evidence, focus source, latency measurements, and limitations. No real integration test was run in this documentation pass. This plan makes the implementation route concrete while leaving only observable provider/UI compatibility as validation gates; it does not pretend an unpublished API has been discovered.
