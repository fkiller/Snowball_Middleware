# MW.06.01.01.01 — partial local onboarding, 2026-09-19

Task remains IN PROGRESS; A1/A2 remain pending. This is not full native harness
onboarding or packaged support on two OSes.

## Implemented

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

- Full `npm test`: **124/124 pass** before the final SDK receiver fix.
- After SDK fix: `node --test tests/local-api.test.mjs`: **17/17 pass**.
- Focused store/selection/API: 23/23; Windows ACL/private-state: 2/2;
  composed runtime durable restart: 1/1. Counts overlap the full suite.
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
  **not interactively validated**; browser used a trusted fixture picker. No claim
  of macOS support or native dialog cancellation verification.
- Internet-off is currently only static no-remote-asset evidence plus all-local
  runtime tests. No OS network disconnect was performed. Real auth cancellation,
  reviewed-provider connect/probe, diagnostics and complete Connections UI remain.
- Current implementation returns safe generic selection failure on storage trouble;
  improve user-facing reasons without exposing paths, secrets or raw exceptions.
- Runtime state is bounded full-snapshot WAL; compaction/repair is offline future
  work. Native security checks are not a sandbox against malicious same-user code.

Windows ACL design references: [file access and inheritance](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights),
[DirectorySecurity](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.directorysecurity?view=netframework-4.8.1).
