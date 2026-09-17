# Core boundary

MW.02.01.01.01 done: `src/identity.ts` (stable host id, composite session key,
Workspace/Project, per-user state location, versioned persist schema) and
`src/context.ts` (per-controller selection with immutable draft/approval
destinations). MW.02.01.01.02 adds `CommandJournal`: durable deduplicated admission,
central decision claims, owner-bound explicit dispatch, bounded queues and read-only
reconciliation. `docs/ADR-002-DURABLE-COMMANDS.md` defines the contract and limits.
Next: MW.02.02.01.01 authenticated loopback API. Core imports
only `node:` builtins; it never imports reference/legacy-host or a concrete
hardware/harness implementation.
