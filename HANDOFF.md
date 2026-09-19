# Local middleware — UI isolation finding, 2026-09-19 UTC (muse-spark)

Handoff state: READY. MW.06.01.01.01 stays IN PROGRESS (A1/A2 pending).
Key result: native folder-dialog clicks are blocked on an interactive-session
validation vehicle — agent processes run Session 1 on a non-interactive
desktop (notepad MainWindowHandle 0), so agent-launched pickers can never show
UI. A speculative TopMost fix was tried, failed identically, and reverted.

Objective: 로컬 제어 middleware / MW.06 hardware-free supervision onboarding.
Plan: E:/developments/projects/Snowball_Middleware, docs/middleware/PLAN.json
rev 14, resumeTaskId MW.06.01.01.01 (unchanged).
Active task ID / ancestor path: MW.06.01.01.01 under MW > MW.06 > MW.06.01.
Actual Git branch / HEAD / dirty and untracked files: branch
codex/local-control-core, HEAD b205056 plus uncommitted HANDOFF/RESUME docs.
No stash. Demo TEMP scaffolding only; repo has no product diff.
Completed work and exact evidence: live disposable demo runtime served the
real Supervisor to the user's browser; user confirmed bootstrap/one-use code,
Harness survey-null screen, Workspace-empty screen, and the predicted stuck
"확인 중…" on folder select (picker alive server-side, invisible). Stuck
picker exited via the 120s budget (409 cancelled path); no grant published.
TopMost-owner hardening reverted to committed state (wrong hypothesis,
unverifiable here). Native-picker product code is byte-identical to f22db9f.
Full `npm test` 127/127 still holds from the error-code slice; no product
code changed this turn, so tests were not rerun. Validator: 132 nodes, 40/40
scenarios, 11/28 tasks, 23/56 checks.
Current incomplete work / changed files: HANDOFF.md and RESUME.md docs only.
Exact next action: decide the interactive-session validation vehicle for
native dialog clicks (user runs no scripts — agent stages everything).
Concrete pending call (user paused validation as not useful yet): build a
Desktop double-click launcher (one click, no typed commands, console shows
URL+code, dialog surfaces normally) on user approval, or defer native dialog
to tray-app packaging. Then harness setup/auth/probe wiring without HTTP
approval, Internet-off and authenticated recovery journeys; A1/A2 pending.
Reuse runtime/store.
Tests run / not run / failures: probe scripts in TEMP verified listener
200 + snapshot 401 + mint 200/43-char/60s; mechanical UI probe (notepad
handle 0) is the load-bearing evidence. Full suite not rerun (no product
diff). Speech, macOS, physical HID/MK20, pairing, real-provider control,
tray/installer not run.
Processes or device state to preserve: demo runtime from this turn may still
idle until its 30-minute self-cleanup (loopback only, token-gated mint,
disposable state, auto-deleted). No harness, probe, LAN, or device touched.
Decisions / constraints / failed approaches: TopMost-owner tried and reverted
— never ship z-order guesses without a visible-window check. The visible-
window check (EnumWindows/MainWindowHandle during a live select) is the
required pre-step before any further dialog change. Working preference
(user, durable): the user does not run scripts; the agent runs all commands
and stages live disposable runtimes for browser validation.
Blocker and alternative ready task: native dialog clicks blocked on
interactive-session vehicle (external). Only other ready task: MW.07.01.01.01.
Quota source / actual status: codexbar usage --provider codex returns
Authentication required; per AGENTS quota-tool-failure rule, no percentage is
invented and normal contained work continued. Recheck before large work.

---

# Local middleware — selection-error slice, 2026-09-19 UTC (muse-spark)

Handoff state: READY. MW.06.01.01.01 stays IN PROGRESS (A1/A2 pending, no
acceptance claimed). Actionable selection/storage error codes implemented;
interactive native dialog, harness auth/probe wiring, Internet-off and
authenticated recovery journeys remain.

Objective: 로컬 제어 middleware / MW.06 hardware-free supervision onboarding.
Plan: E:/developments/projects/Snowball_Middleware, docs/middleware/PLAN.json
rev 13, resumeTaskId MW.06.01.01.01 (unchanged).
Active task ID / ancestor path: MW.06.01.01.01 under MW > MW.06 > MW.06.01.
Actual Git branch / HEAD / dirty and untracked files: branch
codex/local-control-core, HEAD f22db9f plus uncommitted HANDOFF/RESUME docs.
No stash. Build outputs git-ignored.
Completed work and exact evidence: coded `WorkspaceFault` in
packages/core workspace-store (busy/cancelled/invalid/limit/missing/
permission/storage/unavailable), coded native-picker failures, API 409/429/
400/503 mapping without paths or raw exceptions, Supervisor per-code Korean
notices, aborted-picker cancellation test plus permission/missing/invalid/
closed-store actionable-code tests with no path leak. `npm run build` pass;
`npm test` 127/127 pass; focused selection/store/API/runtime 27/27 pass.
Validator: 132 nodes, 40/40 scenarios mapped, 11/28 tasks done, 23/56 checks.
Current incomplete work / changed files: HANDOFF.md and RESUME.md docs only;
no source edits pending. Evidence in
docs/middleware/evidence/MW.06.01.01.01/verification.md.
Exact next action: interactively verify native folder-dialog
behavior/cancellation on Windows/macOS; connect reviewed harness setup/auth/
probe actions without HTTP-issued executable approval. Verify actual
Internet-off and authenticated recovery journeys; A1/A2 still pending. Reuse
runtime/store rather than recreating persistence.
Tests run / not run / failures: npm run build pass; npm test 127/127 pass;
focused 27/27 pass; test:reference not rerun (reference/ untouched); optional
speech, macOS, physical HID/MK20, pairing, real-provider control,
tray/installer not run.
Processes or device state to preserve: none started; no listener, login,
probe execution, or device access from this slice. Hardware/daemon preserved.
Decisions / constraints / failed approaches: browser never triggers probes —
provider policies live in MW.03.02.01.01 and PROBES.md forbids HTTP-issued
binary approvals; UI states this. One existing capacity test initially failed
because the new generic storage message hid the word capacity; fixed by
keeping a distinct limit code/message with capacity wording and 429 mapping.
No paths, secrets or raw exceptions in error responses. Working preference
(user, durable): the user does not run scripts — the agent runs all commands
and stages live disposable runtimes for browser validation.
Blocker and alternative ready task: HID/MK20/owner-proof blockers unchanged
(external inputs). Only other ready task: MW.07.01.01.01.
Quota source / actual status: codexbar usage --provider codex returns
Authentication required; per AGENTS quota-tool-failure rule, no percentage is
invented and normal contained work continued. Recheck before large work.

---

# Local middleware — 2026-09-19 final checkpoint

Handoff state: READY — mandatory quota handoff. Actual desktop usage: 5% five-hour
remaining (95% used), 85% weekly remaining. New session initially had reset windows;
no reset credit consumed. Implementation stopped at current atomic milestone. Do not
start new work in this window. CodexBar's earlier authentication issue is unchanged;
desktop actual usage is the valid source. Check fresh quota on resume.

## Objective and authoritative state

LOCAL control on the current user's PC, no mandatory cloud plane. Optional hardware,
harnesses and audio; LAN requires explicit enablement. Authoritative repository:
E:/developments/projects/Snowball_Middleware, branch codex/local-control-core.
Latest implementation **4eccedc**. PLAN.json revision 12: 11/28 tasks done, 23/56
acceptance checks passed, 40/40 scenarios mapped. MW.06.01.01.01 remains IN PROGRESS;
A1/A2 remain pending. Do not label this as complete onboarding or packaged MVP.

## Exact next action

Read apps/supervisor/README.md, runtime.mjs and the task evidence. Continue
MW.06.01.01.01 with native directory-dialog Windows/macOS behavior/cancellation
verification and actionable selection/storage error messages. Then wire reviewed
harness setup/auth/probe actions while keeping executable approval outside HTTP.
Run actual authenticated recovery and Internet-off journeys before A1/A2 completion.
Current browser and persistence foundation should be reused, not reimplemented.
No change to blocked Codex exact-answer proof/login-environment question, HID
model/physical gates or MK20 authenticated firmware gates. See historical detail below.

## Completed work and important files

- Preserved, reviewed and committed incoming harness-survey work from the previous
  agent: explicit metadata-only rescan/API/SDK/cards, no probe or process start.
- packages/core/src/workspace-store.ts: dedicated existing DurableLog, checked host
  binding, snapshots validated and fsynced before granting/revoking, original root
  identity retained on restart. Storage failure cannot publish a new grant.
- packages/api/src/index.ts and SDK: empty-body trusted picker action, CSRF/auth,
  cancel/disconnect/revocation/expiry guards immediately before durable commit,
  one in-flight operation, bounded HTTP wait and no late grants. No browser path.
- apps/supervisor/runtime.mjs/private-state.mjs: composition root, current-user
  Windows DACL or POSIX owner/mode checks, native state files and separate locked
  command/workspace logs. Existing broad/foreign permissions fail without repair.
- native-picker.mjs/run.mjs: opt-in native chooser and interactive developer CLI.
  Native Windows/macOS dialog interaction is NOT verified. Browser test used a
  trusted temporary-directory chooser fixture. No tray/service installer yet.
- SDK default fetch bound to globalThis: real browser bootstrap exposed the missing
  Window receiver that Node tests had hidden. Added regression coverage.
- Full details/limitations/sources: docs/middleware/evidence/MW.06.01.01.01/verification.md.

## Tests and observable evidence

Full npm test passed **124/124** before SDK receiver fix. Final API suite after
that fix passed **17/17**, including its new regression. Store/selection/API 23/23,
private-state ACL 2/2 and composed runtime restart 1/1 overlap those suites.
Actual Windows browser: bootstrap -> no-harness skip -> empty workspace -> fixture
folder registration -> no-device skip -> Overview; restart listener -> new bootstrap
-> preserved workspace initially unverified -> recheck empty -> logout. Layout viewed.
No user credentials, projects, native harness, inference, device or firmware touched.
No actual OS Internet disconnect, macOS, native chooser interaction, physical device,
installer/update or complete auth/probe journey tested. Checks remain pending.

## Failed approaches and process cleanup

Get-Acl autoload failed in Windows PowerShell; fixed helper now uses .NET ACL APIs,
without execution-policy bypass. ACL test then passed, including refusing an Everyone
read grant on a disposable state file. Browser fetch receiver issue fixed and actual
journey rerun. Initial preview stdin was closed; it exited via its 300-second cleanup
timer (exit 0). Second PTY preview stopped explicitly (exit 0). Both temp stores and
browser tab cleaned up. Ignored .state fixture scripts/logs are not product endpoints.

## Git and commands

4eccedc includes the same-task incoming dirty slice and this verified implementation.
This handoff/RESUME follow in a documentation commit. No remaining source edits or
stash intended. Source Snowball_Control has preexisting extensive dirty changes;
only its top HANDOFF pointer is refreshed, uncommitted. Do not reset/bulk commit it.

npm run build
npm run start:local -- --native-picker
node --test tests/workspace-store.test.mjs tests/workspace-selection.test.mjs tests/local-runtime.test.mjs tests/private-state.test.mjs
node docs/middleware/validate-plan.mjs --next

CLI is interactive-only; it displays a one-use local bootstrap code and never embeds
credentials in URLs or browser storage. Native picker is experimental. Never steal
stale locks, reset corrupt state, or infer authenticated command control from discovery.

---
Historical checkpoints below; the section above supersedes their quota/next actions.

# Local middleware — harness survey onboarding slice, 2026-09-19 UTC (muse-spark)

Handoff state: READY. MW.06.01.01.01 stays IN PROGRESS (A1/A2 pending, no
acceptance claimed). Added the read-only harness survey slice; trusted native
workspace selection/registration, per-user persistence and browser end-to-end
journeys remain. CodexBar returns no valid quota (claude provider credential
error); per AGENTS quota-tool-failure rule, no percentage is invented and
normal contained work continued. Last recorded actual usage (2026-09-19
checkpoint): 32% five-hour, 1% weekly remaining — treat weekly budget as
scarce, keep units atomic. Recheck before large work.

Objective: 로컬 제어 middleware / MW.06 hardware-free supervision onboarding.
Plan: E:/developments/projects/Snowball_Middleware, docs/middleware/PLAN.json
rev 11, resumeTaskId MW.06.01.01.01 (unchanged).
Active task ID / ancestor path: MW.06.01.01.01 under MW > MW.06 > MW.06.01.
Actual Git branch / HEAD / dirty and untracked files: branch
codex/local-control-core, HEAD 6e8967e plus uncommitted slice. Dirty/new:
packages/api/src/index.ts, packages/client-sdk/src/index.ts,
apps/supervisor/app.js (+README), packages/api/openapi.v1.json (+README),
tests/local-api.test.mjs, docs/middleware/PLAN.json (checkpoint only),
HANDOFF.md. No stash. Build outputs git-ignored.
Completed work and exact evidence: optional `HarnessSurvey` on
`LocalApiOptions` (describe/rescan, runtime-supplied); snapshot carries
`harness` survey or null; explicit `POST /v1/harness/scan` with auth, CSRF,
empty-body, busy-slot and revocation checks; SDK `scanHarness`; onboarding
step 1 lists candidates with empty/partial/null states and never claims
version or control; openapi v1 gains scanHarness + HarnessSurvey (10 paths);
static test proves served assets reference no remote origin (J05/A2 support).
`npm test`: 113/114 — 3 new tests pass; single failure is the known
plugin-host crash-timing flake, 9/9 in isolation, untouched by this slice.
Validator: 132 nodes, 40/40 scenarios mapped.
Current incomplete work / changed files: see dirty list above; nothing
committed. Probe execution NOT wired (deliberate — see decisions).
Exact next action: trusted native workspace selection/registration plus
protected per-user persistence into onboarding (manual explicit-grant path
first; browser cannot pick native folders for the server), then browser-test
authenticated skip/retry/restart and Internet-off journeys. After that,
MW.07.01.01.01 audio-source split is the only other dependency-ready task.
Tests run / not run / failures: npm run build pass; npm test 113/114 (flake
above, isolated 9/9 pass); test:reference not rerun (reference/ untouched);
optional speech, macOS, physical HID/MK20, pairing, real-provider control,
tray/installer not run.
Processes or device state to preserve: none started; no listener, login,
probe execution, or device access from this slice. Hardware/daemon preserved.
Decisions / constraints / failed approaches: browser never triggers probes —
provider policies live in MW.03.02.01.01 and PROBES.md forbids HTTP-issued
binary approvals; UI states this. Snapshot never auto-scans (explicit rescan
only). One draft slip (stray no-op lines in a new test) removed before run.
Blocker and alternative ready task: HID/MK20/owner-proof blockers unchanged
(external inputs). Only other ready task: MW.07.01.01.01.
Quota source / actual status: codexbar invalid (credential error); last
recorded 32% five-hour / 1% weekly (2026-09-19). Automatic protection
unavailable until codexbar authenticates.

---

# Local middleware — resumable checkpoint, 2026-09-19 UTC

Handoff state: READY. User explicitly requested continued work until usage ends.
Latest actual usage: 32% five-hour remaining, 1% weekly remaining. No reset credit
used. CodexBar authentication still fails; desktop actual usage works. Preserve
this checkpoint before further work; inspect fresh quota. This is weekly exhaustion
preparation, not a five-hour mandatory threshold claim.

## Latest work — 2f701bf

MW.06.01.01.01 is IN PROGRESS, both acceptance checks still pending. Partial browser
onboarding lives in apps/supervisor. Optional same-origin API assets, self-only CSP,
memory-only one-use bootstrap, skip/back/refresh/cancel/logout, workspace summaries
and authenticated recheck are implemented. Registry changes invalidate SSE snapshots.
Recheck admits no new path, requires CSRF, rechecks revoked sessions, limits four
concurrent operations/one per workspace, ends HTTP wait at 3 seconds and retains
hung native-work slots until settlement. Missing folder remains repair state.

Build passed. Full suite 110/110 before final deadline addition; final focused
API/workspace 20/20 including timeout, occupied slot and revoked-session checks.
Browser first screen and empty-code validation visually verified. Authenticated
wizard journey, manual registration, restart/offline, macOS/mobile not verified.
Preview uses a disposable journal and a 180-second self-cleanup timer; no real user
credentials/projects/harnesses/devices. Browser tab closed. No other runtime touched.

Exact next action: continue MW.06.01.01.01 by connecting reviewed harness discovery/
probes and trusted native folder selection/registration plus protected per-user
persistence. Then test authenticated skip/retry/restart/Internet-off in the browser.
Do not mark this task done from the partial shell; harness setup and folder-selection
UI explicitly say unavailable. Overview is a count/status shell, not command UI.
See apps/supervisor/README.md and PLAN.json checkpoint. Changed files are listed there.

## Objective and authority

Hardware-independent LOCAL control on the user's computer; no mandatory cloud
control plane. Hardware and speech are optional. LAN is explicitly enabled only.
Eventually deliver Mac/Windows tray plus local browser Supervisor for multiple
harnesses, devices and projects. Current packages are foundations, not an installed
tray/service/Supervisor or completed local alpha.

Authoritative repo E:/developments/projects/Snowball_Middleware, branch
codex/local-control-core. PLAN.json revision 11 is the only task ledger: 132 L0–L5
nodes, 28 tasks, 56 checks, 40 discovery scenarios. 11/28 tasks done, 23/56 checks pass.
Task tree is generated. Prioritize dependency-ready designDemand, then difficulty,
then stable ID. Source Snowball_Control has a redirect, not a competing ledger.

## Exact next action and current task

Run the plan validator with --next. Resume **MW.06.01.01.01** under
MW > MW.06 > MW.06.01 > MW.06.01.01: local onboarding/Connections.
Read API/SDK contracts and the workspace/device/harness registries first. Resolve
missing trusted registration and runtime API wiring before presenting real actions.
Implement same-origin local status -> harness -> workspace -> optional device, with
skip/cancel/retry and truthful empty/partial/auth/permission states. Do not present
mock discovery as control. Onboarding and audio share priority 4/4; stable ID selects
onboarding first. This task is now partially implemented; latest section above supersedes the original entry plan.

MW.05.01.01.01 is DONE in **3384d90**. Core WorkspaceRegistry separates metadata-only
provider candidates from explicit root grants, pins canonical + physical identity,
handles empty/missing/permission/replacement and explicit same-directory relocation,
keeps separate worktree/alias project IDs and explicit logical links, and supplies a
bounded restore codec that preserves original identity. API reads now revalidate
root/file identity and deny .git/junction/sibling traversal. See ADR-007 and evidence.
Persisting the codec in protected per-user storage, folder picker, and registry API/UI
integration remain runtime/onboarding work; CorePersistV1 is not silently upgraded.

MW.03.01.01.02 generic probes are DONE (91d84bd). MW.03.02.01.01 Codex reference
plugin is implemented experimentally but BLOCKED at real acceptance. Before actual
logged-in native create/send/events/decision/cancel verification, resolve the pending
user choice of credential environment: default current-PC Codex CLI login or separate
test account home. The asynchronous question has no answer yet. Do not copy tokens,
automatically sign in, or use existing Desktop threads as test targets. If an answer
arrives, record/use that selection; do not repeat a redundant permission question.

Codex actual verification used ONLY a fresh empty temporary CODEX_HOME, not the
user's logged-in home. It proved selected binary version, native initialization,
needs_auth, empty thread list, isolated worker startup without autospawn, native
child exit and temporary-folder removal. It sent no model turn. Native exact-answer
decision proof remains unresolved; serverRequest/resolved can mean cleared, so
submitted decisions intentionally remain unknown. macOS/Desktop-race evidence is
also missing. Continue independent onboarding work while these gates are unresolved.

## Completed work and commits

Prior foundation: 93a56e9 separate repo/SDK/isolated plugins; 09ff529 identity/context;
f17a769 durable journal; f8e1e07 loopback API/SDK; d8678d1 device registry; fe9eec0
previous handoff. Reference/legacy-host remains a hash-preserved 346-file export.

Earlier discovery session:
- f9bcc0f: HID backend and isolated worker, reviewed-profile-only enumeration and
  safe identify gesture tests. Optional node-hid 3.4.0. Empty production profile
  catalog means NO actual model is enabled. Native metadata inventory saw 26 Windows
  collections; no handles opened. Task blocked on actual model/report and physical
  Windows/macOS verification. Eleven tests do not replace those gates.
- 01d0144: opt-in LAN candidate provider, selected-interface UDP mDNS query driver,
  bounded PTR/SRV/TXT/A followups, manual endpoints, TTL/cancel/NIC-change handling.
  Disabled default, all candidates unpaired/control=false. Nine tests including real
  loopback UDP; user LAN never enabled. Task done for provider contract only.
- 15d9f84: bounded harness candidate collection plus MK20 evidence. Core discovery
  checks exact provider-supplied known/manual/PATH file paths and registered literal
  loopback endpoint metadata; no executable, DNS, socket, recursive scan or guessed
  service port. Canonical aliases deduplicate within provider; installs remain
  separate. Version unknown, unprobed, control false. Eight tests include Windows/
  macOS path fixtures and native Windows temporary-file inspection.
- Source Snowball_Control commit d5eabaf: only new plugins/device-mk20 directory.
  Legacy decoder/preview and pinned-peer explicit lab UDP; production control always
  rejects and USB/LAN cannot merge. Four tests including real loopback. Current
  firmware lacks authenticated pairing, so MW.04.02.01.02 A1/task BLOCKED. A2 passes
  the fail-closed adapter boundary. PAIRING-CONTRACT.md is a requirement, not firmware.
- e164bb5: earlier probe classifier checkpoint; transport was implemented later in 91d84bd.

Latest implementation session:
- **91d84bd**: literal-loopback GET health/schema probes and approved fixed-argv
  binary checks, separate generation/timeout/auth/version/permission states. 92/92
  tests at that milestone. Probe generic task done; no provider support inferred.
- **fc0b203**: packages/harness-codex isolated worker/manifest and selected 0.153.4
  native stdio adapter, owner/session/turn/decision pinning, no historical takeover,
  journal integration, authentic Windows empty-home connection/cleanup evidence.
  See ADR-006 and package support matrix. Task remains blocked at native control gates.
- PluginHost normal stop now sends stdin EOF before force kill to allow owned-child
  cleanup. Native Codex waits for closed stdio on normal exit. Binary probe size bound
  is 512 MiB (actual selected executable is 295,408,944 bytes), still streamed/bounded.
- Full test file concurrency capped at four after parallel startup fixture starvation.
  Production timeout limits were not relaxed. Final full build/test: **101/101 pass**.

Current workspace session:
- **3384d90**: workspace registry, API read integration, seven workspace tests,
  ADR-007 and acceptance evidence. No user projects, accounts, hardware or network
  discovery touched. Native Windows directories/junctions; case/permission fixtures.
- Full suite's existing process-start timing tests were unstable even at four-file
  concurrency. Non-timing plugin fixture budget is 2000 ms; test default now serial.
  Deadline-specific assertions and all production timeouts remain unchanged.
- Build passed, focused 17/17, final full serial **108/108** (23.3 seconds).

## Architecture and constraints

Core imports Node builtins only, never hardware/provider/reference implementation.
Plugins are isolated processes with reviewed artifact approval and bounded frames,
but process separation is not an OS sandbox (ADR-001).

ADR-002: journal fsyncs bounded SHA-256-chain WAL before adapter entry, pins owner
and revision, deduplicates immutable command intent, centrally claims decisions.
No automatic dispatch/replay. Startup cancels queued and marks uncertain delivery
unknown. ACK requires authoritative owner acceptance, not socket write. Corrupt/full
storage fails closed; explicit offline dead-PID lock recovery only. No compaction UI
or sudden-power-loss/Windows ACL verification yet.

ADR-003: 127.0.0.1 API, exact Host/Origin, one-use trusted internal bootstrap,
memory bearer/CSRF, actor-bound commands; HTTP only admits, never dispatches.
SSE invalidations require resnapshot on gaps. No URL/storage/log credentials.
Workspace reads registered/bounded; no same-user filesystem sandbox promise.
Tray bootstrap integration, same-origin Supervisor and installed persistence remain.

ADR-004: candidate != registered device, per-controller contexts and volatile leases,
restored bindings start offline. Verified identity comes from adapter evidence, never
IP/name/USB path. Physical reconfirmation for unstable identity; no generic keyboard
capture. Driver input is semantic only, requires future journal/runtime wiring.

HID: reviewedProfiles=[]; no model-specific approval exists. Native async operations
are bounded in flight; worker termination contains a hung backend. Actual report
contract and both-OS physical evidence are required before task completion.
LAN: private/link-local IPv4 selected interface only, no subnet sweep, no automatic
NIC fallback, no authenticated pairing inferred. IPv6/proxy advertisements excluded.
Harness candidates: provider catalog construction/settings persistence belong to
provider/runtime tasks. Finite exact metadata operations; a hung filesystem call
retains one occupied slot, returns stale results, ignores late generation output.
Metadata stamp is not executable approval. Invalid endpoint diagnostics redact URL.
MK20: source adapter is a standalone lab library, not a ready production plugin.
No firmware or existing daemon changed, no real device contacted this session.

## Tests and verification

- Current build passed; focused workspace/API tests 17/17; final full
  node --test --test-concurrency=1 tests: **108/108 pass**.
- Initial full npm test 107/108 (plugin startup); four-file rerun 106/108
  (binary fixture startup/output deadline). Serial default resolves observed load
  failures. No production deadline relaxed. Prior milestone was 101/101.
- Includes eight HTTP probe tests, seven binary probe tests, six Codex adapter tests
  (one real durable journal integration), three real Node stdio transport tests.
- Native script: node scripts/verify-codex-local.mjs <selected-executable> <sha256>.
  Codex 0.153.4 Windows x64, SHA-256
  444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b.
  Final exit 0, connected/needs_auth/empty list, nativeChildExited=true and temp home
  removed. No user credentials or actual inference used. Official docs and locally
  generated 0.153.4 schema consulted; schema lives ignored under .state.
- Plan: valid 132 nodes / 40 scenarios / 11 tasks done / 23 checks pass.
- Native fixture and final git diff whitespace checks passed.
- Source MK20 4/4 and reference 44/44 are historical results, not rerun this session.
- Not run: real logged-in Codex create/send/events/decision/cancel, actual Desktop race,
  macOS, physical HID/MK20, signed installers/tray/UI/update, optional speech.
- No owned plugin/native listener intentionally left running. Only preexisting user
  Codex native process remained in the final process-name inventory; it was untouched.

## Remaining work and external inputs

1. Implement MW.06.01.01.01 onboarding and its missing trusted registry/runtime wiring.
   Workspace task is complete; do not recreate it or generic probes.
2. Codex logged-in environment choice pending; actual control and decision evidence
   remain blocked. Unsupported Desktop/private routes stay unsupported on both OSes.
3. HID selected model/report and physical Windows/macOS verification pending; reviewed
   profile catalog stays empty. Never open typing collections to guess a model.
4. MK20 authenticated firmware/physical pairing remains blocked; legacy lab adapter
   cannot gain control or merge transports from an IP/name/serial claim.
5. Follow --next for workspace onboarding, audio separation, runtime lifecycle,
   Supervisor, tray/Settings, packaging/install/update and remaining integrity gates.

## Failed approaches / known limitations

Earlier-session resolved failures (full details in Codex evidence):
- Initial direct native kill produced EBUSY removing the temporary home after PID
  exit. Native stdin EOF/closed-stdio wait and bounded rm retries passed on rerun.
- Journal test cleanup ran before lock close (ENOTEMPTY); cleanup ordering fixed.
- A 96/98 full run had two existing plugin startup timeouts under parallel native
  load; four-file test concurrency gave final 101/101, without production changes.
- Initial 256 MiB native probe bound was too small for installed Codex; finite 512 MiB
  streaming bound passed actual native version verification.
- Exact answer acceptance cannot be inferred from resolution/clearing notifications.
  This remains a limitation, not a resolved failure or successful delivery.

CodexBar authentication fails; desktop actual usage is available. Do not infer quota
from tokens or spend project time repairing it. Legacy firmware substring parsing
requires bounded/sanitized lab preview text; full render interoperability unverified.
PowerShell does not support Bash brace-expansion file paths; use explicit paths.
Previous Host header tests use native HTTP because fetch normalizes hostile Host.
Existing plugin timeout fixture uses 1000 ms to avoid 150 ms concurrent-suite flakes.
Do not collapse queued large payload recovery into one giant transaction.

## Git state and preservation

Middleware on codex/local-control-core; latest implementation **2f701bf** is committed,
then this handoff/RESUME are checkpointed. No uncommitted implementation remains. Verify git status/log/diff. No stash made.
Sibling E:/developments/projects/Snowball_Control on pilot/codex-app-recon at d5eabaf
has extensive PREEXISTING dirty/untracked host/hardware/docs. Only new MK20 plugin
files were committed. Source HANDOFF's top pointer is refreshed uncommitted, preserving
its older content and user changes. Never reset/stash/bulk commit that repository.

## Commands

    npm ci --ignore-scripts
    npm test
    node --test tests/http-probes.test.mjs tests/binary-probes.test.mjs tests/codex-adapter.test.mjs tests/codex-rpc.test.mjs
    node docs/middleware/validate-plan.mjs --next
    node docs/middleware/validate-plan.mjs --write-tree
    node docs/middleware/validate-plan.mjs --affected R-LOCAL
    git status --short
    git log -10 --oneline
    git diff

Source-only: `npm test --prefix plugins/device-mk20` in Snowball_Control.
Model identity has no product behavior role. Astra, Antigravity or another LLM should
resume the same task IDs, evidence and dependency tree without redesigning by default.
