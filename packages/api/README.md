# Local API

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
[OpenAPI v1](openapi.v1.json). No installed tray/browser UI is delivered by this
package yet. No server runs merely by importing it. Native packages and browser
onboarding integrate these capabilities in later tasks.

Defaults: 60-second one-use bootstrap, 8-hour in-memory session, 16 outstanding
grants, 64 sessions/connections, 30 bootstrap attempts/minute, 600 authenticated
requests/minute/session, 32 streams total (2/session), 256 retained invalidations,
128 KiB request body, 5-second body timeout, 16 KiB headers, 8 MiB snapshot response.
If an oversized/slow body causes socket teardown, clients treat it as an uncertain
network result and inspect command history; they must not blindly retry mutations.

Snapshot summaries are bounded; detailed records use `/v1/commands/{id}` and
`/v1/decisions/{id}`. Snapshot capacity errors require local maintenance; they never
silently return a partial state. Read permissions cover the local host; actor-bound
mutation prevents borrowing another controller's command ID.
