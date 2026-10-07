<p align="center">
  <img src="assets/banner.png" alt="Snowball Middleware Banner" width="100%">
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
  <a href="https://github.com/fkiller/Snowball_Control"><img src="https://img.shields.io/badge/Companion-Snowball%20Control-purple.svg" alt="Companion Repo"></a>
</p>

---

## 🌟 Overview

**Snowball is an inter-Harness local control interface.** It gives developers a common way to navigate and control Codex, AGY, and OpenCode through an MK20 desk terminal and local Web Supervisor. The user chooses the harness, project, and session; each harness keeps its native runtime, history, models, and permissions.

Our philosophy is to keep control in the user's hands and on their computer: make switching tools and following work immediate, discover capabilities from the installed environment, and show real results and limitations. The full [product philosophy](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md#product-philosophy-inter-harness-local-control) is maintained with the central architecture.

**Preview:** Intended exclusively for personal workstations and trusted local networks. The loopback Web UI requires no login or PIN. The omission of authentication/encryption in MK20 UDP and development TCP ADB is detailed in [Current Design and Pre-Release Checklist](docs/ARCHITECTURE.md).

**Snowball Middleware** is the host-side control plane that unifies local AI coding agents—**OpenAI Codex**, **Google Antigravity (AGY)**, and **OpenCode**—into a single, low-latency desktop interface.

It provides developers with:
- **Web Supervisor (`http://127.0.0.1:8765/`)**: Local-loopback dashboard without a login/PIN. Available control operations depend on the native adapters connected to the selected runtime; discovery alone does not grant execution or approval capabilities.
- **Native Desktop System Tray**: Electron tray shell for managing the local runtime. The package builder currently supports Windows and macOS; this review's installed harness baseline is Windows.
- **MK20 Hardware Integration**: The companion **Snowball_Control** checkout supplies the device transport and local STT implementation for `scripts/start-all.mjs`. Native approval, cancellation, and recovery boundaries are defined in the architecture specification.

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

## 💻 Multi-Platform Installation & Execution

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

Installed tool versions on the review PC are documented in [config/harness-compatibility.json](config/harness-compatibility.json). Recording installed versions does not constitute universal compatibility certification. Full MK20 integration (`node scripts/start-all.mjs`) references the sibling Snowball_Control checkout and built `host/dist`. Full SD backup before modification and the modified QMK update are required.
