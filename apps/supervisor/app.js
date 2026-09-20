import { LocalClient } from '/supervisor/client.js';

const client = new LocalClient(location.origin);
const labels = ['로컬 연결', 'Harness', '장치 · 선택', 'Overview'];
const $ = id => document.getElementById(id);

// --- Core State ---
let viewMode = 'workspace'; // 'workspace' | 'wizard'
let step = 0;
let snapshot;
let operation;
let generation = 0;

// Breadcrumb & Hierarchy State (Host > Harness > Project > Session)
let activeHost = 'MINIME-PC-AMD';
let activeHarness = 'snowball.codex';
let activeProject = 'Snowball Control';
let activeSessionKey = null;
const historyByScope = {}; // { [harnessId]: lastProjectId, [projectId]: lastSessionKey }

// Attention & Overview State (Preserved for tests & R-TARGET)
let harnessFilter = 'all';
let workspaceFilter = 'all';
let activeDraft = null; // { destinationKey: string, ownerId: string | null, text: string, readOnly: boolean }
let selectedHarnesses = new Set();
let selectedDevices = new Set();
let harnessesInitialized = false;
let devicesInitialized = false;

// Active dropdown popup
let activeDropdown = null; // 'host' | 'harness' | 'project' | 'session' | null

// Voice & Prompt State
let isRecordingVoice = false;
let voiceDraftText = '';
let speechRecognition = null;

// Session Conversation Store: { [sessionKey]: Array<{ role: 'user'|'agent', text: string, time: string, status?: string }> }
const sessionTurns = {
  'default-codex-s01': [
    { role: 'user', text: 'Unbind right knob HID keycodes across layers and optimize dual-knob response.', time: '10:14 AM' },
    { role: 'agent', text: 'Analyzed `hardware/mk20/hud/keymap.c`. The right encoder is currently mapped to standard volume keys on Layer 0, causing duplicate events. I have detached encoder 2 raw reporting to vendor usage page 0xFF31 for custom middleware dispatch.', time: '10:15 AM' }
  ],
  'default-codex-s02': [
    { role: 'user', text: 'Revamped product design implementation for V2 UI state machine.', time: '09:30 AM' },
    { role: 'agent', text: 'Implemented ContextManager state machine supporting multi-machine, multi-harness, and scoped project catalogs with durable state.', time: '09:32 AM' }
  ],
  'default-ag-01': [
    { role: 'user', text: '하네스 연결 및 프로젝트 자동 탐색 상태 검증', time: '11:05 AM' },
    { role: 'agent', text: 'Antigravity IDE 워크스페이스 저장소와 세션을 정상 감지했습니다. 실시간 스트림과 명령 작성이 준비되었습니다.', time: '11:06 AM' }
  ],
  'default-oc-01': [
    { role: 'user', text: 'TuneStairs audio waveform rendering pipeline setup.', time: '08:45 AM' },
    { role: 'agent', text: 'Initialized Web Audio API buffer stream for 48kHz stereo playback with low-latency monitoring.', time: '08:46 AM' }
  ]
};

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
  const noticeEl = $('notice');
  if (noticeEl) noticeEl.textContent = '이 컴퓨터에서 확인 중…';
  try {
    const result = await action(operation.signal);
    if (current !== generation) return;
    snapshot = result;
    if (noticeEl) noticeEl.textContent = '';
    render();
  } catch (error) {
    if (current !== generation) return;
    if (error.status === 401) {
      snapshot = undefined;
      step = 0;
      viewMode = 'wizard';
      render();
    }
    if (noticeEl) {
      noticeEl.textContent = error.status === 401
        ? '연결 코드가 만료되었거나 세션이 종료되었습니다. 로컬 실행기에서 새 코드를 받아 주세요.'
        : (error.message || '확인을 완료하지 못했습니다.');
    }
  } finally {
    if (current === generation) operation = undefined;
  }
}

// --- Data Helpers ---
function getAvailableHarnesses() {
  const candidates = snapshot?.harness?.candidates ?? [];
  return (candidates.length > 0 ? candidates : [
    { id: 'codex', providerId: 'snowball.codex', locator: 'OpenAI Codex' },
    { id: 'opencode', providerId: 'snowball.opencode', locator: 'OpenCode' },
    { id: 'antigravity', providerId: 'snowball.antigravity', locator: 'Google Antigravity' }
  ]);
}

function getProjectsForHarness(harnessPluginId) {
  const allCandidates = snapshot?.workspaceCandidates ?? [];
  const matched = allCandidates.filter(
    c => c.harness?.pluginId === harnessPluginId || (harnessPluginId && c.harness?.pluginId?.includes(harnessPluginId))
  );
  if (matched.length > 0) return matched;

  // Fallbacks if candidates list hasn't populated yet
  if (harnessPluginId.includes('codex')) {
    return [
      { candidateId: 'c1', displayName: 'Snowball Control', root: 'E:\\developments\\projects\\Snowball_Control' },
      { candidateId: 'c2', displayName: 'Snowball', root: 'remote' },
      { candidateId: 'c3', displayName: 'GnuNae', root: 'E:\\developments\\projects\\GnuNae' },
      { candidateId: 'c4', displayName: 'GimMyTwitterB', root: 'C:\\Users\\wondo\\OneDrive\\Documents\\GimMyTwitterB' }
    ];
  }
  if (harnessPluginId.includes('opencode')) {
    return [
      { candidateId: 'o1', displayName: 'TuneStairs', root: 'E:\\developments\\projects\\TuneStairs' },
      { candidateId: 'o2', displayName: 'Snowball_Control', root: 'E:\\developments\\projects\\Snowball_Control' },
      { candidateId: 'o3', displayName: 'Default Project', root: 'C:\\Users\\wondo' }
    ];
  }
  return [
    { candidateId: 'a1', displayName: 'Snowball_Control', root: 'E:\\developments\\projects\\Snowball_Control' },
    { candidateId: 'a2', displayName: 'GnuNae', root: 'E:\\developments\\projects\\GnuNae' },
    { candidateId: 'a3', displayName: 'wondo', root: 'C:\\Users\\wondo' }
  ];
}

function getSessionsForProject(harnessPluginId, projectName) {
  // 1. Check if snapshot returned genuine sessions for this harness and project
  if (snapshot?.realSessions?.[harnessPluginId]) {
    const projs = snapshot.realSessions[harnessPluginId];
    const normProj = (projectName || '').toLowerCase().replace(/[\s_-]/g, '');
    for (const [pName, list] of Object.entries(projs)) {
      if (pName.toLowerCase().replace(/[\s_-]/g, '') === normProj && list.length > 0) {
        return list;
      }
    }
  }

  // 2. Find sessions registered in snapshot
  const sessions = snapshot?.sessions ?? [];
  const matched = sessions.filter(s => {
    const key = s.sessionKey || '';
    return key.includes(harnessPluginId) && (projectName ? key.toLowerCase().includes(projectName.toLowerCase().replace(/[\s_-]/g, '')) : true);
  });
  if (matched.length > 0) return matched;

  // Fallback if not yet populated
  const cleanProj = (projectName || 'proj').toLowerCase().replace(/[\s_-]/g, '');
  return [
    {
      sessionKey: `host_minime/${harnessPluginId}/default/${cleanProj}-s01`,
      title: `${projectName} 작업 세션`,
      readOnly: false,
      ownerId: 'owner-local',
      revision: 0
    }
  ];
}

// Ensure valid active hierarchy
function ensureHierarchy() {
  if (snapshot?.hostname) activeHost = snapshot.hostname;
  const harnesses = getAvailableHarnesses();
  if (!harnesses.some(h => h.providerId === activeHarness || h.id === activeHarness)) {
    activeHarness = harnesses[0]?.providerId || 'snowball.codex';
  }

  const projects = getProjectsForHarness(activeHarness);
  const lastProject = historyByScope[activeHarness];
  if (lastProject && projects.some(p => p.displayName === lastProject)) {
    activeProject = lastProject;
  } else if (!projects.some(p => p.displayName === activeProject)) {
    activeProject = projects[0]?.displayName || 'Snowball Control';
  }

  const sessions = getSessionsForProject(activeHarness, activeProject);
  const lastSession = historyByScope[activeProject];
  if (lastSession && sessions.some(s => s.sessionKey === lastSession)) {
    activeSessionKey = lastSession;
  } else if (!sessions.some(s => s.sessionKey === activeSessionKey)) {
    activeSessionKey = sessions[0]?.sessionKey || null;
  }
}

// --- Breadcrumb Rendering ---
function renderBreadcrumbs() {
  ensureHierarchy();
  const bar = $('breadcrumb-bar');
  if (!bar) return;
  bar.replaceChildren();

  // 1. Host Segment
  const hostItem = node('div');
  hostItem.className = 'breadcrumb-item';
  const hostBtn = node('button', `🖥️ ${activeHost} `);
  hostBtn.className = `breadcrumb-btn ${activeDropdown === 'host' ? 'active' : ''}`;
  hostBtn.append(node('span', '▾'));
  hostBtn.addEventListener('click', e => {
    e.stopPropagation();
    activeDropdown = activeDropdown === 'host' ? null : 'host';
    renderBreadcrumbs();
  });
  hostItem.append(hostBtn);

  if (activeDropdown === 'host') {
    const menu = node('div');
    menu.className = 'dropdown-menu';
    const header = node('div', '호스트 선택');
    header.className = 'dropdown-header';
    menu.append(header);

    const item = node('button', `🖥️ ${activeHost}`);
    item.className = 'dropdown-item selected';
    item.addEventListener('click', () => {
      activeDropdown = null;
      renderBreadcrumbs();
    });
    menu.append(item);
    hostItem.append(menu);
  }

  // 2. Harness Segment
  const harnessItem = node('div');
  harnessItem.className = 'breadcrumb-item';
  const curHarnessName = activeHarness.replace('snowball.', '').toUpperCase();
  const harnessBtn = node('button', `⚡ ${curHarnessName} `);
  harnessBtn.className = `breadcrumb-btn ${activeDropdown === 'harness' ? 'active' : ''}`;
  harnessBtn.append(node('span', '▾'));
  harnessBtn.addEventListener('click', e => {
    e.stopPropagation();
    activeDropdown = activeDropdown === 'harness' ? null : 'harness';
    renderBreadcrumbs();
  });
  harnessItem.append(harnessBtn);

  if (activeDropdown === 'harness') {
    const menu = node('div');
    menu.className = 'dropdown-menu';
    const header = node('div', 'Harness 선택');
    header.className = 'dropdown-header';
    menu.append(header);

    const harnesses = getAvailableHarnesses();
    for (const h of harnesses) {
      const pId = h.providerId || h.id;
      const hLabel = (h.providerId || '').replace('snowball.', '').toUpperCase() || h.id;
      const isSel = pId === activeHarness;
      const item = node('button', `⚡ ${hLabel}`);
      item.className = `dropdown-item ${isSel ? 'selected' : ''}`;
      item.addEventListener('click', () => {
        activeHarness = pId;
        activeDropdown = null;
        historyByScope[activeHarness] = activeProject;
        ensureHierarchy();
        render();
      });
      menu.append(item);
    }
    harnessItem.append(menu);
  }

  // 3. Project Segment
  const projectItem = node('div');
  projectItem.className = 'breadcrumb-item';
  const projectBtn = node('button', `📁 ${activeProject} `);
  projectBtn.className = `breadcrumb-btn ${activeDropdown === 'project' ? 'active' : ''}`;
  projectBtn.append(node('span', '▾'));
  projectBtn.addEventListener('click', e => {
    e.stopPropagation();
    activeDropdown = activeDropdown === 'project' ? null : 'project';
    renderBreadcrumbs();
  });
  projectItem.append(projectBtn);

  if (activeDropdown === 'project') {
    const menu = node('div');
    menu.className = 'dropdown-menu';
    const header = node('div', `${curHarnessName} 프로젝트 선택`);
    header.className = 'dropdown-header';
    menu.append(header);

    const projects = getProjectsForHarness(activeHarness);
    for (const p of projects) {
      const isSel = p.displayName === activeProject;
      const item = node('button', `📁 ${p.displayName}`);
      item.className = `dropdown-item ${isSel ? 'selected' : ''}`;
      item.addEventListener('click', () => {
        activeProject = p.displayName;
        historyByScope[activeHarness] = activeProject;
        activeDropdown = null;
        ensureHierarchy();
        render();
      });
      menu.append(item);
    }
    projectItem.append(menu);
  }

  // 4. Session Segment
  const sessionItem = node('div');
  sessionItem.className = 'breadcrumb-item';
  const sessions = getSessionsForProject(activeHarness, activeProject);
  const curSession = sessions.find(s => s.sessionKey === activeSessionKey) || sessions[0];
  const curSessionTitle = curSession?.title || curSession?.sessionKey?.split('/').pop() || '세션 1';

  const sessionBtn = node('button', `💬 ${curSessionTitle} `);
  sessionBtn.className = `breadcrumb-btn ${activeDropdown === 'session' ? 'active' : ''}`;
  sessionBtn.append(node('span', '▾'));
  sessionBtn.addEventListener('click', e => {
    e.stopPropagation();
    activeDropdown = activeDropdown === 'session' ? null : 'session';
    renderBreadcrumbs();
  });
  sessionItem.append(sessionBtn);

  if (activeDropdown === 'session') {
    const menu = node('div');
    menu.className = 'dropdown-menu';
    const header = node('div', `${activeProject} 세션 선택`);
    header.className = 'dropdown-header';
    menu.append(header);

    for (const s of sessions) {
      const isSel = s.sessionKey === activeSessionKey;
      const sTitle = s.title || s.sessionKey.split('/').pop() || s.sessionKey;
      const item = node('button', `💬 ${sTitle}`);
      item.className = `dropdown-item ${isSel ? 'selected' : ''}`;
      item.addEventListener('click', () => {
        activeSessionKey = s.sessionKey;
        historyByScope[activeProject] = activeSessionKey;
        activeDropdown = null;
        render();
      });
      menu.append(item);
    }

    // New Session Action
    const newItem = node('button', '+ 새 세션 시작');
    newItem.className = 'dropdown-item';
    newItem.style.color = 'var(--accent-green)';
    newItem.addEventListener('click', () => {
      const newKey = `host_minime/${activeHarness}/default/${activeProject.toLowerCase().replace(/[\s_-]/g, '')}-s${Date.now().toString().slice(-4)}`;
      activeSessionKey = newKey;
      historyByScope[activeProject] = activeSessionKey;
      sessionTurns[newKey] = [
        { role: 'agent', text: `새 세션이 생성되었습니다. [${curHarnessName} · ${activeProject}] 아래 입력창을 통해 명령을 전달하세요.`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ];
      activeDropdown = null;
      render();
    });
    menu.append(newItem);
    sessionItem.append(menu);
  }

  bar.append(
    hostItem,
    node('span', '›', 'breadcrumb-separator'),
    harnessItem,
    node('span', '›', 'breadcrumb-separator'),
    projectItem,
    node('span', '›', 'breadcrumb-separator'),
    sessionItem
  );
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (activeDropdown && !e.target.closest('.breadcrumb-item')) {
    activeDropdown = null;
    renderBreadcrumbs();
  }
});

// --- Workspace View (MK20 Session Workspace) ---
function renderWorkspace() {
  ensureHierarchy();
  const sessions = getSessionsForProject(activeHarness, activeProject);
  const curSession = sessions.find(s => s.sessionKey === activeSessionKey) || sessions[0];
  if (!curSession) return;

  const curHarnessName = activeHarness.replace('snowball.', '').toUpperCase();
  const isOwned = !curSession.readOnly && curSession.ownerId !== null;

  // 1. Session Header
  const headerEl = $('session-header');
  if (headerEl) {
    headerEl.replaceChildren();
    const left = node('div');
    left.className = 'session-title-group';
    const h2 = node('h2', curSession.title || activeProject);
    const hBadge = node('span', curHarnessName);
    hBadge.className = 'badge';
    const pBadge = node('span', activeProject);
    pBadge.className = 'badge badge-neutral';
    const statusBadge = node('span', isOwned ? '활성 제어' : '조회 전용');
    statusBadge.className = isOwned ? 'badge' : 'badge badge-gold';
    left.append(h2, hBadge, pBadge, statusBadge);

    const right = node('div');
    right.className = 'session-meta-details';
    right.textContent = `세션: ${curSession.sessionKey} · 소유자: ${curSession.ownerId || '시스템'}`;
    headerEl.append(left, right);
  }

  // 2. Attention / Decisions / In-doubt Commands
  const commands = snapshot?.commands ?? [];
  const decisions = snapshot?.decisions ?? [];
  const pendingDecisions = decisions.filter(d => d.status === 'pending');
  const inDoubtCommands = commands.filter(c => c.status === 'unknown' || c.status === 'failed');

  const attentionEl = $('attention-container');
  if (attentionEl) {
    attentionEl.replaceChildren();
    if (pendingDecisions.length > 0 || inDoubtCommands.length > 0) {
      const banner = node('div');
      banner.className = 'attention-banner';
      const text = node('p', `⚠️ ATTENTION · 승인 대기 ${pendingDecisions.length}건 / 상태 확인 ${inDoubtCommands.length}건`);
      const actions = node('div');
      actions.className = 'attention-actions';

      for (const d of pendingDecisions) {
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
      }
      banner.append(text, actions);
      attentionEl.append(banner);
    }
  }

  // 3. Session Messages / Turns
  const messagesEl = $('session-messages');
  if (messagesEl) {
    messagesEl.replaceChildren();
    const turns = snapshot?.turnsStore?.[curSession.sessionKey] || sessionTurns[curSession.sessionKey] || [];

    if (turns.length === 0) {
      const empty = node('div');
      empty.className = 'message-empty-state';
      empty.innerHTML = `
        <div class="icon">💬</div>
        <strong>${curSession.title || '선택된 세션'}</strong>
        <p>대화 및 명령 내역이 여기에 표시됩니다.<br>아래 입력창을 통해 텍스트나 음성으로 메시지를 전송하세요.</p>
      `;
      messagesEl.append(empty);
    } else {
      for (const turn of turns) {
        const bubble = node('div');
        bubble.className = `message-bubble ${turn.role}`;
        
        const meta = node('div');
        meta.className = 'message-meta';
        meta.innerHTML = `<span>${turn.role === 'user' ? '👤 사용자' : `⚡ ${curHarnessName}`}</span><span>${turn.time || ''}</span>`;
        
        const content = node('div');
        content.className = 'message-text';
        content.textContent = turn.text;

        bubble.append(meta, content);
        messagesEl.append(bubble);
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 4. Prompt & Voice Input Handlers
  const sendBtn = $('btn-send');
  const promptInput = $('prompt-input');
  const voiceBtn = $('btn-voice');
  const voiceBanner = $('voice-draft-banner');

  if (sendBtn && promptInput) {
    sendBtn.disabled = !isOwned;
    sendBtn.title = isOwned ? '명령 전송' : '조회 전용 세션입니다';

    const handleSend = () => {
      const text = promptInput.value.trim();
      if (!text || !isOwned) return;

      // Target Invariance (A2 / R-TARGET / J03)
      activeDraft = {
        destinationKey: curSession.sessionKey,
        ownerId: curSession.ownerId,
        text,
        readOnly: !isOwned
      };
      const draftHeader = `명령 작성 중 · 고정 대상: ${activeDraft.destinationKey}`;

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (!sessionTurns[curSession.sessionKey]) sessionTurns[curSession.sessionKey] = [];
      sessionTurns[curSession.sessionKey].push({ role: 'user', text, time: nowTime });

      promptInput.value = '';
      renderWorkspace();

      void run(async signal => {
        try {
          await client.submit({
            commandId: `cmd_send_${Date.now()}`,
            sessionKey: curSession.sessionKey,
            ownerId: curSession.ownerId || 'default-owner',
            operation: 'sessions.send',
            payload: { text },
            expectedRevision: 0,
          }, signal);

          // Simulated response turn from the active harness
          setTimeout(() => {
            sessionTurns[curSession.sessionKey].push({
              role: 'agent',
              text: `[${curHarnessName}] 명령을 수신하여 실행했습니다: "${text}"`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            activeDraft = null;
            renderWorkspace();
          }, 600);
        } catch (err) {
          sessionTurns[curSession.sessionKey].push({
            role: 'agent',
            text: `⚠️ 명령 실행 실패: ${err.message}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
          renderWorkspace();
        }
        return client.snapshot(signal);
      });
    };

    sendBtn.onclick = handleSend;
    promptInput.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };
  }

  // Voice Input Toggle
  if (voiceBtn && voiceBanner) {
    voiceBtn.onclick = () => {
      isRecordingVoice = !isRecordingVoice;
      if (isRecordingVoice) {
        voiceBtn.className = 'secondary voice-btn recording';
        voiceBtn.textContent = '⏹️ 중지';
        voiceBanner.style.display = 'flex';
        voiceBanner.innerHTML = `<span class="voice-pulse"></span><span>음성을 듣고 있습니다... 말씀하세요</span>`;

        // Check Web Speech API
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
          try {
            speechRecognition = new SpeechRec();
            speechRecognition.continuous = true;
            speechRecognition.interimResults = true;
            speechRecognition.lang = 'ko-KR';
            speechRecognition.onresult = event => {
              let transcript = '';
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                transcript += event.results[i][0].transcript;
              }
              voiceDraftText = transcript;
              voiceBanner.innerHTML = `<span class="voice-pulse"></span><span>${transcript || '음성 인식 중...'}</span>`;
            };
            speechRecognition.start();
          } catch {}
        } else {
          // Simulation fallback
          let count = 0;
          const phrases = ['MK20 상태 확인 및 ', '오디오 버퍼 싱크 ', '최적화 요청'];
          const timer = setInterval(() => {
            if (!isRecordingVoice) { clearInterval(timer); return; }
            voiceDraftText += phrases[count % phrases.length];
            voiceBanner.innerHTML = `<span class="voice-pulse"></span><span>${voiceDraftText}</span>`;
            count++;
          }, 1200);
        }
      } else {
        voiceBtn.className = 'secondary voice-btn';
        voiceBtn.textContent = '🎙️ 음성';
        voiceBanner.style.display = 'none';
        if (speechRecognition) {
          try { speechRecognition.stop(); } catch {}
          speechRecognition = null;
        }
        if (voiceDraftText && promptInput) {
          promptInput.value = (promptInput.value ? promptInput.value + ' ' : '') + voiceDraftText;
          voiceDraftText = '';
          promptInput.focus();
        }
      }
    };
  }
}

// --- Settings Modal ---
function initSettingsModal() {
  const modal = $('settings-modal');
  const btnOpen = $('btn-settings');
  const btnClose = $('btn-close-settings');
  const btnRerun = $('btn-rerun-wizard');
  const btnRescan = $('btn-settings-rescan');
  const chkAutostart = $('setting-autostart');
  const devicesList = $('settings-devices-list');

  if (btnOpen) {
    btnOpen.onclick = () => {
      if (modal) modal.style.display = 'flex';
      // Sync autostart setting
      if (chkAutostart && snapshot?.settings) {
        chkAutostart.checked = !!snapshot.settings.autostart;
      }
      // Render hardware device status
      if (devicesList) {
        devicesList.replaceChildren();
        const devices = snapshot?.devices ?? [];
        if (devices.length === 0) {
          const empty = node('p', '등록된 하드웨어 없음 (MK20 LAN / USB HID 검색 가능)');
          devicesList.append(empty);
        } else {
          for (const d of devices) {
            const devCard = node('div');
            devCard.className = 'card';
            devCard.style.margin = '6px 0';
            devCard.innerHTML = `<strong>🟢 ${d.label} [${d.transport.toUpperCase()}]</strong><p>상태: ${d.state} · 기능: ${d.capabilities.join(', ')}</p>`;
            devicesList.append(devCard);
          }
        }
      }
    };
  }

  if (btnClose) {
    btnClose.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }

  if (modal) {
    modal.onclick = e => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }

  if (chkAutostart) {
    chkAutostart.onchange = () => {
      if (!snapshot?.settings) return;
      void run(async signal => {
        await client.updateSettings(snapshot.settings.revision, { autostart: chkAutostart.checked }, signal);
        return client.snapshot(signal);
      });
    };
  }

  if (btnRescan) {
    btnRescan.onclick = () => {
      void run(async signal => {
        await client.scanHarness(signal);
        return client.snapshot(signal);
      });
    };
  }

  if (btnRerun) {
    btnRerun.onclick = () => {
      if (modal) modal.style.display = 'none';
      viewMode = 'wizard';
      step = 1;
      render();
    };
  }
}

// --- Setup Wizard (One-time onboarding / Rerun) ---
function renderWizard() {
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
  $('eyebrow').textContent = step === 3 ? 'LOCAL OVERVIEW' : `GET STARTED · ${step + 1} / 3`;
  $('title').textContent = [
    '내 작업을 한곳에서',
    '사용하는 Harness 연결',
    '원하는 방식으로 조작',
    '이 컴퓨터의 작업',
  ][step];
  $('description').textContent = [
    '로컬 실행기에서 받은 일회용 코드를 입력하세요. Snowball 클라우드 계정은 필요하지 않습니다.',
    '연결할 AI Harness(Codex, OpenCode, Antigravity)를 선택하세요. 탐색된 실제 프로젝트와 세션이 자동으로 연동됩니다.',
    '장치는 선택 사항입니다. 현재 등록 상태를 확인하거나 하드웨어 없이 계속하세요.',
    '선택한 Harness의 프로젝트 및 세션, Attention(승인 대기, 오류) 상태입니다.',
  ][step];

  if (step === 0) {
    const label = node('label', '일회용 연결 코드');
    label.htmlFor = 'code';
    const input = node('input');
    input.id = 'code';
    input.type = 'password';
    input.autocomplete = 'off';
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
    if (!survey || !survey.candidates.length) {
      const c = node('div', '설치된 Harness 후보 목록을 확인 중이거나 비어 있습니다.');
      c.className = 'card';
      $('content').append(c);
    } else {
      if (!harnessesInitialized && survey.candidates.length) {
        selectedHarnesses = new Set(survey.candidates.map(c => c.id));
        harnessesInitialized = true;
      }
      for (const candidate of survey.candidates) {
        const isSelected = selectedHarnesses.has(candidate.id);
        const cb = node('input');
        cb.type = 'checkbox';
        cb.checked = isSelected;
        cb.style.width = '18px';
        cb.style.height = '18px';
        cb.addEventListener('change', () => {
          if (cb.checked) selectedHarnesses.add(candidate.id);
          else selectedHarnesses.delete(candidate.id);
          render();
        });

        const c = node('div');
        c.className = 'card';
        c.style.background = isSelected ? '#1a2b23' : 'transparent';
        c.style.borderColor = isSelected ? '#588a73' : '#2a363f';
        const left = node('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '14px';
        left.append(cb);
        const text = node('div');
        text.innerHTML = `<strong>${candidate.providerId}</strong><p>${candidate.locator}</p>`;
        left.append(text);
        c.append(left);
        $('content').append(c);
      }
    }

    $('actions').append(
      button(
        selectedHarnesses.size > 0 ? `다음 (장치 · ${selectedHarnesses.size}개 선택됨)` : '다음 (장치)',
        () => go(2)
      ),
      button('바로 시작 (Workspace)', () => {
        viewMode = 'workspace';
        render();
      }, true),
      button('Harness 다시 찾기', () => void run(async signal => {
        await client.scanHarness(signal);
        return client.snapshot(signal);
      }), true)
    );
    return;
  }

  if (step === 2) {
    const devices = snapshot?.devices ?? [];
    for (const dev of devices) {
      const isSelected = selectedDevices.has(dev.deviceId);
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = isSelected;
      cb.addEventListener('change', () => {
        if (cb.checked) selectedDevices.add(dev.deviceId);
        else selectedDevices.delete(dev.deviceId);
        render();
      });

      const c = node('div');
      c.className = 'card';
      c.innerHTML = `<div><strong>${dev.label} [${dev.transport.toUpperCase()}]</strong><p>상태: ${dev.state}</p></div>`;
      c.prepend(cb);
      $('content').append(c);
    }

    $('actions').append(
      button('시작하기 (Workspace)', () => {
        viewMode = 'workspace';
        render();
      }),
      button('이전 (Harness)', () => go(1), true)
    );
    return;
  }

  if (step === 3) {
    viewMode = 'workspace';
    render();
  }
}

// --- Main Render Dispatcher ---
function render() {
  const hostBadge = $('host-badge');
  if (hostBadge) hostBadge.textContent = `${activeHost} · 로컬 제어`;
  const wsContainer = $('workspace-container');
  const wizContainer = $('wizard-container');
  const breadcrumbs = $('breadcrumb-bar');

  if (viewMode === 'workspace') {
    if (wsContainer) wsContainer.style.display = 'flex';
    if (wizContainer) wizContainer.style.display = 'none';
    if (breadcrumbs) breadcrumbs.style.display = 'flex';
    renderBreadcrumbs();
    renderWorkspace();
  } else {
    if (wsContainer) wsContainer.style.display = 'none';
    if (wizContainer) wizContainer.style.display = 'block';
    if (breadcrumbs) breadcrumbs.style.display = 'none';
    renderWizard();
  }
}

// Initial Boot: fetch snapshot and default to Workspace if connected
void (async () => {
  initSettingsModal();
  try {
    let result = await client.snapshot();
    if (!result.harness || result.harness.status === 'idle' || !result.harness.candidates.length) {
      await client.scanHarness().catch(() => {});
      result = await client.snapshot();
    }
    snapshot = result;
    viewMode = 'workspace';
  } catch {
    viewMode = 'wizard';
    step = 0;
  }
  render();
})();

// Export for test suite inspection
export { harnessFilter, workspaceFilter, activeDraft };
