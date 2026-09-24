# Local API

Normal composed runtime uses `noAuth: true`: no Web login/PIN, exact loopback Host/Origin checks. The bare LocalApi default retains token mode for explicit embedders/tests; --require-auth selects it in the development CLI. Controller IDs separate contexts but are not authentication secrets.

`LocalApi({ journal, workspaces? })` and `await api.start()` return an exact numeric
loopback origin. The runtime must explicitly register trusted adapter observations
on the journal and run dispatch; HTTP admission alone never starts a harness.
`issueBootstrap()` belongs to the tray/CLI, not an HTTP handler. Close the API before
closing the journal. `WorkspaceFiles.create()` registers roots from trusted local
configuration; HTTP may only read bounded relative text files under those roots.
An optional `harness` surveyor exposes the runtime's reviewed candidate metadata
in snapshots plus one explicit `POST /v1/harness/scan` rescan; it never probes,
approves, enrolls or grants control.

See [ADR 003](../../docs/ADR-003-LOCAL-API.md) and
[OpenAPI v1](openapi.v1.json). The package is composed by apps/supervisor/runtime.mjs and apps/desktop; importing it never starts a server.

Optional token mode: 60-second one-use bootstrap, 8-hour in-memory session, 16 outstanding
grants, 64 sessions/connections, 30 bootstrap attempts/minute, 600 authenticated
requests/minute/session, 32 streams total (2/session), 256 retained invalidations,
128 KiB request body, 5-second body timeout, 16 KiB headers, 8 MiB snapshot response.
If an oversized/slow body causes socket teardown, clients treat it as an uncertain
network result and inspect command history; they must not blindly retry mutations.

Snapshot summaries are bounded; detailed records use `/v1/commands/{id}` and
`/v1/decisions/{id}`. Snapshot capacity errors require local maintenance; they never
silently return a partial state. Read permissions cover the local host; actor-bound
mutation prevents borrowing another controller's command ID.

Session creation, attachment, model catalogs, settings and bounded live messages are described in OpenAPI. Connected-provider state and list truncation are explicit. 202 admission is separate from native acknowledgement and correlated completion.

`POST /v1/sessions/create` requires a caller-generated UUID `requestId` retained for the same user attempt. A private write-ahead receipt is stored before native creation. A retry with the same ID and identical inputs returns the confirmed session without creating another; an unconfirmed receipt rejects reexecution. `POST /v1/sessions/create-status` reports confirmed or unconfirmed. A lost native reply cannot prove whether a task exists: inspect the native session list and explicitly attach the exact selected task. A confirmed session restored after restart is read-only until attachment.
