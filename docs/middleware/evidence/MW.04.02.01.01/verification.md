# MW.04.02.01.01 — explicit LAN candidate discovery

2026-09-18 Windows x64 / Node 20.19.6. `npm test`: 67/67 pass, including nine
LAN tests. Build passes. No user LAN interface was enabled during verification.

A1: construction/network-off produce zero sockets/probes/DNS calls. Explicit
interface selection is checked against inventory; query uses that exact address.
Disable/selection changes cancel and close pending probes and discard late replies.
The native driver was exercised with real loopback UDP sockets, wrong transaction
IDs and cancellation. It binds the selected address and closes after completion.

A2: fixture tests cover absent multicast replies with manual fallback, invalid
host/port/URL, explicit hostname resolution, public/loopback/broadcast/wrong-subnet
addresses, mixed DNS answers, multiple NIC/VPN changes, late DNS, cancellation,
TTL expiry, address changes, incompatible advertisements, cross-sender record
stitching and bounded PTR→SRV/TXT→A followups. Multiple services from a responder
remain separate endpoints. Every result is unpaired and control=false.

No remote service or pairing/firmware was validated. Tests prove provider state and
network-driver contracts, not production device interoperability. IPv6 and proxy
advertisements are outside this initial provider. UI/runtime integration remains
in downstream tasks. See packages/device-lan/README.md for exact boundaries.
