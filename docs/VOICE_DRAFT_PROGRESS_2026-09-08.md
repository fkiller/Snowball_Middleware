# Destination-bound voice draft — 2026-09-08

User confirmed knob behavior works after immediate-chord deployment. This acceptance applies to the knob change; MK20 spoken-to-Codex acceptance has been requested separately and is not inferred.

Implemented host/src/audio/draft.ts and wired it into host/src/index.ts. Capture snapshots machine/harness/project/session and desktop-or-CLI owner. UI target labels remain tied to that capture. Each capture has a unique generation and abort signal. Cancel invalidates late recognition; empty recognition is not sendable text. Capture-start failures clear recording state. Sending locks the draft synchronously, preserves text until adapter return, and never falls back to another owner. Rejection keeps text in unknown state and blocks retry/replacement. This is an adapter return acknowledgment, not authoritative proof of task execution.

Tests: npm test --prefix host passes TypeScript build plus six tests: destination change, late completion after cancel/new capture, empty/whitespace text, duplicate Send/in-flight replacement, ambiguous delivery, failed capture late result. No live task submission or production host startup was performed.

Remaining before product use:

1. Qualify MK20 spoken native dictation in the recovery PoC. The virtual-cable fixture is user-verified; live transport + cable passes independently.
2. Replace the legacy host audio transport/STT with the owned native bridge. Existing AudioTransport still has shared recording paths/global recorder stop; cancelled jobs may continue consuming resources despite ignored results. Abort signal is available but not connected to that legacy provider. Do not start legacy host just to restore navigation.
3. Fix real owner/project discovery and typed native submission acknowledgments. Snapshotting prevents later selection drift, not incorrect initial catalogs. Desktop tool result validation remains incomplete; errors with isError are checked, arbitrary returned strings are not authoritative success.
4. Add explicit reconciliation UI for unknown submission. It deliberately remains locked; no automatic retry or alternate-owner fallback. State is currently memory-only; restart recovery/persistence remains necessary.
5. Exact-turn Stop, secure enrollment, native setup/device routing remain separate gates. User controls should distinguish pending/unknown submission from ordinary draft review more clearly; current dispatch guards enforce the restriction.

Files: host/src/audio/draft.ts, host/tests/draft.test.mjs, host/src/index.ts, host/src/state/context.ts, host/package.json. No firmware changes this step, no commit mixing prior work.
