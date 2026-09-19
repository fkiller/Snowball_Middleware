# MW.03.02.01.01 — experimental owned Codex plugin; acceptance blocked

2026-09-19 UTC (2026-09-18 local), Windows x64 Node 20.19.6.
Full build/test: 101/101 pass (bounded test file concurrency four).
Native smoke: scripts/verify-codex-local.mjs, selected installed Codex 0.153.4,
SHA-256 444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b.
295,408,944 bytes. Other observed alpha 0.154.0-alpha.6.2 was not used for support.

Actual native result: connected=true; auth=needs_auth; credentialSource=selected-codex-home;
existingDesktopControl=false; sessionCount=0; inferenceSent=false; isolatedWorker=true;
nativeChildExited=true. Empty temporary credential home, no credentials copied or
existing user tasks read/resumed/sent. Successful run removed its own temporary home.

A1 BLOCKED: native create/send/events/decision/cancel with a logged-in environment
not exercised. Generic fixtures and real journal integration pass but do not replace
provider evidence. User has been asked which login environment to use; no answer yet.
Native decision resolution can mean answered or cleared, so exact-answer acceptance
is unproven and delivery remains unknown. Unsupported decision forms are not guessed.

A2 BLOCKED: fixture Desktop history is read-only, wrong owner/turn/target rejected,
unexpected native turns revoke ownership, old/native ID namespaces remain distinct.
No private Desktop route implemented. Actual Desktop ownership race and macOS have
not run. Support matrix is packages/harness-codex/README.md; neither is claimed supported.

Tests: six adapter tests (one with real durable journal); three native stdio Node
fixture-process tests; unchanged surrounding core/API/HID/LAN/probe/plugin tests.
Official app-server docs plus schema generated from the selected binary were read.

Failed approaches resolved:
- Immediate native kill left a temporary directory EBUSY even after PID exit. EOF,
  closed-stdio wait and bounded removal retries completed successfully on rerun.
- Test cleanup initially removed a journal directory before closing its lock; hooks
  now close it first. Final adapter suite passes.
- Unbounded parallel file tests starved two existing 500 ms plugin-start fixtures
  (96/98 pass). Cap file concurrency at four; final 101/101 pass. Production budgets
  unchanged. The prior failed full run is not hidden or counted as pass.
- Initial 256 MiB executable bound rejected installed Codex size; finite 512 MiB
  bound with streaming digest verified the actual binary without unbounded reads.

No current API server or plugin remains intentionally running. Existing user daemon
and hardware were untouched. Forced-crash descendant containment is not verified;
normal native exit and temporary-directory cleanup are verified.
