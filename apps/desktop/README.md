# Snowball desktop runtime

The [common installer](../../README.md#one-shot-install) includes MK20, M5Stack and all three harness plugins behind one native tray/API. No USB device is required during PC installation. USB preparation uses a dedicated sandboxed window; routine supervision opens in the local browser. The [central architecture](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md) owns the current device journey, protocol, compatibility and verification scope.

The existing `assets/icon.png` is the product mark. `npm run install:desktop` prepares a separate Snowball Middleware native application with derived ICO/ICNS resources and product metadata. Its bootstrap imports this reviewed source checkout; `.state/desktop-runtime.json` verifies the executable hash. Trays, utility windows, notifications, native dialogs, shortcuts, installer/uninstaller and the local Web header/favicon use this artwork. Windows installation creates native Desktop/Start Menu shortcuts with the matching `local.snowball.middleware` AppUserModelID for notification identity; `--no-shortcut` suppresses both. Existing suite login entries migrate while preserving the enabled/disabled choice. Vendor applications retain their own identities.

Requires Node >=22.12. Development setup:

```text
npm ci --ignore-scripts
npm run build
npm run install:desktop
npm run start:tray
```

Regenerate native formats from the existing artwork by launching `scripts/build-desktop-icons.mjs` with the pinned development Electron binary. Re-run `npm run install:desktop` afterward. `node scripts/verify-desktop-branding.mjs` checks Windows embedded icon frames/product metadata or macOS bundle identity/icon against the committed artwork.

Optional `--data-dir ABSOLUTE_PATH` selects private local state. `--codex-control-config ABSOLUTE_JSON_PATH` uses the pinned configuration in `docs/middleware/CONTROL_REALITY.md`. Without it, native Codex connection dialogs select and verify canonical paths, supported version and SHA-256. Provider login remains owned by the provider; discovered sessions do not automatically acquire dispatch authority.

The tray opens Supervisor/Settings, pauses/resumes control, changes the actual OS login item, shows diagnostics, and quits its owned worker. Single-instance ownership is scoped to the selected data directory. Plugins run separately. Settings persist in `settings.v1.json`; autostart is re-read from the OS and failed changes do not report success. English/Korean settings apply to the tray, attention text and initial setup locale. Notifications avoid task contents. There is no permanent main application window.

All supported devices, including MK20 and future devices, use the common preparation host with reviewed device-specific adapters and physical guidance. The window discovers attached devices, reviews actual/included versions and improvements, asks before writes, verifies recovery backup and retained settings, checks reboot, and offers reviewed Wi-Fi import or physical instructions. MK20's ordinary runtime update keeps the SD card inside and uses its USB receiver; QMK uses DFU. Legacy firmware without that receiver needs initial migration. A card reader is only an advanced recovery path. ADB remains debug-only. LAN observations never grant USB write authority. M5Stack's included firmware is 0.5.0; a middleware update never silently installs firmware.

`npm run test:tray` uses isolated temporary state and checks an actual native tray, zero front windows, loopback access without PIN, and pause/resume. It does not change autostart. The installed-suite test separately exercises real isolated Windows login registration/migration, owned runtime processes and shutdown. `npm run package:desktop` produces a private unsigned allowlisted reference package with SHA-256 inventory; `scripts/verify-packaged-desktop.mjs` checks inventory, product identity and native smoke. The complete source installer supplies all devices/plugins; the reference package has a narrower composition. `npm run package:windows-installer -- ABSOLUTE_PACKAGE_DIRECTORY` builds the branded Inno Setup wrapper.

Windows native verification does not certify macOS installation/login, notification delivery, signing/notarization, remote-PC appearance or physical firmware update/recovery. Those acceptance results remain separate in the central architecture. Technical dependency and developer-tool names may still mention Electron; they are not product branding.
