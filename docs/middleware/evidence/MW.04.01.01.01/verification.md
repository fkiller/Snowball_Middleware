# MW.04.01.01.01 — device registry foundation

2026-09-17, Windows x64 / Node 20.19.6. `npm test`: 47/47 pass, including
5 new device-registry tests. Build passes. Reference baseline 44/44 passed earlier
in this session; reference code remains unchanged.

A1: real loopback API + client SDK operate with zero devices. A missing hardware
plugin updates source status and does not prevent durable Web-client admission.
Unsupported/unpaired candidates cannot register. Old scan generations cannot
overwrite current candidates or source status.

A2: a real isolated Node virtual plugin enumerates two devices. Each gets its own
opaque Device/Controller identity and lease. Plugin-origin semantic events select
different sessions; directed output reaches the corresponding native virtual
device with that device's selection. A mismatched Controller output is rejected.
Disconnecting one leaves the other ready. This is a fixture integration test,
not a real-device or completed browser UI acceptance claim.

Recovery: JSON export/restore preserves IDs and context, starts offline, retains
no leases, refuses wrong identity and stale/replayed input, and allows explicit
same-identity reconnect with a new lease. Unverified HID stays needs_identification;
no speculative association by port/name is made. Duplicate persisted IDs fail.

Files: core/src/devices.ts; device-virtual/src/index.ts; API/SDK snapshot device
fields and subscription; tests/device-registry.test.mjs. Contract: ADR-004.
Unperformed: actual HID enumeration/permissions/physical identification, device
firmware pairing, macOS, signed installation and installed config persistence.
