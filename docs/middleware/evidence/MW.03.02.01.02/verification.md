> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: needs_review. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# MW.03.02.01.02 — 두 번째 harness와 제한된 Antigravity 지원 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.03.02.01.02
- **Scenarios**: H08, H09

## 1. Implemented Components

1. **`packages/harness-antigravity`**:
   - `AntigravityObserverAdapter` in `src/index.ts`:
     - Discovers and parses session transcripts from Antigravity brain directories (`.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`).
     - Parses user request previews, assistant steps, timestamps, and turns.
     - Supports live transcript watching via `watchSession()` and emits events (`turn/started`, `item/agentMessage/delta`).
     - **Observe-only enforcement (R-TRUTH / H09)**: Manifest and adapter strictly report `capabilities: ['observe']`, `readOnly: true`, and zero control capabilities.
     - Mutation attempts (`execute()`) reject with `read_only_harness` or `owner_mismatch`. Never claims control without an authenticated control channel.
   - `antigravityManifest` in `src/manifest.ts`:
     - Conforms to `@snowball/plugin-sdk`.
     - Operations: `harness.status`, `harness.list`, `harness.read`, `harness.watch` (all `access: 'observe'`).
   - `worker.ts`:
     - Stdio JSON-RPC 2.0 worker conforming to `PluginHost`.

2. **`packages/harness-opencode`**:
   - `OpenCodeOwnedAdapter` in `src/index.ts`:
     - Implements `DispatchPort` for `CommandJournal` integration.
     - Connects to local OpenCode instance via REST (`/global/health`, `/session`, `/session/:id/message`, `/session/:id/abort`, `/session/:id/decision`) and SSE (`/event`).
     - Binds session keys via `formatSessionKey({ hostId, harness: { pluginId: 'snowball.opencode', instanceId }, nativeSessionId })`.
     - Identifies owned sessions vs read-only historical sessions.
     - Enforces owner ID protection: commands with wrong owner ID or mismatched session key fail before dispatch.
     - Dispatches `sessions.send`, `sessions.interrupt`, `decisions.resolve` with correlation tracking.
     - Listens to SSE event stream; external turns on owned sessions revoke local ownership (`ownerLost`).
   - `opencodeManifest` in `src/manifest.ts`:
     - Conforms to `@snowball/plugin-sdk`.
     - Observe operations: `status`, `list`, `read`, `refreshAuth`.
     - Control operations: `connect`, `create`, `execute`, `disconnect`.
   - `worker.ts`:
     - Stdio JSON-RPC 2.0 worker conforming to `PluginHost`.

## 2. Acceptance Verification

### MW.03.02.01.02.A1 (PASS)
- **Title**: 실제 OpenCode instance에서 read/send/stop/decision/reconnect와 session identity를 검증한다.
- **Procedure**: `node --test tests/harness-opencode.test.mjs`
- **Result**:
  - 4/4 tests pass.
  - Manifest publishes both observe and control capabilities.
  - OpenCode auth detection, session lifecycle (create, list, read), and session identity formatting pass.
  - Command dispatch (send, interrupt, decision) and owner protection pass.
  - External turn revokes local ownership via SSE pass.

### MW.03.02.01.02.A2 (PASS)
- **Title**: Antigravity transcript fixture pass가 full control로 표시되지 않고 실제 검증한 기능만 활성화된다.
- **Procedure**: `node --test tests/harness-antigravity.test.mjs`
- **Result**:
  - 5/5 tests pass.
  - Manifest publishes observe-only capabilities (zero control operations).
  - Status reports `readOnly: true`, `surface: 'transcript-observer'`, `capabilities: ['observe']`.
  - `listSessions` and `readSession` parse conversations and turns without claiming control (all sessions have `readOnly: true` and `ownerId: null`).
  - `execute()` rejects all mutation attempts with `read_only_harness`.
  - `watchSession()` accurately observes transcript appends and emits delta events.
