# MW.02.01.01.01 verification — identity and controller contexts

2026-09-17, Windows x64, Node 20.19.6 / TypeScript 5.9.3.
`npm test`: **16 passed, 0 failed** (7 new core identity/context tests + 9 existing
plugin protocol tests). `npm run test:reference`: **44/44 pass** (legacy prototype
regression, untouched). `node docs/middleware/validate-plan.mjs --next`:
132 nodes, 56 checks, 40/40 scenarios mapped, dependency order holds.

## What was implemented (new production code, no legacy import)

- `packages/core/src/identity.ts` — stable `host_<32hex>` id (generated once,
  persisted; hostname is display only), composite session key
  `hostId/pluginId/instanceId/escapedNative` with canonical percent-encoding
  (`%` then `/`), `Workspace`/`Project` models with absolute normalized roots
  (Windows drive letter uppercased, no bulk lowercasing) and
  project-inside-workspace containment, opaque `ctl_` controller ids,
  per-user data dir resolution (Windows/macOS/Linux, current user only),
  versioned persist schema `controller-state.v1.json` with fail-closed loader
  (unknown version, duplicate ids/roots, cross-host bindings all rejected),
  legacy `dev-pc/codex[/project]` label migration that binds fresh opaque ids
  without merging scopes.
- `packages/core/src/context.ts` — `ControllerContext` per controller:
  independent selection; `beginDraft`/`beginApproval` bind an immutable
  destination (later `selectScope` never retargets, J03); `resolveApproval`
  applies exactly once and reports `stale` otherwise, with
  `notePeerApprovalResolved` for the D17 second-client case; terminal drafts
  never return to pending and `unknown` resolves only to `sent`/`failed`
  (R-RECOVER, no replay). `ControllerStore` isolates controllers and
  snapshots/restores the persisted shape.
- `packages/core/src/index.ts` — public re-exports. Core imports only
  `node:` builtins; no reference/legacy-host, hardware, or harness code
  (R-PLUGIN).
- `tests/core-identity.test.mjs` — 7 tests: A1 cross-host/instance key
  separation, separator round-trip and rejection, A2 two-controller
  independence (scope/draft/approval) plus J03 non-retarget and D17
  apply-once/peer-resolved, terminal/unknown draft rules, workspace
  containment with per-user data dirs (J06), persist round-trip with
  foreign-host/version rejection, legacy migration without label leakage.

## Acceptance mapping

- A1 (same nativeSessionId across instance/host never collides): covered by
  tests 1–2. Same native id under another host or instance formats to a
  different canonical key; `%`/`/` inside native ids stay inside the fourth
  segment; non-canonical and foreign-host keys are rejected at parse.
- A2 (two controllers keep independent scope/draft/approval): covered by
  test 3. Controller B changing scope leaves controller A's draft and approval
  destinations pinned; one approval revision applies once, the peer observes
  `resolved` without re-applying.
- J03/J06/D17 scenario contracts are exercised by tests 3 and 5; J04 durable
  replay and MW.02.01.01.02 command journal remain future work and are not
  claimed here.

## Not tested / not claimed

macOS/Linux data-dir execution (paths resolved but not executed there),
physical HID/MK20, real harness ownership or command send, installers,
network pairing, malicious-plugin sandboxing. No USB/network listener,
provider login, or device access was started. No transcript or credential
material is stored in core state or evidence.
