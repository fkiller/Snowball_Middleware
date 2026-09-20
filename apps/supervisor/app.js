import { LocalClient } from '/supervisor/client.js';

const client = new LocalClient(location.origin);
const labels = ['로컬 연결', 'Harness', '작업 공간', '장치 · 선택', 'Overview'];
const names = {
  ready: '사용 가능',
  empty: '빈 작업 공간',
  missing: '폴더를 찾을 수 없음 · 이동/삭제 확인 필요',
  needs_permission: '폴더 접근 권한 필요',
  needs_review: '폴더가 변경됨 · 로컬에서 다시 선택 필요',
  unavailable: '아직 확인되지 않음',
};
const $ = id => document.getElementById(id);
let step = 0;
let snapshot;
let operation;
let generation = 0;

// State for Overview & Attention (MW.06.02.01.01)
let harnessFilter = 'all';
let workspaceFilter = 'all';
let activeDraft = null; // { destinationKey: string, ownerId: string | null, text: string, readOnly: boolean }

const node = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};

function button(label, action, secondary = false) {
  const element = node('button', label);
  element.type = 'button';
  if (secondary) element.className = 'secondary';
  element.addEventListener('click', action);
  return element;
}

function cancel() {
  generation++;
  operation?.abort();
  operation = undefined;
}

function go(next) {
  cancel();
  step = next;
  render();
}

async function run(action) {
  cancel();
  const current = generation;
  operation = new AbortController();
  $('notice').textContent = '이 컴퓨터에서 확인 중…';
  try {
    const result = await action(operation.signal);
    if (current !== generation) return;
    snapshot = result;
    $('notice').textContent = '';
    render();
  } catch (error) {
    if (current !== generation) return;
    if (error.status === 401) {
      snapshot = undefined;
      step = 0;
      render();
    }
    $('notice').textContent =
      error.status === 401
        ? '연결 코드가 만료되었거나 세션이 종료되었습니다. 로컬 실행기에서 새 코드를 받아 주세요.'
        : selectionNotice(error.code);
  } finally {
    if (current === generation) operation = undefined;
  }
}

function selectionNotice(code) {
  if (code === 'workspace_selection_cancelled') return '폴더 선택이 취소되었습니다. 마지막으로 받은 상태를 유지합니다.';
  if (code === 'workspace_selection_busy') return '다른 폴더 선택이 진행 중입니다. 잠시 기다렸다가 다시 시도하세요.';
  if (code === 'workspace_selection_limit') return '작업 공간 저장 용량이 찼습니다. 사용하지 않는 등록을 정리한 뒤 다시 시도하세요.';
  if (code === 'workspace_selection_missing') return '선택한 폴더를 찾을 수 없습니다. 이동·삭제 여부를 확인하고 다시 선택해 주세요.';
  if (code === 'workspace_selection_permission') return '선택한 폴더에 접근할 권한이 없습니다. 폴더 권한을 확인하고 다시 선택해 주세요.';
  if (code === 'workspace_selection_storage' || code === 'workspace_storage_unavailable') return '로컬 저장소 확인에 실패했습니다. 디스크 여유와 폴더 접근을 확인한 뒤 다시 시도하세요.';
  if (code === 'workspace_selection_invalid') return '선택 결과가 올바르지 않습니다. 다시 선택해 주세요.';
  if (code === 'workspace_selection_unavailable') return '폴더 확인을 완료하지 못했습니다. 폴더를 확인한 뒤 다시 시도하세요.';
  if (code === 'control_paused') return '제어가 일시 정지되어 있습니다. 트레이 메뉴나 설정에서 제어를 다시 켜 주세요.';
  if (code === 'read_only_session') return '조회 전용 세션에는 새 명령을 보낼 수 없습니다.';
  return '확인을 완료하지 못했습니다. 로컬 서비스와 접근 권한을 확인한 뒤 다시 시도하세요.';
}

function card(title, detail, action, badge = null) {
  const c = node('div');
  c.className = 'card';
  const text = node('div');
  const titleEl = node('strong', title);
  if (badge) {
    const b = node('span', ` [${badge}] `);
    b.className = 'badge';
    titleEl.prepend(b);
  }
  text.append(titleEl, node('p', detail));
  c.append(text);
  if (action) c.append(action);
  $('content').append(c);
  return c;
}

function renderOverview() {
  const sessions = snapshot?.sessions ?? [];
  const commands = snapshot?.commands ?? [];
  const decisions = snapshot?.decisions ?? [];

  // 1. Attention Section (top of Overview)
  const pendingDecisions = decisions.filter(d => d.status === 'pending');
  const inDoubtCommands = commands.filter(c => c.status === 'unknown' || c.status === 'failed');

  if (pendingDecisions.length > 0 || inDoubtCommands.length > 0) {
    const attHeader = node('h3', '⚠️ ATTENTION · 확인 필요 항목');
    attHeader.style.color = '#f4d9a4';
    attHeader.style.margin = '16px 0 8px';
    $('content').append(attHeader);

    // Pending Decisions
    for (const d of pendingDecisions) {
      const actions = node('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.append(
        button('승인 (Accept)', () => {
          void run(async signal => {
            await client.submit({
              commandId: `cmd_dec_${Date.now()}`,
              sessionKey: d.sessionKey,
              ownerId: d.ownerId,
              operation: 'decisions.resolve',
              payload: { answer: 'accept' },
              expectedRevision: d.revision,
              decision: { decisionId: d.decisionId, expectedRevision: d.revision },
            }, signal);
            return client.snapshot(signal);
          });
        }),
        button('거부 (Decline)', () => {
          void run(async signal => {
            await client.submit({
              commandId: `cmd_dec_${Date.now()}`,
              sessionKey: d.sessionKey,
              ownerId: d.ownerId,
              operation: 'decisions.resolve',
              payload: { answer: 'decline' },
              expectedRevision: d.revision,
              decision: { decisionId: d.decisionId, expectedRevision: d.revision },
            }, signal);
            return client.snapshot(signal);
          });
        }, true)
      );

      card(
        `승인 대기: ${d.decisionId}`,
        `대상: ${d.sessionKey} · revision: ${d.revision}`,
        actions,
        'DECISION'
      );
    }

    // In-doubt / Failed Commands
    for (const c of inDoubtCommands) {
      card(
        `명령 상태 확인: ${c.commandId}`,
        `상태: ${c.status} · 대상: ${c.sessionKey} · operation: ${c.operation}`,
        null,
        c.status.toUpperCase()
      );
    }
  }

  // 2. Filter Bar
  const filterBar = node('div');
  filterBar.style.display = 'flex';
  filterBar.style.flexWrap = 'wrap';
  filterBar.style.gap = '8px';
  filterBar.style.margin = '20px 0 12px';

  const filterLabel = node('span', 'Harness 필터: ');
  filterLabel.style.alignSelf = 'center';
  filterLabel.style.color = '#8c9ca8';
  filterBar.append(filterLabel);

  const filters = [
    ['all', '전체'],
    ['snowball.codex', 'Codex'],
    ['snowball.opencode', 'OpenCode'],
    ['snowball.antigravity', 'Antigravity'],
  ];

  for (const [key, label] of filters) {
    const isSelected = harnessFilter === key;
    const btn = button(label, () => {
      harnessFilter = key;
      render();
    }, !isSelected);
    btn.style.padding = '6px 12px';
    filterBar.append(btn);
  }

  $('content').append(filterBar);

  // 3. Active Draft Card (Destination Invariance R-TARGET / J03)
  if (activeDraft) {
    const draftCard = node('div');
    draftCard.className = 'card';
    draftCard.style.borderColor = '#a9e3c5';
    draftCard.style.flexDirection = 'column';
    draftCard.style.alignItems = 'stretch';

    const header = node('strong', `명령 작성 중 · 고정 대상: ${activeDraft.destinationKey}`);
    header.style.color = '#a9e3c5';

    const input = node('input');
    input.type = 'text';
    input.value = activeDraft.text;
    input.placeholder = '전송할 명령 텍스트를 입력하세요...';
    input.addEventListener('input', e => {
      activeDraft.text = e.target.value;
    });

    const draftActions = node('div');
    draftActions.style.display = 'flex';
    draftActions.style.gap = '8px';
    draftActions.append(
      button('명령 전송', () => {
        if (!activeDraft.text.trim()) return;
        const targetKey = activeDraft.destinationKey;
        const ownerId = activeDraft.ownerId;
        const text = activeDraft.text;

        void run(async signal => {
          await client.submit({
            commandId: `cmd_send_${Date.now()}`,
            sessionKey: targetKey,
            ownerId: ownerId || 'default-owner',
            operation: 'sessions.send',
            payload: { text },
            expectedRevision: 0,
          }, signal);
          activeDraft = null;
          return client.snapshot(signal);
        });
      }),
      button('작성 취소', () => {
        activeDraft = null;
        render();
      }, true)
    );

    draftCard.append(header, input, draftActions);
    $('content').append(draftCard);
  }

  // 4. Session List
  const listHeader = node('h3', `작업 목록 (${sessions.length}개)`);
  listHeader.style.margin = '20px 0 8px';
  $('content').append(listHeader);

  const filteredSessions = sessions.filter(s => {
    if (harnessFilter === 'all') return true;
    return s.sessionKey.includes(`/${harnessFilter}/`) || s.sessionKey.includes(`:${harnessFilter}:`);
  });

  if (!filteredSessions.length) {
    card('조건에 맞는 작업 없음', '현재 선택된 필터에 해당하는 작업이 없습니다.');
  }

  for (const s of filteredSessions) {
    const isOwned = !s.readOnly && s.ownerId !== null;
    const sessionAction = button(
      isOwned ? '명령 작성' : '조회 전용',
      () => {
        if (!isOwned) {
          $('notice').textContent = '조회 전용 작업입니다. 새 명령을 보낼 수 없습니다.';
          return;
        }
        // Pin destination key
        activeDraft = {
          destinationKey: s.sessionKey,
          ownerId: s.ownerId,
          text: '',
          readOnly: !isOwned,
        };
        render();
      },
      !isOwned
    );

    card(
      `세션: ${s.sessionKey}`,
      `소유자: ${s.ownerId || '없음 (조회 전용)'} · revision: ${s.revision}`,
      sessionAction,
      isOwned ? '소유' : '조회전용'
    );
  }

  $('actions').append(button('연결 설정 다시 보기', () => go(1), true));
}

function render() {
  $('steps').replaceChildren(
    ...labels.map((name, index) => {
      const el = node(index === step ? 'strong' : 'span', `${index + 1}. ${name}`);
      if (snapshot && index > 0) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => go(index));
      }
      return el;
    })
  );
  $('content').replaceChildren();
  $('actions').replaceChildren();
  $('notice').textContent = '';
  $('eyebrow').textContent = step === 4 ? 'LOCAL OVERVIEW' : `GET STARTED · ${step + 1} / 4`;
  $('title').textContent = [
    '내 작업을 한곳에서',
    '사용하는 Harness 연결',
    '작업 공간 확인',
    '원하는 방식으로 조작',
    '이 컴퓨터의 작업',
  ][step];
  $('description').textContent = [
    '로컬 실행기에서 받은 일회용 코드를 입력하세요. Snowball 클라우드 계정은 필요하지 않습니다.',
    'Harness 연결은 선택 사항입니다. 검토된 후보 목록만 표시하며, 버전·제어 가능 상태를 추정하지 않습니다.',
    '로컬에서 명시적으로 등록한 폴더만 표시합니다. Harness가 알려 준 경로는 자동 등록하지 않습니다.',
    '장치는 선택 사항입니다. 현재 등록 상태를 확인하거나 하드웨어 없이 계속하세요.',
    '로컬 서비스가 보고한 작업과 Attention(승인 대기, 오류) 상태입니다.',
  ][step];

  if (step === 0) {
    const label = node('label', '일회용 연결 코드');
    label.htmlFor = 'code';
    const input = node('input');
    input.id = 'code';
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 43;
    $('content').append(label, input);
    $('actions').append(
      button('로컬 서비스 연결', () => {
        const code = input.value;
        input.value = '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
          $('notice').textContent = '로컬 실행기가 발급한 연결 코드를 입력해 주세요.';
          return;
        }
        void run(async signal => {
          await client.bootstrap(code, signal);
          const result = await client.snapshot(signal);
          if (!signal.aborted) step = 1;
          return result;
        });
      })
    );
    return;
  }

  if (step === 1) {
    const survey = snapshot?.harness ?? null;
    if (!survey) {
      card(
        'Harness survey 미연결',
        '로컬 실행기가 후보 목록을 제공하지 않았습니다. 자동 설치·로그인·프로세스 시작 없이 건너뛸 수 있습니다.'
      );
    } else {
      if (survey.stale) {
        card('이전 Harness 결과', '최신 검사가 완료되지 않아 이전 검사 결과를 유지 중입니다. 다시 찾기로 갱신할 수 있습니다.');
      }
      if (!survey.candidates.length) {
        card(
          '설치된 Harness 후보 없음',
          '로컬 실행기에 Harness를 설치·등록한 뒤 다시 찾기. 자동 설치·실행은 하지 않습니다.'
        );
      }
      for (const candidate of survey.candidates) {
        card(
          `${candidate.providerId} · ${candidate.kind === 'file' ? '설치 파일' : '로컬 등록 주소'}`,
          `${candidate.locator} — 버전 미확인 · 연결 검사 전. 제어 가능으로 표시하지 않습니다.`
        );
      }
      $('actions').append(
        button(
          'Harness 다시 찾기',
          () => void run(async signal => {
            await client.scanHarness(signal);
            return client.snapshot(signal);
          }),
          true
        )
      );
    }
  }

  if (step === 2) {
    const workspaces = snapshot?.workspaceDetails ?? [];
    if (!workspaces.length) {
      card(
        '등록된 작업 공간 없음',
        snapshot?.workspaceSelectionAvailable
          ? '이 컴퓨터의 폴더를 직접 선택하거나 등록 없이 계속하세요.'
          : '현재 실행기에서는 폴더 선택을 사용할 수 없습니다. 등록 없이도 계속할 수 있습니다.'
      );
    }
    if (snapshot?.workspaceSelectionAvailable) {
      $('actions').append(
        button('폴더 선택', () => void run(async signal => {
          await client.selectWorkspace(signal);
          return client.snapshot(signal);
        }))
      );
    }
    for (const workspace of workspaces) {
      card(
        workspace.displayName,
        names[workspace.status] ?? '알 수 없는 상태',
        button('다시 확인', () => void run(async signal => {
          await client.recheckWorkspace(workspace.workspaceId, signal);
          return client.snapshot(signal);
        }), true)
      );
    }
  }

  if (step === 3) {
    const devices = snapshot?.devices ?? [];
    card(
      devices.length ? `등록된 장치 ${devices.length}개` : '등록된 장치 없음',
      '발견과 인증·제어 가능 여부는 다릅니다. 이 화면은 장치 검색이나 입력을 자동으로 시작하지 않습니다.'
    );
  }

  if (step === 4) {
    renderOverview();
  } else {
    if (step > 1) $('actions').append(button('이전', () => go(step - 1), true));
    $('actions').append(button(step === 3 ? '하드웨어 없이 Overview 열기' : '건너뛰고 계속', () => go(step + 1)));
  }

  $('actions').append(
    button('새로 고침', () => void run(signal => client.snapshot(signal)), true),
    button('확인 취소', () => {
      cancel();
      $('notice').textContent = '확인을 취소했습니다. 마지막으로 받은 상태를 유지합니다.';
    }, true),
    button('연결 종료', async () => {
      cancel();
      await client.logout().catch(() => {});
      snapshot = undefined;
      go(0);
    }, true)
  );
}

// Initial load: try to fetch snapshot immediately (no-auth or active session)
void (async () => {
  try {
    const result = await client.snapshot();
    snapshot = result;
    step = 1;
  } catch {}
  render();
})();
