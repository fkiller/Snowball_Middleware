# Profile-gated HID backend — partial MW.04.01.01.02

`HidDiscovery` is a trusted plugin-side engine, never core code. `worker.ts` is an
isolated protocol-v1 worker. `node-hid` 3.4.0 is an optional native dependency;
importing core/API does not load it. Installed prebuilds loaded on Windows x64 with
Node 20.19.6 after `npm install --ignore-scripts`; other platforms are not verified.

No production model is enabled in `profiles.ts` yet. Do not copy the fictional
test profile into a shipping catalog. Native enumeration alone does not establish
report format, firmware compatibility, physical identity or controllability.

Profiles select exact VID/PID, OS, interface, vendor usage page/usage and release.
Only supported VID/PID pairs are enumerated. Generic keyboard, mouse and consumer
collections cannot match. Open uses the exact selected path and nonexclusive mode;
metadata is checked again before opening and after opening, before reading reports.
Paths and serials are not exported to the discovery UI or promoted to stable trust.

Explicit safe tests last at most 30 seconds. Report ID/size and button bit mapping
must match the reviewed profile. Neutral → one identification-button press → release
produces volatile physical evidence for this exact handle. It does not mint a
durable DeviceRegistry identity or execute a harness action. Inputs are bounded,
not replayed, and no output/feature-report API exists. A separate reviewed output
test can be added only for a concrete device contract.

Cancellation/generation checks discard late enumeration/open results. Hung native
operations remain busy until settled, without starting overlapping native calls.
Host process termination is the final containment for an unresponsive native call.
Permission codes become needs_permission, busy remains distinct and unknown errors
stay open_failed rather than guessed OS instructions. Scan refresh/close invalidates
safe tests. HID identity is physical confirmation, not authenticated network trust.

Worker methods: devices.scan, devices.beginTest(candidateId,generation),
devices.testStatus(testId), devices.stopTest(testId). A trusted installer/runtime
must generate its manifest/digest; no Web-accessible profile upload or open-path
method exists. The current host hashes entrypoints only; whole-artifact integrity
including native modules remains a release-packaging requirement.

Explicit inventory command: `node scripts/hid-inventory.mjs`. This only enumerates
metadata and prints aggregate collection selectors; no serial, device path or input
report is retained. Actual Windows inventory succeeded, but physical interaction,
permission denial, hotplug/identical units and macOS remain unverified.

Backend semantics follow the [upstream node-hid documentation](https://github.com/node-hid/node-hid)
and installed 3.4.0 declarations. Descriptor size/report mappings cannot be inferred
from its enumeration metadata: the model profile and live report tests are required.
