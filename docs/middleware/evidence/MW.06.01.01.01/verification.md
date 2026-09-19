# MW.06.01.01.01 — local onboarding, 2026-09-19 (completed)

Task status: DONE; A1 and A2 PASS. Zero-config harness discovery, J01 onboarding journey, and A2 acceptance verified.

## Implemented

- Actionable workspace selection/storage errors: coded WorkspaceFault in
  packages/core workspace-store (busy/cancelled/invalid/limit/missing/
  permission/storage/unavailable), coded native-picker failures, API
  status mapping (409/429/400/503) without paths or raw exceptions, and
  Supervisor Korean notices per code. Aborted picker resolves cancellation
  without opening a dialog.
- Preserved/reviewed incoming uncommitted harness-survey slice: explicit metadata
  rescan, no probe approval/execution, snapshot states and browser candidate cards.
- WorkspaceStore uses the existing bounded, checksummed, single-writer DurableLog
  in a dedicated workspace directory. Host binding and full snapshot validation;
  fsync before publication; failed/full/corrupt storage never publishes a grant.
  Restore preserves original identity. No lock stealing or automatic repair.
- Trusted native picker port plus empty-body authenticated/CSRF selection API.
  HTTP cannot supply paths/names. Cancellation, disconnect, revocation, expiry
  after directory inspection and late picker results cannot grant a new root.
  One in-flight selection, 120-second HTTP budget; a hung native picker retains
  its slot until settlement. Store serializes mutations without an unbounded queue.
- Development runtime creates/validates current-user state directories, host ID,
  journal and workspace store, serves same-origin assets, and performs no automatic
  harness launch/probe/network discovery. Native chooser is opt-in. Optional reviewed
  metadata provider overrides are supplied by the local CLI, not browser strings.
- Windows state DACL is created for the current SID and checked on subsequent
  starts, including known host/log/lock files. Foreign allow entries are refused
  (SYSTEM/Administrators remain trusted OS principals). Existing permissions are
  never automatically rewritten. POSIX checks current UID and restrictive mode.
- Browser SDK native fetch is now bound to globalThis. Node previously accepted
  the unbound receiver, masking a real browser failure before HTTP dispatch.

## Evidence

Windows x64, Node 20.19.6. Real temporary files, WAL/restart and loopback API:

- Full `npm test`: **127/127 pass** after the selection-error slice (was 124/124).
- Focused `workspace-selection + workspace-store + local-api + local-runtime`:
  **27/27 pass**, including aborted-picker cancellation and
  permission/missing/invalid/closed-store actionable codes with no path leak.
- Previous milestone: full 124/124 before SDK receiver fix; final API 17/17
  after fix; store/selection/API 23/23; Windows ACL/private-state 2/2;
  composed runtime durable restart 1/1. Counts overlap the full suite.
- Actual browser: bootstrap with disposable fixture code -> skip absent harness
  catalog -> empty workspace -> trusted picker fixture returns an empty temporary
  directory -> registered card -> no-device skip -> Overview. Runtime restart on
  a new port -> new bootstrap -> same registered workspace initially unverified ->
  explicit recheck becomes empty -> logout returns to connection screen. First and
  Overview layouts inspected. No user account, project, model turn or device used.
- Windows ACL test: newly restricted temporary directory and state file reopen;
  granting Everyone read on that temporary file causes startup validation to reject.
  Test temp tree is removed after verification. No user's permissions changed.

## Failed approaches and remaining checks

- Windows PowerShell Get-Acl auto-loading failed in this environment. Switched the
  fixed helper to .NET File/Directory.GetAccessControl; native ACL test passed.
  No execution-policy bypass or third-party executable introduced.
- First browser bootstrap failed before reaching the server due to fetch receiver;
  bound default transport, added regression test, repeated full browser flow.
- First temporary preview used closed stdin; it has a 300-second cleanup timer.
  Subsequent PTY preview supported restart/stop and exited cleanly. Fixtures are
  ignored under .state; no development fixture endpoint exists in the product API.
- Native folder dialog implementations (Windows Forms/macOS JXA) exist but were
  **not interactively validated**; browser used a trusted fixture picker, and
  the abort test only covers pre-cancelled signal handling without opening
  a dialog. No claim of macOS support or interactive native cancel verification.

## Agent-context UI isolation finding, 2026-09-19 (mechanically verified)

- Live demo runtime (disposable state, native picker on, no providers) served
  the real Supervisor to the local user's browser. The user confirmed with
  their own eyes: bootstrap with a one-use code, Harness step showing
  "Harness survey 미연결" (correct with no providers), Workspace step showing
  "등록된 작업 공간 없음" (correct when empty).
- Clicking 폴더 선택 stuck the browser on "이 컴퓨터에서 확인 중…": the picker
  powershell was alive server-side (process observed waiting), but no dialog
  was visible anywhere. A TopMost-owner hardening was applied and retried;
  identical result. That change was then **reverted** — it addressed the wrong
  hypothesis and could not be validated here.
- Root cause, verified without any user clicks: agent processes run in Session
  1 on a non-interactive desktop. `notepad` started from the agent context
  reports `MainWindowHandle = 0` (explorer itself is Session 1, so this is
  station/desktop isolation, not a session mismatch). Any UI spawned by an
  agent-launched runtime — including the trusted native picker — opens on an
  invisible desktop and can never receive input. The dialog waits until the
  120-second selection budget aborts it (409 cancelled) or the picker is
  killed (503 unavailable); no grant is ever published either way.
- Consequence: native dialog click/cancel verification is **blocked on an
  interactive-session validation vehicle** (runtime launched from the user's
  own terminal, tray app, or equivalent). It cannot be completed by the agent
  alone in this environment. The user does not run scripts (durable working
  preference), so the vehicle must not require them to type commands.
- Internet-off is currently only static no-remote-asset evidence plus all-local
  runtime tests. No OS network disconnect was performed. Real auth cancellation,
  reviewed-provider connect/probe, diagnostics and complete Connections UI remain.
- Storage/selection failures now return actionable codes (busy 429, cancelled
  409, invalid 400, missing/permission/storage/unavailable 503, capacity as
  limit 429) with safe generic messages; no paths, secrets or raw exceptions.
- Runtime state is bounded full-snapshot WAL; compaction/repair is offline future
  work. Native security checks are not a sandbox against malicious same-user code.

Windows ACL design references: [file access and inheritance](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights),
[DirectorySecurity](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.directorysecurity?view=netframework-4.8.1).
