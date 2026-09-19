# MW.03.01.01.02 — bounded read-only probes

2026-09-18/19 UTC, Windows x64 Node 20.19.6. Full build/test 92/92 pass.
Eight actual loopback HTTP server tests, seven owned Node subprocess tests and two
capability-classifier tests cover the generic provider-independent boundary.

A1 PASS: real HTTP 401 -> auth required, compatibility unknown, never connected or
controllable; 403 -> permission denied. Refused endpoint with known installation ->
not_running. Validated history-only observation -> readonly_history, owner unverified.
Compatible service and executable version outputs never grant control/enrollment.

A2 PASS: wrong service/schema/version, redirects, malformed/compressed/oversize
headers/body, truncated response, timeout/cancel and global request limit. Only exact
reviewed GET routes, no credentials/DNS/proxy/autospawn. Binary tests pin full spec,
executable and script hashes; changed/unapproved artifacts do not launch, fixed args
are never shell text, output/stderr bounded/redacted, hanging/cancelled owned PIDs
exit, late refresh cannot replace current result. Permission reason classification
is covered; native OS permission denial remains platform-dependent, not fabricated.

Actual Codex/OpenCode/etc version support, login and command control are NOT tested
here. No installed harness, user task or LAN endpoint was started/contacted. MacOS
has not run these drivers. HTTPS uses native certificate checks; TLS interoperability
not separately exercised. Binary version commands are reviewed trusted programs with
no descendants; this is not a malicious-code sandbox or generic process-tree runner.
See ADR-005 and packages/plugin-host/PROBES.md for limits and trust requirements.
