# NORTH STAR (노스스타) — Snowball Control & Middleware

## 1. Fundamental Purpose (본질적 목적)
Snowball은 **inter-Harness 로컬 제어 인터페이스**입니다. 사용자의 컴퓨터 상에서 여러 AI 하네스를 하드웨어 데스크 터미널(MK20)과 로컬 미들웨어를 통해 실시간으로 물리 제어합니다. 용어의 의미와 제품 철학은 [중앙 아키텍처 문서](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md#제품-철학-inter-harness-로컬-제어)에 정의합니다.

클라우드 제어 플레인을 거치지 않고, 개발자의 책상 위에 놓인 전용 하드웨어 터미널(MK20)에서 노브와 LCD 키를 통해 현재 PC에서 실행 중인 AI 하네스(Codex, Antigravity, OpenCode 등)의 세션을 전환하고, 프롬프트를 음성으로 주입하며, 실제 모델 및 추론 강도(Effort)를 변경하여 실행을 통제합니다.

---

## 2. Core Invariants & Principles (불변 원칙)

### I. Local-First & Zero Cloud Dependency (로컬 우선 및 클라우드 제어 플레인 배제)
- **로컬 실행이 근본**: 모든 명령 디스패치, 세션 조회, 오디오 전사(STT), 기기 상태 동기화는 사용자의 로컬 머신에서 완결된다.
- **오프라인 로컬 제어**: 로컬 의존성이 준비되어 있으면 인터넷 없이도 미들웨어와 MK20 간의 조작 및 로컬 관찰·제어가 가능해야 한다. 클라우드 모델 추론과 최초 다운로드에는 네트워크가 필요하며, 현재 검증 범위는 중앙 아키텍처 문서에서 구분한다.

### II. Zero Simulation (시뮬레이션 전면 금지)
- **가짜 응답 금지**: `agentResponse: 'Command dispatched and acknowledged...'`와 같은 가짜 확인 메시지, mock 지연 타이머, 정적 성공 흉내는 시스템 어디에도 존재해서는 안 된다.
- **실제 프로세스 구동**: 
  - K1(New) 후 프롬프트를 전송하면 실제 하네스 네이티브 프로세스(`codex app-server`, `agy stream-json`, `opencode run`)가 스폰되어 실제 새 세션 UUID가 생성되고 턴 결과가 실시간 스트리밍되어야 한다.
  - 음성 녹음(Talk)은 실제 MK20 하드웨어 마이크와 로컬 상주 Whisper 워커(`faster-whisper`, int8 CPU)를 통해 실제 텍스트로 변환되어야 한다.

### III. Living Source of Truth (살아있는 원천 기반 동적 발견)
- **하드코딩 금지**: 지원 모델 리스트, 모델별 Effort/Variant 목록, 세션 목록, 프로젝트 목록을 코드 내에 정적 배열로 고정하지 않는다.
- **원천(Source of Truth) 실시간 질의**:
  - OpenCode: 네이티브 CLI와 로컬 모델 캐시에서 실제 모델·variant 메타데이터를 발견한다.
  - Antigravity: 설치된 CLI가 반환하는 모델 식별자와 지원 effort 정보를 사용한다.
  - Codex: 정식 RPC 스펙 및 `.codex/session_index.jsonl` 인덱스 질의.
- **동적 Effort 현실 반영**: 각 모델이 실제 지원하는 effort만 노출한다. 추론을 지원하지 않거나 지원 정보를 확인하지 못한 경우 임의의 목록을 대신 만들지 않는다.

### IV. Web UI & Security Boundary (웹 UI 및 보안 경계)
- **로컬 Supervisor Web UI**: 개발자 본인의 로컬 PC 루프백(`127.0.0.1:8765`) 전용으로, 번거로운 로그인이나 PIN 입력 없이 즉시 대시보드에 접근할 수 있어야 한다 (`noAuth/no PIN`). 외부 인터넷에는 절대 직접 노출되지 않는다.
- **하드웨어 디바이스 페어링 분리**: MK20 기기와의 통신(USB HID / LAN UDP 7701)은 로컬 Web UI 접근 통제와 독립적인 하드웨어 전송 계층으로 분리 관리된다.

### V. Plugin Sandbox Isolation (플러그인 샌드박스 격리)
- **보안 격리 목표**: 플러그인이 코어 권한이나 임의의 파일 시스템에 무단 접근하지 못하도록 권한을 제한해야 한다. 현재 자식 프로세스 격리는 OS 파일 시스템 샌드박스를 강제하지 않으며, Preview에서는 신뢰하는 내부 어댑터만 사용한다.
- **호스트 디스패치 보장**: 플러그인 격리가 실제 명령 실행 자체를 막는 것이 아니며, 코어 미들웨어의 Host Dispatcher(`scripts/harness-dispatch.mjs`)를 통해 승인된 네이티브 프로세스를 안전하게 실행한다.

---

## 3. Physical Desk Terminal (MK20) Interaction Contract

MK20 4x5 키 매트릭스와 2개 로터리 엔코더, 상단 8:3 대형 LCD는 다음의 고유 역할을 수행한다:

1. **상단 LCD (HUD / Reader)**:
   - 현재 기기명(`MINIME-PC-AMD`), 활성 하네스(`CODEX / ANTIGRAV / OPENCODE`), 음량(`VOL 75%`).
   - 현재 프로젝트 및 세션명, 최신 에이전트 대화/프롬프트 내역(다국어 한글 렌더링).
   - 모델/세션/워크스페이스 탐색기 진입 시 대화형 목록 뷰어 역할.
2. **K13 (HARNESS)**: 멀티 아이템 리스트로 현재 활성 AI 하네스 순환 선택.
3. **K9 (PROJECT) / K5 (SESSION) / K1 (ACTION: NEW)**: 작업 프로젝트 및 세션 탐색/생성.
4. **K18 (MODEL) / K14 (EFFORT) / K10 (ACCESS)**: 현재 세션의 실행 파라미터 동적 확인 및 클릭 시 하단 키(K19, K15, K11, K7, K3)를 통한 원터치 선택.
5. **K20 (TALK) / K16 (SEND)**: 하드웨어 마이크를 통한 원터치 음성 주입 및 즉각적 실행 디스패치.
