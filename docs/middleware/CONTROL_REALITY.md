# Local control correction and MVP reality — 2026-09-24

## Live correction after the 0-project report

The old browser URL `127.0.0.1:62147` was an obsolete portable process. The current user browser was moved to a newly built portable on loopback. It restores the explicitly selected current-PC Codex CLI from private state, rechecks two registered workspaces as ready, and groups six read-only native sessions under `Snowball_Control` by exact server-side cwd/workspace identity. `Snowball_Middleware` was initially empty; the latest packaged browser created one separate owned verification task there and completed a real GPT-6-Astra/low response. The browser's real `model/list` call showed five Codex models and GPT-6-Astra efforts low, medium, high, xhigh, max, ultra. No existing task was attached or commanded during these checks. Session transcript history remains bounded, and historical tasks are read-only until explicit attachment.

The Windows PnP observer distinguishes MK20's QMK HID key controller (`4250:426F`) from the separate Linux product CDC USB link (`1D6B:0104`). On 2026-09-24 the user connected MK20 USB: QMK HID, including vendor interface 03, was present and a safe real open/close test passed 2/2; product CDC was absent. The running portable reported one unsupported QMK USB candidate and zero controllable devices. The UI displays current presence in its header and Settings; neither USB observation grants pairing or input control. MK20 production control remains blocked by unverified input reports and authenticated firmware/transport. Startup recovers an abandoned private journal lock only after exact token and dead-PID checks; a live owner still blocks a second writer. An unsigned per-user Windows installer passed install/run/uninstall, and a macOS ARM64 CI app passed package/archive smoke; neither is signed or an updater.

## User-confirmed local control contract — 2026-09-21

- Default local Web UI uses noAuth: no login, PIN, pairing code or repeated authorization. It binds only 127.0.0.1; Host/Origin/browser checks stay in force. Optional token mode is operator-selected, not the normal journey.
- MK20/device pairing is separate from Web UI access. Do not add a Web PIN to repair a device protocol.
- Connected, explicitly selected harness sessions must accept commands. Discovery alone is observation; explicit attachment establishes the route. Do not treat permanently disabling commands as plugin isolation.
- Plugin isolation means precise operation/event/session scope and no exceptional core privileges. Current process separation is not OS confinement against malicious same-user plugins; report this limitation honestly.
- Every model/effort, voice, settings and session action requires actual backend behavior and evidence. Removing a fake fallback makes the state honest; it does not complete the missing MVP feature.


## Implemented in this correction

Normal start:local and LocalClient operate without bootstrap/PIN. Host, Origin and loopback restrictions remain. Controller IDs identify separate client contexts; they are not secrets or an authentication claim. Token-mode tests remain for the explicit --require-auth option.

Codex provides harness.models and harness.attach. Models/efforts come from native model/list, including bounded pagination. Explicit thread/resume attaches a selected existing stored thread; send validates its owner/instance/session plus provider model/effort and includes the selections in native turn/start. A native turn ID is an acknowledgement, not proof of completed inference. An attached thread is not automatically the live Desktop owner's process.

The actual development runtime accepts a trusted adapter factory and the CLI composes the bundled Codex worker through PluginHost. API paths /v1/harness/sessions, /v1/harness/models and /v1/sessions/attach are documented in OpenAPI and the SDK. Commands pass through durable admission and a per-session dispatcher. The Web UI exposes attachment and real catalog selection; selection is bound to the session at send time. Public API remains semantic, with no generic plugin RPC endpoint.

Plugin manifests restrict operations to their kind; host rejects events outside that namespace. Core checks host/plugin/instance/owner and removes stale listeners. These checks preserve positive connected-session commands. No core or journal object is passed into the Codex worker. OS permission confinement and a full imported-artifact trust chain remain missing.

## Start a selected Codex connection

The Windows tray and its loopback onboarding page now offer `Codex CLI 연결…`. The browser sends an empty request; the native app opens executable, existing Codex home and working-directory pickers. It checks canonical paths, the exact supported CLI version and SHA-256, then displays those values for review before starting an owned plugin. The selection persists in a private state file and reconnects at next start. The onboarding page also offers native-confirmed removal of one connection or reset of all saved connection references; these stop only middleware-owned plug-ins and retain task history/provider login. Existing tasks remain read-only until explicit attach. Real default-login CLI dynamic enrollment, restoration and removal were verified without sending any task command; interactive OS dialog selection/confirmation has not been verified on the user's visible desktop. A failed saved provider leaves the local UI open and the tray degraded; reset can recover corrupt saved JSON if its private ACL remains intact.

For the development CLI without a tray, build first and create a local JSON configuration using paths and SHA-256 of the reviewed 0.153.4 executable. Select the existing CODEX_HOME explicitly; Snowball does not copy credentials or log into it. This config is selected by the local CLI, not by arbitrary Web input.

    {
      "instanceId": "local",
      "launch": {
        "executable": "C:/absolute/path/codex.exe",
        "sha256": "REPLACE_WITH_REVIEWED_64_HEX_SHA256",
        "version": "0.153.4",
        "codexHome": "C:/absolute/selected/codex-home",
        "workingDirectory": "C:/absolute/selected/project"
      }
    }

    npm run build
    npm run start:local -- --codex-control-config C:/absolute/codex-control.json

Open the printed loopback URL. Choose the listed harness/project/session, attach that session, refresh the model catalog, select model/effort or leave harness defaults, then send. Do not use another current task implicitly. If the selected harness needs its own account login, that is the provider's state, not a Snowball Web PIN.

## Remaining reality checklist (required MVP work, not waived)

| Area / stable task | Actual state | Remaining acceptance |
|---|---|---|
| Codex model/effort / MW.03.02.01.01 | Windows real catalog + gpt-6-astra/low create/resume/response/completion/interrupt passed. Separate ephemeral approval tasks exercised safe cancel and accepted a temporary-file request whose exact effect appeared; both answer commands remained unknown because native clearing/effect is not a unique client receipt. | Exact native approval receipts, running Desktop co-ownership and macOS |
| Existing sessions / MW.05.02.01.01 | Explicit resume enables commands; listing alone does not. Journal-known destinations restore read-only with durable title, workspace ID, folder and creation time; native preview cannot overwrite a saved title. Latest packaged UI created one separate owned task in the selected Snowball_Middleware folder and completed a real gpt-6-astra/low response. After package restart it restored read-only with null active owner; explicit attach created a new owner and a second real gpt-6-astra/low response completed. Six older Snowball_Control sessions stayed read-only. | Running Desktop co-ownership semantics, native-owned project identity and complete historical transcript |
| New task / MW.05.02.01.01 | Registered-workspace API/SDK/Web implemented; real native HTTP creation and browser fixture creation passed. A private write-ahead request ID receipt prevents duplicate native create on same-ID retry across restarts; confirmed receipts restore read-only. Native Codex selection, dynamic registration and native-confirmed disconnect/reset now exist | A lost native create reply cannot be identified automatically: inspect native sessions and explicitly attach the exact task. Interactive OS dialogs and provider-side reconciliation if supported remain |
| Transcript/events / MW.06.02.01.01 | Journal completion uses correlated native evidence; bounded native agent deltas and SSE refresh verified in browser | Full native transcripts, streaming turn projection and recovery; no sample conversation fallback |
| Overview/Settings / MW.06.02.01.01 | Latest packaged browser showed two registered projects, six read-only Codex sessions under the exact workspace, real counts and working project-card navigation. Same-named unrelated candidates remain separate. CSP-safe `hidden` state keeps Settings closed on initial load; actual open/close passed. The MK20 badge cannot be activated by an unrelated device. | Real owned-session pending/unknown attention, draft target invariance and multi-harness/device acceptance. Historical static fixture A1/A2 claims are superseded by the current needs_review evidence. |
| Hardware model/effort / MW.04.02.01.02 | ContextManager fixed lists removed; catalog and getExecutionSettings exist | Bind paired hardware to the same selected provider catalog and journal command payload |
| Hardware lab / MW.04.02.01.02 | start-all remains quarantined; preserved prototype has synthetic voice/new-session/results and private Desktop IPC | Replace these paths with real audio/provider/command bridge, prove paired MK20 input; do not enable the prototype as MVP |
| Web voice / MW.07.01.01.01 | Only actual supported browser SpeechRecognition; synthetic fallback removed | Local speech provider integration, permission/errors/end lifecycle and scope changes; browser speech may use network |
| Physical voice / MW.07.02.01.01 | Portable speech/source components are not wired to the lab | Real recording → transcription → review → send/interrupt with immutable target; real microphone/device tests |
| Access policy / MW.03.02.01.01 | Fake access list removed; native creation policy remains fixed read-only/on-request | Provider-supported policy choices and actual request/effect verification |
| Autostart/tray / MW.06.01.01.02, MW.08.01.01.01 | Actual Electron tray/utility core, persistent settings, native reviewed Codex selection/disconnect/reset and OS login-item port. A private unsigned Windows per-user installer passed clean-path install, installed native tray smoke and uninstall; 96/96 app hashes and 99 expected app files. macOS ARM64 CI app passed native smoke again after ZIP extraction. The current-user live runtime restored two ready projects, controllable Codex and read-only OpenCode; the QMK USB candidate is visible but MK20 has zero registered devices. Startup recovers exact dead-owner WAL locks while refusing a live owner. | Interactive picker/confirmation/cancel, actual login lifecycle, signing, sleep/crash recovery, macOS x64 and signed/notarized user installation remain. Active/conflicting lock failures still need a user-visible explanation. |
| Language/notifications / MW.06.01.01.02 | Persistent settings apply native tray translations and newly actionable OS notifications; UI clearly labels tray-only language | Actual OS notification delivery and Web-wide localization remain unverified/unimplemented |
| Plugin scope / MW.01.02.01.01 | Protocol namespaces, broker session scope, process crash separation | OS-enforced least privilege for hostile code; dependency integrity; same-user process can bypass broker through files/network |
| OpenCode/Antigravity / MW.03.02.01.02 | OpenCode 1.18.31 now launches as an isolated middleware-owned read-only server with pinned executable and internal Basic secret. Its eight model IDs come from the native catalog with no invented efforts. A structured send on a new verification session returned provider HTTP 403, so control stays disabled. Antigravity remains observe-only. | Reviewed provider credential import, permitted native send/completion/abort/permission/reconnect evidence and macOS native acceptance before OpenCode control. |
| Plugin publication / MW.01.02.01.02 | Three private standalone harness repositories and `v0.1.0-private` releases exist under `fkiller`. Windows/macOS source, bundled-SDK package and fresh-consumer installation CI passed. Asset hashes and links are in [release evidence](evidence/MW.01.02.01.02/private-releases-20260924.md). | License/public redistribution, independent device-plugin releases and real provider/hardware platform acceptance remain; private CI does not imply product control completeness. |

Removing a fabricated result or disabling an unavailable action is a truthfulness fix, not completion of that row. Do not mark the MVP done from fixture counts. PLAN L0 inherited R-EXEC applies to every task. Real Codex model/effort command evidence passed for its scoped A3 check; hardware catalog binding and other harness execution settings remain pending.

## Evidence

Historical fixture milestone before native continuation: 46/46 pass (tests/local-runtime, codex-adapter, plugin-host, security-audit, execution-settings, session-isolation, local-api and supervisor-truth). Native turn/start payload contains the selected catalog model and effort exactly once after attachment; other-instance catalog access and forged event namespaces fail. These tests use a native Codex port fixture; no user's model turn was sent. HANDOFF.md records final full-suite results and unexecuted checks.

## Native continuation evidence — 2026-09-22

[Native acceptance](evidence/MW.03.02.01.01/native-20260922.md) records real default-login Codex verification, fresh/stored task creation, process restart, explicit resume, chosen model/effort, native output, correlated journal completion and actual interrupt. Only newly created verification tasks were commanded; the stored task was archived afterward. No Web PIN was introduced.

Windows native tray smoke passed with zero front windows, actual Tray creation, loopback noAuth and pause/resume; it did not mutate OS startup or send notifications. Full Node 24 regression milestone: 202 tests, 198 pass, 0 fail, 4 physical skips. Later changes and final counts are recorded in HANDOFF.md. Browser fixture validation proved model/effort payload, streaming/completion, registered-workspace new task creation and truthful desktop settings availability. This is distinct from the native provider evidence.

[Instance continuation](evidence/MW.05.02.01.01/instance-20260922.md) records the two-instance browser/API isolation and another real Codex model/effort turn after the registry change. Native approval clearing now closes the matching pending prompt without claiming that an answer was accepted. The Windows portable executable smoke passed; its precise build and final regression result are in HANDOFF.md.

## 2026-09-24 package and distribution evidence

[Owned OpenCode evidence](evidence/MW.03.02.01.02/owned-server-20260924.md) distinguishes its verified read-only catalog from the rejected free-provider command. [Windows installer/live evidence](evidence/MW.08.01.01.01/installer-20260924.md) records clean install/run/uninstall, the live two-project/two-harness snapshot and MK20 USB presence without device control. [Private plugin release evidence](evidence/MW.01.02.01.02/private-releases-20260924.md) links the three private repositories, release hashes and successful Windows/macOS fresh-install CI. Full Node 24 regression: 226 tests, 222 passed, four physical skips, zero failed. No pre-existing user harness task was commanded during these checks.

Development tray: npm run build; npm run install:desktop; npm run start:tray -- --codex-control-config ABSOLUTE_JSON_PATH. Requires Node >=22.12. Installation/signing are separate unfinished gates.
