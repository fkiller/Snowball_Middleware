# 디바이스 플러그인 개발 가이드

기기 아키텍처·통신 규격·설치·검증 상태는 [중앙 아키텍처](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md)에서 관리한다. 이 문서는 현재 저장소의 개발 진입점을 안내한다.

## 실제 확장 계약

공통 계약은 [plugin-sdk](../../packages/plugin-sdk/src/index.ts)의 Protocol 1 JSON-RPC와 [PluginHost](../../packages/plugin-host/src/index.ts)다.

1. 매니페스트에 `kind: 'hardware'`, SDK 범위, 상대 worker 진입점, 플랫폼/아키텍처, 선언한 `devices.*` 작업, 닫힌 설정 스키마와 실제 worker SHA-256을 정의한다.
2. 호스트가 승인한 다이제스트를 검사한 뒤 `plugin.initialize`를 교환한다. 실제 지원 기능만 광고한다.
3. worker는 선언된 작업과 제한된 이벤트만 처리한다. 기기 발견·페어링·컨트롤러 등록·하네스 명령 소유권은 각각 별도 확인이다.
4. 취소·EOF·프로세스 종료 때 자신의 핸들과 소켓을 정리한다. 전송 여부가 불명확한 명령을 자동 재생하지 않는다.

[독립 예제](../../examples/standalone-device-plugin)는 가상 디바이스의 프로세스 계약 예제이며 물리 기기 검증 자료가 아니다. `npm run test:plugin-reference`와 `npm run check:boundaries`로 실제 worker 및 정적 의존성 경계를 확인한다. PluginHost의 프로세스 분리와 정적 import 검사만으로 OS 파일시스템 샌드박스가 구현됐다고 주장하지 않는다.

## 기존 기기의 진입점

| 구성 | 실제 구현 | 개발 시 경계 |
| --- | --- | --- |
| MK20 | [Control의 transport/encoder](https://github.com/fkiller/Snowball_Control/blob/main/plugins/device-mk20/src/index.mjs), Middleware `scripts/mk20-lan.mjs` / `scripts/start-all.mjs` | 호스트가 직접 사용하는 trusted-LAN Preview 경로. `SNMK1` 선택 lease와 JSON `v2_sync`이며 범용 PluginHost worker와 같지 않다. LCD 픽셀은 HUD가 로컬에서 그린다. |
| M5Stack | [Device 저장소](https://github.com/fkiller/Snowball_Device_M5Stack)의 `src/manifest.mjs`, `src/worker.mjs`, `scripts/gateway.mjs` | worker의 `devices.list/render`와 trusted gateway를 분리한다. 보드 등록·서명된 USB/LAN 경로·컨트롤러 API를 유지한다. |
| HID / LAN / virtual | Middleware `packages/device-*` | 각 모듈의 실제 탐지·등록 계약을 확인한다. VID/PID나 주소만으로 제어 권한을 부여하지 않는다. |

MK20 화면 크기·키 flags·JSON 프레임의 현재 규격은 중앙 문서가 원천이다. `available`은 최근 알림, `connected`는 선택 PC의 유효한 화면 수신이며 이 표시는 MK20에 한정된다. 다른 기기의 연결 판정은 해당 기기의 실제 프로토콜을 따른다.

공통 설치·트레이·일시정지 변경을 할 때는 Web/MK20/M5Stack 프로필을 함께 확인한다. 기기 전용 변경을 공통 SDK나 다른 기기로 전파하기 전에 별도 영향 검토와 버전 호환성 확인이 필요하다.
