# MW.02.02.01.01 — authenticated loopback API

2026-09-17, Windows x64 / Node 20.19.6. `npm test`: 42/42 pass, including
10 live HTTP/client-SDK/spec tests. Build passes. Earlier reference baseline in
this session: 44/44; reference source untouched.

A1: actual HTTP listener bound to 127.0.0.1. Foreign Host, foreign/null Origin,
cross-site/same-site fetch metadata, absent/expired/revoked bearer, missing CSRF,
missing POST Origin and URL query credentials are rejected. Bootstrap is one-use
and expires. A slow request revoked before body completion cannot enqueue work.
SDK authenticated actor overrides no client input; changed idempotent intent and
stale revision return conflicts. Wrong controller cannot reuse a command ID.
Admission stays queued with no adapter execution. Credentials appear in body/header
only; SDK transport failure does not replay mutations. API does not install any logger.

A2: real authenticated SSE tests replay retained invalidations, detect ring gaps,
future cursors and foreign restart epochs, fetch consistent snapshots and receive
live commit invalidation. Revocation closes streams; stream limits reject excess.
The package exposes no LAN bind option. Tests use no device, cloud or harness.

Other boundaries: registered-workspace text reads succeed; traversal, absolute/ADS
paths, unregistered roots, Windows junction, binary and oversized files fail.
Malformed/compressed/oversized request bodies never admit work. OpenAPI local refs
resolve and route surface matches the implemented operations.

One initial API fixture failure was a Host override normalized away by fetch;
native HTTP now sends actual hostile headers. Full parallel suite exposed an
existing 150 ms plugin startup/timeout fixture race. It now allows 1000 ms and
deliberately delivers the old reply while the next request remains pending;
the same unknown/late-response semantics are asserted. Final full suite passes.

Not tested: macOS, installed browser/tray UX, power failure, real provider/device,
signed binaries, hostile concurrent same-user filesystem swaps, or production LAN
pairing. Workspace containment is a portable local boundary, not an OS sandbox.
No listener or child process is left running after tests. Contracts: ADR-003,
packages/api/openapi.v1.json and package READMEs.
