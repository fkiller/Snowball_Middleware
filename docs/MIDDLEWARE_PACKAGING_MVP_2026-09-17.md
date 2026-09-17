# Hardware-independent middleware packaging MVP

**최신 실행 기준 (2026-09-17):** 사용자가 로컬 제어를 근본 목적으로 확정했다. [계층형 실행 계획](middleware/PLAN.md), [전체 작업 트리](middleware/TASK_TREE.md), [discovery journeys](middleware/DISCOVERY_JOURNEYS.md), [재개 절차](middleware/RESUME.md)를 우선한다. 현재 PC가 기본이며 LAN 장치/다른 PC 연결은 명시적으로 활성화하는 확장이다.

작성: 2026-09-17. 상태: 구현 전 제품/아키텍처 제안 및 현재 코드 감사.
이번 문서는 사용자 요청에 따른 새 MVP 방향이다. 기존 하드웨어·음성 회귀 동작은 보존한다.
설치 파일, 별도 Git 저장소, 플러그인 런타임, Web GUI가 구현됐다는 의미는 아니다.

## 1. 제품 정의와 권장 결정

Snowball Middleware는 각 macOS/Windows 사용자 계정에서 실행되며 여러 harness의 작업을 조회하고 제어하는 하드웨어 독립 실행 계층이다. MK20, HID 컨트롤러, 브라우저는 선택 가능한 클라이언트다. 하드웨어가 없어도 설치·설정·작업 수행이 완결돼야 한다.

- Core: TypeScript/Node 기반 기존 로직을 추출한다. MK20 화면, 키 번호, ADB, 특정 harness RPC를 알지 않는다.
- Desktop packaging: MVP는 Electron의 tray/menu shell과 별도 core process를 권장한다. 기존 TypeScript/Node 생태계를 유지하고 외부 Node 설치를 없애는 선택이다. Chromium 포함에 따른 용량/메모리 비용은 실측한다. 주 창은 생성하지 않는다.
- 대안: 용량/상주 메모리 요구가 우선이면 Tauri tray + bundled Node sidecar. Rust와 Node 두 런타임의 빌드·서명·프로세스 수명 관리 비용 때문에 초기 기본안으로 삼지 않는다. 이는 실측 성능 비교가 아닌 구현 비용 판단이다.
- Settings와 Supervisor는 기본 브라우저에서 localhost로 연다. 앱 실행 시 대시보드를 강제로 띄우지 않는다. 첫 설치 설정만 명시적으로 안내한다.
- Distribution: macOS Developer ID 서명/공증 DMG, Windows 서명 EXE + winget. MS Store는 후속 채널. npm은 SDK/CLI/플러그인 개발용.
- 단일 PC의 로컬 제어를 먼저 완결한다. 같은 PC의 여러 Controller와 선택적 LAN 장치는 구분해 검증한다. 여러 실행 PC의 집계는 후속 G4 확장 gate이며 local MVP의 선행 조건이 아니다. G4 통과 전 multi-host 지원 완료를 선언하지 않는다.

## 2. 저장소 및 의존 방향

제안 이름은 작업명이며 npm scope/GitHub 이름 확보를 의미하지 않는다.

```text
snowball-middleware/                 새 별도 Git 저장소
  packages/core/                     모델, 명령, 상태, persistence, 권한
  packages/api/                      HTTP 명령/조회 + SSE 이벤트, OpenAPI
  packages/plugin-sdk/               manifest, RPC schemas, conformance fixtures
  packages/plugin-host/              process lifecycle, capability validation
  packages/client-sdk/               Web/CLI/3rd-party client 공통
  apps/desktop/                      tray, login startup, lifecycle, updater
  apps/supervisor/                   hardware 없는 browser UX
  apps/cli/                          doctor/status/dev tooling
  plugins/harness-codex/             초기 reference implementation
  plugins/harness-opencode/          두 번째 conformance 대상
  plugins/harness-antigravity/       검증 범위만 capability로 노출
  plugins/device-virtual/            실제 하드웨어 없는 계약 검증

Snowball_Control/                   기존 MK20 하드웨어 저장소
  hardware/mk20/                     firmware, rendering, QMK, lab tooling
  plugins/device-mk20/               추출할 MK20 host adapter와 presentation

third-party-device-or-harness/      독립 개발/릴리스, SDK만 의존
```

초기에는 middleware의 reference harness plugins를 같은 monorepo에서 독립 패키지로 관리한다. 모든 플러그인마다 저장소를 만들 필요는 없다. MK20 구현은 core에 역의존하지 않고 공개 SDK 계약만 사용한다. Core CI는 MK20 소스/SDK가 없는 상태에서도 통과해야 한다.

현재 `host/`와 `docs/`가 Git에서 untracked다. 단순 git subtree/filter만으로는 이 구현이 이전되지 않는다. 첫 추출 전에 source/test/license/fixture 파일을 선별한 inventory와 해시를 만들고, local state·녹음·venv·SDK·probe 산출물을 제외한 명시적 export를 사용한다. 기존 작업을 삭제하거나 blanket-add하지 않는다. 현재 저장소/새 저장소의 라이선스와 타사 재배포 권한을 확인한다. 별도 Snowball Gateway의 이름·코드와 혼동하지 않는다.

## 3. 공통 모델과 동시성

| 개념 | 의미 / 식별 |
|---|---|
| Host | middleware가 설치된 Mac/PC. 안정적인 hostId와 trust identity |
| Controller | MK20, HID, Web client. 각 controllerId별 선택 context |
| HarnessInstance | 같은 제품의 여러 계정/프로세스/서버를 분리한 instanceId |
| Project | 논리 프로젝트. 여러 Host의 Workspace와 명시적 연결 |
| Workspace | hostId, 등록 root, worktree/branch. 경로 문자열만으로 전역 병합 금지 |
| Session | hostId + harnessInstanceId + nativeSessionId |
| Task/Turn | Session 안의 실행 단위. 실행 상태와 관찰 freshness 별도 |
| Decision | native request ID, 종류, 옵션, revision, 만료, 소유 Session |
| Command | commandId, 대상, actor, expectedRevision, 권한/lease, 결과 |
| Draft | 텍스트와 고정 목적지, 소유자, 전달 상태. 다른 선택으로 이동하지 않음 |

Host와 Controller를 모두 Device라고 부르지 않는다. 독립 네트워크 장치는 자체 화면/입출력/네트워크를 가질 수 있으나 harness 실행 PC는 별개다. HID는 연결된 PC의 adapter가 report를 해석한다. 하나의 제품이 USB와 네트워크를 함께 지원할 수도 있으므로 standalone/HID를 배타적인 제품 타입으로 만들지 않는다.

읽기는 여러 client가 가능하다. 쓰기는 Session별 명령 큐와 revision 검사, 짧은 제어 lease로 조정한다. Controller마다 선택 상태가 따로 있으므로 Web의 프로젝트 변경이 MK20 선택을 바꾸지 않는다. Snowball lease는 외부 harness 앱까지 잠그지 못한다. 실제 owner attach가 보장되지 않으면 view-only와 원래 앱 열기를 제공한다.

전달 상태는 queued → dispatched → acknowledged → completed/failed, 그리고 unknown을 구분한다. commandId를 저장하고 중복 요청에 기존 결과를 반환한다. 재접속 시 자동 재전송하지 않는다. 외부 harness가 idempotency를 제공하지 않으면 end-to-end exactly-once를 약속할 수 없다. unknown은 조회로 조정하고, 문구 포함 여부만으로 전달 성공을 확정하지 않는다. approval도 native ID와 revision 기준으로 한 번만 해결한다.

## 4. 플러그인 계약

### 공통 manifest/lifecycle

`id`, `publisher`, `version`, `kind`, `sdkApiRange`, `entrypoint`, `os/arch`, `capabilities`, `permissions`, `configSchema`, `integrity`, `license`를 선언한다. namespaced 문자열 ID를 사용하고 현재 harness 3종 union을 없앤다.

Core와 플러그인은 versioned JSON-RPC over stdio를 기본으로 한다. discover/probe → configure → start → healthy/degraded → stop 흐름, request timeout, cancellation, bounded event queue, restart backoff를 규정한다. stdout은 프로토콜, stderr는 redacted diagnostics로 제한한다. 한 플러그인 crash가 다른 플러그인과 core를 종료시키지 않아야 한다.

MVP는 검토한 플러그인 allowlist 및 사용자가 선택한 개발 플러그인만 허용한다. manifest 권한 선언이나 별도 프로세스 자체는 보안 sandbox가 아니다. native/Node plugin은 사용자 권한 파일 접근 등이 가능하므로 설치 시 신뢰 범위를 드러내고, 임의 npm install script를 실행하는 marketplace는 연기한다. 네이티브 실행 파일의 OS별 서명·공증, 업데이트/철회 정책도 검증 대상이다.

### Hardware plugin

- discover/enroll/revoke, stable device identity, reconnect/health.
- 버튼/노브/마이크/display 등 capability와 transport를 각각 노출.
- 물리 입력을 `session.select`, `prompt.submit`, `decision.resolve`, `turn.cancel` 같은 의미 명령으로 변환. key 16 같은 숫자는 core에 전달하지 않는다.
- 표시용 projection을 MK20 layout/framebuffer 또는 HID LED/report로 변환. 화면 없는 장치도 유효하다.
- HID VID/PID/usage/interface, hotplug, serial 없는 동일 모델 식별, OS 권한, 펌웨어별 report format을 adapter가 처리. 일반 키보드 HID와 vendor raw HID는 지원 범위가 다르다. 전역 키보드 가로채기를 기본값으로 삼지 않는다.
- MK20 legacy UDP/ADB 경로는 lab compatibility로 격리한다. source IP allowlist만으로 암호학적 pairing을 대체하지 않는다. 네트워크 제품 출시 전 firmware 측 인증 지원 또는 검증된 보호 transport가 필요하다.

### Harness plugin

probe/version/capabilities, list/read/subscribe, create/send/cancel, decision answer, config, optional focus와 changes를 제공한다. 기능별 supported/read-only/unsupported, reason, tested version을 반환한다.

Codex owned app-server와 기존 Desktop owner 연결은 서로 다른 기능이다. 현재 private IPC 의존 경로는 experimental capability로 분리하고 macOS 지원을 추정하지 않는다. OpenCode는 기존 owner의 HTTP/SSE 계약을 검증한다. Antigravity transcript discovery가 된다는 이유로 기존 IDE task의 send/stop/approval 지원을 선언하지 않는다.

### 추가로 필요한 경계: Audio source / Speech provider

현재 LocalWhisperProvider가 MK20 ADB capture를 직접 생성한다. 이를 AudioSource(MK20/host mic/browser)와 SpeechProvider(local worker/선택한 remote worker)로 분리한다. Python, 모델, GPU는 기본 core 설치의 필수조건으로 만들지 않는다. 기존 Whisper review → explicit Send와 destination binding을 유지한다. 음성팩은 선택 설치하고 크기, 저장 위치, 장치, 언어, 상태, 삭제 기능을 제공한다. raw audio 보관 기본값은 끄고, TTS는 후속이다.

## 5. API와 multi-host topology

현재 PC의 loopback API가 기본이다. 아래 multi-host topology는 사용자가 켜는 local-LAN 확장 설계이며 최초 설치에서 자동 시작하지 않는다. WAN/cloud control plane은 현재 범위에 없다. 로컬 제어와 harness 자체의 cloud inference는 별개다.

브라우저와 hardware adapter가 동일한 command gateway를 통과한다. Web GUI가 daemon의 객체나 vendor DB를 직접 읽지 않는다.

제안 API v1:

```text
GET  /v1/health
GET  /v1/hosts, /controllers, /harnesses, /projects, /sessions
GET  /v1/sessions/{id}, /v1/decisions
GET  /v1/events?cursor=...          SSE: typed event + seq + observedAt
POST /v1/commands                  idempotency key + target + expectedRevision
GET  /v1/commands/{id}             ACK/실행완료/unknown 분리
GET/PATCH /v1/settings             revision + schema validation
POST /v1/enrollments               승인된 pairing 절차
DELETE /v1/enrollments/{id}         인증 철회
```

목록은 필터/페이지네이션, 이벤트는 bounded retention과 snapshot 재동기화를 제공한다. HTTP 접수(202)가 harness 완료를 뜻하지 않는다. 오류는 unsupported, staleRevision, permissionDenied, ownerUnavailable, deliveryUnknown 등을 구분한다. 파일 읽기는 등록 Workspace 경계와 realpath 검증을 거치며 전체 OS 파일 접근 API는 만들지 않는다.

기본 localhost API는 127.0.0.1 전용으로 묶고 정확한 Host/Origin 검사, 인증 세션, CSRF 보호, 최소 권한을 적용한다. tray가 연 일회성 짧은 bootstrap을 교환하여 browser session을 만든다. 장기 token을 URL/localStorage에 넣지 않는다. SSE도 인증을 적용하고 transcript HTML은 이스케이프한다.

여러 Host의 통합은 브라우저가 연 local host를 선택 가능한 집계 지점으로 사용한다. 집계 host는 사용자가 명시적으로 paired한 remote host에만 TLS + per-host credentials로 접속한다. remote host는 대상/권한/명령 ID를 다시 검증한다. 중앙 클라우드와 자동 trust mesh는 요구하지 않는다. 집계 지점 장애 시 다른 host에서 그 host에 등록된 연결 범위를 열 수 있으며 자동 HA나 모든 trust의 복제를 약속하지 않는다.

LAN 원격 API는 명시적 enable/pairing 후 별도 listener로 연다. mDNS는 검색 힌트이며 인증이 아니다. VPN도 애플리케이션 인증을 대체하지 않는다. remote host가 끊기면 마지막 관찰 시각과 stale 상태를 보존하며 offline host의 작업을 완료/실패로 추정하지 않는다. STT remote endpoint는 실행 host와 별도 선택한다.

## 6. 설치와 릴리스

| 채널 | 권고 | 이유와 실제 작업 |
|---|---|---|
| macOS direct | 1차 | Developer ID 서명, hardened runtime/필요 entitlement, notarization, staple, DMG. app/helper/네이티브 plugin까지 확인 |
| Windows direct + winget | 1차 | 사용자 단위 서명 EXE, silent install/uninstall, 안정된 URL/hash로 winget manifest 제출. winget은 installer 자체가 아님 |
| Microsoft Store | 2차 | MSI/EXE listing도 가능. MSIX는 lifecycle/plugin 동작 별도 검증. EXE/MSI 경로는 앱 업데이트 책임이 남음 |
| npm | 개발 채널 | SDK/CLI/reference plugin 배포. 일반 사용자에게 Node 설치·로그인 실행·서명·업데이트를 해결하는 기본 installer로 제시하지 않음 |

사용자 언급 GNUnae의 실제 빌드/배포 설정은 이번 저장소에서 확인하지 않았다. 동일 구현이라고 단정하지 않으며, Developer ID 기반 direct distribution 패턴만 추천한다.

MVP는 user-scoped login app으로 상주하며 admin/root service를 요구하지 않는다. tray shell이 core를 supervise하고 single instance lock을 잡는다. 브라우저 종료는 core와 harness를 종료하지 않는다. '연결 일시중지'는 새 제어 명령만 막고 기존 harness 작업은 계속된다. '미들웨어 종료'는 연결/자식 프로세스 영향 범위를 보여주고, 종료 시 함께 끝날 수 있는 middleware-owned 작업이 있으면 해당 범위를 명시한다. 기존 외부 harness 프로세스를 임의 종료하지 않는다.

settings/state/logs/cache/model은 OS 사용자 데이터 디렉터리로 이동한다. credential은 Keychain/Windows 보호 저장소에 저장한다. 작업 폴더나 설치 디렉터리에 쓰지 않는다. 로그인 실행은 opt-in 설정, sleep/wake·로그아웃·중복 실행·port 충돌을 처리한다.

OS/architecture별 clean-machine CI: macOS arm64/x64, Windows x64를 초기 대상으로 제안한다. Windows arm64는 native HID/audio/모델 의존성 검증 후 추가한다. 서명 secret은 CI protected store, release artifacts는 immutable URL/hash, updater는 서명 검증을 사용한다. 업데이트 주체를 하나로 정하고 winget/인앱 동시 업데이트를 lock으로 직렬화한다. schema migration 전 백업과 실패 복구를 정의하며 신버전 DB를 구버전이 그대로 읽을 수 있다고 가정하지 않는다. 제거 시 앱/로그인 항목을 제거하고 사용자 데이터·모델 보존 여부를 선택하게 한다.

## 7. Tray와 Settings

tray 상태: 정상 / 연결 저하 / 사용자 확인 필요 / 연결 일시중지. 색뿐 아니라 아이콘/문구를 함께 쓴다. 클릭 메뉴:

```text
Snowball · 연결됨                 상태, 실행 host
작업 중 4 · 확인 필요 2           예시 집계; 선택 시 Supervisor 필터
─────────────────────
Supervisor 열기
확인할 항목                      approval/question/error/unknown
연결                             Hosts / Controllers / Harnesses
새 장치·호스트 연결…
제어 명령 일시중지 / 재개
─────────────────────
설정…
진단…                            상태 점검, redacted logs export
업데이트 확인…
Snowball 정보…
미들웨어 종료…
```

menu는 상태/이동/빠른 제어에 집중한다. 다수 task 세부내용이나 승인 대량처리를 tray에 넣지 않는다. 특정 세션 Stop은 Supervisor 상세에서 수행한다.

| Settings 영역 | 항목 |
|---|---|
| General | 로그인 실행, 언어, 알림/방해금지, release channel |
| Hosts & access | 이름, pairing/해제, 연결 주소, 원격 접근 opt-in, 역할, 인증 철회 |
| Controllers | 이름, device plugin/version, transport, mapping profile, follow/pin, 연결 테스트 |
| Harnesses | instance 추가, executable/endpoint, 계정 상태, tested version, 지원 기능, 원래 앱 열기 |
| Projects | workspace 등록, host별 root/worktree 연결, 표시명, 기본 harness, 보관 |
| Voice | source, STT provider/host/model, 언어, 입력 확인, 모델 다운로드/삭제, 보관 정책 |
| Plugins | 게시자/버전/권한, enable/disable, update/revert, compatibility, 개발 모드 |
| Privacy & diagnostics | 로그 보관, transcript/audio 정책, export redaction, telemetry opt-in |
| Advanced | API 접근 scope, port, timeout, 데이터 export/복구, reset |

전체 설정은 browser Settings로 통일한다. 최초 실행에서 harness 감지 → 검증 결과/권한 → workspace 선택 → hardware 선택 사항 → 상태 확인까지 가능해야 한다. 하드웨어 연결을 onboarding 필수 단계로 삼지 않는다.

## 8. Non-hardware Supervisor UX

기본 화면은 여러 작업의 상태와 사람이 처리할 항목을 한눈에 보는 Overview다. MK20 키 배열이나 여러 채팅 창을 첫 화면에 복제하지 않는다.

```text
Snowball   Overview | Projects | Hosts | Controllers | Connections
전체 Host ▾   전체 Harness ▾   전체 Project ▾   상태 ▾   검색

확인 필요  [승인] [질문] [실패] [전달 불명]     최근 완료
────────────────────────────────────────────────────────
프로젝트 / 작업       Host       Harness     상태         마지막 관찰
Snowball / API 분리    MacBook    Codex       실행 중       2초 전
Website / build       Windows    OpenCode    승인 필요     방금
Firmware / diagnose   Windows    Antigravity 조회 전용     8초 전
────────────────────────────────────────────────────────
선택한 작업 상세: 요약 | Activity | Changes | Decisions
고정 목적지: Host / Harness / Project / Session
지원되는 동작: 답변 · 메시지 · 중단 요청 · 원래 앱에서 열기
```

위 수치와 행은 UX 예시이며 현재 실측 상태가 아니다.

- Project 단위 그룹을 기본으로 하고 Host/Harness는 교차 필터로 제공한다. 깊은 Machine → Harness → Project 탐색을 매번 강제하지 않는다.
- 세션 실행 상태와 연결 상태를 별도 표시한다. '실행 중 · 연결 끊김 · 3분 전 관찰'처럼 불확실성을 보존한다.
- Attention queue는 pending decision/질문/실패/unknown을 우선순위와 시간순으로 보여주고 중복 알림을 합친다. 승인에는 명령/경로/대상/근거가 보여야 한다.
- 행 선택 상세에서 transcript와 diff를 읽는다. 메시지/답변/취소는 capability와 현재 ownership이 허용할 때만 나타난다. unsupported 사유는 숨기지 않는다.
- 승인 시 expected revision을 재검증한다. 다른 Controller가 해결한 decision은 즉시 resolved로 바뀐다. 위험한 일괄 승인 버튼은 MVP에서 제외한다.
- draft는 탭/필터/선택을 바꿔도 원래 목적지를 유지한다. 입력창에 대상이 항상 보이며 별도 draft shelf에서 회수 가능하다.
- 성능을 위해 transcript는 필요할 때 로드하고 목록은 페이지/가상화한다. 새 이벤트 때문에 읽던 행이 튀지 않게 한다. 키보드 탐색, 텍스트 상태, reduced motion, 좁은 화면을 지원한다.
- New task는 harness와 workspace를 명시한다. native project ID가 달라도 같은 논리 Project에 사람이 연결할 수 있다.
- MVP 집계는 연결된 범위와 누락 Host 수를 명시한다. vendor별 비용/진척률을 임의의 통합 퍼센트로 변환하지 않는다.

## 9. 현재 증거와 missing puzzle

| 우선순위 | 현재 증거 | 필요한 연결 요소 / 완료 기준 |
|---|---|---|
| P0 | index.ts가 CodexAdapter, LocalWhisperProvider, UDP를 직접 생성 | headless core + semantic API, hardware 0개로 create/read/send/decision/cancel |
| P0 | MvpController가 key 번호, ContextManager, Codex RPC와 전역 draft/context 보유 | domain service와 MK20 presentation 분리; Controller별 context, 복합 Session identity |
| P0 | UDP 0.0.0.0, 마지막 발신자와 고정 주소로 sync, 인증/등록 없음 | 장치 registry/pairing/revocation; 두 장치에 잘못된 상태·명령이 섞이지 않음 |
| P0 | 단일 draft persistence 및 텍스트 기반 reconciliation | durable command journal, owner identity, crash recovery, duplicate/unknown 테스트 |
| P0 | app-server와 Desktop IPC가 혼합, pipe 탐색은 Windows 전용 | surface별 capability/version gate, macOS 검증, private IPC 실패 시 truthful degradation |
| P0 | host/docs가 untracked; 상당한 기존 변경 | 선별 export, 라이선스/의존 inventory, 새 repo 재현 build |
| P1 | legacy AgentHarness ID가 세 문자열 union | 공개 plugin SDK/manifest/RPC, version handshake, process isolation, conformance suite |
| P1 | legacy mesh 파일은 존재하나 현재 index에서 시작 안 함 | 명시적 trust 기반 host federation; legacy mesh를 완성된 제품 API로 재사용 금지 |
| P1 | Whisper가 ADB와 Python/venv에 결합 | source/provider 분리, optional voice pack, runtime/model 설치·업데이트 |
| P1 | tray/browser/API/release pipeline 부재 | install→login→configure→supervise→upgrade→uninstall의 완결된 경로 |
| P1 | harness adapter 테스트는 mocks/fixtures 중심 | 두 번째 harness 실제 owner 작업 검증; 등록만으로 full support 표시 금지 |
| P1 | 외부 plugin은 사용자 권한 코드 | publisher trust, capability enforcement 가능한 범위 명시, native signing, revoke/update policy |
| P2 | standalone power 과거 설명에 상충 기록 | MK20 실제 보드/firmware별 acceptance. core 출시와 분리 |

추가 제품 결정: 이름/라이선스, 지원 OS 최소 버전, stable/experimental 기준, 장치 제조사의 프로토콜 호환 책임, 로그/음성 보관, crash report 정책, 지원할 실제 두 번째 HID 모델, signing 계정/배포 소유자. 독립 제어 계층에는 별도 모델 구독이 필수가 아니며 harness 계정/자격증명을 임의 복제하지 않는다.

## 10. MVP 단계 및 검수

1. **Extraction baseline**: 파일 inventory/export, 새 repository scaffold, SDK 0.1 계약. 기존 46개 테스트 이식/분류. core의 hardware/provider 구체 import 금지 검증.
2. **Local vertical slice**: Codex owned runtime + API + hardware 없는 Supervisor에서 새 task/메시지/이벤트/질문/중단/재시작 복구. private Desktop attach는 별도 gate.
3. **Packaging alpha**: tray-only startup, OS user data/secrets, Mac/Windows clean install. 개발자 Node/Python 없이 core 사용. browser 닫아도 서비스 유지.
4. **Plugin proof**: MK20 adapter와 virtual device, OpenCode 실제 instance로 같은 계약 검증. 실제 HID 1종 hotplug/report/permission 확인; virtual만 통과하면 HID 지원 완료라고 하지 않음. Antigravity는 입증된 기능만 활성화.
5. **Local release candidate**: 현재 PC에서 여러 controller와 Web, 여러 harness/projects 검수. signed/notarized artifacts, winget manifest, update/rollback/uninstall, dependency/license/SBOM 점검과 support matrix.
6. **Optional local-LAN multi-host (G4)**: Mac+Windows 두 Host, controller 두 개와 Web, 두 harness, 여러 projects. 명시 pairing, stale/offline, 동시 승인, selection independence, 잘못된 목적지 방지. 이 확장은 단일 PC release의 선행 조건이 아니다.

다음 구현의 가장 작은 완결 단위는 별도 repo에서 `core + plugin-sdk + API + virtual device + Codex adapter`로 hardware 없는 한 작업의 전체 왕복을 만드는 것이다. 먼저 모든 프레임워크/marketplace를 만드는 방식은 피한다.

필수 acceptance: 장치 0개; 두 controller 독립 선택; 동일 명령 재전송; send 후 crash로 unknown 복구; 두 사용 surface의 같은 approval race; plugin crash/hang; unsupported 동작; Mac/Windows sleep/wake; 만료/revoked credential; remote host disconnect; 폴더/worktree 경계; 새 버전 호환 실패; 서명 설치/업데이트/제거. 실제 USB/네트워크 하드웨어와 실제 harness owner 결과를 mock 결과와 별도로 기록한다.

## 11. 이번 검증 범위

- `npm test --prefix host`: TypeScript build 포함 **46 passed, 0 failed, 0 skipped**.
- 실제 기존 local Whisper worker가 prerecorded English fixture를 전사했다. 물리 microphone/hardware 및 실제 harness 명령 송신 검증은 수행하지 않았다.
- macOS, packaging, third-party HID, 새 API, multi-host 인증/제어는 구현/검증 전이다.
- 실행 중 daemon 재시작, firmware 변경, 새 repository 생성, 외부 publish는 하지 않았다.
- CodexBar 인증 오류. 앱의 실제 계정 usage 조회로 시작 시 5시간 95%/주간 71% remaining 확인; 추정치를 사용하지 않았다.

## 12. 공식 배포 참고 자료 (2026-09-17 조회)

- Apple Developer ID: https://developer.apple.com/developer-id/
- Apple notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Windows packaging/Store update 차이: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/
- Store Win32 EXE/MSI: https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store
- winget manifests: https://learn.microsoft.com/en-us/windows/package-manager/package/manifest
- winget submission: https://learn.microsoft.com/en-us/windows/package-manager/package/repository
- Electron process model: https://github.com/electron/electron/blob/main/docs/api/utility-process.md
- Electron signing: https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md
- Tauri architecture: https://v2.tauri.app/concept/architecture/

채널 가능 여부는 공식 문서 근거이며, 본 제품의 Store 승인·서명 성공·성능·GNUnae 구현을 확인한 것은 아니다.
