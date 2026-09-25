# Middleware execution plan — local control first

상태: 2026-09-24 재감사·구현 중 (PLAN revision 42). 실제 상태는 PLAN.json의 L5 증거와 CONTROL_REALITY.md, HANDOFF.md를 따른다. Windows 실제 Codex 제어, 읽기 전용 네이티브 연결 복원/해제, unsigned portable tray 및 per-user installer 설치·실행·제거는 검증됐다. macOS ARM64 CI에서 desktop 앱 빌드·실행과 ZIP 해제 후 재실행도 통과했지만 x64·서명·공증·실사용 설치는 미검증으로 G2/G3 출시는 미완료다. harness 플러그인 3종의 별도 비공개 release/Windows·macOS CI는 통과했고 공개 라이선스는 미정이다. MK20 QMK HID는 현재 Windows에서 감지되고 안전한 vendor-interface 열기/닫기가 검증됐다. 별도 본체 CDC는 미감지이고 버튼 보고서와 인증 페어링은 아직 검증되지 않았다.

이 저장소 `Snowball_Middleware`의 PLAN.json만 편집한다. 원본 Snowball_Control의 원장은 이곳을 가리키는 redirect다.

## 작업 선택 정책 — 2026-09-17 사용자 지시

선행 조건이 완료된 task만 후보로 삼는다. 후보 중 `priority.designDemand`(설계 판단 요구, 1–5), 이어서 `priority.implementationDifficulty`(구현 난도, 1–5) 내림차순으로 선택한다. 동률은 안정 ID 순이다. 진행 중인 atomic 작업은 먼저 안전하게 마무리한다. 번호 순서나 쉬운 UI부터 수행하지 않는다. 기본 우선 경로는 추출/scaffold → plugin 계약 → identity/context → durable command/recovery → loopback 제어 API다. `--next`가 이 순서를 반영한다.

## 시작점과 문서 우선순위

1. 현재 사용자 지시와 실제 저장소/테스트.
2. 저장소 `AGENTS.md`, 최신 `HANDOFF.md`.
3. 이 문서의 제품 원칙 및 [PLAN.json](PLAN.json)의 작업/검증 상태.
4. [DISCOVERY_JOURNEYS.md](DISCOVERY_JOURNEYS.md)의 journey 계약.
5. [RESUME.md](RESUME.md)의 재개/중단 절차.
6. [2026-09-17 설계](../MIDDLEWARE_PACKAGING_MVP_2026-09-17.md)의 상세 아키텍처. 로컬 우선 범위는 이 문서가 최신이다.

새 repository를 만들 때 이 폴더와 최신 HANDOFF를 함께 복사하고 source/destination 경로를 기록한다. 계획만 이전하고 상태·증거를 남겨 두지 않는다. 원본과 새 repo에 편집 가능한 task ledger를 동시에 운영하지 않는다. 이전 후 원본에는 새 authoritative 경로/commit을 가리키는 포인터를 남긴다.

## L0 — 바뀌지 않는 제품 목적

**MW: 사용자가 자기 컴퓨터에서 사용하는 harness와 작업을 로컬에서 발견하고 이해하고 제어한다. 하드웨어는 선택 가능한 조작 수단이다.**

요구사항 ID는 모든 세부 task로 상속된다.

| ID | 원칙 | 실패로 보는 사례 |
|---|---|---|
| R-LOCAL | 기본 모드는 현재 사용자/현재 PC의 로컬 제어 | Snowball cloud 로그인·중앙 서버가 없으면 local UI가 열리지 않음 |
| R-NET | 기본 API는 loopback. LAN은 사용자 소유 장치/PC 연결을 명시적으로 켜는 확장 | 최초 실행부터 전체 interface에 API 노출, subnet/port sweep |
| R-TRUTH | 발견·설치·로그인·연결·제어 가능을 별도 상태로 표시 | 실행 파일 존재/401/기록 파일만으로 Connected 또는 controllable |
| R-TARGET | 명령/초안/승인은 고정된 owner와 대상에 귀속 | 필터 변경/재접속이 메시지 목적지를 바꿈 |
| R-RECOVER | 중단 후 증거와 상태로 복구, 불명 전달은 재송신 금지 | reconnect가 unknown prompt/approval을 자동 replay |
| R-PLUGIN | core는 hardware/harness 구현에 의존하지 않음 | Core에서 K16/ADB/Codex RPC 사용 |
| R-OPTIONAL | hardware/voice/인터넷 없이 core 설정·조회 UI 사용 가능 | 장치 pairing이나 모델 다운로드가 첫 화면 진입 필수 |
| R-EXEC | 표시되는 모델·effort·설정·동작은 실제 backend와 검증 증거 필요 | 고정 목록·모의 성공을 실제 제어로 표시 |
| R-PRIVACY | 로컬 credentials/state, 필요한 범위만 탐색 | 홈 전체 재귀 스캔, 다른 사용자 credential 복사, 자동 로그 업로드 |

로컬 제어는 모든 harness의 추론이 오프라인이라는 뜻이 아니다. cloud-backed harness는 그 자체의 네트워크·계정이 필요할 수 있다. Snowball 제어/설정/상태 표시가 별도 cloud에 의존하지 않게 한다. Internet 차단 검수에서 local 상태/오류 표시를 확인하고, cloud 모델의 새 응답까지 성공한다고 주장하지 않는다.

LAN device pairing은 MK20 등 물리 장치를 위한 별도 로컬 연결 경로다. LAN의 다른 실행 PC 집계는 다음 확장 gate다. WAN relay, 중앙 계정 동기화, SaaS orchestration은 현재 scope 밖이다. 기존 다중 PC 요구는 보존하되 단일 PC MVP의 선행 조건으로 두지 않는다.

## User-confirmed local control contract — 2026-09-21

- Default local Web UI uses noAuth: no login, PIN, pairing code or repeated authorization. It binds only 127.0.0.1; Host/Origin/browser checks stay in force. Optional token mode is operator-selected, not the normal journey.
- MK20/device pairing is separate from Web UI access. Do not add a Web PIN to repair a device protocol.
- Connected, explicitly selected harness sessions must accept commands. Discovery alone is observation; explicit attachment establishes the route. Do not treat permanently disabling commands as plugin isolation.
- Plugin isolation means precise operation/event/session scope and no exceptional core privileges. Current process separation is not OS confinement against malicious same-user plugins; report this limitation honestly.
- Every model/effort, voice, settings and session action requires actual backend behavior and evidence. Removing a fake fallback makes the state honest; it does not complete the missing MVP feature.

## Depth 구조와 propagation

| Depth | 노드 종류 | 답하는 질문 | 예 |
|---|---|---|---|
| L0 | product | 왜 존재하는가? | MW: 로컬 제어 |
| L1 | outcome | 무엇이 사용 가능해져야 하는가? | MW.03: Harness 발견/연결 |
| L2 | journey | 어느 사용자 흐름인가? | MW.03.01: 최초 탐색 |
| L3 | work package | 어떤 계약/구성요소를 만든다? | MW.03.01.01: 후보 catalog |
| L4 | executable task | 지금 어떤 파일/동작을 바꾼다? | MW.03.01.01.01: 제한된 후보 수집 |
| L5 | acceptance check | 어떤 증거로 완료를 판단한다? | MW.03.01.01.01.A1: 미설치·다중설치 fixture |

PLAN.json은 parent/dependsOn/requirements/입력 파일/출력 경계/구현 단계/검수/재개 지점을 담는 단일 작업 원장이다. L0~L3 상태는 자식에서 계산하며 사람이 완료로 덮어쓰지 않는다. L4 완료는 L5 실제 증거가 있어야 한다. 기존 46개 테스트 통과는 새 구현 task의 완료 증거로 재사용하지 않는다.

**변경 전파:** 요구 변경 → R-ID 갱신 → 그 요구를 상속하는 모든 하위 task와 acceptance 재검토 → 완료 task를 needs_review로 전환 → dependent task도 검토 → 코드/schema/UX/테스트/지원문서 동시 갱신 → 증거 기록 → 상위 상태 재계산. 문서만 수정하고 구현 완료 표시를 유지하지 않는다.

**실패 역전파:** L5 fail → L4 in_progress/blocked → L3/L2/L1 incomplete → 연결된 release gate 미충족. 불필요하게 무관한 작업까지 차단하지 않는다. blocked task에는 원인·재현·필요한 외부 조건과 진행 가능한 다른 task를 기록한다.

**새 작업:** 적절한 L1/L2/L3 아래 영구 ID를 부여한다. 설계 변경이 필요한데 부모 목표가 없으면 부모부터 추가한다. 한 L4가 한 번의 검증 가능한 변경으로 끝나지 않으면 실행 전에 L4 형제 task로 분할하고 의존성·L5·시나리오 매핑을 갱신한다. ID를 재사용/재번호하지 않는다.

## L1 outcomes / 실행 순서

| ID | 결과 | 핵심 범위 | Gate |
|---|---|---|---|
| MW.01 | 별도 repo 재현 기반 | 선별 inventory/export, contracts, test 분류 | G0 |
| MW.02 | 로컬 제어 core | identities/context, durable commands, localhost API | G1 |
| MW.03 | Harness discovery 완결 | 후보 탐색, 검증, 연결/로그인, capability, 복구 | G1/G2 |
| MW.04 | Device discovery 완결 | 장치 없는 시작, HID, LAN pairing, 중복/복구/제거 | G2 |
| MW.05 | Project/Session 정확성 | workspace 등록/이동/worktree, 기존 owner/새 task | G1 |
| MW.06 | 하드웨어 없는 supervision | onboarding, tray/Settings, Overview/Attention | G1/G2 |
| MW.07 | 선택형 음성 | AudioSource/STT 분리, 설치/권한/취소/복구 | G2 |
| MW.08 | 설치 가능한 제품 | OS lifecycle, release/update/uninstall, support evidence | G2/G3 |
| MW.09 | 선택형 local-LAN 확장 | host pairing, federation, network-off fallback | G4 |

L2~L5의 읽기용 전체 트리는 [TASK_TREE.md](TASK_TREE.md), 상세 단계/의존성/상태는 [PLAN.json](PLAN.json)을 본다. 트리는 원장에서 생성하는 읽기 전용 뷰다. 읽기 명령은 RESUME.md에 있다.

## Release gates

- **G0 추출 기반:** source/test/license inventory와 별도 repo 재현 build. source의 유용한 untracked 작업이 사라지지 않음.
- **G1 local alpha:** 장치 0개로 discovery → 연결 → workspace/session → send/events/decision/cancel/recovery. 다른 PC, cloud control plane 없이 완결. API와 최소 browser UI 포함.
- **G2 packaged local beta:** macOS/Windows tray installer, discovery 모든 실패 복구 경로, MK20/실제 HID와 두 번째 harness 지원 범위, optional voice. 테스트 대역 성공과 실장치 성공을 분리.
- **G3 local release candidate:** 서명/공증/upgrade/rollback/uninstall, privacy/security, 실제 지원 matrix. 설치할 모델이 없거나 인터넷이 끊겨도 core UI 동작.
- **G4 local-LAN multi-host:** 별도 명시 pairing으로 사용자 PC 간 supervision; 하나의 host 실패가 현재 PC 제어를 막지 않음. G3 이후 확장 가능. G4 미완료를 multi-host 완성으로 표시하지 않음.

확정된 구현 순서는 task dependency graph가 결정한다. 순서 번호만 보고 선행 조건을 건너뛰지 않는다. 일부 UI/mock 작업은 병행 가능하지만 현재 세션에서 sub-agent 실행을 자동 요구하지 않는다.

## 운영 기록 규칙

- 상태: todo, ready, in_progress, blocked, needs_review, done. ready는 모든 dependency done일 때만 허용.
- 한 task를 시작할 때 owner는 사람/도구 식별용 기록일 뿐 제품 동작에 쓰지 않는다. session ID, base commit, touched files와 nextAction을 저장한다.
- done이면 각 check에 날짜/환경/명령 또는 수동 절차/실제 결과/증거 경로를 추가한다. 미실행은 pending, 환경 부재는 blocked이며 pass가 아니다.
- 플랫폼별 검수는 각각 기록한다. Windows pass를 macOS pass로 전파하지 않는다.
- 비율보다 충족 gate/완료 leaf/남은 acceptance를 보고한다. UI 배지와 mocks는 실제 capability 증거가 아니다.
- 작업을 멈추기 전 PLAN.json checkpoint와 HANDOFF를 함께 갱신한다. 갑작스러운 중단 시 둘이 어긋날 수 있으므로 다음 실행자는 Git/files/evidence로 대조한다.
- 이번 작업의 사용자 지시가 quota guard보다 우선이다. 중단 시에는 검증 가능한 상태와 정확한 다음 동작을 HANDOFF에 기록한다.

## 추출 당시 reference/legacy-host의 discovery 결함 (현재 제품 상태는 AUDIT.md 참조)

`CodexHarness.isAvailable()`은 항상 true. Codex binary discovery는 Windows 경로 첫 후보 또는 PATH fallback이며 version/owner 선택이 없다. OpenCode는 HTTP 401을 available로 취급하고 autoSpawn 기본 true이므로 discovery와 실제 시작을 분리해야 한다. Antigravity는 디렉터리/실행 파일 존재로 availability를 판정한다. MK20 UDP는 등록된 장치 identity 대신 기본 IP/마지막 발신자에 의존한다. 이 관찰은 구현 task의 입력 근거이지 현재 파일을 이번 계획 작업에서 고쳤다는 뜻이 아니다.
