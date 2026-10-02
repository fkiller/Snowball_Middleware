# Plugin development and distribution status

All harness plugins and middleware components are officially published under the **Apache-2.0** license. Three standalone harness plugin repositories have verified releases under `fkiller`. The middleware source is maintained at [Snowball_Middleware](https://github.com/fkiller/Snowball_Middleware) alongside the desktop application.

| Component | Current authority | Status |
|---|---|---|
| SDK / plugin host | packages/plugin-sdk, packages/plugin-host | Protocol v1, local workspaces; Apache-2.0 |
| Codex / OpenCode / Antigravity | packages/harness-* and three standalone repositories below | SDK-only runtime imports; Apache-2.0 release, Windows/macOS CI and fresh-install tests passed |
| HID / LAN / virtual | packages/device-* | Workspace implementations; Apache-2.0 |
| MK20 | ../Snowball_Control/plugins/device-mk20 | Hardware-owned reference plugin in Snowball_Control |
| Standalone example | examples/standalone-device-plugin | Copyable independent protocol fixture; no hardware/runtime dependency |

To learn the process protocol, copy examples/standalone-device-plugin into an empty directory and run npm test. It includes package metadata, one bounded worker, manifest generation and a portable test. The middleware suite also loads it with the real PluginHost. It requires developer Node; it is not an end-user install package.

Contract: explicit approval → manifest/platform/digest validation → plugin.initialize → declared operations → bounded events → cancellation/EOF cleanup. Control goes through the loopback semantic API (normal noAuth, optional token mode), immutable session/controller binding and the durable command journal. Devices emit semantic input; they must not directly invoke a harness or borrow Desktop IPC credentials. Discovery never implies authentication/ownership. Do not import another package's src or reach into a sibling checkout.

Run npm run check:boundaries and npm run test:plugin-reference. The static import checker enforces declared package dependencies and provider-free core/SDK. It is not a sandbox or a full dynamic import/security analysis. Harness plugins now import identity helpers and data-only dispatch types from @snowball/plugin-sdk. The static checker rejects provider-to-core/provider-to-provider imports. Core re-exports preserve existing consumers; journal storage/admission/proof code remains core-owned.

For public distribution: all packages carry the Apache-2.0 license, bundled with a compatible SDK, with verified native provider/device capabilities across Windows, macOS, and Linux. Do not copy credentials, transcripts, `.state`, private binaries or generated lab data into plugin repositories.

## Standalone harness extraction

After build, run `npm run export:harnesses -- ABSOLUTE_NEW_DIRECTORY`. It creates separate Codex, OpenCode and Antigravity source packages, vendored prerelease SDK tarball, lockfiles, standalone TypeScript configuration, protocol and fresh release-install tests, and Windows/macOS CI definitions. The package bundles the SDK for consumers because a nested `file:vendor/...` dependency alone failed fresh tarball installation.

Official Standalone Repositories:
- [Snowball_Harness_Codex](https://github.com/fkiller/Snowball_Harness_Codex)
- [Snowball_Harness_OpenCode](https://github.com/fkiller/Snowball_Harness_OpenCode)
- [Snowball_Harness_Antigravity](https://github.com/fkiller/Snowball_Harness_Antigravity)

