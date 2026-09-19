# Local Supervisor — development onboarding

Build with npm run build, then run npm run start:local in an interactive terminal.
Optional --native-picker enables the OS directory chooser only when the browser
explicitly asks. Optional --data-dir ABSOLUTE_PATH selects a private development
state directory; existing weak/foreign permissions fail without being rewritten.
Optional --codex-executable ABSOLUTE_PATH configures read-only candidate metadata,
not execution approval. No automatic probe, login, harness start, or LAN discovery.

The terminal privately displays a one-use 60-second connection code; Enter issues
another. Redirected stdin/stdout are refused. Ctrl+C closes this runtime only.
Bootstrap remains memory-only; no credential URL/browser-storage persistence.
Default data location follows resolveUserDataDir. Host identity and two separate
locked logs (commands/workspaces) persist. Startup never steals an old process lock.

runtime.mjs composes the existing API/journal/store. Workspace selection supplies
no HTTP path, persists before publication, and cancels on revocation/disconnect.
private-state.mjs creates/verifies Windows SID ACL or POSIX UID/mode boundaries.
Native dialog implementations are experimental: real UI cancellation and macOS
verification are pending. Tests/browser use an explicitly injected temporary picker.

This is not an installed tray/service or complete MVP. Harness registration/auth/probe
UI, device setup, native dialog verification, OS offline checks, richer supervision,
packaging/update remain. See PLAN.json and evidence/MW.06.01.01.01/verification.md.
