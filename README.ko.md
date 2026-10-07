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

**Snowball Middleware가 공통 설치와 PC 실행을 담당합니다.** Snowball Control은 MK20 펌웨어·HUD·기기 도구를, Snowball Device · M5Stack은 ESP32 펌웨어와 게이트웨이를 담당합니다. Web UI와 M5Stack에는 Control 체크아웃이 필요 없습니다. 세 Snowball Harness 저장소의 Codex·Antigravity·OpenCode 플러그인은 모든 프로필에 함께 설치됩니다.

Windows PowerShell에서 원하는 구성의 명령 **하나만** 실행하세요.

| 내 구성 | 함께 설치하는 구성 요소 | 명령 |
| --- | --- | --- |
| MK20 | Middleware + MK20 호스트 라이브러리 + 하네스 플러그인 3종 | `& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1'))) -Profile mk20` |
| M5Stack + FACES | M5Stack 펌웨어/게이트웨이 + Middleware + 하네스 플러그인 3종 | `& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1'))) -Profile m5stack` |
| Web UI만 | Middleware + 하네스 플러그인 3종 | `& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/fkiller/Snowball_Middleware/main/install.ps1'))) -Profile web` |

설치기는 Node/Git(기기 프로필은 Python 포함) 준비, 저장소 빌드, 격리된 플러그인 프로세스의 실제 초기화 검증, **Start-Snowball.ps1** 실행 파일·바탕화면 바로가기 생성까지 수행합니다. 실제 API 응답을 확인한 뒤 **http://127.0.0.1:8765/**를 엽니다. 기본 설치 위치는 `%LOCALAPPDATA%\Snowball`이며, 이후 실행 파일은 다운로드 없이 설치된 구성을 다시 시작합니다.

M5Stack은 첫 설치 시 USB로 연결하세요. 플래시 용량 탐지, 기존 전체 플래시 비공개 백업, 펌웨어 업로드, 실제 FACES 응답 확인 후 등록합니다. 독립 MK20은 Wi-Fi에 연결하고, 연결할 각 PC에 이 프로필을 설치하세요. MK20의 K17(Machines)에서 왼쪽 노브를 돌리고 클릭하면 온라인 PC를 페어링·선택합니다. 기기는 페어링 목록과 마지막 선택을 재부팅 뒤에도 유지하며, 선택한 PC의 하네스·프로젝트·세션을 표시합니다. PC 추가에는 USB·ADB·SD 변경이 필요 없습니다. 최초 펌웨어·Wi-Fi 준비와 이후 펌웨어 유지보수는 별도 기기 작업이며, 문제 발생 시 복원할 수 있도록 SD 이미지 백업을 권장합니다. USB 재연결·부트로더 진입·네이티브 하네스 로그인은 사용자가 수행해야 하며, 네이티브 앱이 없으면 해당 공급자는 사용 불가로 표시합니다.

옵션: `-InstallRoot 경로`, `-Serial COM번호`, `-Bind PC의_사설_IP`, `-Port 8765`, `-NoStart`, `-NoFlash`(M5Stack 기존 펌웨어 확인). 여러 USB 포트나 LAN 어댑터가 있으면 해당 옵션으로 지정하세요. 오류가 나면 완료로 처리하지 않습니다. 원샷 부트스트랩은 현재 **Windows** 대상입니다. Node/Git가 설치된 macOS 개발 환경에서는 같은 부모 폴더의 체크아웃 구성으로 `npm run setup -- --profile web` , `--profile mk20` 또는 `--profile m5stack`을 사용할 수 있습니다. Linux 전체 플러그인 런타임은 아직 지원하지 않습니다.

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
