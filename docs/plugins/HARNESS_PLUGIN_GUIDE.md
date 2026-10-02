# HARNESS PLUGIN GUIDE (하네스 플러그인 표준 및 개발 가이드)

## 1. 개요 및 목적
하네스 플러그인(Harness Plugin)은 사용자의 로컬 PC에서 구동되는 다양한 AI 코딩 에이전트(Codex, Antigravity, OpenCode, Claude Code, Cursor 등)를 Snowball 미들웨어에 표준화된 방식으로 연동하는 어댑터입니다.

하네스 플러그인은 **"하드코딩 없는 살아있는 원천(Source of Truth) 탐색"**과 **"보안 격리(Sandbox Isolation) 하에서의 실제 호스트 명령 디스패치"**를 핵심 원칙으로 합니다.

---

## 2. 하네스 플러그인 인터페이스 (`HarnessAdapter`)

모든 하네스 플러그인은 `@snowball/core`의 `HarnessAdapter` 인터페이스를 구현합니다:

```typescript
export interface HarnessAdapter {
  readonly id: string;               // 예: 'snowball.codex', 'snowball.antigravity', 'snowball.opencode'
  readonly name: string;             // 표시 이름 (예: 'Codex', 'Antigrav', 'OpenCode')
  readonly surface: string;          // 연동 방식 (예: 'stdio-rpc', 'stream-json', 'cli-runner')
  readonly readOnly: boolean;        // 플러그인 자체의 샌드박스 격리 여부 (기본 true)

  /** 살아있는 모델 카탈로그 동적 스캔 */
  listModels?(): Promise<ProviderModelItem[]>;

  /** 현재 머신의 세션 목록 스캔 */
  listSessions(): Promise<SessionSummary[]>;

  /** 세션의 대화 내역(Turns) 및 상세 읽기 */
  readSession(sessionId: string): Promise<SessionDetail>;

  /** 호스트 레벨 프롬프트 디스패치 및 실시간 스트리밍 */
  dispatchTurn(params: HarnessTurnParams): Promise<HarnessTurnResult>;
}
```

---

## 3. 핵심 구현 4대 원칙

### 1. Living Model Catalog Discovery (동적 모델 카탈로그 탐색)
- **금지**: 하네스가 제공하는 모델 리스트를 정적 배열로 코드에 고정하는 행위.
- **표준**: 네이티브 CLI 명령어 또는 로컬 캐시 메타데이터를 직접 질의합니다:
  - OpenCode: `opencode models` CLI 질의 + `~/.cache/opencode/models.json` 파싱.
  - Antigravity: `agy.exe models` CLI 질의.
  - Codex: 공식 롤아웃 JSONL 및 RPC 스키마 질의.
- **모델 스펙 객체 필드**:
  ```typescript
  export interface ProviderModelItem {
    model: string;            // CLI 실행 시 전달할 실제 식별자 (예: 'opencode/muse-spark-1.3-contributor-free')
    displayName: string;      // LCD 화면에 표시할 직관적 명칭 (예: 'Muse Spark 1.3 Free')
    efforts: string[];        // 해당 모델이 지원하는 Reasoning Effort 목록 (예: ['minimal', 'low', 'medium', 'high', 'xhigh'])
    defaultEffort: string;    // 해당 모델의 기본 Effort
    isDefault?: boolean;      // 기본 추천 모델 여부
  }
  ```
  *(추론 미지원 모델의 경우 `efforts: ['none']`, `defaultEffort: 'none'`으로 설정)*

### 2. Living Session & Turn Discovery (세션 및 대화 내역 인덱싱)
- 하네스의 로컬 데이터베이스나 파일시스템을 직접 탐색하여 실시간 세션을 수집합니다:
  - SQLite DB (`opencode.db`, Antigravity `brain.db` 등)
  - 인덱스 파일 (`session_index.jsonl`, 세션 디렉터리 등)
- 턴(Turn) 내역에서 유저 프롬프트, 에이전트 응답 텍스트, 프로세스 세부정보(`processDetails`)를 추출하여 MK20 상단 LCD 및 Local API에 제공합니다.

### 3. Sandbox Isolation Boundary (플러그인 보안 격리)
- 플러그인 매니페스트(`manifest.ts`)는 `readOnly: true`, `surface: 'transcript-observer'`를 선언하여 플러그인이 미들웨어의 코어 권한을 탈취하거나 무단 파일 변조를 수행할 수 없도록 격리합니다.
- 실제 명령 실행은 승인된 호스트 디스패처(`scripts/harness-dispatch.mjs`)가 전담합니다.

### 4. Host Dispatch Execution (실제 호스트 명령 실행)
- K16(Send) 클릭 시 시뮬레이션 없이 실제 네이티브 프로세스를 스폰합니다:
  - 표준 입출력 인터페이스(Stdio RPC, stream-json NDJSON, CLI argv).
  - 에이전트 생성 텍스트를 `onDelta(textPiece)` 콜백으로 실시간 수신하여 MK20 화면에 즉시 스트리밍.
  - 프로세스 종료 시 최종 세션 ID 및 완성된 텍스트 반환.

---

## 4. 신규 하네스 플러그인 개발 튜토리얼 (예: `Claude Code` 연동)

새로운 하네스(예: `Claude Code` CLI)를 추가하는 단계별 가이드:

### 1단계: 플러그인 매니페스트 정의 (`packages/harness-claude-code`)
```typescript
import { HarnessManifest } from '@snowball/plugin-sdk';

export const claudeCodeManifest: HarnessManifest = {
  id: 'snowball.claudecode',
  name: 'Claude Code',
  version: '0.1.0',
  readOnly: true,
  surface: 'cli-process',
  capabilities: ['harness.sessions', 'harness.models']
};
```

### 2단계: 동적 모델 스캐너 추가 (`scripts/harness-catalog-scanner.mjs`)
```javascript
export function scanClaudeCodeCatalog() {
  // claude models 또는 관련 설정 파일 조회
  return [
    {
      model: 'claude-3-7-sonnet',
      displayName: 'Claude 3.7 Sonnet',
      efforts: ['low', 'medium', 'high', 'max'],
      defaultEffort: 'high',
      isDefault: true
    },
    {
      model: 'claude-3-5-haiku',
      displayName: 'Claude 3.5 Haiku',
      efforts: ['none'],
      defaultEffort: 'none',
      isDefault: false
    }
  ];
}
```

### 3단계: 세션 스캐너 추가 (`scripts/harness-session-scanner.mjs`)
Claude Code의 세션 기록 파일(`~/.claude/sessions/`)을 탐색하여 활성 프로젝트명과 세션 제목, 최근 턴 내역을 수집합니다.

### 4단계: 디스패처 러너 등록 (`scripts/harness-dispatch.mjs`)
```javascript
export async function runClaudeCodeTurn(sessionId, promptText, cwd, model, effort, onDelta) {
  return new Promise((resolve, reject) => {
    const args = ['--format', 'json', '--model', model];
    if (sessionId) args.push('--session', sessionId);
    if (effort && effort !== 'none') args.push('--effort', effort);
    args.push(promptText);

    const p = cp.spawn('claude', args, { cwd: cwd || process.cwd() });
    let agentText = '';

    p.stdout.on('data', chunk => {
      const piece = chunk.toString();
      agentText += piece;
      if (onDelta) onDelta(piece);
    });

    p.on('close', code => {
      resolve({ sessionId: sessionId || 'new-session', response: agentText.trim() });
    });
  });
}
```

### 5단계: 통합 확인
`scripts/start-all.mjs`의 `context.harnesses` 배열에 등록하고, MK20 K13 버튼을 눌러 새 하네스로 즉시 전환하여 물리 제어할 수 있습니다.
