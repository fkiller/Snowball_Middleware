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
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg" alt="Platforms">
  <a href="https://github.com/fkiller/Snowball_Middleware#one-shot-install"><img src="https://img.shields.io/badge/Install-Snowball-purple.svg" alt="Install Snowball"></a>
</p>

---

<a id="one-shot-install"></a>
## Snowball 한 번에 설치

**PC마다 Snowball을 한 번 설치하세요.** 기본 설치에 Web UI, MK20 검색·연결·음성 런타임, M5Stack 검색·게이트웨이, Codex·Antigravity·OpenCode 하네스 플러그인 3종이 모두 포함됩니다. 기기 프로필을 고르거나 USB 기기를 연결할 필요가 없습니다.

기존 Snowball 아이콘을 네이티브 앱·트레이·기기 설정 창·알림·바로가기·설치 프로그램·로컬 Web UI에 일관되게 적용합니다. 소스 설치도 제품 이름과 아이콘을 가진 실행 파일을 준비하며, 업데이트 시 해당 suite의 기존 자동 시작 선택을 보존합니다. 기기 펌웨어와 제공사 앱은 각각의 검토된 리소스를 유지합니다.

사용하는 OS를 펼친 뒤 명령을 복사하세요.

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

설치가 끝나면 트레이 아이콘에서 **http://127.0.0.1:8765/** Web UI와 설정·일시정지/재개·로그인 자동 시작을 관리합니다. Windows는 Node/Git/Python을 준비합니다. macOS/Linux는 curl·Git·venv/pip을 포함한 Python >=3.12가 필요하며 Linux는 그래픽 데스크톱과 Electron 시스템 라이브러리도 필요합니다. 네이티브 하네스 앱 설치와 로그인은 각 공급자를 통해 준비하세요.

<a id="update-snowball"></a>
## Snowball 업데이트

### 1. PC 소프트웨어 업데이트

**기존에 설치한 폴더를 사용하세요.** 아래는 기본 경로 예시입니다. 다른 폴더(예: `Snowball-LAN`)에 설치했다면 첫 줄을 그 경로로 바꾸세요. 기기 프로필 옵션은 넣지 않습니다.

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

업데이트는 기기 설정·페어링 키·컨트롤러 상태·음성 캐시·API 포트·로그인 자동 시작 선택을 보존합니다. 이전 단일 기기 설치에도 두 기기 어댑터를 포함합니다. PC 업데이트로 **Included(제공)** 후보를 갱신한 뒤, 기기 펌웨어는 아래 절차로 적용합니다.

<a id="update-device"></a>
### 2. 기기 펌웨어 업데이트

1. PC 업데이트 후 기기를 USB 데이터 케이블로 연결하고 트레이에서 **기기 설정…** 메뉴를 엽니다.
2. 기기를 선택하고 **Installed(현재) → Included(제공)** 버전과 개선 사항을 확인합니다.
3. 기종을 확인한 뒤 **설치 / 업데이트**를 선택합니다. 복구 백업 검증과 설정 보존 절차를 거쳐 쓰기를 진행합니다.
4. 재기동과 실행 버전 확인이 끝날 때까지 USB 연결을 유지합니다. 필요하면 같은 창의 Wi-Fi 안내를 따릅니다.

[기기별 상세 절차와 복구](https://github.com/fkiller/Snowball_Middleware/blob/main/README.ko.md#update-device) · [현재 M5Stack 제공 버전과 개선 사항](https://github.com/fkiller/Snowball_Device_M5Stack/blob/main/firmware/release.json)

<details>
<summary><strong>M5Stack · USB 펌웨어 업데이트</strong></summary>

- 최초 ESP32 Core 4MB/16MB와 FACES를 지원합니다. CP210x 감지만으로 기종을 확정하지 않으며 펌웨어가 응답하지 않으면 실물 기종을 확인하세요.
- 전체 플래시 백업 중 USB를 유지하세요. 진행률·MiB·경과 시간을 표시하며 16MB 읽기는 몇 분 걸릴 수 있습니다. 읽기 후 크기·해시를 검증한 다음 쓰기를 진행합니다.
- 저장된 Wi-Fi와 등록 PC를 보존합니다. 네트워크가 없으면 Wi-Fi 가져오기 선택을 검토하거나 FACES 키보드 안내를 따릅니다. OS 비밀번호는 해당 선택 이후에만 읽으며 UI·로그에 표시하지 않습니다.
- PC 업데이트 도구는 값이 동일한 Wi-Fi 드라이버 항목의 재기록을 설정 손실로 오판하지 않습니다. 다른 저장 영역 차이는 계속 완료를 차단하고 백업을 보존합니다. 구 도구에서 보존 실패가 나왔다면 복원·재시도 전에 보존된 백업과 실제 기기를 비교해야 하며, PC Update만으로 기기 저장 영역을 검증한 것은 아닙니다.
- 0.3.0 이하는 새 PC LAN 검색을 위해 한 번 업그레이드해야 합니다. 제공 버전은 설치된 설정 창에서 확인하며 과거 캡처의 버전은 예시입니다.

</details>

<details>
<summary><strong>MK20 · 런타임과 QMK</strong></summary>

**런타임(화면·통신 소프트웨어)**

검증된 USB 수신기나 기존에 허용된 LAN 관리 연결이 있으면 **MK20 → 런타임 → 백업 후 런타임 업데이트**를 사용합니다. SD 카드를 기기에 둔 채 변경할 런타임 파티션을 백업하고 Wi-Fi·PC 등록을 보존하며 재기동 후 실행 이미지를 확인합니다. 키보드 USB 연결만으로 런타임 업데이트가 가능해지지는 않습니다. 최초 이관이 필요한 구 펌웨어는 창의 연결 안내를 따르세요.

**QMK(키보드 펌웨어)**

일반 키보드 USB에서는 설치된 QMK 이미지를 식별할 수 없으며 미확인이 구버전을 뜻하지 않습니다. QMK 영역에서 대상 기기·USB 연결을 확인한 뒤 **키보드 펌웨어 확인 모드로 전환**을 선택합니다. 실제 DFU 읽기로 이미지를 비교한 뒤 필요한 경우 별도로 백업 후 업데이트하거나 **업데이트 없이 키보드로 돌아가기**를 선택합니다.

수동 DFU는 MK20 전원을 끈 뒤 맨 윗줄 맨 왼쪽 사각 화면 키(원형 노브 아님)를 누른 채 전원을 켜고 PC USB를 연결합니다. 별도 전원을 쓰면 USB 재연결만으로는 전원이 꺼지지 않을 수 있습니다.

DFU를 감지하면 모드 전환 안내 대신 실제 읽기 결과를 표시합니다. 읽기 실패와 USB 드라이버 접근 실패를 구분하고, USB 접근이 가능하면 일반 키보드로 돌아갈 수 있습니다. 구 설치본에서 DFU 진입 후 멈추면 먼저 PC 미들웨어를 업데이트하세요. 호스트 도구가 Maple 부트로더의 플래시 끝 응답을 올바르게 처리하도록 수정했습니다. 펌웨어 쓰기에는 여전히 전체 백업 검증과 별도의 업데이트 선택이 필요합니다.

</details>

<details>
<summary><strong>감지·백업·업데이트가 실패할 때</strong></summary>

- **다시 확인**은 현재 연결·버전을 읽으며 펌웨어를 쓰지 않습니다. 미확인은 설치 버전을 확인하지 못했다는 뜻입니다.
- 창에 실패한 단계를 유지합니다. 해당 시도의 백업이 검증된 뒤에만 복구 백업 경로를 표시합니다. 최초 백업 읽기 실패라면 펌웨어 쓰기를 시작하지 않은 상태입니다.
- M5Stack은 실패한 백업 구간만 낮은 USB 속도로 한 번 재시도합니다. 다시 실패하면 쓰기를 차단하고 기존 펌웨어 재기동·응답 확인을 시도합니다.
- 같은 창의 기기별 복구 안내를 따르세요. 카드 리더·레거시 등록 스크립트는 고급 유지보수 도구입니다.
- macOS/Linux의 실물 기기 인수는 자동 검사와 별도이며 중앙 검증 기록에서 확인합니다.

</details>

<details>
<summary>기기 설정 화면 예시</summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/fkiller/Snowball_Control/main/assets/screenshots/mk20_device_setup_ko.png" width="100%" alt="MK20 한국어 기기 설정: LAN 관리 연결, 제공 런타임 0.2.6 및 런타임 파티션 백업 진행 화면"><br>
  <em>사용자 제공 캡처(2026-10-12): MK20 LAN 관리 연결에서 제공 런타임 0.2.6으로 업데이트하기 위한 파티션 백업 진행 예시입니다. 현재 버전의 미확인은 버전을 확인하지 못했다는 뜻이며, 업데이트 완료 화면은 아닙니다.</em>
</p>

</details>

## 기기에서 PC 연결

MK20은 Wi-Fi 연결 후 **K17 · Machines**에서 PC를 선택합니다. M5Stack 펌웨어 0.4.0 이상은 **Machines**에서 등록 PC나 새 PC를 선택하여 LAN으로 페어링합니다. PC 추가에는 전체 PC 설치만 필요하며 USB 등록 스크립트는 필요 없습니다. 기기 포트를 허용하고 클라이언트 격리를 해제한 같은 신뢰 사설 LAN을 사용하세요.

<details>
<summary><strong>고급 옵션</strong></summary>

| 목적 | Windows | macOS / Linux |
| --- | --- | --- |
| 기존 설치 폴더 | `-InstallRoot 경로` | `--root 경로` |
| 사설 LAN 인터페이스 지정 | `-Bind PC의_사설_IP` | `--bind PC의_사설_IP` |
| API 포트 지정 | `-Port 포트` | `--port 포트` |
| 설치 후 실행하지 않기 | `-NoStart` | `--no-start` |
| 바로가기 생략 | `-NoShortcut` | `--no-shortcut` |
| 진단용 부분 구성 | `-Profile web\|mk20\|m5stack` | `--profile web\|mk20\|m5stack` |

일반 설치·업데이트는 두 기기와 하네스 3종을 함께 포함합니다. 사설 LAN이 없거나 선택이 모호하면 검색은 대기하고 로컬 Web UI는 유지합니다. Windows가 묻는 경우 미들웨어 Node.js의 개인 네트워크 접근을 허용하세요. Linux의 USB/시리얼 접근은 일반 OS 권한을 사용합니다. Unix 전체 옵션은 `bash install.sh --help`로 확인합니다. 설치 폴더의 **Start-Snowball.ps1** / **Start-Snowball.sh**는 다운로드 없이 다시 실행합니다.

</details>

M5Stack **0.5.5**는 머신 목록에서 식별되지 않은 “기존 등록 PC” 항목을 숨기고 구 키는 삭제하지 않습니다. 실제 호스트 식별자가 있는 PC만 선택하며, 읽기 입력 시 받은 실제 내용과 스크롤바를 즉시 이동하고 아직 응답받지 못한 행에는 로딩을 표시합니다. 호스트의 자동 LAN 선택은 알려진 Hyper-V·WSL·VPN 어댑터 이름을 제외하며 명시적 bind와 대상 기기 서브넷 선택을 우선합니다. PC 업데이트는 호스트 검색 수정과 펌웨어 후보를 제공하고, 기기 쓰기는 설정 창에서 검토·전체 백업·설정 보존 후 진행합니다. 0.5.5의 손으로 A/C 조작 검증은 남아 있으며 업데이트 전 진단 탐색에서는 실제 395의 0·12·24행 수신을 확인했습니다.

[공통 아키텍처와 검증 범위](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md)

[Control · MK20](https://github.com/fkiller/Snowball_Control) · [Middleware](https://github.com/fkiller/Snowball_Middleware) · [M5Stack](https://github.com/fkiller/Snowball_Device_M5Stack) · Harness: [Codex](https://github.com/fkiller/Snowball_Harness_Codex), [Antigravity](https://github.com/fkiller/Snowball_Harness_Antigravity), [OpenCode](https://github.com/fkiller/Snowball_Harness_OpenCode)

---

## 🌟 개요 (Overview)

**Snowball은 inter-Harness 로컬 제어 인터페이스입니다.** 개발자가 MK20 데스크 터미널과 로컬 Web Supervisor에서 Codex, AGY, OpenCode를 공통된 조작 방식으로 탐색하고 제어합니다. 사용자가 하네스·프로젝트·세션을 선택하고, 각 하네스는 고유한 실행 환경·이력·모델·권한을 유지합니다.

제품의 철학은 **제어권을 사용자의 손과 컴퓨터에 두는 것**입니다. 도구를 오가고 작업을 확인하는 동작은 즉각적이어야 하며, 기능은 실제 설치 환경에서 발견하고 결과와 한계는 사실대로 보여줘야 합니다. 자세한 [제품 철학](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md#제품-철학-inter-harness-로컬-제어)은 중앙 아키텍처 문서에서 관리합니다.

**Preview:** 개인 PC와 신뢰하는 내부 네트워크 전용입니다. 루프백 Web UI에는 로그인/PIN을 요구하지 않습니다. MK20 UDP/개발 ADB의 인증·암호화 생략은 [현재 설계 문서](docs/ARCHITECTURE.ko.md)에 명시합니다.

**Snowball Middleware**는 로컬 AI 코딩 에이전트—**OpenAI Codex**, **Google Antigravity (AGY)**, **OpenCode**—를 단일한 초저지연 데스크톱 인터페이스로 통합하는 호스트 제어 평면입니다.

주요 구성:
- **웹 수퍼바이저 (`http://127.0.0.1:8765/`)**: 로그인/PIN 없는 로컬 루프백 대시보드입니다. 사용 가능한 제어 기능은 선택한 런타임에 연결된 네이티브 어댑터에 따라 달라지며, 단순 발견만으로 실행 또는 승인 권한이 부여되지 않습니다.
- **네이티브 데스크톱 시스템 트레이**: Snowball Middleware가 제품 아이콘과 로컬 제어 메뉴를 제공하며 백그라운드에서 실행됩니다. 패키지 빌더는 Windows와 macOS를 지원합니다.
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
