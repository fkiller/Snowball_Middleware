# Local client SDK

`LocalClient` works through fetch and keeps credentials in memory. Bootstrap with a
code provided by the trusted local tray/CLI. Use the exact origin returned by the
runtime; the browser Supervisor will be hosted at this origin in a later task.

Observation flow:

1. `snapshot()` returns a consistent state and cursor.
2. Iterate `events(snapshot.cursor, abortSignal)` using authenticated fetch SSE.
3. On `changed`, refresh the snapshot to update supervision state.
4. On `resync` or disconnect, close the old iterator, obtain a fresh snapshot,
   then open a new stream from that snapshot's cursor. Never use a resync cursor
   as proof that local state has already been refreshed.
5. On 401, ask for local bootstrap again. Do not put credentials in an EventSource
   URL or browser storage. Use AbortSignal to cancel a read/stream and always close
   abandoned iterators.

`submit()` makes one request. 202 means durable admission, not completion. After a
network failure, inspect the retained command ID; retry only the same immutable
intent explicitly. A new command ID is a new action. Payload/owner/decision changes
under an existing ID are rejected. `logout()` revokes the server session.
