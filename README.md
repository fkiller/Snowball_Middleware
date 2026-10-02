<p align="center">
  <img src="assets/banner.png" alt="Snowball Middleware Banner" width="100%">
</p>

<h1 align="center">
  <img src="assets/icon.png" width="48" height="48" valign="middle" alt="Snowball Icon">
  Snowball Middleware
</h1>

<p align="center">
  <strong>Local Control Plane, Web Supervisor & Desktop Middleware for AI Coding Agents</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg" alt="Platforms">
  <img src="https://img.shields.io/badge/Tests-237%2F237%20Passing-brightgreen.svg" alt="Tests">
  <a href="https://github.com/fkiller/Snowball_Control"><img src="https://img.shields.io/badge/Hardware-MK20%20Control%20Panel-purple.svg" alt="Companion Repo"></a>
</p>

---

## 🌟 Overview

**Snowball Middleware** is the host-side control plane that unifies local AI coding agents—**OpenAI Codex**, **Google Antigravity (AGY)**, and **OpenCode**—into a single, low-latency desktop interface.

It provides developers with:
- **Web Supervisor (`http://127.0.0.1:8765/`)**: Zero-auth, local-loopback web dashboard for inspecting live turns, reviewing diffs, granting tool approvals, dictating prompts, and adjusting model/effort variants in real time.
- **Native Desktop System Tray**: Lightweight cross-platform tray runtime (Windows, macOS, Linux) managing background daemon workers, hotkeys, and quick status monitoring.
- **Hardware Agnostic**: Fully functional as a standalone desktop control plane. When connected to the **MK20 hardware desk terminal**, it streams LCD framebuffers and binds physical mechanical keys and rotary encoders instantly.

> 💡 **Looking for MK20 Firmware and Hardware Tooling?**  
> Check out the companion repository: 👉 **[`Snowball_Control`](https://github.com/fkiller/Snowball_Control)** (QMK firmware, Tina Linux OS/BSP, and C HUD daemon).

---

## ⚡ Non-Negotiable Core Principles

1. **Zero Simulation (시뮬레이션 전면 금지)**
   - No mock delays, fake approvals, or simulated responses.
   - All session turns, file edits, and tool approvals dispatch directly into native agent runtimes (`codex app-server`, `agy stream-json`, `opencode run`).
2. **Living Source of Truth (살아있는 원천 기반 동적 발견)**
   - Models, efforts (variants), sessions, and workspaces are dynamically discovered from native tools and local caches. Zero static hardcoding.
3. **Local-First & Security Boundary**
   - Web Supervisor runs strictly on `127.0.0.1` loopback with zero mandatory cloud dependencies.
   - Network hardware connections (LAN UDP / USB HID) require explicit physical proof of presence.
4. **Plugin Sandbox Isolation**
   - Device and harness plugins run in security-isolated sandboxes, preventing arbitrary file system access while preserving native host dispatching.

---

## 🏗️ Architecture

For the complete architectural specification, protocol definitions, and security model, see:  
👉 **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

```text
 ┌────────────────────────────────────────────────────────┐
 │                   Web Supervisor                       │
 │               http://127.0.0.1:8765/                   │
 └──────────────────────────┬─────────────────────────────┘
                            │ REST / SSE
 ┌──────────────────────────▼─────────────────────────────┐
 │                Core Middleware Engine                  │
 │   - ContextManager (State Engine & Mode Machine)       │
 │   - DeviceRegistry & SessionManager                    │
 │   - Resident Whisper Worker (Metal / CUDA / CPU STT)   │
 │   - Living Catalog & DB Scanners                       │
 └──────────────┬──────────────────────────┬──────────────┘
                │ Native Dispatch          │ UDP 7701 / HID
 ┌──────────────▼─────────────┐   ┌────────▼─────────────┐
 │   AI Coding Harnesses      │   │  MK20 Desk Terminal  │
 │   - OpenAI Codex           │   │  (via companion repo │
 │   - Google Antigravity     │   │   Snowball_Control)  │
 │   - OpenCode               │   └──────────────────────┘
 └────────────────────────────┘
```

---

## 💻 Multi-Platform Installation & Execution

### Prerequisites
- **Node.js**: `>= 22.12.0`
- **Operating Systems**: Windows 10/11 x64, macOS 12+ (Apple Silicon & Intel), Linux (Kernel 5.4+)

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
npm run start:tray
```

### 4. Desktop Packaging (Multi-Platform Releases)
```bash
# Build standalone desktop app bundles (Windows, macOS ARM64/x64, Linux)
npm run package:desktop

# (Windows) Build NSIS per-user installer (.exe)
npm run package:windows-installer
```

---

## 🧪 Verification & Test Suite

Run the full automated test suite (237 unit, integration, and platform tests):

```bash
# Run full regression test suite
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
│   └── icon.png
├── config/                     # Configuration schemas (STT models, etc.)
├── docs/                       # Comprehensive architecture documentation
│   └── ARCHITECTURE.md         # Single Source of Truth architecture specification
├── packages/
│   ├── api/                    # Local HTTP & WebSocket API server
│   ├── client-sdk/             # TypeScript client SDK for Supervisor
│   ├── core/                   # State machine, session manager & journal
│   ├── harness-antigravity/    # Antigravity adapter plugin
│   ├── harness-codex/          # Codex adapter plugin
│   └── harness-opencode/       # OpenCode adapter plugin
├── scripts/                    # Build, packaging & test automation scripts
├── LICENSE                     # Apache-2.0 License
└── README.md                   # Project overview and quick start guide
```

---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
