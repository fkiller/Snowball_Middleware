# ADR 001 — Local plugin boundary

Status: implemented protocol foundation, not a complete public extension ecosystem.

Core never imports vendor/device implementations. An explicitly approved plugin runs as a separate Node process over line-delimited JSON-RPC 2.0. Protocol major 1 currently accepts only `^1.0.0`; unsupported range syntax fails closed instead of pretending to implement general semver negotiation. Handshake binds plugin identity and API version. Discovery/start are distinct; importing the host does not spawn anything or open a network port.

The host validates the manifest, explicit ID/digest approval, actual entrypoint hash, realpath containment, OS/arch, operations, message limits and event rate. Timeouts/cancellation after dispatch report **unknown**, not not-sent. Restart is explicit with exponential cooldown; requests are never automatically replayed. Each process generation starts a new event sequence. No unbounded event queue is maintained; subscriptions must be synchronous/fast or forward to a bounded queue in Core. Slow arbitrary listeners are outside this host's scheduling guarantee.

This is crash isolation, not a malicious-code sandbox. Manifest permissions are disclosures, not OS confinement. Entrypoint hashing is an integrity check of that file, not proof of publisher authenticity or transitive dependencies. The package installer must later verify the complete immutable artifact, native signatures and publisher policy. Approved directories must not be writable by less trusted users; hash/spawn does not eliminate filesystem TOCTOU attacks. Do not label arbitrary third-party execution safe based on this layer.

Only a small environment allowlist is passed. Plugin stderr is drained but not forwarded because it may contain private data. Structured, redacted diagnostics and configuration-schema evaluation are follow-up work; the current host exposes no configuration API, so it cannot accept unvalidated settings. Plugins receive no harness login token from ambient environment. They still have the OS permissions of the current user.

Output is bounded by 64 KiB per frame, 32 pending requests and 100 events/second by default; request deadlines default to 3 seconds. These are configurable internal limits, not performance promises. No auto-discovery, USB, LAN, firmware or real harness commands are implemented by the virtual device.
