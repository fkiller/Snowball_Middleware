# Explicit read-only executable probes

`BinaryHarnessProbe` and `runBinaryProbe` share PluginHost's explicit digest-approval
trust model and managed child-process boundary. They do not import concrete harness
code. They run the selected native executable directly, rather than nesting a child
inside a JS plugin worker whose termination could orphan that child.

Approval pins the complete normalized specification: canonical executable path and
SHA-256, fixed argv, additional script/config artifacts and their hashes, and exact
stdout-to-tested-version mapping. Changing any element invalidates approval. Merely
discovering a file or calculating a digest does not approve it. The trusted settings
layer supplies approval storage; no public HTTP discovery route issues approvals.

The reviewed command must be a side-effect-free, non-interactive version/schema
probe and must not spawn descendants. The host cannot infer that property from an
arbitrary executable. This is approved code execution, not a malicious-code sandbox.
Binary probes do not support Windows shell shims; resolve and review the underlying
native executable or runtime plus script artifacts instead of enabling a shell.
No PATH lookup, shell, stdin, inherited provider credentials or NODE_OPTIONS.

Defaults: 3 second deadline including artifact reads, maximum 5 seconds; 64 KiB
combined stdout/stderr; four active work units. Files are streamed with a 512 MiB
limit. Cancel/deadline prevents later launch, terminates the owned direct process,
and escalates termination after 250 ms. A native filesystem operation cannot always
be cancelled: its slot stays occupied until it settles, avoiding unbounded work.
Return on timeout can precede asynchronous process cleanup; tests verify owned PIDs
exit. Descendant trees require a different supervised-runtime contract and are not
supported by this version-probe API.

Path/hash verification prevents ordinary replacement. Concurrent malicious changes
by the same OS user between verification and spawn are outside this boundary, as in
PluginHost. Review all scripts/configuration consulted by a probe; artifact lists do
not automatically discover transitive runtime dependencies.

Only known output maps to a version. Stderr/raw stdout are never returned. Success
means an installed supported executable, not a running harness owner, authenticated
account or control grant. Per-selection generation guards prevent stale results.
Actual provider policies, executable discovery and supported-version evidence are
separate provider tasks; the tests run only local Node fixture programs.
