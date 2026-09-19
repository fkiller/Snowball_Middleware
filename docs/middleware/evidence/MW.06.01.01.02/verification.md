# MW.06.01.01.02 — Tray-only shell과 Settings (completed)

Task status: DONE; A1 and A2 PASS.

## Implemented

- **TrayShell (`apps/desktop/tray-shell.mjs`):**
  - Explicitly enforces `hasMainWindow === false` (never auto-creates a native main window on startup).
  - Tray status management (`ready` | `paused` | `attention` | `degraded`).
  - Context menu generation:
    - Status header
    - `Supervisor 열기` (opens browser)
    - `제어 명령 일시중지 / 재개` (toggles pause state via API)
    - `설정…` (opens `/supervisor#settings`)
    - `진단…` (opens `/supervisor#diagnostics`)
    - `미들웨어 종료…`
  - Quit scope reporting (`getQuitScope()`): truthfully lists stopped local runtime while preserving external harnesses (`codex`, `antigravity`, `opencode`).

- **Settings API (`packages/api/src/index.ts`):**
  - `GET /v1/settings`: Authenticated, returns current `LocalSettings` (revision, autostart, language, controlPaused, notifications, updatedAt).
  - `PATCH /v1/settings`: Authenticated, validates `expectedRevision`, validates schema/allowed keys. Rejects stale revision with 409 `stale_revision`.
  - `POST /v1/commands`: When `controlPaused === true`, immediately rejects new command submissions with 409 `control_paused`. Existing journal entries and active turns are unaffected.
  - Secrets are never exposed in URL, query parameters, or responses.

- **Client SDK (`packages/client-sdk/src/index.ts`):**
  - Added `settings()` and `updateSettings(expectedRevision, patch)` methods to `LocalClient`.
  - Added `settings?: LocalSettings` to `Snapshot`.

## Evidence

Windows x64, Node 20.19.6.

- Focused `tests/tray-settings.test.mjs`: **2/2 pass**
  - `A1 acceptance`: Browser disconnect and control pause do not terminate tasks; TrayShell has no main window (`hasMainWindow: false`); control pause blocks new commands with 409 `control_paused` without affecting existing turns.
  - `A2 acceptance`: Settings change/cancel and tray reflect same revision; stale revision rejected with 409; secrets never in URL or GET responses; `getQuitScope()` truthfully lists preserved external harnesses.
- Full `npm test`: **133/133 pass** (was 131/131).
- Plan validation: 132 nodes, 28 tasks, 56 checks. **14/28 tasks done, 29/56 checks passed**.
