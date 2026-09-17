# ADR 003 — Authenticated local API and recoverable observation

Status: implemented and verified, MW.02.02.01.01, 2026-09-17.

The server binds **127.0.0.1 only**, with an OS-assigned port by default. There is
no LAN option in this package. Host must exactly equal the listener's numeric host
and port. An Origin, when present, must exactly match this origin; mutations also
require it. No wildcard CORS, proxy headers, DNS host aliases or null origins.
Only same-origin/none fetch metadata is accepted. Future LAN pairing is a separate
explicit feature, not a bind-address flag.

The trusted tray/CLI calls `issueBootstrap()` to create a one-use 60-second grant.
The user conveys the code into the local Supervisor (paste for the initial flow).
POST /v1/bootstrap consumes it and returns an in-memory bearer session and CSRF
token bound to a freshly generated Controller ID. Never put credentials in URLs,
fragments, cookies, localStorage or application logs. Restart expires all grants
and sessions. Tokens are random, retained as digests server-side. Native clients
use the same Origin and bearer/CSRF headers. This API does not protect against
malicious code already running as the same OS user. Packaged tray/OS ACL and the
browser onboarding UI are later tasks; there is no web-accessible grant minting.

Local sessions grant host supervision. Read-only snapshots summarize all sessions,
commands and decisions; command payloads remain off snapshots/events. Mutating
commands derive actorId from authentication, never from a supplied body. Existing
command IDs owned by another Controller cannot be retried. POST only admits work:
202 means queued, never sent/succeeded. HTTP exposes no adapter dispatch, owner
registration, read-proof injection, plugin start or lock-takeover capability.

Every journal commit advances an in-memory epoch:sequence cursor. SSE transmits
bounded invalidation events, not transcripts or secrets. A reconnect with a retained
cursor replays invalidations; unknown epoch/gap/future cursor produces `resync`.
The client fetches an atomic snapshot carrying its cursor, then reconnects from
that cursor. No automatic POST retries. Slow streams are disconnected and must
resnapshot. Server restart changes the epoch. Clients authenticate fetch-based
SSE with headers; native EventSource with query credentials is unsupported.

Limits cover request bodies, headers/timeouts, bootstrap attempts, active sessions,
stream count, ring capacity and snapshot bytes. Errors return stable generic codes,
never raw exception/path/credential text. Core remains the authority for queue and
revision limits. Workspace reads accept registered IDs and relative paths only,
reject traversal/ADS/symlinks, bound text reads, and never register arbitrary roots
from HTTP. Concurrent filesystem mutation by another same-user process is outside
this portable check's isolation guarantee; platform handle-relative/no-follow
hardening and Windows ACLs must be evaluated at the packaged security gate.
