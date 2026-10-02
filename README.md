<p align="center">
  <img src="assets/banner.png" alt="Snowball Middleware Banner" width="100%">
</p>

<h1 align="center">
  <img src="assets/icon.png" width="48" height="48" valign="middle" alt="Snowball Icon">
  Snowball Middleware — Preview
</h1>

<p align="center">
  <strong>Local Control Plane, Web Supervisor & Desktop Middleware for AI Coding Agents</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg" alt="Platforms">
  <a href="https://github.com/fkiller/Snowball_Control"><img src="https://img.shields.io/badge/Hardware-MK20%20Control%20Panel-purple.svg" alt="Companion Repo"></a>
</p>

---

## 🌟 Overview

**Preview:** 개인 PC와 신뢰하는 내부 네트워크 전용입니다. 루프백 Web UI에는 로그인/PIN을 요구하지 않습니다. MK20 UDP/개발 ADB의 인증·암호화 생략은 [현재 설계와 공개 전 확인 사항](docs/ARCHITECTURE.md)에 명시합니다.

**Snowball Middleware** is the host-side control plane that unifies local AI coding agents—**OpenAI Codex**, **Google Antigravity (AGY)**, and **OpenCode**—into a single, low-latency desktop interface.

It provides developers with:
- **Web Supervisor (`http://127.0.0.1:8765/`)**: Local-loopback dashboard without a login/PIN. Available control operations depend on the native adapters connected to the selected runtime; discovery alone does not grant execution or approval capabilities.
- **Native Desktop System Tray**: Electron tray shell for managing the local runtime. The package builder currently supports Windows and macOS; this review's installed harness baseline is Windows.
- **MK20 integration**: The companion **Snowball_Control** checkout supplies the device transport and local STT implementation for `scripts/start-all.mjs`. Native approval, cancellation and recovery still require the checks listed in the architecture document.

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
   - Production device transports require their own reviewed pairing. The MK20 lab Preview uses a trusted private LAN and does not provide cryptographic device authentication.
4. **Plugin Sandbox Isolation**
   - Device and harness plugins run in security-isolated sandboxes, preventing arbitrary file system access while preserving native host dispatching.

---

## 🏗️ Architecture

For the complete architectural specification, protocol definitions, and security model, see:  
👉 **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

Current component ownership, transport paths, security boundaries and implementation limits are maintained in the [single architecture document](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md).

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
│   └── ARCHITECTURE.md         # Pointer to Snowball_Control/docs/ARCHITECTURE.md
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

현재 리뷰 PC의 설치 버전은 [config/harness-compatibility.json](config/harness-compatibility.json)에서 확인합니다. 설치 버전 기록은 전체 호환성 인증이 아닙니다. MK20 전체 통합(`node scripts/start-all.mjs`)은 같은 부모 폴더의 Snowball_Control checkout과 빌드한 `host/dist`를 참조합니다. 변경 전 SD 백업과 수정 QMK 업데이트가 필요합니다.
