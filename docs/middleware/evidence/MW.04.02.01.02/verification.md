# MW.04.02.01.02 — MK20 extraction and firmware gate

2026-09-18 Windows x64, Node 20.19.6. Hardware repository commit d5eabaf contains
plugins/device-mk20. Its `npm test --prefix plugins/device-mk20` passes 4/4.
Tests cover strict bounded decoding, UTF-8 renderer bounds, fail-closed production
control and transport merging, and real loopback UDP pinned-peer input/output.
The middleware has no dependency on this hardware-specific package.

A1 BLOCKED: inspected hardware/mk20/hud/mk20-hud.c and v2_state.c plus legacy
host transport. Firmware accepts unauthenticated JSON/UDP and changes host address
from received datagrams. No physical pairing authentication exists. The new
PAIRING-CONTRACT.md records required identity, approval, expiry, revoke and replay
behavior; it is a requirement, not implemented firmware. No actual MK20 contacted,
firmware changed, authenticated transport tested, or success inferred from mocks.

A2 PASS for the extracted adapter boundary: compatibility always says unpaired,
unauthenticated, lab-only, not controllable, cannot merge USB/LAN; production
control always rejects. No input is admitted to the command journal. Explicit
lab previews remain unacknowledged and cannot retarget themselves from a sender.

Remaining: real authenticated firmware/protocol and physical acceptance, complete
render interoperability and isolated production plugin wiring. Existing hardware
repository dirty files were preserved; only the new plugin directory was committed.
