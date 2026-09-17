# Discovery journeys — 탐색부터 제거까지

상태: 구현할 계약. 실제 연결/플랫폼 지원을 검증했다는 의미가 아니다.
모든 시나리오는 PLAN.json L4 task에 연결되며 L5에서 증거를 기록한다.

## 공통 사용자 경험 / 상태 모델

Settings → Connections에서 Harnesses / Controllers를 분리한다. 최초 설치의 작은 wizard와 이후 Settings는 같은 상태/API를 사용한다. 작업은 뒤로/건너뛰기/취소 가능하고 등록되지 않은 후보와 저장된 연결을 구분한다. 실패 카드에는 원인, 관찰 시각, 다음 가능한 행동이 항상 있다. 후보가 없어도 Supervisor는 열린다.

발견(discovery)은 trust나 실행 허가가 아니다. 읽기 탐색 중 자동 설치·로그인·harness server 시작·명령 전송·firmware 쓰기를 하지 않는다. `--version` 같은 실행 probe도 검토된 provider 경로/사용자가 선택한 파일에 제한하며 timeout/출력 제한을 적용한다. 임의 발견 실행 파일을 자동 실행하지 않는다.

```text
idle → scanning → candidates / empty / scan_failed / cancelled
candidate → probing → compatible / needs_auth / needs_permission /
                       not_running / unsupported / ambiguous / probe_failed
compatible + 사용자 연결 선택 → registering → ready_control / ready_readonly
registered → reconnecting → ready / degraded / offline / needs_reauth
registered → disabled / removed / revoked
```

구현 데이터는 단일 enum으로 조합을 폭발시키지 않는다. DiscoveryState, Presence, Compatibility, AuthState, PermissionState, Connectivity, ControlCapability, EnrollmentState를 별도 필드로 둔다. UI는 가장 해결해야 할 사유와 가능한 action을 투영한다. installed-but-not-running, connected-but-readonly, offline-with-cached-tasks가 모두 표현 가능해야 한다.

Candidate에는 kind, pluginId, 후보 source, locator, stable identity claim, observedAt, expiresAt, OS/arch/version, probe result, reason code를 둔다. credential은 저장소 reference만 두고 응답/로그로 반환하지 않는다. address/PID/path/name은 identity 자체가 아니며 한 필드 변화로 새 entity를 무조건 만들지 않는다.

제안 초기 제한: 로컬 탐색 전체 10초, 후보 probe 3초, 동시 probe 4개, 결과 100개 상한. 한 probe timeout 때문에 다른 결과를 잃지 않는다. 실제 연결 handshake 예산은 별도다. 취소 즉시 late result generation을 무효화한다. background 재탐색은 등록된 항목·허용된 discovery source만 대상으로 debounce/backoff하며 무한 retry/spin을 피한다. 수치는 초기 설정값이며 실측 후 조정한다.

## Harness journey

사용자 흐름: 시작 → 설치된 후보 보기 → 제품/버전/실행 surface 선택 → 연결 검사 → 필요 시 원래 harness에서 로그인 → 기능 확인 → 프로젝트 선택 → 작업 열기. 발견되지 않으면 실행 파일/지원 endpoint를 직접 선택할 수 있다. 설치 안내는 plugin에 등록된 공식 링크를 열며 자동 다운로드/임의 shell 실행은 하지 않는다.

탐색 우선순위: 사용자 저장 override → plugin이 정의한 OS 설치 위치/등록 정보 → 제한된 PATH 후보 → 사용자가 등록한 local endpoint. GUI login app의 PATH가 터미널과 다를 수 있으므로 PATH에만 의존하지 않는다. 전체 디스크/전체 포트를 훑지 않는다. Windows 경로 casing과 macOS case-sensitive volume 차이를 고려하고 모든 경로를 일괄 lowercase하지 않는다. canonical executable 경로 중복은 합치되 다른 계정/owner instance는 합치지 않는다.

| 시나리오 | Trigger / 결과 | 다음 행동 / 보존 규칙 |
|---|---|---|
| H01 | 첫 실행, 미설치 → empty | 설치 안내 / 수동 선택 / 건너뛰기. setup 완료를 막지 않음 |
| H02 | PATH 또는 알려진 위치에 단일 설치 → candidate | 출처·경로·버전 보여주고 연결 검사 |
| H03 | 다중 버전/CLI+Desktop/다중 계정 → 여러 후보 | 자동 첫 후보 선택 금지, instance 선택; 기록과 owner 구분 |
| H04 | GUI PATH 누락/사용자 설치 경로 → manual selection | 저장 override, 재시작 후 재검증, 경로 변경 감지 |
| H05 | 없음/permission denied/손상/지원 외 버전 → probe_failed/unsupported | 파일 재선택·지원 버전 안내; 숨겨진 무한 재시작 없음 |
| H06 | health 401 또는 로그인 만료 → needs_auth | 원래 앱 로그인/credential 입력 경로, 재검사; connected로 표시 금지 |
| H07 | 설치됐으나 owner 미실행 → not_running | 사용자가 '시작' 선택한 뒤에만 owned runtime 시작; 외부 앱 실행 안내 |
| H08 | 기록만 발견/기존 owner attach 불가 → ready_readonly | 기록 조회와 원래 앱 열기; 자동 resume/send로 ownership 탈취 금지 |
| H09 | 프로토콜 handshake 성공 → capability 확인 | 기능별 read/control/unsupported 이유와 tested version; 등록 후 workspace 선택 |
| H10 | endpoint에 다른 서비스/redirect/인증 실패 → rejected | schema/version 검증; 다른 origin으로 credential 전달 금지; 주소 수정 |
| H11 | 탐색 취소/연속 refresh/probe hang → cancelled/partial | 마지막 유효 결과 유지, 늦은 결과 무시, 재시도 가능 |
| H12 | 종료·sleep/wake·프로세스 재시작 → offline/reconnecting | 저장 identity 재검증, bounded retry; pending command는 조회만 |
| H13 | 재설치·버전 변경·계정 교체 → needs_review/needs_auth | capability 재협상, 기존 세션 잘못 병합 금지, 이전 draft 보존 |
| H14 | disable/remove | 감시/연결/owned helper 정리, 외부 harness 삭제/종료 금지; secret 정리와 캐시 보존 옵션 |

surface별 최소 검증:

- Codex owned app-server: 실제 설치 버전 handshake와 native request/response 확인. 기존 Desktop 접근은 독립 capability이며 Windows private pipe 성공을 macOS 공통 계약으로 취급하지 않는다.
- OpenCode: 명시 등록 local HTTP endpoint health/auth/schema 확인, 같은 owner의 SSE와 session 식별. 발견 중 autoSpawn 금지. 새 server 시작은 명시 액션.
- Antigravity: 기록 위치 발견과 명령 실행 가능 분리. 지원되지 않은 existing-owner command는 read-only. capability 향상은 별도 실제 증거 후 노출.
- 설치 직후 아무 프로젝트가 없어도 정상 empty. discovery scan은 예제 프로젝트나 CWD를 실제 사용자 등록 프로젝트인 것처럼 추가하지 않는다.

## Device journey

사용자 흐름: '장치 추가'(선택 사항) → USB/HID 또는 로컬 네트워크 → 후보 → 지원 plugin/호환성 → 필요한 OS 권한·물리 확인 → 등록 → 안전한 입력 테스트 → mapping/profile → 사용. 장치 종류를 사용자가 몰라도 자동 후보의 transport/모델 정보를 보여준다.

| 시나리오 | Trigger / 결과 | 다음 행동 / 보존 규칙 |
|---|---|---|
| D01 | 장치 없음 → empty | '하드웨어 없이 계속', Web은 정상 제어 client |
| D02 | 지원 HID 삽입 → candidate | VID/PID뿐 아니라 usage/interface/report contract 검증 |
| D03 | 일반 keyboard/지원 외 VID-PID → unsupported/ignored | 타이핑 탈취 금지, 지원 plugin 안내 또는 숨기기 |
| D04 | 동일 모델 2개/serial 없음/composite interface → ambiguous | 물리 버튼 식별 요청; OS path는 일시 locator; 구별 불가하면 재확인 |
| D05 | USB+LAN으로 같은 장치 발견 → 여러 transport | 검증된 identity로만 묶기; MAC/IP/표시명만으로 merge 금지 |
| D06 | 권한 거부/busy/OS 재승인 필요 → needs_permission | 필요한 기능·이유와 OS 설정 이동, 취소/재검사; 광범위 권한 기본 요구 금지 |
| D07 | HID 등록 후 안전한 입력 테스트 → ready | 버튼/노브 event만 표시; 실제 harness 명령은 전송하지 않음; 출력 테스트 명시 선택 |
| D08 | unplug/replug/USB port 변경 → offline/reconnecting | draft/context 유지, 안정 ID 검증; 애매한 장치는 다시 확인 |
| D09 | LAN discovery 미활성 → local-only | 사용자가 장치 추가에서 local network discovery enable; 그 뒤만 mDNS/지원 discovery |
| D10 | multicast 차단/다중 NIC/VPN → empty/partial | 수동 IP/host+port 입력, 선택 interface에서 진단; subnet scan으로 확대 금지 |
| D11 | LAN 후보 → unpaired | 기능 노출은 제한, 장치 물리 승인 또는 제조사 검증 pairing 수행; timeout/cancel 제공 |
| D12 | spoof/replay/잘못된 pairing code → rejected | trust 저장 안 함, retry 제한; 주소만 일치한다고 허용하지 않음 |
| D13 | paired 장치 IP 변경/host sleep/wake → reconnect | key identity 재검증, 주소 갱신; fingerprint 변경은 repair 필요 |
| D14 | legacy MK20 UDP/ADB만 가능 → experimental/lab | 인증 없는 경로를 secure ready로 표시 금지; 지원 transport/firmware 조건 안내 |
| D15 | plugin 누락·crash·SDK/firmware 불일치 → degraded/unsupported | mapping 유지, 명령 차단, 복구/지원 버전 안내; core/다른 장치 유지 |
| D16 | disable/forget/revoke/factory reset | 구독·handle·device credential 정리, 해당 controller lease 해제; harness task는 자동 취소하지 않음 |
| D17 | 두 장치+Web 동시 연결/같은 approval 해결 | context 독립, revision 한 번만 적용; stale 쪽에는 해결됨 표시 |
| D18 | 출력 전송 실패/연결 단절 중 입력 → degraded | bounded queue, 오래된 버튼 event 폐기; reconnect 시 제어 명령 replay 금지 |

HID physical presence는 검증된 network identity와 같은 보안 속성이 아니다. OS handle 접근 권한과 사용자 등록 범위를 적용하고 plugin별 위험 모델을 명시한다. serial 없는 장치는 재부팅 후 완전 자동 식별을 약속하지 않는다. 일반 HID 지원이 모든 키보드/장치 지원을 뜻하지 않는다.

network pairing은 'discovered'와 'paired' 화면을 분리한다. mDNS 이름·IP는 힌트일 뿐이다. 인증 가능한 장치 firmware가 없으면 plugin의 lab mode에 남고 production pairing 검수는 blocked다. MK20에 새 network protocol을 적용하는 것은 하드웨어 저장소의 별도 변경이며 기존 wire protocol을 몰래 바꾸지 않는다.

## 프로젝트·복구·로컬 경계의 연결 시나리오

| 시나리오 | 결과 계약 |
|---|---|
| J01 | 첫 시작 → local status → harness 선택/skip → workspace 선택/skip → device 선택/skip → Supervisor. 어떤 step 실패도 설치 반복을 요구하지 않음 |
| J02 | 프로젝트 없음/이동/삭제/권한 거부/worktree → 명확한 empty 또는 repair, 사용자 등록 root 밖 읽기 금지 |
| J03 | context 전환 중 recording/draft/approval → 원래 대상 고정, 다른 target으로 자동 재전송 금지 |
| J04 | 앱/browser 종료·업데이트 직전/직후 → 등록·draft·unknown journal 복구, 외부 owner process는 임의 종료하지 않음 |
| J05 | 인터넷 차단 → local UI/discovery/cache/진단 정상, cloud harness 실패 원인을 따로 표시; telemetry/model download 때문에 core를 막지 않음 |
| J06 | 다른 OS 사용자/credential 접근 실패 → 현재 사용자 격리, 다른 계정의 instance/secret 자동 탐색 금지 |
| J07 | 선택적 LAN host pairing/해제/끊김 → 현재 host 계속 사용, paired host만 집계, network-off 즉시 listener/discovery 중단 |
| J08 | uninstall/reinstall → 앱/로그인 항목/credential 정리 정책, 데이터 보존 선택, 예전 trust를 무조건 부활시키지 않음 |

## 검수 원칙

각 시나리오는 성공·실패·취소·재시도·재시작 결과를 해당 task L5에 기록한다. Windows/macOS fixture와 가능한 실제 환경을 구분한다. firmware나 장치가 없으면 실제 검수는 blocked이며 virtual pass로 대체하지 않는다. 최초 발견부터 제거까지 등록 lifecycle을 한 번 실제로 수행해야 '지원'이라고 표시한다.

예시 문구: '설치됨 · 아직 실행되지 않음', '로그인 필요', '연결됨 · 조회만 가능', '지원되지 않는 버전', '장치를 구별하려면 버튼을 누르세요', '연결 끊김 · 마지막 확인 2분 전'. 구현 내부 오류만 노출하지 말고 사용자가 다음에 할 수 있는 행동을 붙인다.
