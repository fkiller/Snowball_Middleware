# MW.05.01.01.01 — local workspace registry

Date: 2026-09-19. Windows x64, Node 20.19.6. Scope: service/library boundary,
not installed folder-picker/onboarding UI or complete local alpha.

## A1 — lifecycle, candidates and project identity

Seven new tests in `tests/workspaces.test.mjs` exercise empty startup, candidate
reports without filesystem reads, explicit association, no automatic alias/case/
worktree merging, same-directory relocation preserving IDs, missing/deleted roots,
same-path replacement rejection, restore retaining original identity, corrupt state,
logical links, removal, stale async completion and caller mutation isolation.

Windows real temporary directories prove rename/replacement/delete/junction behavior.
Case-sensitive volume and EACCES/recovery are **injected filesystem fixtures**; this
does not claim native macOS or Windows ACL verification. No other user's directories
or credentials are inspected. Candidates do not grant reads or command ownership.

## A2 — registered read boundaries

Actual temporary directories/junctions test similar sibling names, unregistered
files, traversal to another workspace, nested junctions and registered-root junction
retargeting. A `.git` pointer fixture represents a linked worktree; it is not followed
or exposed by file reads. Explicit logical links never extend either read scope.
Existing API integration also covers ADS, absolute paths, symlinks, oversized/binary
files and authenticated read requests. The reader revalidates registered directory
identity and the final file identity; no CWD fallback exists.

## Verification and failed runs

- `npm run build`: pass.
- Focused `node --test tests/workspaces.test.mjs tests/local-api.test.mjs`: 17/17 pass.
- Initial full `npm test`: 107/108. Existing cancellation fixture failed during
  its 500 ms plugin initialization timeout, before exercising cancellation.
- After giving non-timing plugin fixtures 2000 ms, four-file concurrent rerun:
  106/108. Binary output-limit and hanging-process checks hit their deadlines before
  fixture startup under load. Production bounds were not changed.
- Test default changed to one file at a time; deadline-specific assertions and
  explicit timeout values remain intact. Final `node --test --test-concurrency=1 tests`: **108/108 pass** (23.3 s). These are startup-load failures, not workspace acceptance failures.

No production/native provider credentials, user project contents, hardware, firmware,
installed service, or network discovery were used. Reference tests and real Codex
control gates were not rerun. See ADR-007 for filesystem race/isolation limits and
the remaining current-user storage/runtime/folder-picker integration.
