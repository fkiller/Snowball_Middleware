# ADR 004 — Optional hardware and per-device control identity

Status: implemented registry foundation, MW.04.01.01.01, 2026-09-17.

The registry is independent of OS/device enumeration, network discovery and the
command journal. Zero devices is normal. Source failures produce failed or
missing_plugin observations; Web/API admission remains available. Candidates carry
no control authority. Only explicit local registration creates an opaque stable
device ID, a distinct Controller ID and an ephemeral connection lease.

Source = plugin ID + configured instance ID. Scan generation discards stale results.
Native device IDs and display names are locators, not physical identity. No implicit
cross-source/cross-transport merge occurs. Verified identity is supplied only by a
trusted adapter after its own physical/pairing checks; the registry does not invent
that evidence from a serial number, path, MAC, IP or label. LAN registration requires
verified identity. Unsupported candidates cannot register. Duplicate verified
identity must reconnect explicitly. HID registration is a trusted local action
after the physical workflow; that actual workflow is the next task.

Versioned export/restore retains bindings and per-controller context, with all
connections offline. Leases, pending inputs and discovery candidates are never
persisted. Reconnect requires matching source, verified identity, transport,
capabilities and binding revision. Missing stable identity returns
needs_identification, leaving future physical reconfirmation UI to the HID task.
The local runtime must persist the exported configuration through its storage
boundary; the in-memory registry does not claim to have installed durable user
configuration or OS access controls itself.

Inputs carry a current lease, monotonic sequence and bounded freshness window.
Selection updates only that Controller. Buttons produce semantic events; they
never directly call a harness. The runtime must obtain target/decision revision and
admit explicit actions through CommandJournal. No stale input is queued for replay.
Output checks Controller identity and returns the exact native destination and
current selection; a plugin render failure must invalidate that device connection.
Subscriptions carry invalidations to API snapshots/SSE. No hardware endpoint is
required for the API to start.

The virtual plugin now enumerates two devices and supports fixture-only semantic
input simulation and directed display frames. This validates independent state
without touching a real keyboard, MK20, HID handle or LAN. Plugin process isolation
is not a hardware sandbox. Actual HID, stable physical confirmation, LAN pairing,
revoke/forget UI and installed persistence remain separate tasks.
