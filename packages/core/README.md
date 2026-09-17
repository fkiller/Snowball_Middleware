# Core boundary

MW.02.01.01.01 done: `src/identity.ts` (stable host id, composite session key,
Workspace/Project, per-user state location, versioned persist schema) and
`src/context.ts` (per-controller selection with immutable draft/approval
destinations). Next: MW.02.01.01.02 durable commands/recovery. Core imports
only `node:` builtins; it never imports reference/legacy-host or a concrete
hardware/harness implementation.
