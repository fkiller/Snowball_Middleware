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
