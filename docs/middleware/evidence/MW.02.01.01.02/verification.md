# MW.02.01.01.02 — durable command/decision verification

2026-09-17, Windows x64, Node 20.19.6. `npm test`: 32/32 pass;
`npm run test:reference`: 44/44 pass. Build passes. No real harness/device executed.

- A1: `tests/core-journal.test.mjs` kills actual child Node processes while queued,
  immediately before a simulated external effect, and immediately after that effect.
  Explicit dead-process lock recovery restores cancelled/unknown state, preserves
  the effect count and makes duplicate admission return the retained record.
  Timeout/late receipt, restart after ACK, exact owner/correlation proof, blocked
  uncertain delivery, independent session progress and owner-change race are tested.
- A2: two controller identities compete for one centrally persisted claim; only
  one command is admitted. Native request ID 0 retains its numeric type. Stale
  revisions, native-ID aliases, wrong-owner proof and replaying unknown claims fail.
  Restart requires a fresh exact native read proof before an unclaimed approval
  becomes pending. Expiry/external resolution prevents queued adapter execution.
- Additional boundaries: canonical request fingerprint conflicts; detached reads;
  per-session/global reject-new queue limits; write-ahead record visible before
  adapter execution; 20 large-payload commands recover in bounded transactions;
  single writer, live-PID lock refusal, capacity failure, wrong host, damaged
  checksum, empty record and torn tail all fail closed without deleting evidence.
- Identity regressions: review drafts stay review across restart; sending becomes
  unknown. Parent scope switches clear stale sessions. Approval cache updates require
  matching destination, and path traversal is normalized before lexical containment.

Implementation: packages/core/src/{commands,durable-log,journal-model}.ts.
Contract: docs/ADR-002-DURABLE-COMMANDS.md. No external database/native dependency.
Not tested: macOS filesystem behavior, sudden power loss, real-provider correlation,
Windows ACL enforcement, signed installers, live devices. These are later gates,
not implied by the portable/mock tests. This is deduplicated admission and no blind
replay, not a promise of provider-level exactly-once execution.
