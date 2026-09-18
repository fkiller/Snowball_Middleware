# Bounded local harness candidate collection

`HarnessDiscovery` accepts trusted provider definitions (explicit known paths,
command basenames, persisted user override paths and explicitly registered local
endpoints) and a caller-supplied GUI environment PATH snapshot. No provider code is
imported by core. Provider-specific catalog construction and settings persistence
belong to the provider/runtime tasks. No default provider, guessed service port,
account or currently installed executable is selected automatically.

Only exact file metadata is inspected. There is no child process, shell, recursive
directory enumeration, socket, DNS, version execution, transcript read or session
attachment. GUI PATH can be empty; known and manual paths remain usable. Relative,
empty PATH entries and Windows UNC paths are ignored. Registered endpoints require
literal 127.0.0.1 or ::1 URLs, without credentials/query/fragment. Invalid endpoint
diagnostics omit the original URL to avoid retaining pasted credentials.

Limits: 16 providers; 32 entries per configured list; 32 absolute PATH directories;
256 inspections/endpoints; 256 diagnostics; 2 second default deadline, maximum 5.
Exact canonical file paths deduplicate only within a provider, retaining sources
and aliases. Different installation paths and different providers remain separate.
Symlinks are resolved by the local filesystem. This is metadata collection, not a
sandbox against network-mounted filesystems or concurrent same-user file changes.

Candidates always have null version, unprobed connection and control=false. A
metadata stamp detects ordinary replacement between scans; it is not a signature
or authorization. The next probe stage must revalidate identity and compatibility
before execution. Missing, permission denied and other inspection failures remain
diagnostics. Explicit overrides are rechecked on every scan and never assumed valid
because settings remember them. Discovery itself does not persist settings.

Cancel, deadline and an occupied filesystem operation retain the previous snapshot
with stale=true. A newer generation cannot be overwritten by a late operation.
Filesystem operations cannot forcibly cancel in Node; at most one remains pending,
new filesystem probes report busy until it settles. The installed runtime may
isolate this service if forced termination is needed. A complete empty scan replaces
previous candidates, so deleted installations do not stay falsely present.

Tests include Windows/macOS path fixtures and actual Windows temporary-file
metadata inspection. They do not validate provider binaries, macOS execution,
authentication, or command control. Those are separate acceptance gates.
