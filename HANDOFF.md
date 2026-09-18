# Local middleware — resumable checkpoint, 2026-09-18

Handoff state: READY. This is a partial MVP checkpoint, not a completed product.
Read fresh quota before implementation. CodexBar still reports Authentication
required; actual desktop usage reached 14% five-hour remaining (86% used), weekly
28% remaining: AGENTS PREPARE HANDOFF threshold. No large new implementation was
started afterward. No reset credit consumed. Recheck actual quota on resume.

## Objective and authority

Hardware-independent LOCAL control on the user's computer; no mandatory cloud
control plane. Hardware and speech are optional. LAN is explicitly enabled only.
Eventually deliver Mac/Windows tray plus local browser Supervisor for multiple
harnesses, devices and projects. Current packages are foundations, not an installed
tray/service/Supervisor or completed local alpha.

Authoritative repo E:/developments/projects/Snowball_Middleware, branch
codex/local-control-core. PLAN.json revision 8 is the only task ledger: 132 L0–L5
nodes, 28 tasks, 56 checks, 40 discovery scenarios. 9/28 tasks done, 19/56 checks pass.
Task tree is generated. Prioritize dependency-ready designDemand, then difficulty,
then stable ID. Source Snowball_Control has a redirect, not a competing ledger.

## Exact next action and current task

Run `node docs/middleware/validate-plan.mjs --next`; resume MW.03.01.01.02 under
MW > MW.03 > MW.03.01 > MW.03.01.01. Read ADR-005 and packages/core/src/probes.ts.
Implement bounded read-only literal-loopback GET health/schema probing, with real
fixture servers for 401, wrong service, redirect, malformed/oversize response,
unsupported version, refusal, cancellation and timeout. Then implement explicitly
selected/reviewed binary probes through isolated plugin-host approval. Never execute
arbitrary discovered files or turn on a shell for .cmd shims. Do not start servers,
authenticate automatically or send commands during discovery. A1/A2 are pending;
classifier tests alone do not satisfy either. No planner/model approval is required.

Current task step 1 is implemented: assessProbe validates separate presence,
compatibility, auth, permission, connectivity and advertised-control facts. Reason
projection distinguishes needs_auth, not_running, readonly_history, wrong_service,
unsupported, etc. Even compatible stays unregistered/control-unverified. Drivers,
provider version/schema facts and transport evidence are not implemented yet.

## Completed work and commits

Prior foundation: 93a56e9 separate repo/SDK/isolated plugins; 09ff529 identity/context;
f17a769 durable journal; f8e1e07 loopback API/SDK; d8678d1 device registry; fe9eec0
previous handoff. Reference/legacy-host remains a hash-preserved 346-file export.

This session:
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
- e164bb5: probe classifier/ADR/evidence checkpoint. No production probe transport
  has been implemented.

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

- Full `npm test`: 75/75 after discovery (build included).
- After final endpoint redaction: build and discovery 8/8 pass.
- Probe classifier: build and 2/2 pass. Final full `npm test`: 77/77 pass.
- Source `npm test --prefix plugins/device-mk20`: 4/4 pass.
- Plan validator valid: 132 nodes, 40/40 scenarios, 9 tasks/19 checks pass.
- Historical reference suite 44/44 from prior session; reference unchanged, not rerun.
- Not run: optional speech, actual macOS, physical HID/MK20, authenticated pairing,
  real-provider control, installed tray/Supervisor, signing/installer/update gates.
- No test listener/plugin process left running; existing hardware/daemon preserved.

## Remaining work and external inputs

1. Finish MW.03.01.01.02 probe drivers/acceptance above.
2. Follow --next; actual provider integration and owner proof before command control.
3. HID blocked: user has been asked which model and physical/macOS test environment
   is available. No answer received. Do not silently choose one of 26 collections.
4. MK20 blocked: implement reviewed authenticated firmware protocol and physically
   validate approval/cancel/expiry/identity/replay. No claim that legacy UDP is secure.
5. Device lifecycle, workspace onboarding, Supervisor, tray/runtime wiring, signed
   packaging/install/update and complete product integrity gates remain unfinished.

## Failed approaches / known limitations

CodexBar authentication fails; desktop actual usage is available. Do not infer quota
from tokens or spend project time repairing it. Legacy firmware substring parsing
requires bounded/sanitized lab preview text; full render interoperability unverified.
PowerShell does not support Bash brace-expansion file paths; use explicit paths.
Previous Host header tests use native HTTP because fetch normalizes hostile Host.
Existing plugin timeout fixture uses 1000 ms to avoid 150 ms concurrent-suite flakes.
Do not collapse queued large payload recovery into one giant transaction.

## Git state and preservation

Middleware on codex/local-control-core; implementation is selectively committed,
then this handoff/RESUME are checkpointed. Verify git status/log/diff. No stash made.
Sibling E:/developments/projects/Snowball_Control on pilot/codex-app-recon at d5eabaf
has extensive PREEXISTING dirty/untracked host/hardware/docs. Only new MK20 plugin
files were committed. Source HANDOFF's top pointer is refreshed uncommitted, preserving
its older content and user changes. Never reset/stash/bulk commit that repository.

## Commands

    npm ci --ignore-scripts
    npm test
    node --test tests/harness-discovery.test.mjs tests/harness-probes.test.mjs
    node docs/middleware/validate-plan.mjs --next
    node docs/middleware/validate-plan.mjs --write-tree
    node docs/middleware/validate-plan.mjs --affected R-LOCAL
    git status --short
    git log -10 --oneline
    git diff

Source-only: `npm test --prefix plugins/device-mk20` in Snowball_Control.
Model identity has no product behavior role. Astra, Antigravity or another LLM should
resume the same task IDs, evidence and dependency tree without redesigning by default.
