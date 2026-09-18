# MW.03.01.01.01 — bounded local harness candidates

2026-09-18 Windows x64 Node 20.19.6. Full build/test: 75/75 pass. Final focused
build plus discovery tests: 8/8 pass after invalid-endpoint credential redaction.

A1 PASS: Windows/macOS path fixtures cover empty installs, multiple CLI/Desktop
paths, canonical aliases, omitted GUI PATH, manual overrides, permission errors,
replacement metadata and deletion. Native Windows temporary-file inspection also
passes, including non-executable candidates and deletion. Version remains unknown,
connection unprobed, control false. Provider/OS runtime compatibility is not claimed.

A2 PASS: explicit cancellation, deadlines, repeated scans and input mutation cannot
publish a stale generation; last valid results remain visibly stale after interruption.
A hung filesystem request occupies the sole slot until it settles. Tests assert exact
inspection paths and 256-operation cap; no recursive or network scanning occurs.
Registered literal-loopback URLs are metadata only, never contacted. Invalid URLs
are rejected without retaining embedded credentials in diagnostics.

Implementation: packages/core/src/discovery.ts; tests/harness-discovery.test.mjs.
Boundaries and remaining runtime/provider catalog integration: packages/core/DISCOVERY.md.
No installed provider was launched, probed, authenticated or used to send commands.
