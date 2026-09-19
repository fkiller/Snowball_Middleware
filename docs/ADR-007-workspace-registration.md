# ADR 007 — explicit local workspace grants and project relationships

Status: implemented library boundary, MW.05.01.01.01. 2026-09-19.

The legacy project list could inject the current directory when a provider had no
projects, and file browsing could fall back to the process directory after a missing
project. Neither behavior belongs in the new local-control service.

## Identity and lifecycle

`WorkspaceRegistry` starts empty. Provider project reports are bounded metadata
(100 candidates); reporting never inspects a path or grants access. Registration is
an explicit trusted local action, limited to 128 roots. It creates distinct workspace
and project IDs even for aliases. There is no automatic merge by casing, name,
repository remote, shared git directory, or native project ID.

Registration captures the requested path, exact canonical path, and filesystem
device/inode/birth time using bigint stat fields. Inspection reads at most one
directory entry; it never recursively scans, runs Git, follows worktree metadata,
or falls back to CWD. Unknown filesystem identity fails closed. An empty directory
is a valid workspace. Missing, permission-denied, replaced, and other unavailable
roots remain registered with a repair state. Missing does not claim whether the
directory was moved or deleted; discovering a new location requires user selection.

Explicit relocation preserves IDs only when the newly selected directory has the
original physical identity. A copy/new filesystem identity requires new registration.
Retargeting a registered symlink or replacing a directory at the same pathname does
not silently transfer its grant. Provider associations require explicit matching to
the registered physical and canonical identity. Refreshed/changed provider claims
and relocation clear associations; they never grant command ownership.

Logical project links are explicit relationships between separate project IDs, capped
at 256. They do not combine roots, sessions, command owners, or drafts. Removing a
workspace revokes reads and removes its associations/links without deleting files or
canceling harness sessions.

## Reads and restart

`WorkspaceFiles.create` remains compatible; it now registers its supplied roots with
this registry. `fromRegistry` supports the trusted service wiring. Reads revalidate
the root before and after reading, reject nested symlinks/junctions, traversal,
sibling prefixes, drive/UNC syntax, ADS, reserved Windows device names, ambiguous
trailing dots/spaces, and `.git` segments. Canonical containment is case-sensitive
even on Windows; actual filesystem canonical spelling decides. A worktree's `.git`
file is not permission to traverse its common directory. Existing text/size limits
remain. A final file identity/path check rejects an observed replacement during read.

The versioned bounded serialization retains original physical identity, IDs and
explicit logical links. Restore never re-baselines identity and starts unavailable;
each read/refresh verifies again. Provider reports/associations are ephemeral and
must be freshly observed. Corrupt/unknown-version state fails; no silent empty reset.
The service must store this only in its current-user protected state directory.
This module supplies the codec, not an on-disk writer, account broker, installer or
new browser registration endpoint. Native folder picker/API/UI wiring is subsequent
work; existing CorePersistV1 lexical records are not silently upgraded into grants.

## Limits of evidence

This protects service read boundaries and detects observed root changes. It is not
an OS sandbox against malicious code already running as the same user; Node lacks
a portable atomic directory-relative no-follow open across every ancestor. A hostile
same-user process can race filesystem observations. Native filesystem calls can also
stall; this library does not promise cancellation of OS filesystem I/O. Runtime
isolation/time budgets belong in lifecycle integration before packaged support.

Windows temporary directories and junctions are tested. Permission failure and
case-sensitive volume behavior are injected filesystem fixtures, not macOS/Windows
ACL acceptance. Worktree tests use explicit `.git` pointer fixtures; there is no
Git executable dependency. Filesystem identity stability across OS/filesystem changes
must fail into repair rather than be guessed. No installed harness, credentials,
device, user's project, or firmware is touched by these checks.
