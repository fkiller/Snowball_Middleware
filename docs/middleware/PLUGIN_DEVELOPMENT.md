# Plugin development and distribution status

2026-09-24: the owner selected private repositories under `fkiller` and left licensing undecided. Three harness plugins have verified independent private releases. The middleware source also has a separate private remote at [Snowball_Middleware](https://github.com/fkiller/Snowball_Middleware); private distribution is not public redistribution.

| Component | Current authority | Status |
|---|---|---|
| SDK / plugin host | packages/plugin-sdk, packages/plugin-host | Protocol v1, local workspaces; not published |
| Codex / OpenCode / Antigravity | packages/harness-* and three separate private repositories below | SDK-only runtime imports; private `v0.1.0-private` releases, Windows/macOS CI and fresh-install tests passed |
| HID / LAN / virtual | packages/device-* | Workspace implementations; hardware gates vary |
| MK20 | ../Snowball_Control/plugins/device-mk20 | Hardware-owned lab plugin; unsigned UDP, no production control |
| Standalone example | examples/standalone-device-plugin | Copyable independent protocol fixture; no hardware/runtime dependency |

To learn the process protocol, copy examples/standalone-device-plugin into an empty directory and run npm test. It includes package metadata, one bounded worker, manifest generation and a portable test. The middleware suite also loads it with the real PluginHost. It requires developer Node; it is not an end-user install package.

Contract: explicit approval → manifest/platform/digest validation → plugin.initialize → declared operations → bounded events → cancellation/EOF cleanup. Control goes through the loopback semantic API (normal noAuth, optional token mode), immutable session/controller binding and the durable command journal. Devices emit semantic input; they must not directly invoke a harness or borrow Desktop IPC credentials. Discovery never implies authentication/ownership. Do not import another package's src or reach into a sibling checkout.

Run npm run check:boundaries and npm run test:plugin-reference. The static import checker enforces declared package dependencies and provider-free core/SDK. It is not a sandbox or a full dynamic import/security analysis. Harness plugins now import identity helpers and data-only dispatch types from @snowball/plugin-sdk. The static checker rejects provider-to-core/provider-to-provider imports. Core re-exports preserve existing consumers; journal storage/admission/proof code remains core-owned.

For public distribution: decide licensing of inherited source and generated provider schemas, publish a compatible SDK rather than relying on the bundled private prerelease, verify native provider/device capabilities on each target OS, publish device-plugin references and review signing/update/revocation. Do not copy credentials, transcripts, `.state`, private binaries or generated lab data into plugin repositories.

No license is inferred from private source access. `private:true` and `UNLICENSED` remain until the owner's redistribution decision is recorded.

## Standalone harness extraction

After build, run `npm run export:harnesses -- ABSOLUTE_NEW_DIRECTORY`. It creates separate Codex, OpenCode and Antigravity source packages, vendored prerelease SDK tarball, lockfiles, standalone TypeScript configuration, protocol and fresh release-install tests, and Windows/macOS CI definitions. The package bundles the SDK for consumers because a nested `file:vendor/...` dependency alone failed fresh tarball installation. The generator itself never initializes remotes or publishes. No secrets/state/recordings are copied.

Private source and release links: [Codex](https://github.com/fkiller/snowball-harness-codex/releases/tag/v0.1.0-private), [OpenCode](https://github.com/fkiller/snowball-harness-opencode/releases/tag/v0.1.0-private), [Antigravity](https://github.com/fkiller/snowball-harness-antigravity/releases/tag/v0.1.0-private). All six GitHub Actions jobs (Windows/macOS for each plugin) passed source tests and fresh tarball install/import. Release asset SHA-256 values and the corrected failed first draft are recorded in [distribution evidence](evidence/MW.01.02.01.02/private-releases-20260924.md). These private releases are visible only to authorized repository collaborators. The MK20 lab adapter remains in the separate hardware repository and is not a production-loadable middleware plugin; HID/LAN providers are not in the desktop bundle.
