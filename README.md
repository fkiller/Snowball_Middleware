<p align="center">
  <img src="assets/banner.png" alt="Snowball Banner" width="100%">
</p>

<h1 align="center">
  <img src="assets/icon.png" width="48" height="48" valign="middle" alt="Snowball Icon">
  Snowball Middleware — Preview
</h1>

<p align="center">
  <strong>inter-Harness Local Control, Web Supervisor & Desktop Middleware</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg" alt="Platforms">
  <a href="https://github.com/fkiller/Snowball_Middleware#one-shot-install"><img src="https://img.shields.io/badge/Install-Snowball-purple.svg" alt="Install Snowball"></a>
</p>

---

<a id="one-shot-install"></a>
## Install Snowball

**Install Snowball once per PC.** The default installation includes the Web UI, MK20 discovery/transport and speech runtime, M5Stack discovery/gateway, and all three Codex/Antigravity/OpenCode harness plugins. No device profile selection or connected USB device is needed.

Choose your platform below, then use the code block’s **Copy** button on GitHub. README Markdown supports these expandable selectors; interactive tabs require a documentation website.

<details open>
<summary><strong>Windows · PowerShell</strong></summary>

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1')))
```

</details>

<details>
<summary><strong>macOS · Terminal</strong></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.sh | bash
```

</details>

<details>
<summary><strong>Linux · Terminal</strong></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.sh | bash
```

</details>

Windows prepares Node/Git/Python; macOS/Linux require curl, Git and Python >=3.12 with venv/pip and prepare a checksum-verified Node LTS locally. The installer builds the companion components, checks the actual isolated harness workers, and starts a hidden per-user background application with a tray icon. The terminal returns after the owned runtime responds. The tray provides Web UI, status, Settings, Pause/Resume, Restart, Quit and login startup. Web UI stays on **http://127.0.0.1:8765/**. Default locations: Windows `%LOCALAPPDATA%\Snowball`, macOS `~/Library/Application Support/Snowball`, Linux `${XDG_DATA_HOME:-~/.local/share}/Snowball`. **Start-Snowball.ps1** (Windows) / **Start-Snowball.sh** (macOS/Linux) restart it without downloading dependencies. Missing native harness applications remain unavailable until installed and signed in through their vendors.

For updates, use the same `-InstallRoot` with `-Update` on Windows, or `--root PATH --update` on macOS/Linux, and omit the profile option. For example, download `install.sh` and run `bash install.sh --root "$HOME/.local/share/Snowball" --update` on Linux (use your existing root). Old single-device installs gain both adapters while preserving device settings, pairing keys, controller state, speech caches, custom API port and login startup preference. An absent or ambiguous private LAN leaves automatic discovery waiting while the Web UI remains available; use `-Bind PRIVATE_PC_IP` (Windows) / `--bind PRIVATE_PC_IP` (macOS/Linux) when needed.

MK20 joins Wi-Fi independently: press K17 (Machines), choose a PC and pair/select it. M5Stack firmware **0.4.0 and later** automatically discovers registered and new middleware PCs on the same LAN. Select a New PC in Machines to pair over Wi-Fi. Adding a PC requires only the complete middleware installation: no device-specific install, USB connection or registration script. Use a trusted private LAN with device ports allowed, the same broadcast subnet and no client isolation.

For initial M5Stack preparation or firmware upgrades, **connect USB and use the automatically opened device setup window**, also available from the tray’s **Device setup…** menu. It shows installed/included versions and improvements; only your Install/Update selection starts a full private flash backup, firmware write, retained Wi-Fi/pairing storage verification and automatic reboot check. See the [included firmware version and improvements](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/firmware/release.json). If no network is saved, the default reviewed option imports this PC’s connected Wi-Fi after the update when the OS permits it; an existing network is never replaced. OS passwords are read only after that choice and never appear in the UI/logs. If import is unavailable, the same window visually guides Settings → Wi-Fi, network selection and password entry on the FACES keyboard. Original ESP32 Core 4MB/16MB only; CP210x alone does not prove the model, and firmware without a Snowball response requires physical model confirmation. Builds may download missing toolchains. Firmware 0.3.0 and earlier need one device upgrade for LAN discovery of new PCs. Optional `Register-M5Stack.ps1` / `.sh` remain legacy maintenance tools; ordinary installation and `-Update` never silently flash a device.

During M5Stack full-flash backup, Device setup shows the actual read percentage, MiB and elapsed time. A 16MB USB read can take several minutes; the backup file appears only after the read finishes. Reading 100% still requires size/hash verification before firmware writing. Keep USB connected throughout. Full backups are read in 1 MiB chunks; a failed chunk is retried once at a lower USB serial speed. If both reads fail, writing is blocked and the tool attempts to restart and verify the existing firmware.

Device setup separates **Display/connection runtime** and **Keyboard firmware QMK**. Matching native device ID/address folds LAN status and maintenance into one runtime entry. Unknown QMK firmware in normal USB mode does not mean outdated. Choose **Enter keyboard firmware check mode** in the QMK section after confirming the target MK20 and USB connection; actual DFU image comparison precedes a separate backup/update choice. A readable DFU entry also offers **Return to keyboard without updating**. Background scans retain consent, buttons and open instructions. Manual DFU: Power MK20 off, then hold the leftmost square display key in the top row (not a round knob) while powering on, with USB connected to the PC. Reconnecting USB alone may not power-cycle a separately powered keyboard. See the central specification for behavior and physical verification limits.

If an update fails, the window retains the failed stage. A backup path is shown only after the helper confirms backup verification; a planned filename or a previous attempt's backup is not presented as the current recovery backup. A failure while reading the initial backup means firmware writing has not started.

All devices, including MK20 and future devices, follow the same **Device setup…** journey: detection, version/improvements, consent, verified recovery backup, preserved settings, update/reboot and network setup/visual guidance. Supported adapters are bundled by default; no per-device registration script is required. MK20 runtime 0.2.5 adds a USB receiver: the SD card stays inside while the entire affected runtime partition is backed up, fixed runtime files are transferred and an automatic reboot is verified against running-image hashes. QMK retains its separate DFU/readback path. A card reader is an advanced recovery tool, not a normal journey step. For older firmware with an existing authorized LAN management connection, Windows Device setup now offers a separate **MK20 → Runtime → Back up and update runtime** action. It verifies a full runtime-partition backup before replacing the pinned files, preserves Wi-Fi/PC registration and checks running images after reboot. Keyboard USB alone does not enable runtime updating. The common guide now shows MK20’s actual 20-key/two-knob matrix and M5Stack Core’s A/B/C plus FACES controls with interactive instructions. Tutorial navigation never controls hardware or claims a live connection. M5Stack 0.5.2 has passed physical post-update backup/Wi-Fi and two-PC LAN checks (see the central verification record); MK20 first USB migration/update acceptance remains unresolved. Ordinary LAN pairing and all three harness contracts are unchanged.

<p align="center">
  <img src="https://raw.githubusercontent.com/fkiller/Snowball_Control/main/assets/screenshots/mk20_device_setup_en.png" width="100%" alt="MK20 device setup in English showing LAN maintenance, included runtime 0.2.6 and runtime-partition backup in progress"><br>
  <em>User-provided capture, 2026-10-12: MK20 LAN maintenance with the runtime-partition backup in progress and included runtime 0.2.6. Installed Unknown means the version is unverified; this capture shows the backup stage, not update completion.</em>
</p>

The existing Snowball icon is used throughout the native application, tray, device setup window, notifications, shortcuts, installer and local Web UI. Source installation prepares a branded native executable; updates preserve the existing autostart preference of the selected suite. Firmware and provider applications keep their own reviewed resources.

**Check again** waits for any active automatic discovery and performs a fresh read; it does not start a firmware write. The window shows scanning and reports action errors by cause. For a LAN-only MK20, **Unknown** means the running firmware did not supply its version. The window explains the actual missing USB/DFU prerequisite and backup capability; the included version is not the installed version.

MK20 setup displays one QMK entry per physical USB parent, rather than one per composite function. Keyboard USB, DFU backup access, runtime USB response and LAN presence have distinct guidance. Normal keyboard presence does not identify the exact installed image; the connected legacy MK20 still needs its first runtime USB migration. M5Stack 0.5.2 also fixes stack exhaustion and a restart when selecting a new PC, alongside legacy-PC choice and late authenticated recovery. A PC update includes this firmware candidate; installing it on the device still requires the reviewed, backed-up update. Physical verification on 2026-10-12 confirmed firmware 0.5.2, a valid 16MB backup, retained Wi-Fi/legacy pairing and authenticated LAN pairing with MINIME-PC-AMD and SNOWBALL-395. Repeated switching reached each PC's actual Codex/Antigravity session content without restarting. USB invoked native navigation handlers only; LAN handled pairing/control. No prompt was sent. Manual button operation and MK20 first USB migration remain separate field checks.

On Windows, allow the middleware Node.js process on your private network when Windows asks. Denying network access can block LAN discovery and selection even while the background middleware and USB detection work. The local Web UI remains loopback-only.

Options: `-Update`, `-InstallRoot PATH`, `-Bind PRIVATE_PC_IP`, `-Port 8765`, `-NoStart`, `-NoShortcut`. `-Profile web|mk20|m5stack` remains an explicit development/diagnostic subset option, not the normal installation flow; it retains adapters already installed in that root. macOS/Linux: `--update`, `--root PATH`, `--bind PRIVATE_PC_IP`, `--port 8765`, `--no-start`, `--no-shortcut`, `--python PATH`, `--data-dir PATH`; `bash install.sh --help` lists all options. Linux requires a graphical desktop, Electron system libraries and user access to device USB/serial interfaces; no sandbox bypass or automatic USB permission changes are used. Linux Wi-Fi import may be unavailable: use the common device setup guide. macOS/Linux interactive device acceptance remains separate from automated tests. See the central specification for protocol, authentication and field-verification limits.

[Common architecture and repository ownership](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md)

[Control · MK20](https://github.com/fkiller/Snowball_Control) · [Middleware · Installer / Web UI](https://github.com/fkiller/Snowball_Middleware) · [Device · M5Stack](https://github.com/fkiller/Snowball_Device_M5Stack) · Harness: [Codex](https://github.com/fkiller/Snowball_Harness_Codex), [Antigravity](https://github.com/fkiller/Snowball_Harness_Antigravity), [OpenCode](https://github.com/fkiller/Snowball_Harness_OpenCode)

---

## 🌟 Overview

**Snowball is an inter-Harness local control interface.** It gives developers a common way to navigate and control Codex, AGY, and OpenCode through an MK20 desk terminal and local Web Supervisor. The user chooses the harness, project, and session; each harness keeps its native runtime, history, models, and permissions.

Our philosophy is to keep control in the user's hands and on their computer: make switching tools and following work immediate, discover capabilities from the installed environment, and show real results and limitations. The full [product philosophy](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md#product-philosophy-inter-harness-local-control) is maintained with the central architecture.

**Preview:** Intended exclusively for personal workstations and trusted local networks. The loopback Web UI requires no login or PIN. The omission of authentication/encryption in MK20 UDP and development TCP ADB is detailed in [Current Design and Pre-Release Checklist](docs/ARCHITECTURE.md).

**Snowball Middleware** is the host-side control plane that unifies local AI coding agents—**OpenAI Codex**, **Google Antigravity (AGY)**, and **OpenCode**—into a single, low-latency desktop interface.

It provides developers with:
- **Web Supervisor (`http://127.0.0.1:8765/`)**: Local-loopback dashboard without a login/PIN. Available control operations depend on the native adapters connected to the selected runtime; discovery alone does not grant execution or approval capabilities.
- **Native Desktop System Tray**: Snowball Middleware runs in the background with its product icon and local runtime controls. The package builder supports Windows, macOS and Linux; this review's installed harness baseline is Windows.
- **MK20 Hardware Integration**: The default installation includes the companion **Snowball Control** transport and speech library alongside the M5Stack gateway. Explicit development subsets can run the common native-session API independently. Native approval, cancellation, and recovery boundaries are defined in the architecture specification.

> 💡 **Looking for MK20 Firmware and Hardware Tooling?**  
> Check out the companion repository: 👉 **[`Snowball_Control`](https://github.com/fkiller/Snowball_Control)** (QMK firmware, Tina Linux OS/BSP, and native C HUD daemon).

---

## 🖥️ Visual Showcase

### Web Supervisor Dashboard
The local-loopback Web Supervisor (`http://127.0.0.1:8765/`) provides zero-cloud oversight, workspace project discovery, active harness monitoring (Codex, AGY, OpenCode), and real-time physical device connectivity:

<p align="center">
  <img src="assets/screenshots/web_supervisor_dashboard_en.png" width="100%" alt="Snowball Web Supervisor Dashboard">
</p>

### Physical MK20 Terminal Integration
The companion **[`Snowball_Control`](https://github.com/fkiller/Snowball_Control)** repository connects the desktop middleware to the MK20 hardware terminal, featuring physical breadcrumb navigation (`Device > Harness > Project > Session`), built-in mic speech prompt capture, and low-latency display updates:

<p align="center">
  <img src="assets/screenshots/mk20_navigation_demo.gif" width="480" alt="MK20 Live Navigation Demo"><br>
  <em>Physical MK20 hardware terminal driven by Snowball Middleware.</em><br>
  <a href="https://github.com/fkiller/Snowball_Control">👉 Visit Snowball_Control Repository</a> &nbsp;|&nbsp; <a href="https://x.com/fkiller/status/2099345561627382015">🔗 Original Post on X</a>
</p>

---

## ⚡ Non-Negotiable Core Principles

1. **Zero Simulation**
   - No mock delays, fake approvals, or simulated responses.
   - Supported actions must reach native agent runtimes (`codex app-server`, `agy stream-json`, `opencode run`) and report actual results. Native approval and cancellation support varies by adapter; current limits are documented in the architecture.
2. **Living Source of Truth**
   - Models, efforts (variants), sessions, and workspaces are dynamically discovered from native tools and local caches. Zero static hardcoding.
3. **Local-First & Security Boundary**
   - Web Supervisor runs strictly on `127.0.0.1` loopback with zero mandatory cloud dependencies.
   - Production device transports require their own reviewed pairing. The MK20 lab Preview uses a trusted private LAN and does not provide cryptographic device authentication.
4. **Plugin Sandbox Isolation**
   - Plugins should have limited permissions while preserving authorized native host dispatch. Current child-process isolation does not enforce an OS filesystem sandbox; untrusted plugins are outside this Preview's security boundary.

---

## 🏗️ Architecture

For the complete architectural specification, protocol definitions, and security model, see:  
👉 **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

Current component ownership, transport paths, security boundaries and implementation limits are maintained in the [Single Architecture Specification](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md).

---

## 💻 Developer builds and tray shell

### Prerequisites
- **Node.js**: `>= 22.12.0`
- **Current validation**: Windows review host. Automated core tests also run on Ubuntu; Linux Supervisor currently has no default harness survey or native tray package target.

### 1. Setup & Build
```bash
# Clone the repository
git clone https://github.com/fkiller/Snowball_Middleware.git
cd Snowball_Middleware

# Install dependencies
npm ci --ignore-scripts

# Build core packages
npm run build
```

### 2. Running Web Supervisor (Local Loopback)
```bash
npm run start:local
```
Open **`http://127.0.0.1:8765/`** in your browser. The dashboard connects immediately without requiring a login or PIN.

### 3. Running Native Desktop Tray
```bash
# Windows / macOS / Linux System Tray runtime
npm run install:desktop
npm run start:tray
```

### 4. Desktop Packaging (Multi-Platform Releases)
```bash
# Build on the target Windows or macOS host
npm run package:desktop

# (Windows) Build NSIS per-user installer (.exe)
npm run package:windows-installer
```

---

## M5Stack + FACES hardware demo

[![M5Stack + FACES](https://raw.githubusercontent.com/fkiller/Snowball_Device_M5Stack/main/assets/screenshots/m5stack_navigation_demo.gif)](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/assets/videos/m5stack_navigation_demo.mp4)

[Device firmware and setup](https://github.com/fkiller/Snowball_Device_M5Stack) · [Full MP4 on GitHub](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/assets/videos/m5stack_navigation_demo.mp4) · [X](https://x.com/fkiller/status/2106892916149158101?s=20)

---

## 🧪 Verification & Test Suite

Run the full automated test suite and inspect its reported pass/skip totals:

```bash
# Run full regression test suite (241 passed)
npm test

# Run desktop tray smoke test
npm run test:tray
```

---

## 📁 Repository Structure

```text
Snowball_Middleware/
├── apps/
│   ├── desktop/                # Electron native tray shell & background worker
│   └── supervisor/             # Web Supervisor UI (HTML, CSS, JS runtime)
├── assets/                     # Official brand artwork, icon, and banner
│   ├── banner.png
│   ├── icon.png
│   ├── screenshots/            # Web Supervisor dashboard & MK20 hardware captures
│   │   ├── web_supervisor_dashboard_en.png
│   │   ├── web_supervisor_dashboard_ko.png
│   │   ├── mk20_navigation_demo.gif
│   │   └── mk20_ui_elements_test.gif
│   └── videos/                 # Demonstration recordings
│       ├── mk20_navigation_demo.mp4
│       └── mk20_ui_elements_test.mp4
├── config/                     # Configuration schemas (STT models, etc.)
├── docs/                       # Comprehensive architecture documentation
│   ├── ARCHITECTURE.md         # English architecture pointer (default)
│   └── ARCHITECTURE.ko.md      # Korean architecture pointer
├── packages/
│   ├── api/                    # Local HTTP & WebSocket API server
│   ├── client-sdk/             # TypeScript client SDK for Supervisor
│   ├── core/                   # State machine, session manager & journal
│   ├── harness-antigravity/    # Antigravity adapter plugin
│   ├── harness-codex/          # Codex adapter plugin
│   └── harness-opencode/       # OpenCode adapter plugin
├── scripts/                    # Build, packaging & test automation scripts
├── LICENSE                     # Apache-2.0 License
├── README.md                   # English project documentation (default)
└── README.ko.md                # Korean project documentation
```

---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Installed tool versions on the review PC are documented in [config/harness-compatibility.json](config/harness-compatibility.json). Recording installed versions does not constitute universal compatibility certification. Use the installed suite launcher above for the complete runtime. `start:local` and `start:tray` are separate developer entry points requiring explicit native adapter configuration; the installed tray owns the full suite.
