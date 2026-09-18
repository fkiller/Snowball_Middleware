# MW.04.01.01.02 — partial, physical acceptance blocked

2026-09-18 Windows x64 / Node 20.19.6. `npm test`: 58/58 pass (11 HID tests).
Real isolated HID worker starts with an empty reviewed catalog and refuses invented
candidate IDs. Windows and macOS selector fixtures pass; this is not macOS runtime
evidence. Report/permission/unplug/duplicates tests use synthetic handles.

`node scripts/hid-inventory.mjs`: node-hid 3.4.0 native addon loaded successfully;
26 collection entries enumerated on Windows. Diagnostic is metadata only, opens
zero handles, reads zero input reports and sends zero feature/output reports.
Machine-specific locator/serial values were not persisted. Optional native package
failure cannot block core/API imports.

Test evidence: exact VID/PID/interface/usage/release matching; typing collections
excluded; no-profile means no enumeration; duplicates and absent serials remain
untrusted; physical neutral/press/release; stale generation/port/metadata rejection;
permission/busy/offline reason preservation; cancellation/timeout with late native
completion; bounded input; unplug invalidation; real child worker integration.

Remaining A1/A2: a selected actual model with reviewed vendor report contract,
physical button/hotplug/permission tests on Windows and macOS, and two identical
devices/no serial/changed USB port. User was asked for model/environment; no answer
at this checkpoint. Do not mark task or either acceptance pass from these fixtures.
Production reviewedProfiles remains empty. Standard keyboard/mouse reads were not
used as a shortcut. No firmware change or existing daemon interaction occurred.

Continue other dependency-ready work while this physical gate is pending. Refer to
packages/device-hid/README.md for profile, worker and backend limitations.
