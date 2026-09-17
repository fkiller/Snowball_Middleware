# Local middleware foundation — 2026-09-17

Handoff state: READY — MANDATORY QUOTA HANDOFF. Final actual app check reports 8% five-hour remaining (92% used), crossing the AGENTS <=10% threshold. Implementation has stopped; only safe preservation/handoff followed. Continue with Antigravity or after Codex quota resets. CodexBar authentication is unavailable; recheck real app usage in the next session.

## Current objective and priority
Local control first; hardware is optional. The user explicitly requests highest design-demand/difficulty work first while respecting dependencies. PLAN.json priority fields and validator --next implement that order. No mandatory cloud control plane; local-LAN is opt-in.

## Current repository and completed tasks
Authoritative repository: E:/developments/projects/Snowball_Middleware. Branch codex/local-control-core. Latest implementation commit: 93a56e9 (extract local middleware and establish isolated plugin protocol). A subsequent documentation-only handoff commit may be HEAD; use git log -2. Source prototype remains separately at ../Snowball_Control, source HEAD c4513bb plus preserved dirty/untracked work.

Completed: MW.01.01.01.01 inventory (346 hashes); MW.01.01.01.02 separate repo/scaffold/reference suite; MW.01.02.01.01 SDK and isolated plugin-host foundation. PLAN.json: 3/28 tasks done, 6/56 checks passed. Source plan is a redirect, not a second ledger.

Production files: packages/plugin-sdk/src/index.ts, packages/plugin-host/src/index.ts, packages/device-virtual/src/index.ts. Contract/security limits: docs/ADR-001-PLUGIN-BOUNDARY.md. New tests: tests/plugin-host.test.mjs. packages/core is reserved for next implementation; no Core/API/tray/browser/installer implemented yet.

## Exact next action
Read AGENTS.md, docs/middleware/PLAN.md, DISCOVERY_JOURNEYS.md, PLAN.json and RESUME.md. Run node docs/middleware/validate-plan.mjs --next. Start MW.02.01.01.01: define stable Host identity, composite Session identity, registered Workspace/Project identity, and per-Controller context/draft destinations. Read reference/legacy-host/src/state/context.ts and mvp-controller.ts as behavior evidence; do not import them into Core. Add collision, independent-context and persistence/migration tests. Then durable command journal/recovery is the next high-demand dependency; do not skip to UI.

## Architecture decisions and constraints
TypeScript/Node retained. Reference files are byte-preserved, not the production daemon. JSON-RPC over bounded stdio; explicit plugin digest approval; OS/architecture/version checks; immutable manifest; realpath entry containment; fixed operations; pending/frame/event bounds. Cancellation or timeout after dispatch is unknown. No automatic process restart or command replay; explicit exponential cooldown. Plugin events receive authoritative process identity/generation. Separate process is not a security sandbox. Digest covers only entrypoint, not transitive dependencies or publisher authenticity. Config schema is a declared contract; no runtime configure API exists yet. Native plugin package signing, immutable artifact install and child-descendant lifecycle remain future release work.

No USB/network listener/provider login/real harness command was started. Existing user daemon and MK20 firmware remain untouched. No new registry/GitHub/npm release was published. Root source license is missing, so public redistribution must wait for provenance/license review; all packages are private/UNLICENSED for now.

## Tests and evidence
- npm ci --ignore-scripts --no-audit --no-fund: clean dependency install succeeded.
- npm test: TypeScript build and 9/9 new plugin tests pass. Real child processes cover manifest rejection, approval/integrity, unknown timeout/cancel, resource bounds, crash isolation, event spoof/flood and startup/stop cancellation.
- npm run test:reference: 44/44 pass, mocked providers/local sockets only.
- npm run test:reference:speech: 2/2 pass using source machine's existing host/.venv-whisper/Scripts on PATH and cached model/temp fixture. Python/models/audio were not exported. This is not portable speech-install evidence.
- 346 source AND destination SHA-256 hashes matched after copy; original host source untouched.
- Plan hierarchy/dependency/evidence validation: 132 nodes, 40/40 discovery scenarios mapped.
Not tested: macOS execution, physical HID/MK20, real harness ownership/control, installers, network pairing, sandbox security.

## Failed approaches / remaining issues
Initial exporter resolved root one directory too high; it failed before writing exported files, then was corrected. Node 20 Windows does not expand the shell test glob; use node --test tests. TypeScript async state narrowing required generation-based startup cancellation. All were fixed and passing checks recorded. Host stop terminates the directly owned child; descendant process trees are not yet managed. Third-party malicious plugin isolation is not claimed.

## Git / files to preserve
This is a new repository: commit only its explicit source/docs/reference/test/config files. The original Snowball_Control remains extensively dirty with valuable existing work; no blanket commit/reset/stash there. Runtime dependencies/dist/audio/state are ignored. .gitattributes marks reference files -text to preserve hashes across checkout. Historical context is in docs/PROTOTYPE_HANDOFF_ARCHIVE.md, not a current instruction.

## Commands
npm ci --ignore-scripts
npm test
npm run test:reference
npm run plan
node docs/middleware/validate-plan.mjs --write-tree

Next agent should update the same task IDs, evidence and HANDOFF before stopping. Agent identity does not affect product behavior.

Final whitespace audit: scoped new packages/scripts/tests/HANDOFF/README/middleware plan checks pass. The whole initial import has pre-existing whitespace/EOF warnings in generated/reference source and three inherited documents; preserved deliberately to retain exact source hashes. No runtime/test failures remain.
