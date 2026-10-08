# 하네스 플러그인 개발 가이드

현재 공개 범주는 Codex·Antigravity(AGY)·OpenCode다. 제품 철학·실행 경계·버전별 제한은 [중앙 아키텍처](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.ko.md), 설치 기준은 [harness-compatibility.json](../../config/harness-compatibility.json)에서 관리한다.

## 프로세스 플러그인과 호스트 어댑터

- 공통 worker 계약은 [plugin-sdk](../../packages/plugin-sdk/src/index.ts)의 Protocol 1 매니페스트·JSON-RPC다. 승인된 worker 다이제스트, 선언한 `harness.*` 기능, 플랫폼과 설정 스키마를 검사하고 `plugin.initialize`를 교환한다.
- 호스트의 [HarnessAdapter](../../packages/core/src/sessions.ts)는 SDK의 [DispatchPort](../../packages/plugin-sdk/src/dispatch.ts)를 확장한다. 실행 계약은 `ownerId`와 `execute(envelope, signal)`이며 세션 조회·생성·attach·모델 조회는 어댑터별 선택 기능이다.
- 워커의 관찰 기능과 승인된 호스트의 실행 기능을 구분한다. 매니페스트의 메타데이터나 `readOnly` 표기만으로 OS 파일 접근이 격리되거나 명령 소유권이 생기지 않는다. 정적 의존성 검사는 OS 샌드박스가 아니다.

## 실제 데이터와 실행

모델·모델별 effort·프로젝트·세션·네이티브 access 값은 설치된 CLI, 캐시, 인덱스/DB, 프로토콜에서 읽는다. 실제로 보고되지 않은 모델이나 effort를 기본 배열로 채우지 않는다. 미지원/미확인은 빈 목록이나 오류로 남긴다. AGY를 호출하는 부모와 모든 자식 프로세스에는 호출 전 `AGY_CLI_DISABLE_AUTO_UPDATE=true`를 적용한다.

Middleware의 `scripts/harness-runtime.mjs`, `harness-catalog-scanner.mjs`, `harness-session-scanner.mjs`, `harness-project-scanner.mjs`와 `harness-dispatch.mjs`가 현재 통합 진입점이다. 실행은 선택한 실제 프로젝트 경로·컨트롤러·하네스 인스턴스·세션·owner/revision에 결합한다. 승인·중단은 각 네이티브 런타임의 실제 지원과 확인 가능한 receipt를 따른다. 프로세스 종료나 텍스트 출력만으로 세션 생성/전송 완료를 만들지 않는다. 불명확한 전송은 `unknown`이며 자동 재전송하지 않는다.

## 수정 및 독립 배포 확인

1. `packages/harness-*`의 실제 manifest, worker, adapter와 기존 테스트를 읽고 지원 기능을 정한다. 아직 구현하지 않은 공급자의 CLI 옵션·모델·세션 경로를 예제로 단정하지 않는다.
2. `npm run check:boundaries`로 SDK 외 내부 구현 의존성이 없는지 확인한다. 기존 PluginHost 및 어댑터 테스트를 실행한다.
3. 독립 배포 경로는 [기존 배포 안내](../middleware/PLUGIN_DEVELOPMENT.md)를 따른다. 설치된 worker가 바뀌면 명시적 설치 검증으로 다이제스트를 다시 승인하며, 시작 시 임의로 승인하지 않는다.
4. 공통 설치/트레이 변경은 세 하네스 worker 초기화와 Web·MK20·M5Stack 프로필에 영향을 준다. 장치의 화면 문구 수정만으로 하네스 프로토콜이나 SDK 버전을 바꾸지 않는다.
5. 변경과 같은 변경 세트에서 중앙 문서·한국어 번역·관련 사용자 안내 및 검증 한계를 갱신한다. fixture 테스트와 실제 하네스/기기 검증을 구분한다.
