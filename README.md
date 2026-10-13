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

Expand your platform and copy its command.

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

After installation, open the tray icon to launch the Web UI at **http://127.0.0.1:8765/** or manage Settings, Pause/Resume and login startup. Windows prepares Node/Git/Python. macOS/Linux need curl, Git and Python >=3.12 with venv/pip; Linux also needs a graphical desktop and Electron system libraries. Install and sign in to native harness applications through their vendors.

<a id="update-snowball"></a>
## Update Snowball

### 1. Update PC software

**Use your existing installation folder.** The examples below use the default folder; change the first line if you installed elsewhere (for example, `Snowball-LAN`). Omit the device profile option.

<details open>
<summary><strong>Windows · PowerShell</strong></summary>

```powershell
$installRoot = Join-Path $env:LOCALAPPDATA 'Snowball'
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1'))) -InstallRoot $installRoot -Update
```

</details>

<details>
<summary><strong>macOS · Terminal</strong></summary>

```bash
install_root="$HOME/Library/Application Support/Snowball"
curl -fsSL https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.sh | bash -s -- --root "$install_root" --update
```

</details>

<details>
<summary><strong>Linux · Terminal</strong></summary>

```bash
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/Snowball"
curl -fsSL https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.sh | bash -s -- --root "$install_root" --update
```

</details>

The update preserves device settings, pairing keys, controller state, speech caches, the API port and login startup preference. Older single-device installations gain both bundled device adapters. PC updates refresh the **Included** firmware candidate; device firmware is updated separately below.

<a id="update-device"></a>
### 2. Update device firmware

1. After the PC update, connect the device with a USB data cable and open **Device setup…** from the tray.
2. Select the device and compare **Installed → Included** and the listed improvements.
3. Confirm the device, then choose **Install / Update**. The window verifies a recovery backup and preserves settings before writing.
4. Keep USB connected until the window confirms reboot and the running version. Follow the Wi-Fi guide if needed.

[Device-specific steps and recovery](https://github.com/fkiller/Snowball_Middleware#update-device) · [Current M5Stack firmware and improvements](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/firmware/release.json)

<details>
<summary><strong>M5Stack · USB firmware update</strong></summary>

- Supports original ESP32 Core 4MB/16MB with FACES; CP210x detection alone does not identify the model. Confirm hardware if its firmware does not answer.
- Keep USB connected during the full-flash backup. The window shows percentage, MiB and elapsed time; 16MB may take several minutes. Size/hash verification follows the read before writing.
- Saved Wi-Fi and paired PCs are retained. If no network is saved, review Wi-Fi import or follow the FACES keyboard guide. The OS password is read only after that choice and is not shown in the UI/logs.
- The PC updater recognizes an identical Wi-Fi driver record being written again without treating it as lost settings. Other storage differences still block completion and preserve the backup. If an older updater reports a preservation failure, verify the retained backup against the device before restoring or retrying; PC Update alone does not verify that device's storage.
- Firmware 0.3.0 and earlier need one upgrade to discover new PCs over LAN. Use the installed window’s Included version; historical screenshot versions are examples.

</details>

<details>
<summary><strong>MK20 · Runtime and QMK</strong></summary>

**Runtime (display and communication)**

Use **MK20 → Runtime → Back up and update runtime** when a verified USB receiver or an existing authorized LAN maintenance connection is available. The SD card stays in the device; the window backs up the affected runtime partition, retains Wi-Fi/PC registration and checks running images after reboot. Keyboard USB alone does not provide runtime update access. Follow the window’s connection guidance for older firmware needing initial migration.

**QMK (keyboard firmware)**

Normal keyboard USB cannot identify the installed QMK image; Unknown does not mean outdated. In the QMK section, confirm the target and USB connection, then choose **Enter keyboard firmware check mode**. Once actual DFU readback compares the images, choose the separate backup/update action if needed, or **Return to keyboard without updating**.

For manual DFU, power MK20 off. Hold the leftmost square display key in the top row (not a round knob), power on and connect PC USB. Reconnecting USB alone may not power-cycle a separately powered device.

When DFU is detected, its readback result replaces the mode-entry controls. A readback failure is shown separately from a missing USB driver and offers a return to keyboard mode when USB access is available. Update the PC middleware first if an older installation stops after entering DFU; the host helper now recognizes the Maple bootloader's end-of-flash response. Firmware writing still requires a verified full backup and a separate update selection.

</details>

<details>
<summary><strong>If detection, backup or update fails</strong></summary>

- **Check again** reads the current connection/version; it does not write firmware. Unknown means the installed version is unverified.
- The window keeps the failed stage. A recovery backup path appears only after that attempt’s backup is verified. An initial backup-read failure means firmware writing has not started.
- M5Stack retries a failed backup chunk once at a lower USB speed. If it still fails, writing is blocked and the tool attempts to restart and verify the existing firmware.
- Follow the device-specific recovery guidance in the same window. Card readers and legacy registration scripts are advanced maintenance tools.
- Physical macOS/Linux device acceptance is separate from automated checks; see the central verification record.

</details>

<details>
<summary>Device setup examples</summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/fkiller/Snowball_Control/main/assets/screenshots/mk20_device_setup_en.png" width="100%" alt="MK20 device setup in English showing LAN maintenance, included runtime 0.2.6 and runtime-partition backup in progress"><br>
  <em>User-provided capture, 2026-10-12: MK20 LAN maintenance with the runtime-partition backup in progress and included runtime 0.2.6. Installed Unknown means the version is unverified; this capture shows the backup stage, not update completion.</em>
</p>

</details>

## Connect a device to a PC

MK20: connect Wi-Fi, press **K17 · Machines**, and select the PC. M5Stack firmware 0.4.0 or later: select the registered or new PC in **Machines** to pair over LAN. Adding a PC needs the full PC installation; USB registration scripts are unnecessary. Use the same trusted private LAN with device ports allowed and client isolation disabled.

<details>
<summary><strong>Advanced options</strong></summary>

| Purpose | Windows | macOS / Linux |
| --- | --- | --- |
| Existing installation folder | `-InstallRoot PATH` | `--root PATH` |
| Choose a private LAN interface | `-Bind PRIVATE_PC_IP` | `--bind PRIVATE_PC_IP` |
| Custom API port | `-Port PORT` | `--port PORT` |
| Install without starting | `-NoStart` | `--no-start` |
| Skip shortcuts | `-NoShortcut` | `--no-shortcut` |
| Diagnostic subset | `-Profile web\|mk20\|m5stack` | `--profile web\|mk20\|m5stack` |

Normal installation/update includes both devices and all three harnesses. If LAN selection is unavailable or ambiguous, discovery waits while the local Web UI stays available. On Windows, allow the middleware Node.js process on your private network when Windows asks. Linux USB/serial access uses your normal OS permissions. Run `bash install.sh --help` for Unix options. **Start-Snowball.ps1** / **Start-Snowball.sh** in the installation folder restart without downloading.

</details>

[Common architecture and verification limits](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md)

[Control · MK20](https://github.com/fkiller/Snowball_Control) · [Middleware](https://github.com/fkiller/Snowball_Middleware) · [M5Stack](https://github.com/fkiller/Snowball_Device_M5Stack) · Harness: [Codex](https://github.com/fkiller/Snowball_Harness_Codex), [Antigravity](https://github.com/fkiller/Snowball_Harness_Antigravity), [OpenCode](https://github.com/fkiller/Snowball_Harness_OpenCode)

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
