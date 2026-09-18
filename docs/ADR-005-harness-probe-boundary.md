# ADR-005 — Discovery facts, probes and ownership are separate

Status: accepted boundary; probe transport implementation pending.
Task: MW.03.01.01.02. Date: 2026-09-18.

Candidate collection must never start a harness or run a discovered executable.
An installed file, a health response, an authentication challenge and a transcript
directory prove different things. Retaining these facts in separate dimensions
prevents the old prototype's `isAvailable` heuristics from claiming control.

`assessProbe` retains presence, compatibility, authentication, permission,
connectivity and advertised control. It projects a remediation reason without
discarding the facts. A 401 observation maps to auth=required, not authenticated or
connected. History-only maps to readonly_history even when offline. A supported,
reachable authenticated service can be compatible but remains unregistered with
control unverified. Actual control requires downstream same-owner/session proofs,
explicit registration and the command journal, never an advertised capability bit.

The next implementation must add bounded read-only drivers:

1. HTTP: only the explicitly selected literal-loopback endpoint; exact reviewed
   health/schema routes; GET only; no redirects, DNS guessing, autoSpawn or command
   routes. Default 3 seconds, bounded headers/body, immediate cancel and generation
   invalidation. Status 401 gives needs_auth; wrong identity/schema/version fails
   closed. Do not send credentials until service identity/policy is established.
2. Binary: explicitly selected candidate plus reviewed provider probe specification;
   revalidate canonical path and artifact digest immediately before launch. Reuse
   isolated plugin-host approval rather than treating metadata stamp as permission.
   Fixed argv without shell, bounded output/time, process cleanup including failure.
   A Windows .cmd shim must not silently enable shell execution. Provider-specific
   executable/runtime selection and support gates must resolve this explicitly.
3. Results: bounded concurrent requests and per-candidate generation; no late result
   overwrites selection. Endpoint/binary compatibility alone cannot infer the owner
   of existing Desktop sessions. Credentials and transcript text never enter probe
   output. Unknown versions remain unsupported/unverified until provider evidence.

Verification required before marking the task done: real loopback server fixtures
for 401, unrelated service, redirect, malformed/oversize schema, version mismatch,
connection refusal, cancellation and timeout; isolated binary fixture for approval,
replacement, fixed argv, hangs and output bounds. These transport checks are still
pending. Classifier tests are necessary but insufficient for A1/A2 acceptance.
