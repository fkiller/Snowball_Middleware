# Local middleware — resumable checkpoint, 2026-09-17

Handoff state: READY — MANDATORY QUOTA HANDOFF. Final actual desktop usage check reports 5% of the five-hour window remaining (95% used), crossing AGENTS' <=10% stop threshold. Implementation had already ended during the 13% preparation phase; only handoff preservation followed. No new implementation may begin in this usage window. This is not a claim that the full MVP is complete. Check fresh usage when resuming, or continue with another agent. CodexBar authentication remains unavailable; the desktop usage tool supplied actual figures. No reset credit was consumed.

## Current objective and authority

Build hardware-independent LOCAL control middleware in this separate repository. Current-PC/loopback operation is fundamental; hardware, speech and a cloud control plane are optional. Harness cloud inference is separate. LAN devices/other PCs require explicit future opt-in. Tray-only Mac/Windows shell plus a local browser Supervisor must eventually supervise multiple harnesses, projects and devices.

Authoritative repository: E:/developments/projects/Snowball_Middleware.
Branch: codex/local-control-core. PLAN.json revision 6 is the sole implementation ledger; source Snowball_Control holds a redirect only. There are 132 L0–L5 nodes, 28 tasks, 56 checks and 40 mapped discovery scenarios. Current result: 7/28 tasks done; 14/56 checks passed. Choose dependency-ready work by designDemand, then implementationDifficulty, then stable task ID. Do not start easier UI work merely because it is visible.

## Completed work and relevant commits

- 93a56e9: separate repository, 346-file hash-preserved reference export, SDK, isolated plugin host and initial virtual device. 75f98dc: previous quota handoff.
- 09ff529: reviewed and preserved the other model's identity/context implementation (MW.02.01.01.01). It had been uncommitted at entry; baseline tests passed before commit.
- f17a769: MW.02.01.01.02 durable commands/central decision claims/recovery. Includes destination-sensitive approval cache updates, review-draft restore preservation and lexical path normalization fixes.
- f8e1e07: MW.02.02.01.01 authenticated loopback API, client SDK, OpenAPI v1 and real HTTP/SSE tests.
- d8678d1: MW.04.01.01.01 optional device registry, versioned offline restore, per-device leases/context, two-device real virtual-plugin integration and API snapshot fields.
- The next documentation-only commit records this handoff. Use git log to obtain its exact hash; d8678d1 is the latest implementation commit.

## Current state and architecture

Core and plugin packages build and test on Windows with Node 20.19.6 and pinned TypeScript 5.9.3. Production core imports Node builtins only, never reference/legacy-host or a concrete provider. No installed tray/GUI/runtime service is delivered yet. Packages are reusable foundations, not a completed executable local alpha.

1. ADR-001 defines reviewed entrypoint digests, explicit child-process start, bounded frames and no implicit retry. Process separation is not a sandbox.
2. ADR-002 defines host-local commandId + immutable canonical fingerprint, pinned owner and session revision, centrally claimed decisions, queue limits and explicit dispatch. A synchronous bounded append-only SHA-256-chain WAL is fsynced before adapter entry. Startup cancels queued work, marks uncertain delivery unknown and never calls an adapter. Exact retries return retained state; changed intent conflicts. ACK is authoritative owner acceptance, not bytes written. The journal lock is never stolen automatically. Explicit offline dead-process recovery is exported. Corrupt/torn/future data fails closed. No provider-level exactly-once promise.
3. ADR-003 defines 127.0.0.1-only API, exact Host/Origin, one-use tray/CLI bootstrap, memory bearer + CSRF, actor-bound mutation and read-only host supervision. HTTP only admits commands, never dispatches or injects owner/proof. SSE is bounded invalidation with epoch:sequence and resnapshot on gaps. SDK never retries mutations. Credentials are not URL/storage/log fields. Workspace read paths are registered, bounded and reject traversal/ADS/symlinks; hostile concurrent same-user filesystem swaps are not an OS-sandbox guarantee.
4. ADR-004 defines discovered candidates versus explicit device registration, plugin/instance identity, independent Controller IDs, volatile leases and timestamp/sequence checks. Device registry export/restore preserves bindings/context but starts offline. Verified identity is adapter-supplied evidence, never inferred from IP/name/path. Missing stable identity requires physical reconfirmation. No cross-transport merge or generic keyboard capture. Device buttons emit semantics; central journal admission is still required by future runtime wiring.

Important files: packages/core/src/{identity,context,commands,durable-log,journal-model,devices}.ts; packages/api/src/{index,workspaces}.ts; packages/api/openapi.v1.json; packages/client-sdk/src/index.ts; packages/device-virtual/src/index.ts; tests/{core-journal,core-recovery-boundaries,local-api,device-registry}.test.mjs; tests/fixtures/journal-crash.mjs; docs/ADR-002 through ADR-004; task evidence folders.

## Exact next action

Read AGENTS.md, this file, PLAN.md, PLAN.json and DISCOVERY_JOURNEYS.md; verify git status/log/diff. Run the plan validator with --next. Resume MW.04.01.01.02 under MW > MW.04 > MW.04.01 > MW.04.01.01 (hardware discovery/control journey).

First implementation step: inspect D02–D08, the DeviceRegistry contract and existing reference hardware facts; choose a bounded HID backend contract that checks VID/PID, usage/interface and report support before opening handles. Inspect currently available hardware read-only before assuming a model or two-OS test access. No broad keyboard capture. A2 requires duplicate models/no serial/USB-port changes to avoid wrong association. A1 requires real Windows/macOS evidence; fixtures alone cannot pass it. Keep actual unsupported/no-device/permission outcomes visible and do not conflate enumeration with verified control.

Then continue priority/dependency ordering: opt-in LAN discovery (MW.04.02.01.01), relevant device pairing/lifecycle; bounded harness candidate discovery and probes (MW.03.01.01.01/.02) when eligible. If a real-device/OS gate is externally blocked, record exact evidence and continue other dependency-ready work instead of fabricating acceptance. Higher-level discovery, harness integration, workspace onboarding, Supervisor UX, tray, signing/install/update gates all remain unfinished.

## Tests and verification

- npm test: 47/47 pass (build plus identity, WAL, real crash processes, real loopback HTTP/SSE, registry/two-device virtual plugin, isolated plugin tests).
- node --test tests/local-api.test.mjs after the final OpenAPI device-field update: 10/10 pass.
- npm run test:reference: 44/44 pass earlier in this session; reference files unchanged afterward.
- Plan validator: valid 132 nodes / 40 of 40 discovery scenarios / 7 tasks done / 14 checks passed.
- git diff --check: passed before implementation commits.
- Not run this session: optional speech tests, macOS, actual HID/MK20/provider, installed UI, signed installers, power-loss durability or LAN pairing. Historical speech fixture evidence exists but is not new evidence.

Tests leave no API listener or child plugin process running. The existing sibling hardware/daemon was not stopped or modified.

## Known limitations / missing integration pieces

- Durable WAL has bounded capacity and no compaction UI; full/corrupt storage fails closed and requires offline maintenance. Windows ACLs and sudden power loss are not verified.
- Device configuration export/restore is a codec; the future installed local runtime must persist it atomically and wire adapter verification/lease revocation. It is not an installed storage service.
- There is no actual HID backend or physical identification UX yet. Unverified devices cannot transparently reconnect. The virtual plugin's simulateInput operation is fixture-only.
- API bootstrap is a trusted internal method. A tray grant/paste onboarding page and same-origin Supervisor hosting remain to be integrated. API snapshot includes device/source/candidate summaries but HTTP cannot register hardware or mint grants.
- API submission does not call a harness. Real adapters must provide owner/correlation/decision proofs and explicit dispatch. The absence of any hardware does not block this core/API path.
- Browser refresh/session expiry requires fresh bootstrap. Future UX may improve this without URL/localStorage secrets.
- Native multi-question/freeform decision schemas, real-provider version compatibility, install/update rollback and support matrix are future work, not covered by mock acceptance.

## Failed approaches worth remembering

- Node fetch normalizes some hostile Host overrides. Host tests use native HTTP to actually send the invalid header.
- A preexisting 150 ms plugin startup/timeout fixture flaked with parallel HTTP/filesystem tests. It now uses 1000 ms and delivers the first late reply while the second request is still pending; production timeouts were not relaxed.
- Avoid assembling an entire queue of 64 KiB command payloads into one 1 MiB recovery transaction. Recovery and owner change are bounded per-command transactions; large-queue tests cover it.
- CodexBar could not authenticate. Do not infer usage from token count or repeatedly repair the quota tool.

## Git state and preservation

Middleware implementation commits are clean and consistent. Only this handoff/RESUME documentation is being updated after d8678d1; commit it as a documentation checkpoint. No stash was created. Verify final git status rather than relying on this paragraph.

Sibling E:/developments/projects/Snowball_Control remains on pilot/codex-app-recon at c4513bb with extensive preexisting dirty/untracked host/hardware/docs. Do not reset, bulk commit or discard that work. Only its top handoff pointer is refreshed to this checkpoint; historical paragraphs there are not current instructions. Reference export remains unchanged.

## Useful commands (run in Snowball_Middleware)

    npm ci --ignore-scripts
    npm test
    npm run test:reference
    node docs/middleware/validate-plan.mjs --next
    node docs/middleware/validate-plan.mjs --affected R-LOCAL
    node docs/middleware/validate-plan.mjs --write-tree
    git status --short
    git log -10 --oneline
    git diff

No permission/planner-model confirmation is pending. The previous model's journal contract questions were resolved in ADR-002 and implemented; do not pause again for an Astra-only review.
