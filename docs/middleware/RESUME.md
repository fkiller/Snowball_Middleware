# Resume / stop protocol — 모델과 대화에 의존하지 않는 재개

## 1. 재개하는 사람/LLM의 첫 동작

1. 현재 repo의 AGENTS.md와 HANDOFF.md 전체를 읽는다. 과거 기록의 '완료'와 현재 지시가 충돌하면 현재 코드/테스트가 우선이다.
2. `git status --short`, `git log -10 --oneline`, `git diff`를 확인한다. untracked source도 확인한다. 기존 변경을 reset/stash/일괄 commit하지 않는다.
3. `docs/middleware/PLAN.md`, `DISCOVERY_JOURNEYS.md`, `PLAN.json`을 읽는다.
4. `node docs/middleware/validate-plan.mjs`로 parent/dependency/checkpoint와 scenario coverage를 검사한다.
5. `node docs/middleware/validate-plan.mjs --next`로 재개 우선 작업과 선행 조건이 만족된 task를 본다. 보고된 ready task를 자동 실행하기 전에 실제 증거와 task checkpoint를 대조한다.
6. task의 L0→L3 조상 요구와 L5 checks를 읽고, steps[0] 또는 checkpoint.nextAction부터 실행한다. 이전 agent 이름/모델을 이유로 설계를 재작성하지 않는다.

현재 재개 task: **MW.05.02.01.01**. 2026-09-24 기준 PLAN revision 45와 AUDIT.md, CONTROL_REALITY.md, HANDOFF.md 최상단을 따른다. Windows 최종 설치본은 실제 설치·tray 실행·제거와 96/96 해시 검증을 통과했다. macOS ARM64 CI desktop 패키지는 앱 실행 및 ZIP 압축 해제 후 재실행 검증을 통과했다. 현재 사용자 데이터에서 등록 프로젝트 2개, 연결 harness 2개(Codex 제어, OpenCode 조회 전용), MK20 QMK USB 후보 1개와 제어 장치 0개를 API로 확인했다. OpenCode 실제 모델 8개가 표시되지만 새 검증 세션의 무료 provider send는 HTTP 403으로 거부되어 제어를 비활성으로 둔다. harness 플러그인 3개는 fkiller 비공개 repo/release로 배포되었고 Windows/macOS CI와 빈 프로젝트 설치 검증이 통과했다. MK20 본체 CDC·입력 보고서·인증 pairing, macOS x64/서명·공증 desktop install, Windows 서명, Codex Desktop 동시 소유권과 정확한 승인 답변 수신은 여전히 별도 검증 조건이다. 기존 사용자 작업에는 명령을 보내지 않았다.

원장의 기존 입력 경로 `host/src`, `host/tests`는 이제 `reference/legacy-host/src`, `reference/legacy-host/tests`에서 읽는다. 하드웨어 입력은 sibling `../Snowball_Control/hardware`에 남아 있다. 새 구현은 `packages/`에만 추가하고 reference 파일을 수정하지 않는다. 다음 작업부터 dependency 완료 여부와 designDemand/difficulty 우선순위를 `--next`로 확인한다.

## 2. 작업 원장 갱신

PLAN.json의 L4 task:

```text
status: ready → in_progress → done (또는 blocked / needs_review)
checkpoint.owner: 실행자/세션 식별; 제품 runtime에 사용하지 않음
checkpoint.baseCommit: 시작한 실제 commit
checkpoint.changedFiles: 이번 작업에서 변경한 경로
checkpoint.completedSteps: 완료한 steps 인덱스/설명
checkpoint.nextAction: 바로 실행 가능한 하나의 동작
checkpoint.blockers: 조건, 재현, 필요한 외부 입력
checkpoint.updatedAt: 실제 갱신 시각
```

L5 check.status는 pending/pass/fail/blocked. pass이면 evidence에 `date`, `environment`, `procedure`, `result`, `reference` 문자열을 가진 객체를 넣는다. 실제 날짜, OS/arch, 명령·절차, 결과와 파일/commit 참조를 기록한다. 비밀키/로그인 token/개인 transcript는 증거 파일에 넣지 않는다. commit이 없으면 uncommitted임을 표시하고 경로/해시를 기록한다. 계획 문서 작성은 구현 acceptance 통과가 아니다.

원장을 수정한 후 `node docs/middleware/validate-plan.mjs --write-tree`로 읽기용 TASK_TREE.md를 다시 생성한다. `--affected R-LOCAL`로 특정 요구를 상속한 task 목록을 확인한다. 이 명령은 영향 범위를 보여줄 뿐 상태를 자동 승인하거나 변경하지 않는다.

구현 evidence는 `docs/middleware/evidence/<task-id>/` 아래 요약부터 만든다. 큰 바이너리/민감 자료는 저장하지 않는다. source task와 check ID를 증거에 적는다. 이미 완료한 task의 증거를 읽고 실제 provider/device 검증과 fixture 검증을 구분한다.

## 3. 정상 중단과 handoff

1. 새 scope 시작을 멈추고 안전한 atomic 변경을 마무리한다.
2. 변경 파일과 실행 중 프로세스/port/작업 소유권을 확인한다. 외부 사용자의 harness/장치를 종료하지 않는다.
3. 관련 check를 실행하고 미실행·실패도 기록한다. 도중 멈춘 작업을 done으로 바꾸지 않는다.
4. task checkpoint, check evidence, top-level resumeTaskId를 갱신한다. blocked이면 다음 진행 가능한 task도 적는다.
5. HANDOFF 최상단에 아래 template을 채운다. AGENTS가 요구하는 quota handoff도 같은 상태를 사용한다.
6. validator와 diff 검사를 실행한다. 선별 commit이 안전하면 수행하되 기존 unrelated 변경을 끼워 넣지 않는다. 미커밋 상태이면 정확히 기록한다.

```text
Objective: 로컬 제어 middleware / 현재 범위
Plan: authoritative repo path + PLAN.json revision
Active task ID / ancestor path:
Actual Git branch / HEAD / dirty and untracked files:
Completed work and exact evidence:
Current incomplete work / changed files:
Exact next action:
Tests run / not run / failures:
Processes or device state to preserve:
Decisions / constraints / failed approaches:
Blocker and alternative ready task:
Quota source / actual status (if available):
```

## 4. 비정상 중단 복구

in_progress와 checkpoint가 오래됐으면 Git diff/파일/실제 프로세스를 먼저 확인한다. 코드가 있어도 미검증이면 done으로 만들지 않는다. 테스트가 실패하면 실패 자체를 보존하고 새 task를 중복 생성하지 않는다. task ledger와 HANDOFF가 다르면 관찰한 사실을 근거로 둘을 맞춘다. 이미 적용된 firmware/update/send를 무작정 반복하지 않는다.

새 repo가 생성됐는데 문서 이전이 덜 끝났다면 정확한 경로와 Git root를 확인한다. 로컬에 비슷한 이름의 폴더가 있다는 이유로 초기화/덮어쓰기하지 않는다. source inventory의 해시/manifest와 대조한다.

## 5. 사용자 지시 변경 전파 예

'기본 discovery는 현재 PC에만 제한' → R-LOCAL/R-NET → Harness candidate scanner, Device LAN enable, API bind, onboarding defaults, Settings, packaged smoke test 모두 영향 검토 → 관련 완료 check pending/관련 task needs_review → 실제 수정/검증 후 다시 pass. provider 사용법 변경이면 해당 plugin/version check와 관련 dependent task만 검토한다.

## 6. 현재 checkpoint

PLAN revision 45, resume MW.05.02.01.01. The current Windows package and unsigned per-user installer passed clean install, tray, noAuth loopback, 96/96 hash verification and uninstall. macOS ARM64 CI desktop app and extracted ZIP passed native runtime smoke; x64 and signed/notarized user install remain open. The live runtime restored two ready projects, controllable Codex and read-only OpenCode; native model catalogs returned five Codex models with real efforts and eight OpenCode models with no invented efforts. OpenCode free-provider structured send to a new disposable session returned 403, so control remains disabled. Three private harness repositories/releases passed Windows/macOS source and fresh-tarball-install CI; licensing is still undecided. MK20 QMK USB is present, but product CDC, input report mapping and pairing remain unverified. The exact next action for this task is visible native Codex picker/disconnect/reset and concurrent Desktop ownership verification using only new verification tasks. Read CONTROL_REALITY.md, OPENCODE_OWNERSHIP.md and HANDOFF.md for the task gates; do not redo completed wiring or command pre-existing user tasks.
