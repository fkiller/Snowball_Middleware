# Snowball Middleware

Local control of the user's harnesses and tasks on macOS/Windows. Hardware is optional. No mandatory cloud control plane; network discovery and other-host control are explicit extensions.

**Audit status (2026-09-24): development foundation, not a completed or distributable MVP.** Read [the integrity review](docs/middleware/AUDIT.md) and [current control reality](docs/middleware/CONTROL_REALITY.md) for fixed vulnerabilities, reopened acceptance gates and remaining integration. This repository is separate from `../Snowball_Control`, which retains MK20 firmware and hardware tooling. Production code belongs in `packages/`; `reference/legacy-host` is a byte-preserved prototype, not the production runtime. Never start its UDP/mesh entrypoints as the new middleware.

Read [the execution plan](docs/middleware/PLAN.md), [task tree](docs/middleware/TASK_TREE.md), [discovery journeys](docs/middleware/DISCOVERY_JOURNEYS.md), and [resume guide](docs/middleware/RESUME.md). The task ledger in this repository is authoritative.

Development requires Node >=22.12.

```text
npm ci --ignore-scripts
npm test
npm run test:reference
npm run plan
```

Normal `npm test` uses fixtures and skips physical HID/MK20 tests. Explicit hardware flags are `SNOWBALL_TEST_HID=1` or `SNOWBALL_TEST_MK20=1`; MK20 also requires `SNOWBALL_MK20_LOCAL_ADDRESS` and `SNOWBALL_MK20_TARGET_ADDRESS`. Never count skipped tests as hardware acceptance.

See [plugin development](docs/middleware/PLUGIN_DEVELOPMENT.md) and the [standalone reference](examples/standalone-device-plugin/README.md). Codex, OpenCode and Antigravity harness plugins have separate private repositories and versioned private releases; hardware plugins and public licensing remain separate gates.

`test:reference` runs the portable regression suite with local mock servers; no provider prompt or physical device is used. `test:reference:speech` additionally requires a separately configured Python/faster-whisper/model environment; no Python, model or recording is bundled.

A development Web Supervisor is available via `npm run build` then `npm run start:local`; it opens on loopback without login or PIN. Optional `--require-auth` selects token mode. The native tray/onboarding can select a reviewed Codex CLI instance, and a selected session can dispatch actual model/effort overrides through the journal. Windows 0.153.4 real create/resume/model/effort/response/interrupt acceptance has passed; native connection/restore/disconnect was verified read-only against the default login. The installed Windows tray runtime restored two ready projects, connected controllable Codex and read-only OpenCode; an earlier browser run read the actual model/effort catalog and completed two real verification responses. Visible native dialogs, exact approvals and Desktop co-ownership remain pending. On 2026-09-24 MK20 QMK HID was physically present and passed a safe enumeration/open-close test; the separate MK20 product CDC was absent. The UI reports one unsupported USB candidate and zero controllable devices. Button-report mapping and authenticated device pairing remain unverified. See [control setup and reality checklist](docs/middleware/CONTROL_REALITY.md) and [desktop setup](apps/desktop/README.md). The [private unsigned desktop preview](https://github.com/fkiller/Snowball_Middleware/releases/tag/v0.1.0-private) contains a Windows per-user installer that passed install/run/uninstall and a macOS ARM64 ZIP that passed CI package/extract/run smoke. Signing, macOS x64 and signed/notarized user installation remain open. `scripts/start-all.mjs` is quarantined because device input bypassed pairing/journal boundaries and still contains simulated actions. Licensing of inherited code/generated provider schemas is not resolved for public distribution. Packages are private and marked UNLICENSED until that review; this does not relicense third-party dependencies.

The currently installed Windows package is from `artifacts/desktop/1790280794452/Snowball Middleware-win32-x64`; the installer is `artifacts/installers/1790297272026/SnowballMiddlewareSetup-0.1.0-win-x64.exe`. The running tray uses an ephemeral loopback URL: open Supervisor from the tray after any restart. Its API verified two ready projects, controllable Codex, read-only OpenCode with eight native models, and the MK20 QMK USB candidate without claiming device control. Full regression: 226 tests, 222 passed, four physical skips, zero failures. [Desktop CI, release and installed-runtime evidence](docs/middleware/evidence/MW.08.01.01.01/desktop-ci-20260924.md) records exact hashes and limitations.
