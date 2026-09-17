# Plugin SDK / host protocol verification

2026-09-17, Windows x64, Node 20.19.6 / TypeScript 5.9.3. `npm test`: **9 passed, 0 failed** after a clean `npm ci --ignore-scripts` install.

Actual child Node processes verify: manifest SDK/path/duplicate rejection and immutability; virtual-device handshake/request/event; undeclared operation rejection; unapproved/modified executable rejection; request timeout and next-request isolation; before/after-dispatch cancellation; outstanding request limit; crash isolation and restart cooldown; oversized unterminated output; event spoof/flood protection; concurrent startup/stop without an orphan child.

Post-dispatch failures are marked unknown. No automatic restart/replay, network listener, device access, harness login or real prompt is used. New SDK/host/virtual packages compile independently of legacy source and MK20 tooling.

See `docs/ADR-001-PLUGIN-BOUNDARY.md` for exact boundaries: trusted current-user plugins, entrypoint integrity only, no malicious-code sandbox, configuration contract only (no configuration execution API), process-local crash isolation and explicit backoff. macOS/native module/package installer verification is not covered by these tests. Child-process descendants require additional lifecycle policy before plugins that spawn persistent processes ship.

TypeScript initially rejected stale control-flow narrowing around asynchronous start/stop. Lifecycle generation now determines cancelled startup, covered by the concurrent start/stop test.
