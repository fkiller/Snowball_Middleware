# Local client SDK

`LocalClient` works through fetch. Normal runtime is PIN-free; use the exact loopback origin returned by the runtime. Only explicitly selected token mode calls bootstrap with a code from its trusted CLI and keeps credentials in memory. The browser Supervisor is served at that same origin.

Observation flow:

1. `snapshot()` returns a consistent state and cursor.
2. Iterate `events(snapshot.cursor, abortSignal)` using same-origin fetch SSE.
3. On `changed`, refresh the snapshot to update supervision state.
4. On `resync` or disconnect, close the old iterator, obtain a fresh snapshot,
   then open a new stream from that snapshot's cursor. Never use a resync cursor
   as proof that local state has already been refreshed.
5. In optional token mode, 401 requires a new local bootstrap. Normal noAuth mode has no PIN flow. Do not put credentials in an EventSource
   URL or browser storage. Use AbortSignal to cancel a read/stream and always close
   abandoned iterators.

`submit()` makes one request. 202 means durable admission, not completion. After a
network failure, inspect the retained command ID; retry only the same immutable
intent explicitly. A new command ID is a new action. Payload/owner/decision changes
under an existing ID are rejected. `logout()` revokes the server session.

For `createSession`, generate one UUID `requestId` for a user attempt and retain it across a timeout or app restart. `createStatus(requestId)` reads the durable receipt. An unconfirmed receipt means native creation may have occurred; the server will not execute that ID again. Inspect the native session list and explicitly attach an exact task before issuing commands. A confirmed retry may return `ownerId: null` and `restoredReadOnly: true` after restart.
