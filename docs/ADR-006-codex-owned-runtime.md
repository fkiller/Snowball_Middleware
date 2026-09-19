# ADR-006 — Codex ownership and evidence boundaries

2026-09-19 UTC. MW.03.02.01.01 implementation with real-provider gates incomplete.

An explicit connection grants permission to start one selected native stdio runtime
under one chosen Codex credential/configuration home. That home is part of the
approved launch digest and handshake validation. Each runtime has a fresh opaque
owner ID; a PID or thread history entry cannot establish ownership. The plugin stores
only native threads created through its own connection and never resumes Desktop
threads to gain a send channel. Restart does not silently reacquire stored owners.

Native requests are bidirectional. Server and client numeric IDs can overlap. A
method-bearing server request is parsed before matching responses by ID, and numeric
0 versus string "0" remain distinct. An approval is pinned to its native thread,
turn, request ID and adapter-generated revision. There is no global active-thread
fallback. Unsolicited native turn changes revoke the local claim. Same-native-thread
concurrency by an external client during dispatch has no provider-wide exclusive
lease guarantee; authenticated ownership-race acceptance remains unverified.

Accepted turn/start response supplies a native correlation ID. Decisions have no
equivalent unambiguous response ACK in the currently exercised protocol:
serverRequest/resolved also describes clearing. It is not evidence that the chosen
answer was consumed. The adapter emits resolution facts but rejects the delivery
promise as unknown, preserving the central journal barrier and preventing replay.
Do not weaken this to make a test/demo appear successful. An actual provider proof
strategy or a more explicit protocol receipt is required before claiming completion.

Workers can own a native child. PluginHost normal stop therefore closes stdin first
and gives the worker a bounded cleanup interval; immediate Windows worker termination
can orphan its child. Codex stop closes native stdin and awaits closed stdio, with a
force-kill fallback. Windows removal uses bounded retries for released filesystem
handles. Native smoke proved process exit AND removal, not just parent exit. Failure
paths/process-tree containment still need the installed-lifecycle task's evidence.

The configured provider executable is over the initial 256 MiB generic probe bound.
Raise that finite bound to 512 MiB and keep streaming/hash/deadline checks. This is
supported by actual installation metadata, not unlimited resource growth. Full test
file concurrency is capped at four to avoid native process-start fixture starvation;
production timeouts were not increased to conceal failures.

Official source: [OpenAI app-server](https://learn.chatgpt.com/docs/app-server).
Local generated schema: `.state/codex-schema-0.153.4` (ignored temporary reference).
Do not use future protocol fields simply because current web documentation lists them.
