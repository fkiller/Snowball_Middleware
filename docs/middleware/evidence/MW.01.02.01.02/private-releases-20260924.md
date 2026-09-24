# MW.01.02.01.02 — private standalone harness releases, 2026-09-24

The user selected the personal GitHub account, private visibility and an undecided license. Three independent UNLICENSED/private repositories and `v0.1.0-private` prereleases now exist:

| Plugin | Source and release | SHA-256 of release tarball |
|---|---|---|
| Codex | https://github.com/fkiller/snowball-harness-codex/releases/tag/v0.1.0-private | `f104e66b4eed376916742e016cb7ba39e1d75b9f9bcd7ee10267c12ec3cab47c` |
| OpenCode | https://github.com/fkiller/snowball-harness-opencode/releases/tag/v0.1.0-private | `4c3362dcce2180d1f30d614a088e079169d0d649d20364a2969817c5e08e969e` |
| Antigravity | https://github.com/fkiller/snowball-harness-antigravity/releases/tag/v0.1.0-private | `79577df145929d0bea6d1789523b0706c325f291fc13ed7728acf530477146e4` |

Each source repository has a pinned local SDK prerelease tarball, independent lockfile, worker/manifest source, integration guide, provider fixtures, and Windows/macOS GitHub Actions. A release-package test packs the actual artifact, requires the bundled SDK/guide/worker, installs it into a fresh consumer directory, and imports its manifest without a middleware or hardware checkout. Both OS jobs passed for all three tagged commits. A first package draft failed a fresh consumer install because npm could not resolve its nested `file:vendor/...` dependency; adding `bundledDependencies` corrected that and the failed draft was never released. Release assets expose matching SHA-256 digests.

These are private reference releases, not public npm packages or end-user harness-control promises. Codex has separate Windows real control evidence; OpenCode and Antigravity remain observe-only. Public redistribution requires a license decision and dependency/license review. Device HID/LAN and MK20 lab code are not bundled in the desktop package or represented by these harness releases. A2 remains incomplete for public/license/device-plugin scope.
