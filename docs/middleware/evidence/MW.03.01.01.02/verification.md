# MW.03.01.01.02 — partial probe state contract

2026-09-18 Windows x64 Node 20.19.6. Build and 2/2 classifier tests pass.
Implementation: packages/core/src/probes.ts. Decision: ADR-005.

Only step 1 (orthogonal facts and truthful capability projection) is implemented.
A1/A2 remain pending: no real HTTP/binary probe drivers or transport fixture tests
exist yet. Do not confuse constructing an auth=required observation with receiving
and validating an actual HTTP 401. The next action is explicitly recorded in the
plan checkpoint and ADR. No server startup, discovered executable execution,
provider login or command send occurred.

Final full middleware build/test after the classifier: 77/77 pass.
