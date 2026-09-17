# Snowball Middleware

Local control of the user's harnesses and tasks on macOS/Windows. Hardware is optional. No mandatory cloud control plane; network discovery and other-host control are explicit extensions.

Implementation is in progress. This repository is separate from `../Snowball_Control`, which retains MK20 firmware and hardware tooling. Production code belongs in `packages/`; `reference/legacy-host` is a byte-preserved prototype, not the production runtime. Never start its UDP/mesh entrypoints as the new middleware.

Read [the execution plan](docs/middleware/PLAN.md), [task tree](docs/middleware/TASK_TREE.md), [discovery journeys](docs/middleware/DISCOVERY_JOURNEYS.md), and [resume guide](docs/middleware/RESUME.md). The task ledger in this repository is authoritative.

```text
npm ci --ignore-scripts
npm test
npm run test:reference
npm run plan
```

`test:reference` runs the portable regression suite with local mock servers; no provider prompt or physical device is used. `test:reference:speech` additionally requires a separately configured Python/faster-whisper/model environment; no Python, model or recording is bundled.

No installer or usable tray/Web application is shipped yet. Licensing of inherited code/generated provider schemas is not resolved for public distribution. Packages are private and marked UNLICENSED until that review; this does not relicense third-party dependencies.
