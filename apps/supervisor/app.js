import { LocalClient } from '/supervisor/client.js';

let client = new LocalClient(location.origin);
let webControllerId,controllerState,controllerReady=false,controllerTimer,controllerWrites=Promise.resolve(),lastControllerPatch='';
// sessionStorage is tab-local; Web Locks also distinguish duplicated/opener tabs
// whose initial sessionStorage was copied by the browser.
async function claimWebController() {
  const fresh=()=>`ctl_${Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('')}`;
  let id;try{id=sessionStorage.getItem('snowball_controller');}catch{}
  if(!/^ctl_[a-f0-9]{16}$/.test(id))id=fresh();
  if(typeof navigator!=='undefined'&&navigator.locks){
    const acquired=await new Promise((resolve,reject)=>{navigator.locks.request('snowball:'+id,{ifAvailable:true},lock=>{resolve(!!lock);if(lock)return new Promise(release=>window.addEventListener('pagehide',release,{once:true}));}).catch(reject);});
    if(!acquired){id=fresh();void navigator.locks.request('snowball:'+id,()=>new Promise(release=>window.addEventListener('pagehide',release,{once:true})));}
  }else id=fresh();
  try{sessionStorage.setItem('snowball_controller',id);}catch{}return id;
}
const $ = id => typeof document !== 'undefined' ? document.getElementById(id) : null;

// --- Internationalization (i18n) State & Dictionary ---
let currentLanguage = 'en';
try {
  if (typeof location !== 'undefined') {
    if (location.hash === '#ko' || location.hash.startsWith('#ko') || location.hash.includes('lang=ko')) currentLanguage = 'ko';
    else if (location.hash === '#en' || location.hash.startsWith('#en') || location.hash.includes('lang=en')) currentLanguage = 'en';
    else {
      const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('snowball_lang') : null;
      if (stored === 'en' || stored === 'ko') currentLanguage = stored;
    }
  }
} catch {}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (location.hash === '#ko' || location.hash.startsWith('#ko') || location.hash.includes('lang=ko')) setLanguage('ko');
    else if (location.hash === '#en' || location.hash.startsWith('#en') || location.hash.includes('lang=en')) setLanguage('en');
  });
}

const I18N = {
  en: {
    settings_btn: 'Settings',
    settings_title: 'Settings',
    voice_btn: 'Voice',
    voice_btn_title: 'Voice Input',
    send_btn: 'Send',
    send_btn_title: 'Send Command',
    prompt_placeholder: 'Type a message or use voice input... (Enter: Send, Shift+Enter: Newline)',
    wizard_default_title: 'Your Work In One Place',
    settings_modal_title: 'Settings',
    system_settings: 'System Settings',
    setting_autostart: 'Start automatically on OS login',
    setting_tray: 'System tray running state',
    tray_and_notifications: 'Tray Display & Notifications',
    setting_language_label: 'Tray Language',
    setting_notifications: 'OS notifications for approval requests and command errors',
    setting_tray_notice: 'Applied during tray execution. UI language can also be toggled directly from the header.',
    voice_engine_title: 'Voice Engine',
    voice_engine_label: 'Voice recognition engine:',
    voice_engine_webspeech: 'Browser Web Speech (if supported)',
    hardware_title: 'Hardware Devices (MK20)',
    mk20_lan_notice: 'Wi-Fi development connection specifies the device address and network interface directly. Address response does not imply pairing or command authorization.',
    mk20_address_label: 'MK20 Address',
    mk20_interface_label: 'PC Interface',
    mk20_lan_save: 'Verify Wi-Fi Address',
    mk20_lan_remove: 'Remove Wi-Fi Address',
    harness_mgmt_title: 'Harness Management & Wizard',
    btn_rescan_harness: 'Rescan Harnesses',
    btn_rerun_wizard: 'Rerun Setup Wizard',
    footer_notice: 'You can start without devices or voice features. Connections and commands are never executed automatically.'
  },
  ko: {
    settings_btn: '설정',
    settings_title: '설정',
    voice_btn: '음성',
    voice_btn_title: '음성 입력',
    send_btn: '전송',
    send_btn_title: '명령 전송',
    prompt_placeholder: '메시지를 입력하거나 음성으로 말하세요... (Enter: 전송, Shift+Enter: 줄바꿈)',
    wizard_default_title: '내 작업을 한곳에서',
    settings_modal_title: '설정',
    system_settings: '시스템 설정',
    setting_autostart: 'OS 로그인 시 자동 실행',
    setting_tray: '시스템 트레이 실행 상태',
    tray_and_notifications: '트레이 표시 및 알림',
    setting_language_label: '트레이 언어',
    setting_notifications: '새 승인 요청·명령 오류의 OS 알림',
    setting_tray_notice: '트레이 실행 중에 적용됩니다. Web 화면 언어는 헤더에서 전환할 수 있습니다.',
    voice_engine_title: '음성 엔진 (Voice Engine)',
    voice_engine_label: '음성 인식 엔진:',
    voice_engine_webspeech: '브라우저 음성 인식 (지원 시)',
    hardware_title: '하드웨어 장치 (MK20)',
    mk20_lan_notice: 'Wi-Fi 개발 연결은 장치 주소와 이 PC의 네트워크 인터페이스를 직접 지정합니다. 주소 응답은 페어링이나 명령 권한을 뜻하지 않습니다.',
    mk20_address_label: 'MK20 주소',
    mk20_interface_label: 'PC 인터페이스',
    mk20_lan_save: 'Wi-Fi 주소 확인',
    mk20_lan_remove: 'Wi-Fi 주소 제거',
    harness_mgmt_title: 'Harness 관리 & 마법사',
    btn_rescan_harness: 'Harness 다시 찾기',
    btn_rerun_wizard: '초기 설정 마법사 다시 실행',
    footer_notice: '장치와 음성 기능 없이도 시작할 수 있습니다. 연결이나 명령은 자동으로 실행하지 않습니다.'
  }
};

function setLanguage(lang, doRender = true) {
  if (lang !== 'en' && lang !== 'ko') return;
  currentLanguage = lang;
  try { sessionStorage.setItem('snowball_lang', lang); } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.title = lang === 'ko' ? 'Snowball · 로컬 제어' : 'Snowball · Local Control';
    $('lang-btn-en')?.classList.toggle('active', lang === 'en');
    $('lang-btn-ko')?.classList.toggle('active', lang === 'ko');

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k && I18N[lang]?.[k]) el.textContent = I18N[lang][k];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k && I18N[lang]?.[k]) el.placeholder = I18N[lang][k];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      if (k && I18N[lang]?.[k]) el.title = I18N[lang][k];
    });
  }
  if (doRender && typeof render === 'function') render();
}

// --- Core State ---
let viewMode = 'workspace'; // 'workspace' | 'wizard'
let step = 0;
let snapshot;
let operation;
let generation = 0;

// Breadcrumb & Hierarchy State (Host > Harness > Project > Session)
let activeHost = '';
let activeHarness = 'snowball.codex';
let activeProject = '';
let activeSessionKey = null;
const historyByScope = {}; // { [harnessId]: lastProjectId, [projectId]: lastSessionKey }

// Attention & Overview State (Preserved for tests & R-TARGET)
let harnessFilter = 'all';
let workspaceFilter = 'all';
let activeDraft = null; // { destinationKey: string, ownerId: string | null, text: string, readOnly: boolean }
const promptDrafts = new Map();
let promptDestination=null;
function checkpointController() {
  if(!controllerReady)return;
  // Tab memory is synchronous so a quick reload cannot outrun a debounce.
  try{sessionStorage.setItem('snowball_ui:'+webControllerId,JSON.stringify({activeHarness,activeProject,activeSessionKey,viewMode,language:currentLanguage,drafts:[...promptDrafts],execution:[...executionBySession],activeDraft}));}catch{}
  clearTimeout(controllerTimer);
  controllerTimer=setTimeout(()=>{
    const selection={...(activeHarness?{harnessPluginId:activeHarness}:{}),...(activeSessionKey?{sessionKey:activeSessionKey}:{})};
    const preferences={language:currentLanguage,view:viewMode,projectName:activeProject,model:'',effort:'',...(executionBySession.get(activeSessionKey)??{})};
    const draft=activeDraft?.commandId?{destinationKey:activeDraft.destinationKey,text:activeDraft.text}:promptDrafts.get(activeSessionKey)?{destinationKey:activeSessionKey,text:promptDrafts.get(activeSessionKey)}:null;
    const patch={selection,preferences,draft},encoded=JSON.stringify(patch);if(encoded===lastControllerPatch)return;lastControllerPatch=encoded;
    controllerWrites=controllerWrites.then(async()=>{
      // Clearing a previous destination is explicit and only affects this tab.
      if(controllerState.draft&&draft&&controllerState.draft.destinationKey!==draft.destinationKey)controllerState=await client.updateController(controllerState.revision,{draft:null});
      controllerState=await client.updateController(controllerState.revision,patch);
    }).catch(async()=>{lastControllerPatch='';try{controllerState=await client.controller();}catch{};});
  },250);
}
let selectedDevices = new Set();
let devicesInitialized = false;

// Active dropdown popup
let activeDropdown = null; // 'host' | 'harness' | 'project' | 'session' | null

// Voice & Prompt State
let isRecordingVoice = false;
let voiceDraftText = '';
let speechRecognition = null;
let voiceSessionKey = null;

// Session Conversation Store: { [sessionKey]: Array<{ role: 'user'|'agent', text: string, time: string, status?: string }> }
const sessionTurns = {};
const executionBySession = new Map();
const modelCatalogs = new Map();
let creatingSession = false;

function openNewSession() {
  const bindings = (snapshot?.connectedHarnesses ?? []).filter(h => h.pluginId === activeHarness && h.canCreate && h.connected && !h.disabled);
  if (!bindings.length || creatingSession) return;
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const dialog = node('dialog');
  const instance=node('select');instance.setAttribute('aria-label', isEn ? 'Harness Instance' : 'Harness 인스턴스');
  if(bindings.length>1){const choice=node('option', isEn ? 'Select an instance to execute' : '실행할 인스턴스를 선택하세요');choice.value='';instance.append(choice);}
  for(const binding of bindings){const choice=node('option',binding.pluginId+' / '+binding.instanceId);choice.value=binding.instanceId;instance.append(choice);}
  const workspace = node('select'); workspace.setAttribute('aria-label', isEn ? 'Workspace Folder' : '작업 폴더');
  const fillWorkspaces = () => {
    const preferred = workspace.value || activeProject;
    workspace.replaceChildren();
    for (const w of snapshot?.workspaceDetails ?? []) if (['ready', 'empty'].includes(w.status)) {
      const option = node('option', w.displayName); option.value = w.workspaceId; workspace.append(option);
    }
    if ([...workspace.options].some(option => option.value === preferred)) workspace.value = preferred;
  };
  fillWorkspaces();
  const title = node('input'); title.setAttribute('aria-label', isEn ? 'Task Name' : '작업 이름'); title.maxLength = 128;
  const message = node('p', isEn ? 'Creates a new Harness task in the registered local folder.' : '등록한 로컬 폴더에서 새 Harness 작업을 생성합니다.');
  const pendingKey = `snowball.create.pending.v1.${activeHarness}`;
  let pending;
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
    if (saved && /^[0-9a-f-]{36}$/.test(saved.requestId) && saved.input?.pluginId === activeHarness && typeof saved.input.instanceId === 'string' && typeof saved.input.workspaceId === 'string') pending = saved;
  } catch { /* A private browser mode may disable session storage; the visible ID still survives this dialog. */ }
  let createRequestId = pending?.requestId ?? crypto.randomUUID();
  if (pending) {
    if (bindings.some(h => h.instanceId === pending.input.instanceId)) instance.value = pending.input.instanceId;
    if ([...workspace.options].some(w => w.value === pending.input.workspaceId)) workspace.value = pending.input.workspaceId;
    title.value = pending.input.title ?? '';
    message.textContent = isEn
      ? `Check previous creation request ${createRequestId} result first. Retries only use the same request ID.`
      : `이전 생성 요청 ${createRequestId}의 결과를 먼저 확인하세요. 재시도는 같은 요청 ID만 사용합니다.`;
  }
  const close = () => { dialog.close(); dialog.remove(); };
  const choose = button(isEn ? 'Add Folder' : '폴더 추가', async () => {
    choose.disabled = true;
    try { await client.selectWorkspace(); snapshot = await client.snapshot(); fillWorkspaces(); }
    catch (error) { message.textContent = error.message; }
    finally { choose.disabled = false; }
  }, true);
  choose.disabled = !snapshot?.workspaceSelectionAvailable;
  const create = button(isEn ? 'Create Task' : '작업 생성', async () => {
    if (!workspace.value || creatingSession) return;
    const binding=bindings.find(h=>h.instanceId===instance.value);
    if(!binding){message.textContent = isEn ? 'Select a Harness instance to execute.' : '실행할 Harness 인스턴스를 선택하세요.';return;}
    const input = { requestId: createRequestId, pluginId: binding.pluginId, instanceId: binding.instanceId, workspaceId: workspace.value, ...(title.value.trim() ? { title: title.value.trim() } : {}) };
    if (pending && JSON.stringify(input) !== JSON.stringify(pending.input)) {
      message.textContent = isEn
        ? `Input for previous request ${createRequestId} changed. Check that task or explicitly start a new attempt.`
        : `이전 요청 ${createRequestId}의 입력이 변경되었습니다. 먼저 해당 작업을 확인하거나 새 요청 시작을 명시적으로 선택하세요.`;
      return;
    }
    pending = {requestId:createRequestId,input};
    try { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); } catch { /* Current dialog still retains the request ID. */ }
    creatingSession = true; create.disabled = true;
    try {
      const result = await client.createSession(input);
      snapshot = result.snapshot;
      const created = snapshot.sessionDetails.find(s => s.sessionKey === result.sessionKey);
      activeHarness = binding.pluginId; activeProject = created.workspaceId || created.cwd; activeSessionKey = created.sessionKey;
      historyByScope[activeHarness] = activeProject; historyByScope[activeProject] = activeSessionKey;
      try { sessionStorage.removeItem(pendingKey); } catch {}
      activeDropdown = null; close(); render();
    } catch (error) {
      const receipt = await client.createStatus(createRequestId).catch(() => null);
      message.textContent = receipt?.status === 'unconfirmed'
        ? (isEn
            ? `Creation result is unconfirmed. Same request will not re-run. Request ID: ${createRequestId}. Check Harness tasks and attach directly if created.`
            : `생성 결과가 불확실합니다. 같은 요청은 다시 실행되지 않습니다. 요청 ID: ${createRequestId}. Harness 작업 목록을 확인하고 생성된 작업이 있다면 직접 연결하세요.`)
        : (isEn
            ? `Could not confirm creation: ${error.message}. Request ID: ${createRequestId}. Recheck using only this request ID.`
            : `생성을 확인하지 못했습니다: ${error.message}. 요청 ID: ${createRequestId}. 상태 조회가 실패해도 이 요청 ID로만 재확인하세요.`);
    }
    finally { creatingSession = false; create.disabled = false; }
  });
  const newAttempt = button(isEn ? 'Start New Attempt' : '새 요청 시작', () => {
    if (!pending || creatingSession) return;
    try { sessionStorage.removeItem(pendingKey); } catch {}
    pending = undefined; createRequestId = crypto.randomUUID(); newAttempt.disabled = true;
    message.textContent = isEn
      ? 'Previous task may have been created. Check task list before starting a new request.'
      : '이전 작업이 생성됐을 수 있습니다. 작업 목록을 확인한 뒤 새 요청을 시작하세요.';
  }, true);
  newAttempt.disabled = !pending;
  dialog.append(
    node('h2', isEn ? 'New Task' : '새 작업'),
    node('label', isEn ? 'Harness Instance' : 'Harness 인스턴스'), instance,
    node('label', isEn ? 'Workspace Folder' : '작업 폴더'), workspace, choose,
    node('label', isEn ? 'Task Name (Optional)' : '작업 이름 (선택)'), title,
    message, create, newAttempt,
    button(isEn ? 'Close' : '닫기', close, true)
  );
  dialog.addEventListener('cancel', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}

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

const connectionNotices = {
  selection_cancelled: {
    ko: '연결 선택을 취소했습니다. 기존 작업과 설정은 유지됩니다.',
    en: 'Connection selection cancelled. Existing tasks and settings are preserved.'
  },
  connection_failed: {
    ko: '연결을 완료하지 못했습니다. Codex 버전·로그인·선택 경로를 확인하고 다시 시도하세요.',
    en: 'Could not complete connection. Check Codex version, login, selected path and retry.'
  },
  connection_busy: {
    ko: '다른 연결 작업이 진행 중입니다. 완료 후 다시 시도하세요.',
    en: 'Another connection operation is in progress. Retry after completion.'
  },
  connection_limit: {
    ko: 'Codex 연결은 최대 8개입니다. 사용하지 않는 연결을 해제하세요.',
    en: 'Maximum of 8 Codex connections. Disconnect unused connections.'
  },
  already_connected: {
    ko: '이미 저장된 Codex 연결입니다. 연결 목록을 확인하세요.',
    en: 'Codex connection already saved. Check connection list.'
  },
  connection_missing: {
    ko: '해당 연결이 이미 제거됐습니다. 목록을 새로고침하세요.',
    en: 'Connection already removed. Refresh the list.'
  },
  native_connection_unavailable: {
    ko: '현재 실행 방식은 네이티브 Codex 연결 선택을 지원하지 않습니다.',
    en: 'Current runtime mode does not support native Codex connection picker.'
  },
};

async function run(action) {
  cancel();
  const current = generation;
  operation = new AbortController();
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const noticeEl = $('notice');
  if (noticeEl) noticeEl.textContent = isEn ? 'Checking on this computer…' : '이 컴퓨터에서 확인 중…';
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
      const codeObj = connectionNotices[error.code];
      const codeMsg = codeObj ? (isEn ? codeObj.en : codeObj.ko) : null;
      noticeEl.textContent = error.status === 401
        ? (isEn ? 'Connection code expired or session ended. Get a new code from the local launcher.' : '연결 코드가 만료되었거나 세션이 종료되었습니다. 로컬 실행기에서 새 코드를 받아 주세요.')
        : (codeMsg || error.message || (isEn ? 'Could not complete verification.' : '확인을 완료하지 못했습니다.'));
    }
  } finally {
    if (current === generation) operation = undefined;
  }
}

// --- Data Helpers ---
function getAvailableHarnesses() {
  const found = (snapshot?.harness?.candidates ?? []).map(c => ({
    ...c,
    displayName: c.displayName || (c.providerId ? c.providerId.replace('snowball.', '').toUpperCase() : c.id)
  }));
  for (const h of snapshot?.connectedHarnesses ?? []) {
    if (!found.some(c => (c.providerId || c.id) === h.pluginId)) {
      found.push({ id: h.pluginId, providerId: h.pluginId, displayName: h.pluginId.replace('snowball.', '').toUpperCase() });
    }
  }
  if (snapshot?.realSessions) {
    for (const pId of Object.keys(snapshot.realSessions)) {
      if (!found.some(c => (c.providerId || c.id) === pId)) {
        found.push({ id: pId, providerId: pId, displayName: pId.replace('snowball.', '').toUpperCase() });
      }
    }
  }
  return found;
}

function getProjectsForHarness(harnessPluginId) {
  // Registered local workspaces are project destinations independent of the
  // harness. A provider candidate is only observation and grants no file access.
  const found = (snapshot?.workspaceDetails ?? []).map(w => ({ id: w.workspaceId, displayName: w.displayName, status: w.status, local: true }));
  for (const candidate of snapshot?.workspaceCandidates ?? []) {
    if (candidate.harness?.pluginId !== harnessPluginId ||
      (candidate.workspaceId && found.some(p => p.id === candidate.workspaceId)) ||
      found.some(p => p.id === candidate.root)) continue;
    found.push({ ...candidate, id: candidate.root,
      displayName: found.some(p => p.displayName === candidate.displayName)
        ? `${candidate.displayName} · 발견됨` : candidate.displayName });
  }
  for (const s of snapshot?.sessionDetails ?? []) if (s.harnessPluginId === harnessPluginId && s.cwd && !found.some(p => p.id === (s.workspaceId || s.cwd))) found.push({ id: s.cwd, displayName: s.cwd });
  if (snapshot?.realSessions?.[harnessPluginId]) {
    for (const projKey of Object.keys(snapshot.realSessions[harnessPluginId])) {
      const match = found.find(p => p.displayName === projKey || p.id === projKey);
      if (!match) {
        found.push({ id: projKey, displayName: projKey, status: 'ready', local: true });
      }
    }
  }
  return found;
}

function getSessionsForProject(harnessPluginId, projectId) {
  const ws = (snapshot?.workspaceDetails ?? []).find(w => w.workspaceId === projectId);
  const targetKey = ws ? ws.displayName : projectId;
  const observed = snapshot?.realSessions?.[harnessPluginId]?.[targetKey];
  if (Array.isArray(observed)) {
    return observed.map(s => {
      const journalSession = (snapshot?.sessions ?? []).find(j => j.sessionKey === s.sessionKey);
      return {
        ...s,
        harnessPluginId: s.harnessPluginId || harnessPluginId,
        harnessInstanceId: s.harnessInstanceId || 'default',
        workspaceId: projectId,
        ownerId: journalSession?.ownerId ?? null,
        readOnly: journalSession ? false : true,
        revision: journalSession?.revision ?? 0
      };
    });
  }
  return (snapshot?.sessionDetails ?? []).filter(s => s.harnessPluginId === harnessPluginId && (s.workspaceId || s.cwd) === projectId).map(s => ({ ...s, ...((snapshot?.sessions ?? []).find(j => j.sessionKey === s.sessionKey) ?? {}) }));
}

function projectDisplayName(projectId) {
  return getProjectsForHarness(activeHarness).find(p => p.id === projectId)?.displayName || projectId;
}

function getOverviewRows(state) {
  const details = state?.sessionDetails ?? [];
  return (state?.workspaceDetails ?? []).map(workspace => {
    let sessions = details.filter(s => s.workspaceId === workspace.workspaceId);
    let realCount = 0;
    const harnessesSet = new Set(sessions.map(s => s.harnessPluginId));
    if (state?.realSessions) {
      for (const [hId, pMap] of Object.entries(state.realSessions)) {
        const sList = pMap[workspace.displayName] || pMap[workspace.workspaceId];
        if (Array.isArray(sList) && sList.length > 0) {
          realCount += sList.length;
          harnessesSet.add(hId);
        }
      }
    }
    const totalSessions = sessions.length > 0 ? sessions.length : realCount;
    return {
      workspaceId: workspace.workspaceId,
      displayName: workspace.displayName,
      status: workspace.status,
      sessions: totalSessions,
      harnesses: [...harnessesSet],
      readOnly: sessions.filter(s => s.readOnly || !s.ownerId).length
    };
  });
}

function workspaceStatusLabel(status) {
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  if (isEn) {
    return ({ ready: 'Ready', empty: 'Empty Folder', missing: 'Missing',
      needs_permission: 'Permission Needed', needs_review: 'Review Needed', unavailable: 'Unavailable' })[status] || 'Unknown';
  }
  return ({ ready: '사용 가능', empty: '빈 폴더', missing: '찾을 수 없음',
    needs_permission: '권한 필요', needs_review: '검토 필요', unavailable: '사용 불가' })[status] || '상태 미확인';
}

function renderOverview() {
  const root = $('overview-container');
  if (!root) return;
  root.replaceChildren();
  const rows = getOverviewRows(snapshot);
  const connected = (snapshot?.connectedHarnesses ?? []).filter(h => h.connected && !h.disabled);
  const readyDevices = (snapshot?.devices ?? []).filter(d => d.state === 'ready');
  const pending = (snapshot?.decisions ?? []).filter(d => d.status === 'pending');
  const uncertain = (snapshot?.commands ?? []).filter(c => c.status === 'unknown' || c.status === 'failed');
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const heading = node('div'); heading.className = 'overview-heading';
  const title = node('h2', isEn ? 'Workspaces Overview' : '전체 작업 현황');
  const counts = node('p', isEn
    ? `Projects ${rows.length} · Connected Harnesses ${connected.length} · Control Devices ${readyDevices.length} · Attention ${pending.length + uncertain.length}`
    : `프로젝트 ${rows.length} · 연결된 Harness ${connected.length} · 제어 장치 ${readyDevices.length} · 주의 ${pending.length + uncertain.length}`);
  heading.append(title, counts); root.append(heading);
  const grid = node('div'); grid.className = 'overview-projects';
  if (!rows.length) grid.append(node('p', isEn ? 'No registered projects. You can add workspace folders in Settings.' : '등록된 프로젝트가 없습니다. 설정에서 작업 폴더를 추가할 수 있습니다.'));
  for (const row of rows) {
    const card = node('button'); card.type = 'button';
    card.className = `overview-project ${row.workspaceId === activeProject ? 'selected' : ''}`;
    const cardStatus = isEn
      ? `Folder ${workspaceStatusLabel(row.status)} · ${row.sessions} sessions · ${row.readOnly} read-only`
      : `폴더 ${workspaceStatusLabel(row.status)} · 세션 ${row.sessions}개 · 조회 전용 ${row.readOnly}개`;
    const cardHarnesses = row.harnesses.length
      ? `Harness: ${row.harnesses.map(id => id.replace('snowball.', '')).join(', ')}`
      : (isEn ? 'No observed harness sessions' : '관찰된 Harness 세션 없음');
    card.append(node('strong', row.displayName),
      node('span', cardStatus),
      node('span', cardHarnesses));
    card.addEventListener('click', () => {
      const first = (snapshot?.sessionDetails ?? []).find(s => s.workspaceId === row.workspaceId);
      if (first) activeHarness = first.harnessPluginId;
      activeProject = row.workspaceId; historyByScope[activeHarness] = activeProject;
      if (first) activeSessionKey = first.sessionKey;
      activeDropdown = null; render();
    });
    grid.append(card);
  }
  root.append(grid);
  if (pending.length || uncertain.length) {
    const attention = node('div'); attention.className = 'overview-attention';
    attention.append(node('strong', isEn ? `Total Attention Items ${pending.length + uncertain.length}` : `전체 주의 항목 ${pending.length + uncertain.length}건`));
    const pendingLabel = isEn ? 'Pending Approval' : '승인 대기';
    const unknownLabel = isEn ? 'Delivery Check' : '전달 상태 확인';
    const errorLabel = isEn ? 'Command Error' : '명령 오류';
    for (const item of [...pending.map(d => ({ sessionKey: d.sessionKey, label: pendingLabel })),
      ...uncertain.map(c => ({ sessionKey: c.sessionKey, label: c.status === 'unknown' ? unknownLabel : errorLabel }))].slice(0, 8)) {
      const session = (snapshot?.sessionDetails ?? []).find(s => s.sessionKey === item.sessionKey);
      const label = `${item.label} · ${session?.title || item.sessionKey}`;
      if (!session || !(session.workspaceId || session.cwd)) { attention.append(node('p', label)); continue; }
      const jump = node('button', label); jump.type = 'button'; jump.className = 'secondary';
      jump.addEventListener('click', () => {
        activeHarness = session.harnessPluginId; activeProject = session.workspaceId || session.cwd;
        activeSessionKey = session.sessionKey; historyByScope[activeHarness] = activeProject;
        historyByScope[activeProject] = activeSessionKey; activeDropdown = null; render();
      });
      attention.append(jump);
    }
    root.append(attention);
  }
}

// Ensure valid active hierarchy
function ensureHierarchy() {
  if (snapshot?.hostname) activeHost = snapshot.hostname;
  const harnesses = getAvailableHarnesses();
  if (!harnesses.some(h => h.providerId === activeHarness || h.id === activeHarness)) {
    activeHarness = harnesses[0]?.providerId || '';
  }

  const projects = getProjectsForHarness(activeHarness);
  const lastProject = historyByScope[activeHarness];
  if (lastProject && projects.some(p => p.id === lastProject)) {
    activeProject = lastProject;
  } else if (!projects.some(p => p.id === activeProject)) {
    activeProject = projects[0]?.id || '';
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
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';

  // 1. Host Segment
  const hostItem = node('div');
  hostItem.className = 'breadcrumb-item';
  const hostLabel = activeHost || (isEn ? 'This Computer' : '이 컴퓨터');
  const hostBtn = node('button', `🖥️ ${hostLabel} `);
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
    const header = node('div', isEn ? 'Select Host' : '호스트 선택');
    header.className = 'dropdown-header';
    menu.append(header);

    const item = node('button', `🖥️ ${hostLabel}`);
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
    const header = node('div', isEn ? 'Select Harness' : 'Harness 선택');
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
  const projectBtn = node('button', `📁 ${projectDisplayName(activeProject)} `);
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
    const header = node('div', isEn ? `${curHarnessName} Project Selection` : `${curHarnessName} 프로젝트 선택`);
    header.className = 'dropdown-header';
    menu.append(header);

    const projects = getProjectsForHarness(activeHarness);
    for (const p of projects) {
      const isSel = p.id === activeProject;
      const item = node('button', `📁 ${p.displayName}`);
      item.className = `dropdown-item ${isSel ? 'selected' : ''}`;
      item.addEventListener('click', () => {
        activeProject = p.id;
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
  const curSessionTitle = curSession?.title || curSession?.sessionKey?.split('/').pop() || (isEn ? 'No connected session' : '연결된 세션 없음');

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
    const header = node('div', isEn ? `${projectDisplayName(activeProject)} Session Selection` : `${projectDisplayName(activeProject)} 세션 선택`);
    header.className = 'dropdown-header';
    menu.append(header);

    for (const s of sessions) {
      const isSel = s.sessionKey === activeSessionKey;
      const sTitle = s.title || s.sessionKey.split('/').pop() || s.sessionKey;
      const observedLabel = isEn ? 'Observed History' : '관찰 기록';
      const item = node('button', `💬 ${sTitle} · ${s.harnessInstanceId ?? observedLabel}`);
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
    const newItem = node('button', isEn ? '+ Start New Session' : '+ 새 세션 시작');
    newItem.className = 'dropdown-item';
    newItem.style.color = 'var(--accent-green)';
    newItem.disabled = !snapshot?.connectedHarnesses?.some(h => h.pluginId === activeHarness && h.canCreate && h.connected && !h.disabled);
    newItem.title = newItem.disabled
      ? (isEn ? 'Connect a harness that supports task creation' : '작업 생성을 지원하는 Harness를 연결하세요')
      : (isEn ? 'Create a real harness task in registered workspace folder' : '등록한 작업 폴더에 실제 Harness 작업 생성');
    newItem.onclick = openNewSession;
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
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  if (isRecordingVoice && voiceSessionKey !== activeSessionKey) {
    speechRecognition?.abort(); speechRecognition = null; isRecordingVoice = false; voiceDraftText = '';
    const banner = $('voice-draft-banner'); if (banner) banner.hidden = true;
  }
  const sessions = getSessionsForProject(activeHarness, activeProject);
  const curSession = sessions.find(s => s.sessionKey === activeSessionKey) || sessions[0];
  if (!curSession) {
    $('session-header')?.replaceChildren(node('p', isEn ? 'No connected harness task. Discovered state does not grant control.' : '연결된 하네스 작업이 없습니다. 탐색 결과는 제어 연결을 의미하지 않습니다.'));
    $('session-messages')?.replaceChildren();
    const send = $('btn-send'); if (send) { send.disabled = true; send.onclick = null; }
    const input = $('prompt-input'); if (input) input.onkeydown = null;
    const voice = $('btn-voice'); if (voice) { voice.disabled = true; voice.onclick = null; }
    return;
  }

  const curHarnessName = activeHarness.replace('snowball.', '').toUpperCase();
  const liveBinding = snapshot?.connectedHarnesses?.find(h => h.pluginId === curSession.harnessPluginId && h.instanceId === curSession.harnessInstanceId);
  const isOwned = (liveBinding ? liveBinding.connected === true && !liveBinding.disabled : true) && curSession.readOnly === false;

  // 1. Session Header
  const headerEl = $('session-header');
  if (headerEl) {
    headerEl.replaceChildren();
    const left = node('div');
    left.className = 'session-title-group';
    const h2 = node('h2', curSession.title || projectDisplayName(activeProject));
    const hBadge = node('span', curHarnessName+' / '+curSession.harnessInstanceId);
    hBadge.className = 'badge';
    const pBadge = node('span', projectDisplayName(activeProject));
    pBadge.className = 'badge badge-neutral';
    const statusText = isOwned
      ? (isEn ? 'Active Control' : '활성 제어')
      : liveBinding && !liveBinding.connected
        ? (isEn ? 'Disconnected' : '연결 끊김')
        : (isEn ? 'Read Only' : '조회 전용');
    const statusBadge = node('span', statusText);
    statusBadge.className = isOwned ? 'badge' : 'badge badge-gold';
    left.append(h2, hBadge, pBadge, statusBadge);

    const right = node('div');
    right.className = 'session-meta-details';
    const ownerLabel = curSession.ownerId || (isEn ? 'system' : '시스템');
    right.textContent = isEn
      ? `Session: ${curSession.sessionKey} · Owner: ${ownerLabel}`
      : `세션: ${curSession.sessionKey} · 소유자: ${ownerLabel}`;
    headerEl.append(left, right);
    if (liveBinding?.sessionListTruncated) headerEl.append(node('p', isEn ? 'Showing partial session history. View full history in native app.' : '세션 목록 일부만 표시됩니다. 네이티브 앱에서 전체 기록을 확인할 수 있습니다.'));
    const binding = snapshot?.connectedHarnesses?.find(h => h.pluginId === curSession.harnessPluginId && h.instanceId === curSession.harnessInstanceId && h.connected && !h.disabled);
    if (!isOwned && binding?.canAttach) headerEl.append(button(isEn ? 'Attach Session' : '이 세션 연결', () => void run(signal => client.attachSession(curSession.sessionKey, signal))));
    if (binding?.canListModels) {
      const catalogKey = JSON.stringify([binding.pluginId, binding.instanceId]);
      headerEl.append(button(isEn ? 'Refresh Models' : '모델 목록 갱신', () => void run(async signal => {
        const result = await client.models(binding.pluginId, binding.instanceId, signal);
        modelCatalogs.set(catalogKey, result.models); return client.snapshot(signal);
      }), true));
      const models = modelCatalogs.get(catalogKey) ?? [];
      const chosen = executionBySession.get(curSession.sessionKey) ?? {};
      const selected = models.find(m => m.model === chosen.model);
      if (selected && chosen.effort && !selected.efforts.includes(chosen.effort)) { delete chosen.effort; executionBySession.set(curSession.sessionKey, chosen); }
      if (modelCatalogs.has(catalogKey) && chosen.model && !selected) executionBySession.delete(curSession.sessionKey);
      const modelSelect = node('select'); modelSelect.setAttribute('aria-label', isEn ? 'Model' : '모델');
      const defaultOption = node('option', isEn ? 'Harness Default Model' : 'Harness 기본 모델'); defaultOption.value = ''; modelSelect.append(defaultOption);
      for (const m of models) { const option = node('option', m.displayName); option.value = m.model; modelSelect.append(option); }
      modelSelect.value = selected?.model ?? ''; modelSelect.disabled = !models.length;
      modelSelect.onchange = () => { executionBySession.set(curSession.sessionKey, modelSelect.value ? { model: modelSelect.value } : {}); renderWorkspace(); };
      const effortSelect = node('select'); effortSelect.setAttribute('aria-label', isEn ? 'Reasoning Effort' : '추론 강도');
      const effortDefault = node('option', isEn ? 'Harness Default Effort' : 'Harness 기본 effort'); effortDefault.value = ''; effortSelect.append(effortDefault);
      for (const effort of selected?.efforts ?? []) { const option = node('option', effort); option.value = effort; effortSelect.append(option); }
      effortSelect.value = selected?.efforts.includes(chosen.effort) ? chosen.effort : ''; effortSelect.disabled = !selected;
      effortSelect.onchange = () => { executionBySession.set(curSession.sessionKey, { model: selected.model, ...(effortSelect.value ? { effort: effortSelect.value } : {}) }); };
      headerEl.append(modelSelect, effortSelect);
    }
  }

  // 2. Attention / Decisions / In-doubt Commands
  const commands = snapshot?.commands ?? [];
  const decisions = snapshot?.decisions ?? [];
  const pendingDecisions = decisions.filter(d => d.status === 'pending' && d.sessionKey === curSession.sessionKey);
  const inDoubtCommands = commands.filter(c => c.sessionKey === curSession.sessionKey && (c.status === 'unknown' || c.status === 'failed'));

  const attentionEl = $('attention-container');
  if (attentionEl) {
    attentionEl.replaceChildren();
    if (pendingDecisions.length > 0 || inDoubtCommands.length > 0) {
      const banner = node('div');
      banner.className = 'attention-banner';
      const text = node('p', isEn
        ? `⚠️ ATTENTION · ${pendingDecisions.length} Pending Approval / ${inDoubtCommands.length} In-Doubt Commands`
        : `⚠️ ATTENTION · 승인 대기 ${pendingDecisions.length}건 / 상태 확인 ${inDoubtCommands.length}건`);
      const actions = node('div');
      actions.className = 'attention-actions';

      for (const d of pendingDecisions) {
        const decisionLabel=node('p', (isEn ? 'Approval request for selected task · ' : '선택된 작업의 승인 요청 · ') + d.decisionId);
        actions.append(decisionLabel);
        for(const answer of d.allowedAnswers ?? []) {
          const label= isEn
            ? ({accept:'Accept',decline:'Decline',cancel:'Cancel'}[answer])
            : ({accept:'승인',decline:'거부',cancel:'취소'}[answer]);
          if(!label)continue;
          const action=button(label,()=>void run(async signal=>{
            await client.submit({commandId:'cmd_dec_'+crypto.randomUUID(),sessionKey:d.sessionKey,ownerId:d.ownerId,
              operation:'decisions.resolve',payload:{answer},expectedRevision:snapshot.sessions.find(s=>s.sessionKey===d.sessionKey)?.revision,
              decision:{decisionId:d.decisionId,expectedRevision:d.revision}},signal);
            return client.snapshot(signal);
          }),answer!=='accept');
          action.disabled=!isOwned||d.ownerId!==curSession.ownerId;actions.append(action);
        }
      }
      banner.append(text, actions);
      attentionEl.append(banner);
    }
  }

  // 3. Session Messages / Turns
  const messagesEl = $('session-messages');
  if (messagesEl) {
    messagesEl.replaceChildren();
    const truncatedPrefix = isEn ? '[Earlier content truncated] ' : '[이전 내용 생략] ';
    const turns = [...(snapshot?.turnsStore?.[curSession.sessionKey] ?? sessionTurns[curSession.sessionKey] ?? []), ...(snapshot?.sessionMessages?.[curSession.sessionKey] ?? []).map(m => ({ ...m, text: (m.truncated ? truncatedPrefix : '') + m.text, time: new Date(m.receivedAt).toLocaleTimeString() }))];

    if (turns.length === 0) {
      const empty = node('div');
      empty.className = 'message-empty-state';
      empty.replaceChildren(
        node('div', '💬', 'icon'),
        node('strong', curSession.title || (isEn ? 'Selected Session' : '선택된 세션')),
        node('p', isEn ? 'Confirmed conversation and command history will appear here.' : '확인된 대화 및 명령 내역이 여기에 표시됩니다.')
      );
      messagesEl.append(empty);
    } else {
      for (const turn of turns) {
        const bubble = node('div');
        bubble.className = `message-bubble ${turn.role}`;
        
        const meta = node('div');
        meta.className = 'message-meta';
        const roleLabel = turn.role === 'user'
          ? (isEn ? '👤 User' : '👤 사용자')
          : turn.role === 'system'
            ? (isEn ? 'Snowball Status' : 'Snowball 상태')
            : `⚡ ${curHarnessName}`;
        meta.replaceChildren(node('span', roleLabel), node('span', turn.time || ''));
        
        const content = node('div');
        content.className = 'message-text';
        content.textContent = turn.text;

        bubble.append(meta, content);
        messagesEl.append(bubble);
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    for (const command of commands.filter(c => c.sessionKey === curSession.sessionKey).slice(-8)) {
      messagesEl.append(node('p', `${command.operation} · ${command.status} · ${command.commandId}`));
    }
  }

  // 4. Prompt & Voice Input Handlers
  const sendBtn = $('btn-send');
  const promptInput = $('prompt-input');
  const voiceBtn = $('btn-voice');
  const voiceBanner = $('voice-draft-banner');

  if (sendBtn && promptInput) {
    if(promptDestination!==curSession.sessionKey){
      if(promptDestination)promptDrafts.set(promptDestination,promptInput.value);
      promptDestination=curSession.sessionKey;promptInput.value=promptDrafts.get(promptDestination)??'';
    }
    promptInput.oninput=()=>{promptDrafts.set(curSession.sessionKey,promptInput.value);checkpointController();};
    sendBtn.disabled = !isOwned;
    sendBtn.title = isOwned
      ? (isEn ? 'Send Command' : '명령 전송')
      : (isEn ? 'Read-only session' : '조회 전용 세션입니다');
    sendBtn.textContent = (isEn ? 'Send' : '전송') + ' ↵';
    promptInput.placeholder = isEn
      ? 'Type a message or use voice input... (Enter: Send, Shift+Enter: Newline)'
      : '메시지를 입력하거나 음성으로 말하세요... (Enter: 전송, Shift+Enter: 줄바꿈)';

    const handleSend = () => {
      const text = promptInput.value.trim();
      if (!text || !isOwned || activeDraft?.commandId) return;

      // R-TARGET: 명령 작성 중 · 고정 대상 (Target invariance preserved)
      activeDraft = {
        destinationKey: curSession.sessionKey,
        ownerId: curSession.ownerId,
        text,
        readOnly: !isOwned
      };
      const execution = structuredClone(executionBySession.get(curSession.sessionKey) ?? {});
      const draft = activeDraft;
      const commandId='cmd_send_'+crypto.randomUUID();draft.commandId=commandId;

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (!sessionTurns[curSession.sessionKey]) sessionTurns[curSession.sessionKey] = [];
      sessionTurns[curSession.sessionKey].push({ role: 'user', text, time: nowTime });

      promptInput.value = '';
      promptDrafts.delete(curSession.sessionKey);checkpointController();
      renderWorkspace();

      void run(async signal => {
        try {
          await client.submit({
            commandId,
            sessionKey: curSession.sessionKey,
            ownerId: draft.ownerId || curSession.ownerId || 'user',
            operation: 'sessions.send',
            payload: { text, ...execution },
            expectedRevision: curSession.revision ?? 0,
          }, signal);

          if(activeDraft===draft)activeDraft = null;
          checkpointController();
          renderWorkspace();
          checkpointController();
        } catch (err) {
          const failMsg = isEn
            ? `Could not verify delivery: ${err.message}. Will not retry automatically. Command ID: ${commandId}`
            : `전송 결과를 확인하지 못했습니다: ${err.message}. 자동 재전송하지 않습니다. 명령 ID: ${commandId}`;
          sessionTurns[curSession.sessionKey].push({
            role: 'system',
            text: failMsg,
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
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceBtn.disabled = !isOwned || !SpeechRec;
    voiceBtn.title = SpeechRec
      ? (isEn ? 'Browser Web Speech (may use network depending on browser)' : '브라우저 음성 인식 사용 (브라우저에 따라 네트워크 이용)')
      : (isEn ? 'This browser does not support voice recognition' : '이 브라우저는 음성 인식을 지원하지 않습니다');
    voiceBtn.textContent = '🎙️ ' + (isEn ? 'Voice' : '음성');
    voiceBtn.onclick = () => {
      voiceSessionKey = curSession.sessionKey;
      isRecordingVoice = !isRecordingVoice;
      if (isRecordingVoice) {
        voiceBtn.className = 'secondary voice-btn recording';
        voiceBtn.textContent = isEn ? '⏹️ Stop' : '⏹️ 중지';
        voiceBanner.hidden = false;
        voiceBanner.replaceChildren(
          node('span', '', 'voice-pulse'),
          node('span', isEn ? 'Listening... Speak now' : '음성을 듣고 있습니다... 말씀하세요')
        );

        if (SpeechRec) {
          try {
            speechRecognition = new SpeechRec();
            speechRecognition.continuous = true;
            speechRecognition.interimResults = true;
            speechRecognition.lang = isEn ? 'en-US' : 'ko-KR';
            speechRecognition.onresult = event => {
              if (voiceSessionKey !== activeSessionKey || !isRecordingVoice) return;
              let transcript = '';
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                transcript += event.results[i][0].transcript;
              }
              voiceDraftText = transcript;
              voiceBanner.replaceChildren(node('span', transcript || (isEn ? 'Transcribing voice...' : '음성 인식 중...')));
            };
            speechRecognition.onerror = () => {
              isRecordingVoice = false; voiceDraftText = '';
              voiceBanner.replaceChildren(node('span', isEn ? 'Could not complete voice recognition.' : '음성 인식을 완료하지 못했습니다.'));
              voiceBtn.textContent = '🎙️ ' + (isEn ? 'Voice' : '음성');
            };
            speechRecognition.start();
          } catch {
            isRecordingVoice = false;
            voiceBanner.replaceChildren(node('span', isEn ? 'Could not start voice recognition.' : '음성 인식을 시작하지 못했습니다.'));
          }
        } else {
          isRecordingVoice = false;
          voiceBanner.replaceChildren(node('span', isEn ? 'Voice recognition not supported. Please type as text.' : '음성 인식 기능이 없습니다. 텍스트로 입력해 주세요.'));
        }
      } else {
        voiceBtn.className = 'secondary voice-btn';
        voiceBtn.textContent = '🎙️ ' + (isEn ? 'Voice' : '음성');
        voiceBanner.hidden = true;
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
  checkpointController();
}

// --- Settings Modal ---
function renderDeviceStatus() {
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const candidates = snapshot?.deviceCandidates ?? [];
  const devices = snapshot?.devices ?? [];
  const sources = snapshot?.deviceSources ?? [];
  const qmk = candidates.some(c => c.source?.instanceId === 'windows-qmk-hid');
  const cdc = candidates.some(c => c.source?.instanceId === 'windows-product-cdc');
  const lan = candidates.some(c => c.source?.instanceId === 'mk20-lan-lab');
  const mk20Ready = devices.some(d => (d.source?.pluginId === 'snowball.device-mk20' || d.source?.pluginId === 'plugin.mk20' || d.label?.includes('MK20')) && d.state === 'ready');
  const badge = $('device-badge');
  if (badge) {
    if (isEn) {
      badge.textContent = mk20Ready ? 'MK20 Connected'
        : lan && qmk ? 'MK20 Wi-Fi Responding · Key USB Detected · Control Not Connected'
        : lan ? 'MK20 Wi-Fi Address Responding · Control Not Connected'
        : qmk && cdc ? 'MK20 Dual USB Detected · Control Not Connected'
        : qmk ? 'MK20 Key USB Detected · Main USB (CDC) Not Detected'
        : cdc ? 'MK20 Main USB Detected · Control Not Connected'
        : !sources.length ? 'MK20 Discovery Not Configured'
        : sources.some(s => s.status === 'failed') ? 'MK20 Discovery Failed'
        : 'MK20 USB Not Detected';
    } else {
      badge.textContent = mk20Ready ? 'MK20 제어 연결됨'
        : lan && qmk ? 'MK20 Wi-Fi 응답 · 키 USB 감지 · 제어 미연결'
        : lan ? 'MK20 Wi-Fi 주소 응답 · 제어 미연결'
        : qmk && cdc ? 'MK20 USB 2종 감지 · 제어 미연결'
        : qmk ? 'MK20 키 USB 감지 · 본체 USB(CDC) 미감지'
        : cdc ? 'MK20 본체 USB 감지 · 제어 미연결'
        : !sources.length ? 'MK20 탐색 미설정'
        : sources.some(s => s.status === 'failed') ? 'MK20 장치 탐색 실패'
        : 'MK20 USB 미감지';
    }
    badge.className = mk20Ready ? 'badge' : 'badge badge-neutral';
  }
  const list = $('settings-devices-list');
  if (!list) return;
  list.replaceChildren();
  if (!devices.length) list.append(node('p', isEn ? 'No controllable registered devices' : '제어 가능한 등록 장치 없음'));
  for (const d of devices) {
    const card = node('div'); card.className = 'card'; card.style.margin = '6px 0';
    const statusText = isEn ? `Status: ${d.state} · Capabilities: ${d.capabilities.join(', ')}` : `상태: ${d.state} · 기능: ${d.capabilities.join(', ')}`;
    card.replaceChildren(node('strong', `${d.label} [${d.transport}]`), node('p', statusText));
    list.append(card);
  }
  for (const candidate of candidates) {
    const card = node('div'); card.className = 'card'; card.style.margin = '6px 0';
    const candidateText = candidate.transport === 'lan'
      ? (isEn ? 'Port responding on specified development network · Identity/pairing unverified · No command rights' : '지정한 네트워크의 개발 포트 응답 · 장치 신원/페어링 미검증 · 명령 불가')
      : (isEn ? 'Observed on USB · Pairing/input contract unverified · No command rights' : 'USB에서 관찰됨 · 아직 페어링/입력 계약 미검증 · 명령 불가');
    card.replaceChildren(node('strong', candidate.label), node('p', candidateText));
    list.append(card);
  }
  if (sources.some(s => s.source.endsWith('/windows-product-cdc')) && !cdc) {
    list.append(node('p', qmk
      ? (isEn ? 'MK20 main product USB (CDC) is currently not detected. QMK key controller USB alone does not establish main control connection.' : 'MK20 본체 제품 USB(CDC)는 현재 감지되지 않습니다. QMK 키 컨트롤러 USB만으로는 본체 제어 연결이 성립하지 않습니다.')
      : (isEn ? 'Both MK20 key controller HID and main product USB (CDC) are currently not detected.' : 'MK20 키 컨트롤러 HID와 본체 제품 USB(CDC)가 모두 현재 감지되지 않습니다.')));
  }
  if (sources.some(s => s.status === 'failed')) list.append(node('p', isEn ? 'Some discovery paths failed. Check network/USB status and retry.' : '장치 탐색에 실패한 경로가 있습니다. 네트워크·USB 상태를 확인한 뒤 다시 시도하세요.'));
  const address = $('mk20-lan-address'), iface = $('mk20-lan-interface'), status = $('mk20-lan-status');
  const config = snapshot?.mk20Lan;
  if (iface && config) {
    const preferred = iface.value || config.selected?.interfaceName;
    iface.replaceChildren();
    for (const item of config.interfaces) { const option = node('option', `${item.name} (${item.address})`); option.value = item.name; iface.append(option); }
    if ([...iface.options].some(option => option.value === preferred)) iface.value = preferred;
  }
  if (address && document.activeElement !== address) address.value = config?.selected?.targetAddress ?? '';
  if (status) {
    if (isEn) {
      status.textContent = config?.error ? 'Unable to read saved MK20 address settings. Save a new address or remove it.' : config?.selected
        ? lan ? 'Configured Wi-Fi address responds. Device pairing is required for actual MK20 control.' : 'Address saved, but development port is not responding. Check Wi-Fi route and device power.'
        : 'Wi-Fi address not configured.';
    } else {
      status.textContent = config?.error ? '저장된 MK20 주소 설정을 읽을 수 없습니다. 새 주소를 저장하거나 제거하세요.' : config?.selected
        ? lan ? '설정한 Wi-Fi 주소가 응답합니다. 실제 MK20 제어에는 장치 페어링이 필요합니다.' : '주소는 저장됐지만 개발 포트 응답이 없습니다. Wi-Fi 경로와 기기 전원을 확인하세요.'
        : 'Wi-Fi 주소가 설정되지 않았습니다.';
    }
  }
}

function initSettingsModal() {
  const modal = $('settings-modal');
  const btnOpen = $('btn-settings');
  const btnClose = $('btn-close-settings');
  const btnRerun = $('btn-rerun-wizard');
  const btnRescan = $('btn-settings-rescan');
  const chkAutostart = $('setting-autostart');
  const trayLanguage=$('setting-language'), notifications=$('setting-notifications');
  const mk20Save=$('mk20-lan-save'), mk20Remove=$('mk20-lan-remove');
  const btnLangEn = $('lang-btn-en'), btnLangKo = $('lang-btn-ko');

  if (btnLangEn) btnLangEn.onclick = () => setLanguage('en');
  if (btnLangKo) btnLangKo.onclick = () => setLanguage('ko');

  if (mk20Save) mk20Save.onclick=()=>void run(async signal=>{
    await client.configureMk20Lan($('mk20-lan-address').value.trim(),$('mk20-lan-interface').value,signal);
    return client.snapshot(signal);
  });
  if (mk20Remove) mk20Remove.onclick=()=>void run(async signal=>{
    await client.removeMk20Lan(signal);
    return client.snapshot(signal);
  });
  const syncSettings=()=>{
    if(chkAutostart)chkAutostart.checked=!!snapshot?.settings?.autostart;
    if(trayLanguage){
      trayLanguage.value=snapshot?.settings?.language??'en';
      trayLanguage.disabled=false;
    }
    if(notifications){notifications.checked=!!snapshot?.settings?.notifications;notifications.disabled=!snapshot?.desktopCapabilities?.tray;}
  };
  const updateSetting=async patch=>{
    if(!snapshot?.settings)return;
    await run(async signal=>{await client.updateSettings(snapshot.settings.revision,patch,signal);return client.snapshot(signal);});syncSettings();
  };
  if(trayLanguage)trayLanguage.onchange=()=>{
    void updateSetting({language:trayLanguage.value});
  };
  if(notifications)notifications.onchange=()=>void updateSetting({notifications:notifications.checked});

  if (btnOpen) {
    btnOpen.onclick = () => {
      if (modal) modal.hidden = false;
      syncSettings();
      // Sync autostart setting
      if (chkAutostart && snapshot?.settings) {
        const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
        chkAutostart.checked = !!snapshot.settings.autostart; chkAutostart.disabled = !snapshot.desktopCapabilities?.autostart;
        chkAutostart.title = chkAutostart.disabled
          ? (isEn ? 'Start with desktop launcher to configure OS autostart' : '트레이 실행기로 시작하면 OS 자동 실행을 설정할 수 있습니다')
          : (isEn ? 'Configure actual OS login item' : '실제 OS 로그인 항목 설정');
        const tray = $('setting-tray'); if (tray) tray.checked = !!snapshot.desktopCapabilities?.tray;
      }
      renderDeviceStatus();
    };
  }

  if (btnClose) {
    btnClose.onclick = () => {
      if (modal) modal.hidden = true;
    };
  }

  if (modal) {
    modal.onclick = e => {
      if (e.target === modal) modal.hidden = true;
    };
  }

  if (chkAutostart) {
    chkAutostart.onchange = () => {
      if (!snapshot?.settings) return;
      void updateSetting({autostart:chkAutostart.checked});
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
      if (modal) modal.hidden = true;
      viewMode = 'wizard';
      step = 1;
      render();
    };
  }
}

// --- Setup Wizard (One-time onboarding / Rerun) ---
function renderWizard() {
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const stepNames = isEn ? ['Local Connection', 'Harness', 'Device (Optional)', 'Overview'] : ['로컬 연결', 'Harness', '장치 · 선택', 'Overview'];
  $('steps').replaceChildren(
    ...stepNames.map((name, index) => {
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
  $('title').textContent = (isEn ? [
    'Your Work In One Place',
    'Connect Your Harness',
    'Choose How To Control',
    'Tasks on this Computer',
  ] : [
    '내 작업을 한곳에서',
    '사용하는 Harness 연결',
    '원하는 방식으로 조작',
    '이 컴퓨터의 작업',
  ])[step];
  $('description').textContent = (isEn ? [
    snapshot?.accessMode === 'local-no-auth' ? 'Connected to this computer. No login or PIN required.' : 'Enter local connection code for selected token mode.',
    'Check harness candidates on this computer. Only connected harnesses can be controlled.',
    'Devices are optional. Check registration status or continue without hardware.',
    'Projects, sessions, and Attention (pending approvals, errors) for selected harness.',
  ] : [
    snapshot?.accessMode === 'local-no-auth' ? '이 컴퓨터에 연결되었습니다. 로그인이나 PIN 입력이 필요하지 않습니다.' : '선택한 토큰 모드의 로컬 연결 코드를 입력하세요.',
    '이 컴퓨터의 Harness 후보를 확인하세요. 실제 연결된 Harness의 작업만 제어할 수 있습니다.',
    '장치는 선택 사항입니다. 현재 등록 상태를 확인하거나 하드웨어 없이 계속하세요.',
    '선택한 Harness의 프로젝트 및 세션, Attention(승인 대기, 오류) 상태입니다.',
  ])[step];

  if (step === 0 && snapshot?.accessMode === 'local-no-auth') {
    $('content').append(node('p', isEn ? 'Local connection complete' : '로컬 연결 완료'));
    $('actions').append(button(isEn ? 'Continue' : '계속', () => go(1)));
    return;
  }
  if (step === 0) {
    const label = node('label', isEn ? 'One-time Connection Code' : '일회용 연결 코드');
    label.htmlFor = 'code';
    const input = node('input');
    input.id = 'code';
    input.type = 'password';
    input.autocomplete = 'off';
    input.maxLength = 43;
    $('content').append(label, input);
    $('actions').append(
      button(isEn ? 'Connect Local Service' : '로컬 서비스 연결', () => {
        const code = input.value;
        input.value = '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
          $('notice').textContent = isEn ? 'Please enter the connection code issued by the local launcher.' : '로컬 실행기가 발급한 연결 코드를 입력해 주세요.';
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
    const connected = (snapshot?.connectedHarnesses ?? []).filter(h => h.pluginId === 'snowball.codex');
    for (const binding of connected) {
      const item = node('div'); item.className = 'card';
      const connDesc = binding.connected
        ? (isEn ? 'Connected · Existing tasks must be explicitly attached to send commands' : '연결됨 · 기존 작업은 직접 연결해야 명령 가능')
        : (isEn ? 'Disconnected · Review needed' : '연결 끊김 · 재검토 필요');
      item.append(node('strong', `Codex CLI · ${binding.instanceId}`), node('p', connDesc));
      if (snapshot?.desktopCapabilities?.codexSelection) item.append(button(isEn ? 'Disconnect…' : '연결 해제…', () => void run(async signal => (await client.disconnectCodex(binding.instanceId, signal)).snapshot), true));
      $('content').append(item);
    }
    if (!survey || !survey.candidates.length) {
      const c = node('div', isEn ? 'Checking installed harness candidates or none found.' : '설치된 Harness 후보 목록을 확인 중이거나 비어 있습니다.');
      c.className = 'card';
      $('content').append(c);
    } else {
      for (const candidate of survey.candidates) {
        const c = node('div');
        c.className = 'card';
        c.append(node('strong', candidate.providerId), node('p', candidate.locator), node('p', isEn ? 'Installed candidate · Unconnected / control unverified' : '설치 후보 · 아직 연결 또는 제어 확인 전'));
        $('content').append(c);
      }
    }

    $('actions').append(
      ...(snapshot?.desktopCapabilities?.codexSelection ? [button(isEn ? 'Connect Codex CLI…' : 'Codex CLI 연결…', () => void run(async signal => (await client.connectCodex(signal)).snapshot))] : []),
      ...(snapshot?.desktopCapabilities?.codexSelection ? [button(isEn ? 'Recover / Reset Codex Connections…' : '저장된 Codex 연결 복구/초기화…', () => void run(async signal => (await client.resetCodex(signal)).snapshot), true)] : []),
      button(
        isEn ? 'Next (Device)' : '다음 (장치)',
        () => go(2)
      ),
      button(isEn ? 'Start Now (Workspace)' : '바로 시작 (Workspace)', () => {
        viewMode = 'workspace';
        render();
      }, true),
      button(isEn ? 'Rescan Harnesses' : 'Harness 다시 찾기', () => void run(async signal => {
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
      c.replaceChildren(node('strong', `${dev.label} [${dev.transport}]`), node('p', isEn ? `Status: ${dev.state}` : `상태: ${dev.state}`));
      c.prepend(cb);
      $('content').append(c);
    }
    for (const candidate of snapshot?.deviceCandidates ?? []) {
      const c = node('div'); c.className = 'card';
      c.replaceChildren(node('strong', candidate.label), node('p', isEn ? 'USB candidate · Unpaired / input unverified, cannot select or control' : 'USB 후보 · 페어링 및 입력 검증 전이므로 선택/명령 불가'));
      $('content').append(c);
    }

    $('actions').append(
      button(isEn ? 'Start (Workspace)' : '시작하기 (Workspace)', () => {
        viewMode = 'workspace';
        render();
      }),
      button(isEn ? 'Previous (Harness)' : '이전 (Harness)', () => go(1), true)
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
  if(activeDraft?.commandId&&(snapshot?.commands??[]).some(command=>command.commandId===activeDraft.commandId&&command.sessionKey===activeDraft.destinationKey&&['queued','dispatched','acknowledged','completed'].includes(command.status)))activeDraft=null;
  const isEn = typeof currentLanguage !== 'undefined' && currentLanguage === 'en';
  const hostBadge = $('host-badge');
  if (hostBadge) {
    hostBadge.textContent = activeHost
      ? (isEn ? `${activeHost} · Local Control` : `${activeHost} · 로컬 제어`)
      : (isEn ? 'This Computer · Local Control' : '이 컴퓨터 · 로컬 제어');
  }
  renderDeviceStatus();
  const wsContainer = $('workspace-container');
  const wizContainer = $('wizard-container');
  const breadcrumbs = $('breadcrumb-bar');
  const overview = $('overview-container');

  if (viewMode === 'workspace') {
    if (overview) overview.style.display = 'block';
    if (wsContainer) wsContainer.style.display = 'flex';
    if (wizContainer) wizContainer.hidden = true;
    if (breadcrumbs) breadcrumbs.style.display = 'flex';
    renderBreadcrumbs();
    renderOverview();
    renderWorkspace();
  } else {
    if (overview) overview.style.display = 'none';
    if (wsContainer) wsContainer.style.display = 'none';
    if (wizContainer) wizContainer.hidden = false;
    if (breadcrumbs) breadcrumbs.style.display = 'none';
    renderWizard();
  }
  checkpointController();
}

// Initial Boot: fetch snapshot and default to Workspace if connected
const liveAbort = new AbortController();
let refreshTimer;
function queueLiveRefresh() {
  if (refreshTimer || liveAbort.signal.aborted) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = undefined;
    if (operation) { queueLiveRefresh(); return; }
    try {
      const latest = await client.snapshot(liveAbort.signal);
      if (latest.cursor.split(':')[0] !== snapshot?.cursor?.split(':')[0] || Number(latest.cursor.split(':')[1]) >= Number(snapshot?.cursor?.split(':')[1] ?? -1)) {
        snapshot = latest; if (!activeDropdown) render();
      }
    } catch { /* A failed read never retries a command. The next stream event can resync. */ }
  }, 150);
}
async function followChanges() {
  while (!liveAbort.signal.aborted) {
    try { for await (const _ of client.events(snapshot?.cursor ?? '', liveAbort.signal)) queueLiveRefresh(); }
    catch { if (liveAbort.signal.aborted) return; }
    if (!liveAbort.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
window.addEventListener('pagehide', () => { liveAbort.abort(); clearTimeout(refreshTimer); });
void (async () => {
  webControllerId=await claimWebController();client=new LocalClient(location.origin,undefined,webControllerId);
  setLanguage(currentLanguage, false);
  initSettingsModal();
  try {
    controllerState=await client.controller();
    let saved;try{saved=JSON.parse(sessionStorage.getItem('snowball_ui:'+webControllerId));}catch{}
    if(saved){activeHarness=saved.activeHarness;activeProject=saved.activeProject;activeSessionKey=saved.activeSessionKey;activeDraft=saved.activeDraft??null;for(const [key,text] of saved.drafts??[])if(typeof key==='string'&&typeof text==='string')promptDrafts.set(key,text);for(const [key,value] of saved.execution??[])executionBySession.set(key,value);}
    else {activeHarness=controllerState.selection.harnessPluginId??activeHarness;activeSessionKey=controllerState.selection.sessionKey??null;activeProject=controllerState.preferences.projectName??'';if(activeSessionKey)executionBySession.set(activeSessionKey,{...(controllerState.preferences.model?{model:controllerState.preferences.model}:{}),...(controllerState.preferences.effort?{effort:controllerState.preferences.effort}:{})});}
    if(!saved&&controllerState.draft)promptDrafts.set(controllerState.draft.destinationKey,controllerState.draft.text);
    if(!location.hash)setLanguage(saved?.language??controllerState.preferences.language??currentLanguage,false);
    controllerReady=true;
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
  if (location.hash === '#settings') $('btn-settings')?.click();
  if (snapshot) void followChanges();
})();

// Export for test suite inspection
export { harnessFilter, workspaceFilter, activeDraft };
