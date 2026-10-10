<p align="center">
  <img src="assets/banner.png" alt="Snowball Banner" width="100%">
</p>

<h1 align="center">
  <img src="assets/icon.png" width="48" height="48" valign="middle" alt="Snowball Icon">
  Snowball Middleware — Preview
</h1>

<p align="center">
  <strong>inter-Harness 로컬 제어, 웹 수퍼바이저 및 데스크톱 미들웨어</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS-orange.svg" alt="Platforms">
  <a href="https://github.com/fkiller/Snowball_Middleware#one-shot-install"><img src="https://img.shields.io/badge/Install-Snowball-purple.svg" alt="Install Snowball"></a>
</p>

---

<a id="one-shot-install"></a>
## Snowball 한 번에 설치

**PC마다 Snowball을 한 번 설치하세요.** 기본 설치에 Web UI, MK20 검색·연결·음성 런타임, M5Stack 검색·게이트웨이, Codex·Antigravity·OpenCode 하네스 플러그인 3종이 모두 포함됩니다. 기기 프로필을 고르거나 USB 기기를 연결할 필요가 없습니다.

Windows PowerShell에서 실행하세요.

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1')))
```

설치기는 Node/Git/Python과 구성 요소를 준비하고 실제 격리 하네스 워커를 확인한 뒤, 트레이 아이콘이 있는 사용자별 숨김 백그라운드 앱을 시작합니다. 소유 런타임이 응답하면 설치 터미널로 돌아옵니다. 트레이에서 Web UI, 상태, 설정, 일시정지/재개, 재시작, 종료, 로그인 자동 시작을 제공합니다. Web UI는 **http://127.0.0.1:8765/**이며 기본 설치 위치는 `%LOCALAPPDATA%\Snowball`입니다. **Start-Snowball.ps1**은 다운로드 없이 다시 실행합니다. 네이티브 하네스 앱과 로그인은 공급자를 통해 준비하며, 없으면 사용 불가로 표시합니다.

기존 설치 업데이트는 같은 `-InstallRoot`에 `-Update`를 추가하고 `-Profile`은 생략하세요. 기존 단일 기기 설치에도 두 어댑터를 준비하며 기기 설정·페어링 키·컨트롤러 상태·음성 캐시·사용자 지정 API 포트·로그인 자동 시작 설정을 보존합니다. 사설 LAN이 없거나 선택이 모호하면 자동 검색은 대기·재시도하고 Web UI는 유지합니다. 필요하면 `-Bind PC의_사설_IP`를 지정하세요.

MK20은 Wi-Fi에 독립적으로 연결한 뒤 K17(Machines)에서 PC를 선택해 페어링합니다. M5Stack 펌웨어 **0.4.0 이상**은 같은 LAN의 등록 PC와 새 미들웨어를 자동 검색합니다. 머신 목록에서 새 PC를 선택하면 Wi-Fi로 페어링합니다. PC 추가에는 전체 미들웨어 설치만 필요하며 기기별 추가 설치·USB 연결·등록 스크립트는 필요하지 않습니다. 같은 브로드캐스트 서브넷, 기기 포트 허용, 클라이언트 격리 해제 상태의 신뢰하는 사설 LAN을 사용하세요.

M5Stack 최초 준비나 펌웨어 갱신은 **USB 연결 시 자동으로 열리는 M5Stack 설정 창**에서 진행합니다. 트레이의 **M5Stack 설정…**에서도 열 수 있습니다. 현재/제공 버전과 개선 사항을 보여주며, 사용자가 설치·업데이트를 선택해야 전체 플래시 비공개 백업 → 펌웨어 쓰기 → Wi-Fi·페어링 저장 영역 보존 검증 → 자동 재기동 확인을 수행합니다. 현재 제공 펌웨어는 **0.5.0**입니다. 저장된 네트워크가 없으면 기본 선택된 가져오기 옵션으로 업데이트 후 PC의 연결된 Wi-Fi를 OS가 허용하는 범위에서 이관하고, 기존 정보가 있으면 덮어쓰지 않습니다. OS 비밀번호는 해당 선택 이후에만 읽으며 UI·로그에 표시하지 않습니다. 가져올 수 없으면 같은 창에서 설정 → Wi-Fi, 네트워크 선택, FACES 키보드 비밀번호 입력을 그림으로 안내합니다. 최초 ESP32 Core 4MB/16MB만 지원합니다. CP210x만으로 기종을 확정하지 않으며 Snowball 응답이 없는 기기는 사용자가 실제 기종을 확인해야 합니다. 빌드는 누락된 도구를 다운로드할 수 있습니다. 0.3.0 이하는 새 PC LAN 검색을 위해 기기 펌웨어를 한 번 업그레이드해야 합니다. `Register-M5Stack.ps1` / `.sh`는 선택적 레거시 유지보수 도구로 남으며 일반 설치와 `-Update`가 기기를 자동 플래싱하지 않습니다.

옵션: `-Update`, `-InstallRoot 경로`, `-Bind PC의_사설_IP`, `-Port 8765`, `-NoStart`, `-NoShortcut`. `-Profile web|mk20|m5stack`은 개발·진단용 명시적 부분 구성으로 유지하며 일반 설치에서는 필요 없습니다. 같은 루트에 이미 설치된 어댑터는 유지합니다. Node/Git/Python이 준비된 macOS 소스 환경에서는 같은 부모 폴더 체크아웃으로 `npm run setup --`을 실행하며, USB 준비는 `--prepare-m5stack [--no-flash]`로 명시합니다. Linux 전체 워커 런타임은 아직 지원하지 않습니다. 프로토콜·인증·실물 검증 범위는 중앙 명세를 확인하세요.

[공통 아키텍처와 저장소 역할](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md)

[Control · MK20](https://github.com/fkiller/Snowball_Control) · [Middleware · Installer / Web UI](https://github.com/fkiller/Snowball_Middleware) · [Device · M5Stack](https://github.com/fkiller/Snowball_Device_M5Stack) · Harness: [Codex](https://github.com/fkiller/Snowball_Harness_Codex), [Antigravity](https://github.com/fkiller/Snowball_Harness_Antigravity), [OpenCode](https://github.com/fkiller/Snowball_Harness_OpenCode)

---

## 🌟 개요 (Overview)

**Snowball은 inter-Harness 로컬 제어 인터페이스입니다.** 개발자가 MK20 데스크 터미널과 로컬 Web Supervisor에서 Codex, AGY, OpenCode를 공통된 조작 방식으로 탐색하고 제어합니다. 사용자가 하네스·프로젝트·세션을 선택하고, 각 하네스는 고유한 실행 환경·이력·모델·권한을 유지합니다.

제품의 철학은 **제어권을 사용자의 손과 컴퓨터에 두는 것**입니다. 도구를 오가고 작업을 확인하는 동작은 즉각적이어야 하며, 기능은 실제 설치 환경에서 발견하고 결과와 한계는 사실대로 보여줘야 합니다. 자세한 [제품 철학](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md#제품-철학-inter-harness-로컬-제어)은 중앙 아키텍처 문서에서 관리합니다.

**Preview:** 개인 PC와 신뢰하는 내부 네트워크 전용입니다. 루프백 Web UI에는 로그인/PIN을 요구하지 않습니다. MK20 UDP/개발 ADB의 인증·암호화 생략은 [현재 설계 문서](docs/ARCHITECTURE.ko.md)에 명시합니다.

**Snowball Middleware**는 로컬 AI 코딩 에이전트—**OpenAI Codex**, **Google Antigravity (AGY)**, **OpenCode**—를 단일한 초저지연 데스크톱 인터페이스로 통합하는 호스트 제어 평면입니다.

주요 구성:
- **웹 수퍼바이저 (`http://127.0.0.1:8765/`)**: 로그인/PIN 없는 로컬 루프백 대시보드입니다. 사용 가능한 제어 기능은 선택한 런타임에 연결된 네이티브 어댑터에 따라 달라지며, 단순 발견만으로 실행 또는 승인 권한이 부여되지 않습니다.
- **네이티브 데스크톱 시스템 트레이**: 로컬 런타임을 관리하기 위한 Electron 트레이 셸입니다. 패키지 빌더는 현재 Windows와 macOS를 지원합니다.
- **MK20 하드웨어 연동**: MK20 프로필만 **Snowball Control**의 전송 및 STT 라이브러리를 불러옵니다. Web·M5Stack 프로필은 공통 네이티브 세션 런타임을 독립적으로 실행합니다. 네이티브 승인, 취소 및 복구 경계는 아키텍처 사양에 정의되어 있습니다.

> 💡 **MK20 펌웨어 및 하드웨어 도구를 찾으시나요?**  
> 동반 저장소를 확인하세요: 👉 **[`Snowball_Control`](https://github.com/fkiller/Snowball_Control)** (QMK 펌웨어, Tina Linux OS/BSP 및 네이티브 C HUD 데몬).

---

## 🖥️ 비주얼 쇼케이스 (Visual Showcase)

### 웹 수퍼바이저 대시보드 (Web Supervisor)
로컬 루프백 웹 수퍼바이저(`http://127.0.0.1:8765/`)는 외부 클라우드 의존성 없이 탐색된 작업공간, 활성 하네스(Codex, AGY, OpenCode), 그리고 실시간 하드웨어 연결 상태를 직관적으로 제공합니다:

<p align="center">
  <img src="assets/screenshots/web_supervisor_dashboard_ko.png" width="100%" alt="Snowball 웹 수퍼바이저 대시보드">
</p>

### 물리 MK20 터미널 연동 (Hardware Terminal)
동반 저장소인 **[`Snowball_Control`](https://github.com/fkiller/Snowball_Control)**과 연동하여 MK20 하드웨어 데스크 터미널에서 브레드크럼 계층 탐색(`기기 > 하네스 > 프로젝트 > 세션`), 내장 마이크 음성 프롬프트 캡처, 초저지연 상태 동기화를 구동합니다:

<p align="center">
  <img src="assets/screenshots/mk20_navigation_demo.gif" width="480" alt="MK20 네비게이션 시연"><br>
  <em>Snowball Middleware로 구동되는 실물 MK20 하드웨어 데스크 터미널.</em><br>
  <a href="https://github.com/fkiller/Snowball_Control">👉 Snowball_Control 저장소 바로가기</a> &nbsp;|&nbsp; <a href="https://x.com/fkiller/status/2099345561627382015">🔗 X (Twitter) 원본 글</a>
</p>

---

## ⚡ 불변의 핵심 원칙 (Core Principles)

1. **Zero Simulation (시뮬레이션 전면 금지)**
   - 가짜 지연, 모의 승인, 시뮬레이션된 응답을 일절 배제합니다.
   - 지원되는 동작은 네이티브 에이전트 런타임(`codex app-server`, `agy stream-json`, `opencode run`)에 전달하고 실제 결과를 보고해야 합니다. 네이티브 승인·취소 지원은 어댑터마다 다르며, 현재 한계는 아키텍처 문서에 명시합니다.
2. **Living Source of Truth (살아있는 원천 기반 동적 발견)**
   - 모델, effort(variant), 세션 및 작업공간은 네이티브 CLI 도구와 로컬 캐시에서 동적으로 발견됩니다. 정적 하드코딩이 존재하지 않습니다.
3. **Local-First & Security Boundary (로컬 우선 및 보안 경계)**
   - 웹 수퍼바이저는 필수적인 외부 클라우드 의존성 없이 `127.0.0.1` 루프백에서 엄격히 실행됩니다.
   - MK20 lab Preview는 신뢰하는 개인 LAN을 사용하며 암호화된 기기 인증을 제공하지 않습니다.
4. **Plugin Sandbox Isolation (플러그인 샌드박스 격리)**
   - 승인된 네이티브 호스트 실행을 유지하면서 플러그인 권한을 제한해야 합니다. 현재 자식 프로세스 격리는 OS 파일 시스템 샌드박스를 강제하지 않으며, 신뢰할 수 없는 플러그인은 Preview의 보안 범위 밖입니다.

---

## 🏗️ 아키텍처 (Architecture)

전체 아키텍처 사양, 프로토콜 정의 및 보안 모델은 다음 문서를 참고하세요:  
👉 **[`docs/ARCHITECTURE.ko.md`](docs/ARCHITECTURE.ko.md)**

현재 컴포넌트 소유권, 전송 경로, 보안 경계 및 구현 제한 사항은 [단일 아키텍처 사양서](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md)에서 중앙 관리됩니다.

---

## 💻 개발자 빌드와 트레이 셸

### 필수 요구사항
- **Node.js**: `>= 22.12.0`
- **현재 검증 환경**: Windows 11 리뷰 호스트. 코어 자동화 테스트는 Ubuntu에서도 통과합니다.

### 1. 설정 및 빌드
```bash
# 저장소 복제
git clone https://github.com/fkiller/Snowball_Middleware.git
cd Snowball_Middleware

# 의존성 설치
npm ci --ignore-scripts

# 코어 패키지 빌드
npm run build
```

### 2. 웹 수퍼바이저 실행 (로컬 루프백)
```bash
npm run start:local
```
브라우저에서 **`http://127.0.0.1:8765/`**에 접속합니다. 로그인이나 PIN 없이 즉시 대시보드가 열립니다.

### 3. 네이티브 데스크톱 트레이 실행
```bash
# Windows / macOS / Linux 시스템 트레이 런타임
npm run install:desktop
npm run start:tray
```

### 4. 데스크톱 패키징 (멀티 플랫폼 릴리즈)
```bash
# 대상 Windows 또는 macOS 호스트에서 빌드
npm run package:desktop

# (Windows) NSIS 사용자별 설치 파일(.exe) 빌드
npm run package:windows-installer
```

---

## M5Stack + FACES 실기 영상

[![M5Stack + FACES](https://raw.githubusercontent.com/fkiller/Snowball_Device_M5Stack/main/assets/screenshots/m5stack_navigation_demo.gif)](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/assets/videos/m5stack_navigation_demo.mp4)

[기기 펌웨어와 설치](https://github.com/fkiller/Snowball_Device_M5Stack) · [GitHub 전체 MP4](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/assets/videos/m5stack_navigation_demo.mp4) · [X](https://x.com/fkiller/status/2106892916149158101?s=20)

---

## 🧪 검증 및 테스트 스위트 (Verification)

전체 자동화 회귀 테스트를 실행합니다:

```bash
# 전체 회귀 테스트 스위트 실행 (241개 통과)
npm test

# 데스크톱 트레이 스모크 테스트
npm run test:tray
```

---

## 📁 저장소 구조 (Repository Structure)

```text
Snowball_Middleware/
├── apps/
│   ├── desktop/                # Electron 네이티브 트레이 셸 및 백그라운드 워커
│   └── supervisor/             # 웹 수퍼바이저 UI (HTML, CSS, JS 런타임)
├── assets/                     # 공식 브랜드 아트워크, 아이콘 및 배너
│   ├── banner.png
│   ├── icon.png
│   ├── screenshots/            # 웹 수퍼바이저 대시보드 및 하드웨어 캡처
│   │   ├── web_supervisor_dashboard_ko.png
│   │   ├── web_supervisor_dashboard_en.png
│   │   ├── mk20_navigation_demo.gif
│   │   └── mk20_ui_elements_test.gif
│   └── videos/                 # 시연 녹화 영상
│       ├── mk20_navigation_demo.mp4
│       └── mk20_ui_elements_test.mp4
├── config/                     # 설정 스키마 (STT 모델 등)
├── docs/                       # 아키텍처 문서
│   ├── ARCHITECTURE.md         # 영문 아키텍처 포인터 (기본)
│   └── ARCHITECTURE.ko.md      # 한글 아키텍처 포인터
├── packages/
│   ├── api/                    # 로컬 HTTP 및 WebSocket API 서버
│   ├── client-sdk/             # 수퍼바이저용 TypeScript 클라이언트 SDK
│   ├── core/                   # 상태 머신, 세션 관리자 및 명령 저널
│   ├── harness-antigravity/    # Antigravity 어댑터 플러그인
│   ├── harness-codex/          # Codex 어댑터 플러그인
│   └── harness-opencode/       # OpenCode 어댑터 플러그인
├── scripts/                    # 빌드, 패키징 및 테스트 자동화 스크립트
├── LICENSE                     # Apache-2.0 라이선스
├── README.md                   # 영문 기본 README
└── README.ko.md                # 한글 README
```

---

## 📄 라이선스 (License)

이 프로젝트는 Apache License 2.0 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

현재 리뷰 PC의 설치 버전은 [config/harness-compatibility.json](config/harness-compatibility.json)에서 확인합니다. 설치 버전 기록은 전체 호환성 인증이 아닙니다. 전체 런타임은 위의 설치된 통합 실행 파일을 사용합니다. `start:local`과 트레이는 명시적으로 네이티브 어댑터를 구성하는 개발용 진입점입니다.
