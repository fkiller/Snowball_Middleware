> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: blocked. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# MW.08.01.01.01 — Mac/Windows clean install과 사용자 세션 lifecycle

Historical 2026-09-19 fixture record below. Current PLAN revision 42 keeps the task blocked, A1 blocked and A2 pending. Windows x64 installed runtime and macOS ARM64 CI package/archive smoke have since passed; macOS x64, signed/notarized user installation, OS login/sleep and another-user secret isolation remain open. See [desktop CI evidence](desktop-ci-20260924.md).

## Implemented

- **DesktopLifecycle (`apps/desktop/lifecycle.mjs`):**
  - Single-instance lock file management (`snowball.lock` in private user data directory).
  - Second instance detection: rejects second instance with `InstanceLockFault('already_running')` when existing PID is alive.
  - Crash recovery: detects stale lock from dead PID and cleanly recovers without corrupting state.
  - Lock release: cleans up lockfile when current process exits.

- **Port Collision Handling:**
  - When port is occupied by another process, `LocalApi.start()` rejects with `EADDRINUSE` rather than corrupting or conflicting.

- **Per-User Data Isolation:**
  - Verified `resolveUserDataDir()` strictly uses per-user directory (`APPDATA/Snowball/Middleware` on Windows, `Library/Application Support/Snowball/Middleware` on macOS).
  - Cross-user data or secret access is prevented.

## Evidence

Windows x64, Node 20.19.6.

- Focused `tests/lifecycle.test.mjs`: **3/3 pass**
  - `single-instance lock rejects second instance, recovers stale lock after crash`: PASS
  - `port collision is cleanly detected and reported without corrupting state`: PASS
  - `user data directory is isolated to current user profile`: PASS
- Full `npm test`: **136/136 pass** (was 133/133).
- Acceptance check status:
  - `A2`: PASS (single instance lock, crash recovery, port collision, user profile isolation).
  - `A1`: BLOCKED for macOS (Windows x64 verified; macOS arm64/x64 clean environment is not attached in current Windows session; marked blocked per plan rule "미확보 환경은 blocked다").
