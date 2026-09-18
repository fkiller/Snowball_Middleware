# Explicit local-network candidate discovery

`LanDiscovery` starts disabled. Construction and interface listing do not create a
socket, send a query or resolve a hostname. A trusted local user action must select
an exact current interface/name/address/netmask via `enable()`. `scan()` then sends
at most three batches (32 questions each) for `_snowball._tcp.local`, limited SRV/TXT
followups and advertised local A records. `disable()` aborts pending work, closes
owned sockets and clears candidates. There is no subnet/port sweep or background loop.

The native probe binds an ephemeral port on the selected IPv4 address, not 0.0.0.0.
It uses RFC 6762 legacy-unicast replies from mDNS responders, avoiding a global
5353 listener. DNS transaction IDs, source port, packet bytes/counts, names, TTLs
and current subnet are checked. PTR/SRV/TXT/A records are grouped by responder;
advertised A must equal that responder. Source proxy advertisements are not supported.
TXT v=1 is an advertised compatibility hint, never authenticated identity.

Results are unpaired with control=false. IP/label changes produce new candidates,
not a transfer of trust. Missing/blocked mDNS returns an explicit manual-address
fallback. `manual(host,port)` resolves only the supplied host, rejects public,
loopback, multicast, broadcast, off-interface or ambiguous/mixed addresses and pins
one numeric endpoint. It performs no TLS/HTTP/auth handshake and sends no command.
DNS uses the OS resolver; explicit host lookup may contact configured DNS servers.
No credentials or secret-bearing URL is accepted here.

Current support: IPv4 private/link-local subnets, one user-selected interface per
provider instance, explicit refresh. IPv6-only networks need a later provider.
VPN/multiple NICs require user choice; disappearing/changed interfaces disable the
provider instead of routing through another adapter. Empty results are not proof
that a device is offline. Real firmware compatibility/pairing belongs to MW.04.02.01.02.

Tests use decoded response fixtures and a real loopback UDP responder. No discovery
was enabled on the user's external/LAN interfaces. The future Settings/runtime
must wire enable/disable and present candidate reasons; this package is the provider.

Encoding uses pinned [dns-packet](https://github.com/mafintosh/dns-packet) 5.6.1.
Legacy-unicast behavior follows [RFC 6762 §6.7](https://www.rfc-editor.org/rfc/rfc6762.html#section-6.7).
