import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);
import {
  defaultDiscoveryProviders,
  DeviceRegistry,
  CommandJournal,
  WorkspaceStore,
  HarnessDiscovery,
  createHostId,
  createControllerId,
  parseHostId,
  resolveUserDataDir,
  formatSessionKey,
  parseSessionKey,
  loadSttConfig,
  resolveSttModel,
  resolveModelsDir,
  deviceControllerId
} from '../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../packages/api/dist/index.js';
import {harnessPresentation as codexPresentation} from '../packages/harness-codex/dist/presentation.js';
import {harnessPresentation as agyPresentation} from '../packages/harness-antigravity/dist/presentation.js';
import {harnessPresentation as ocodePresentation} from '../packages/harness-opencode/dist/presentation.js';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';
const controlRoot=process.env.SNOWBALL_CONTROL_ROOT ? path.resolve(process.env.SNOWBALL_CONTROL_ROOT) : fileURLToPath(new URL('../../Snowball_Control',import.meta.url));
import { HidDiscovery, loadNativeBackend } from '../packages/device-hid/dist/index.js';
import { reviewedProfiles } from '../packages/device-hid/dist/profiles.js';
import os from 'node:os';
import { NativeSourceService } from './source-service.mjs';
import { loadControllerStore } from '../apps/supervisor/controller-store.mjs';
import { controllerUiStore } from './controller-ui-store.mjs';
import { reconcileNativeContext } from './native-context.mjs';
import { dispatchHarnessTurn } from './harness-dispatch.mjs';
import { listNativeAccess } from './native-access.mjs';
import { startMk20Lan } from './mk20-lan.mjs';
import { connectMk20Device } from './mk20-device-binding.mjs';
process.env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
import { languageManager } from './language-manager.mjs';
import { chooseLanAddress, privateIpv4 } from './setup-profile.mjs';
import { loadSuitePlugins } from './suite-plugins.mjs';
import {desktopBridge} from './desktop-bridge.mjs';
import {loadSettings,saveSettings} from '../apps/supervisor/settings-store.mjs';

const profile = process.env.SNOWBALL_PROFILE ?? 'web';
if (!['web', 'mk20', 'm5stack'].includes(profile)) throw Error('Invalid Snowball profile');
const apiPort = Number(process.env.SNOWBALL_PORT ?? 8765);
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw Error('Invalid Snowball port');
let updateDeviceSession = () => {};
const mk20Contexts=new Map();
let speechPreparation;
const speechAbort=new AbortController();
const suiteConfig = process.env.SNOWBALL_SUITE_CONFIG ? JSON.parse(fs.readFileSync(process.env.SNOWBALL_SUITE_CONFIG, 'utf8')) : null;
const suite = suiteConfig ? await loadSuitePlugins(suiteConfig, { start: false }) : null;
const directory = ensurePrivateStateDirectory(process.env.SNOWBALL_DATA_DIR ? path.resolve(process.env.SNOWBALL_DATA_DIR) : resolveUserDataDir());
const desktopSettings=desktopBridge();
const savedSettings=loadSettings(directory);
if(fs.existsSync(path.join(directory,'settings.v1.json')))languageManager.setPrimaryLanguage(savedSettings.language);
if(desktopSettings.enabled)savedSettings.autostart=await desktopSettings.request('get-autostart');
let controlPaused=savedSettings.controlPaused;
const sources = new NativeSourceService();
const controllerPersistence = await loadControllerStore(directory);
const controllerStates = controllerPersistence.store;
const hostIdFile = path.join(directory, 'host.v1.json');
let hostId;
try {
  const data = JSON.parse(fs.readFileSync(hostIdFile, 'utf8'));
  hostId = parseHostId(data.hostId);
} catch {
  hostId = createHostId();
  fs.writeFileSync(hostIdFile, JSON.stringify({ version: 1, hostId }) + '\n');
}

const commandDir = ensurePrivateStateDirectory(path.join(directory, 'commands'));
const workspaceDir = ensurePrivateStateDirectory(path.join(directory, 'workspaces'));

// Clean up stale lock files from previous runs if process is dead
for (const dir of [commandDir, workspaceDir]) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.lock')) {
        const lockPath = path.join(dir, f);
        try {
          const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          if (lockData.pid) {
            try { process.kill(lockData.pid, 0); }
            catch { fs.unlinkSync(lockPath); }
          }
        } catch {
          try { fs.unlinkSync(lockPath); } catch {}
        }
      }
    }
  } catch {}
}

const journal = new CommandJournal({ hostId, directory: commandDir });
const store = new WorkspaceStore({ hostId, directory: workspaceDir });
const devices = new DeviceRegistry(Date.now, controllerStates.contexts);
const discovery = new HarnessDiscovery();
const providers = defaultDiscoveryProviders();

// Run initial harness discovery scan on startup
try {
  await discovery.scan(providers, { platform: process.platform, pathValue: process.env.PATH ?? '' });
} catch {}

// Refresh all workspaces on startup so restored entries transition to 'ready'
for (const ws of store.list()) {
  try {
    const refreshed = await store.refresh(ws.workspaceId);
    console.log(`  Verified Project   : ${refreshed.displayName} [${refreshed.status}]`);
  } catch (err) {
    console.log(`  Project verify note (${ws.displayName}):`, err.message);
  }
}

// Scan and report real project candidates for each harness
try {
  const harnessProjectsMap = await sources.read('projects');
  const allCandidates = [
    ...harnessProjectsMap['snowball.codex'],
    ...harnessProjectsMap['snowball.antigravity'],
    ...harnessProjectsMap['snowball.opencode']
  ];
  store.reportCandidates(allCandidates);
  console.log(`  Reported ${allCandidates.length} real harness project candidates`);
} catch (err) {
  console.log('  Harness project scan note:', err.message);
}

// Register real sessions discovered from Codex, Antigravity, and OpenCode
let realSessionsData = {};
let realTurnsData = {};
try {
  const { sessionsByHarness, turnsStore } = await sources.read('sessions');
  realSessionsData = sessionsByHarness;
  realTurnsData = turnsStore;
  for (const [pluginId, projs] of Object.entries(sessionsByHarness)) {
    for (const [projName, sList] of Object.entries(projs)) {
      for (const s of sList) {
        try {
          const sessionKey = formatSessionKey({
            hostId,
            harness: { pluginId, instanceId: 'default' },
            nativeSessionId: s.id,
          });
          s.sessionKey = sessionKey;
          s.ownerId = 'user';
          s.readOnly = false;
          journal.registerSession(sessionKey, 'user');
          if (turnsStore[s.id] && !turnsStore[sessionKey]) {
            turnsStore[sessionKey] = turnsStore[s.id];
          }
        } catch (err) {}
      }
    }
  }
  console.log(`  Registered genuine sessions across active harnesses`);
} catch (err) {
  console.log('  Harness session scan note:', err.message);
}

const installedVersions = await sources.read('installations');
console.log('Harness installations:', installedVersions);
const connectedHarnesses = Object.entries(installedVersions).map(([kind, info]) => ({
  pluginId: `snowball.${kind}`, instanceId: 'default', connected: info.available,
  canCreate: false, canAttach: info.available, canListModels: info.available,
}));

async function handleListModels(pluginId, instanceId) {
  const list = await sources.read('catalog', pluginId);
  return list.map(m => ({
    model: m.model,
    displayName: m.displayName,
    efforts: m.efforts || []
  }));
}

async function handleCreateSession() {
  throw new Error('Native session creation is not available through this Preview API. Use the native harness, then refresh; MK20 New creates a local draft until its first native turn.');
}

async function handleCommandQueued(sessionKey) {
  try {
    await journal.dispatchNext(sessionKey, {
      ownerId: 'user',
      execute: async (item, signal) => {
        const payload = item.command.input.payload || {};
        const promptText = payload.text || '';
        const model = payload.model;
        const effort = payload.effort;
        const correlationId = 'corr_' + Date.now();

        const parsed = parseSessionKey(sessionKey);
        const harnessPluginId = parsed.harness.pluginId;
        const nativeSessionId = parsed.nativeSessionId;
        const dispatchHarness = harnessPluginId.replace('snowball.', '');
        const sessions = Object.values(realSessionsData[harnessPluginId] || {}).flat();
        const target = sessions.find(session => session.id === nativeSessionId);
        const projectPath = target?.cwd;
        if (!projectPath || !path.isAbsolute(projectPath) || !fs.existsSync(projectPath)) throw new Error('Native session workspace is unavailable; dispatch refused');

        console.log(`[WebUI Dispatch] Dispatching turn for [${dispatchHarness}] session [${nativeSessionId}] prompt: "${promptText}"`);

        const result = await dispatchHarnessTurn({
          signal,
          harnessId: harnessPluginId,
          cwd: projectPath,
          sessionId: nativeSessionId.startsWith('s-') ? undefined : nativeSessionId,
          promptText,
          model,
          effort,
          access: payload.access,
          onDelta: () => {}
        });

        const completedTurns = [
          {
            role: 'user',
            userPrompt: promptText,
            text: promptText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          },
          {
            role: 'agent',
            agentResponse: result.response,
            text: result.response,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            processDetails: [`Harness: ${harnessPluginId}`, `Model: ${model || 'default'}`, `Effort: ${effort || 'default'}`],
            status: 'completed'
          }
        ];

        if (realTurnsData) {
          const priorTurns = realTurnsData[result.sessionId] || realTurnsData[nativeSessionId] || realTurnsData[sessionKey] || [];
          const merged = [...priorTurns, ...completedTurns];
          realTurnsData[result.sessionId] = merged;
          realTurnsData[sessionKey] = merged;
          if (nativeSessionId !== result.sessionId) {
            realTurnsData[nativeSessionId] = merged;
          }
        }

        updateDeviceSession(nativeSessionId, result.sessionId);

        return { status: 'completed', correlationId };
      }
    });
  } catch (err) {
    console.error('[WebUI Dispatch] Error dispatching queued command:', err);
  }
}

const harness = {
  describe: () => discovery.snapshot(),
  rescan: () => discovery.scan(providers, { platform: process.platform, pathValue: process.env.PATH ?? '' }),
};

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const supervisor = await loadSupervisorAssets(repositoryRoot);

const api = new LocalApi({
  journal,
  workspaceStore: store,
  devices,
  controllerStates,
  harness,
  supervisor,
  port: apiPort,
  hostname: os.hostname(),
  noAuth: true,
  initialSettings: {
    ...savedSettings,
    language: languageManager.getPrimaryLanguage().id,
  },
  desktopCapabilities:{tray:desktopSettings.enabled,autostart:desktopSettings.enabled},
  applySettings: async (next, prev) => {
    if(next.autostart!==prev.autostart){const actual=await desktopSettings.request('set-autostart',next.autostart);if(actual!==next.autostart)throw Error('OS login setting was not confirmed');}
    try{saveSettings(directory,next);}catch(error){if(next.autostart!==prev.autostart)await desktopSettings.request('set-autostart',prev.autostart);throw error;}
    controlPaused=next.controlPaused;
    if (next.language && next.language !== prev.language) {
      languageManager.setPrimaryLanguage(next.language);
      console.log(`[LanguageManager] Primary language changed to: ${next.language}`);
    }
  },
  realSessions: realSessionsData,
  harnessPresentations:suite?.presentations ?? {'snowball.codex':codexPresentation,'snowball.antigravity':agyPresentation,'snowball.opencode':ocodePresentation},
  turnsStore: realTurnsData,
  connectedHarnesses,
  listModels: handleListModels,
  listAccess: listNativeAccess,
  createSession: handleCreateSession,
  onCommandQueued: handleCommandQueued,
});

await api.start();

const bootstrapFile = path.join(directory, 'live-bootstrap.json');
function refreshCode() {
  try {
    const bootstrap = api.issueBootstrap();
    const info = {
      origin: api.origin,
      code: bootstrap.code,
      expiresAt: bootstrap.expiresAt,
      url: `${api.origin}/`
    };
    fs.writeFileSync(bootstrapFile, JSON.stringify(info, null, 2) + '\n');
    return info;
  } catch {
    return null;
  }
}

const currentBootstrap = refreshCode();
const bootstrapTimer = setInterval(refreshCode, 30_000);

console.log('====================================================');
console.log('  SNOWBALL MIDDLEWARE IS ONLINE');
console.log('====================================================');
console.log(`  Web Supervisor URL : ${api.origin}/`);
console.log('====================================================');

async function startMk20Runtime({targetAddress, deviceId, leaseToken, isActive}) {
const startupCleanup=[];let compositionReady=false;
try {
const localBindIp = chooseLanAddress(undefined, process.env.SNOWBALL_BIND, targetAddress);
const { Mk20LabTransport } = await import(pathToFileURL(path.join(controlRoot,'plugins/device-mk20/src/index.mjs')).href);
const mk20Identity='mk20-mac-'+deviceId.slice(5).match(/../g).join(':');
const mk20ControllerId=deviceControllerId('plugin.mk20','desk-terminal',mk20Identity);
const mk20 = new Mk20LabTransport({
  controllerId: mk20ControllerId,
  leaseToken,
  labEnabled: true,
  localAddress: localBindIp,
  targetAddress,
  targetPort: 7701
});

startupCleanup.push(()=>mk20.close());
let mk20Device;
let mk20Online = false;
try {
  await mk20.start();
  mk20Online = true;
  console.log(`  MK20 LAN Transport : READY (${targetAddress}:7701)`);

  mk20Device = connectMk20Device(devices, {targetAddress, deviceId});
  startupCleanup.push(()=>mk20Device.release());
  console.log(`  MK20 LAN Registry  : ${mk20Device.reconnected ? 'RECONNECTED' : 'REGISTERED'} (revision ${mk20Device.binding.revision})`);
} catch (err) {
  throw Error('MK20 LAN transport failed: '+err.message);
}
const paintStarting=()=>{
  if(!isActive()||compositionReady)return;
  return mk20.preview({mode:'session',title:os.hostname(),subtitle:'Connected · loading local harnesses',lines:['Reading native projects and sessions...','Machines (K17) remains available.'],scroll:0,totalLines:2,volume:75,muted:false,keys:Array.from({length:20},(_,i)=>({id:i+1,flags:i===16?4:8,top:i===16?'Machines':'',main:i===16?'Change PC':''}))}).catch(error=>console.warn('MK20 startup display:',error.message));
};
await paintStarting();
const startupHeartbeat=setInterval(()=>void paintStarting(),1200);
startupCleanup.push(()=>clearInterval(startupHeartbeat));

// Detect and register MK20 USB Raw HID controller in DeviceRegistry
try {
  const backend = loadNativeBackend();
  const hidDisc = new HidDiscovery(backend, reviewedProfiles);
  const hidScan = await hidDisc.scan();
  const mk20Hid = hidScan.candidates.find(c => c.profileId === 'mk20-qmk-controller');
  if (mk20Hid) {
    const hidSource = { pluginId: 'plugin.device-hid', instanceId: 'mk20-qmk' };
    const hidGen = devices.beginScan(hidSource);
    const hidCand = devices.observe(hidSource, hidGen, {
      nativeDeviceId: `mk20-hid-${mk20Hid.vendorId}:${mk20Hid.productId}`,
      label: 'MK20 QMK Keypad Controller (USB Raw HID)',
      transport: 'hid',
      capabilities: ['button', 'select-session'],
      supported: true,
      // VID/PID identifies a profile, not an individual board. Keep this USB
      // controller ephemeral until the adapter verifies a unique identity.
    });
    devices.finishScan(hidSource, hidGen, 'ready');
    if (hidCand) {
      devices.register(hidCand.candidateId, hidGen);
      console.log('  MK20 USB Raw HID   : CONNECTED (Vendor 0x4250 / Product 0x426F)');
    }
  }
} catch (err) {
  console.log('  MK20 USB Raw HID   : FAILED (' + err.message + ')');
}

const { ContextManager, GitProvider } = await import('./context-manager.mjs');
const { CodexDesktopClient } = await import('./codex-desktop-client.mjs');
const { LocalWhisperProvider } = await import(pathToFileURL(path.join(controlRoot, 'host/dist/audio/local-whisper.js')).href);

const desktop = new CodexDesktopClient();
startupCleanup.push(()=>desktop.close?.());
try {
  const connected = await desktop.connect();
  if (connected) {
    console.log('  Codex Desktop IPC  : CONNECTED');
  } else {
    console.log('  Codex Desktop IPC  : STANDBY (Named pipe not found or app not running)');
  }
} catch (err) {
  console.log('  Codex Desktop IPC  : STANDBY (' + err.message + ')');
}

if (!speechPreparation) {
  speechPreparation=(async()=>{
// --- Whisper STT Model Resolution & Boot Download Check ---
const sttConfig = loadSttConfig();
const modelsDir = resolveModelsDir(sttConfig);
fs.mkdirSync(modelsDir, { recursive: true });

// Ensure Python STT runtime and hardware accelerator libraries are installed
try {
  const depRes = await LocalWhisperProvider.ensureDependencies((msg) => {
    console.log(`  ${msg}`);
  }, speechAbort.signal);
  if (!depRes.ok) console.warn('  Whisper Runtime    : Verification failed; voice capture will report an error until dependencies are ready');
  if (depRes.status && depRes.status.gpu_name) {
    console.log(`  Whisper Hardware   : ${depRes.status.gpu_name} (CUDA cuBLAS: ${depRes.status.cuda_ready ? 'READY' : 'ABSENT'})`);
  }
} catch (depErr) {
  console.log(`  Whisper Runtime    : NOTE (${depErr.message})`);
}

let selectedSttModel = process.env.SNOWBALL_WHISPER_MODEL;
let selectedBackend = process.env.SNOWBALL_WHISPER_DEVICE || 'auto';
let backendDeviceName = '';
let modelSelectionNote = 'explicit env override';

if (!selectedSttModel) {
  try {
    const assessPy = path.resolve('scripts/assess_stt_backend.py');
    const {stdout:out} = await execFileAsync(process.env.PYTHON_BIN ?? 'python', [assessPy, '--json'], { encoding: 'utf8', windowsHide: true,timeout:30000,signal:speechAbort.signal });
    const assessRes = JSON.parse(out);
    selectedSttModel = assessRes.selected_model;
    selectedBackend = assessRes.selected_backend || 'auto';
    backendDeviceName = assessRes.device || '';
    modelSelectionNote = assessRes.model_evaluation?.status_note || assessRes.selected_backend;
  } catch {
    const cpus = os.cpus();
    const evalRes = resolveSttModel('cpu', { cores: cpus.length, availRamGb: os.freemem() / (1024 ** 3) }, sttConfig);
    selectedSttModel = evalRes.selectedModel;
    selectedBackend = 'cpu';
    modelSelectionNote = evalRes.note;
  }
}

// The resident provider uses faster-whisper, which currently implements
// CUDA/CPU only. A successful Vulkan/Metal diagnostic is not this backend.
if(!['auto','cuda','cpu'].includes(selectedBackend)){
  const diagnosticBackend=selectedBackend;selectedBackend='cpu';backendDeviceName=os.cpus()[0]?.model??'';
  const evaluated=resolveSttModel('cpu',{cores:os.cpus().length,availRamGb:os.freemem()/(1024**3)},sttConfig);
  if(!process.env.SNOWBALL_WHISPER_MODEL)selectedSttModel=evaluated.selectedModel;
  modelSelectionNote=`${diagnosticBackend} diagnostic is not a resident backend; CPU selected`;
}

const devLabel = backendDeviceName ? ` (${backendDeviceName})` : '';
console.log(`  Whisper Model Plan : ${selectedSttModel} [${modelSelectionNote}] | Backend: ${selectedBackend.toUpperCase()}${devLabel}`);
console.log(`  Whisper Cache Dir  : ${modelsDir}`);

// Model Verification & Startup Download Check
try {
  const isDownloaded = await LocalWhisperProvider.isModelDownloaded(selectedSttModel, modelsDir, speechAbort.signal);
  if (!isDownloaded) {
    console.log(`  Whisper Model DL   : Downloading '${selectedSttModel}' to local cache...`);
    const dlResult = await LocalWhisperProvider.ensureModelDownloaded(selectedSttModel, modelsDir, (msg) => {
      if (msg.includes('Download') || msg.includes('MB') || msg.includes('%')) {
        process.stdout.write(`\r    [Download] ${msg.slice(0, 65).padEnd(65)}`);
      }
    }, speechAbort.signal);
    if (!dlResult.ok) throw new Error(dlResult.error || 'Whisper model download was not confirmed');
    console.log(`\n  Whisper Model DL   : READY (${dlResult.status})`);
  } else {
    console.log(`  Whisper Model DL   : VERIFIED (Present in cache)`);
  }
} catch (dlErr) {
  throw dlErr;
}

speechAbort.signal.throwIfAborted();
return {selectedSttModel,selectedBackend,modelsDir};
})();
speechPreparation.catch(()=>{});
}
let voice=null,voiceError=null;
const { AudioTransport } = await import(pathToFileURL(path.join(controlRoot,'host/dist/audio/transport.js')).href);
const { AudioPlayer } = await import(pathToFileURL(path.join(controlRoot,'host/dist/audio/player.js')).href);
startupCleanup.push(()=>voice?.close());
let currentVoiceCaptureId=null;

// --- Supertonic TTS Provider Setup with 3-tier Fallback ---
let tts = null;
let cleanTextForSpeech = null;
try {
  const { LocalSupertonicProvider } = await import(pathToFileURL(path.join(controlRoot, 'host/dist/audio/local-supertonic.js')).href);
  const translit = await import(pathToFileURL(path.join(controlRoot, 'host/dist/audio/korean-transliterate.js')).href);
  cleanTextForSpeech = translit.cleanTextForSpeech;
  tts = new LocalSupertonicProvider(undefined, new AudioPlayer(targetAddress, undefined, leaseToken, 7702, localBindIp));
  startupCleanup.push(async()=>{await tts.stop();tts.close();});
  // Pre-warm Supertonic resident worker and load GPU model on startup
  void tts.warmup().then(ready=>{if(ready)console.log('  Local TTS worker ready');else console.warn('  Local TTS worker unavailable');}).catch(error=>console.warn('  Local TTS unavailable:',error.message));
} catch (ttsErr) {
  console.warn('  Supertonic TTS Engine : NOTE (' + ttsErr.message + ')');
}

const langStatus = languageManager.getStatus();
console.log(`  Active Languages      : [Primary: ${langStatus.primary.name} (${langStatus.primary.id}), Enabled: ${langStatus.enabled.map(l => l.id).join(', ')}] (Auto-detected from OS: ${langStatus.osDetected})`);

function extractSpokenAgentResponse(rawText) {
  if (!rawText) return '';
  if (typeof cleanTextForSpeech === 'function') {
    return cleanTextForSpeech(rawText);
  }
  let t = String(rawText).trim();
  // Strip markdown code fences (```...```)
  t = t.replace(/```[\s\S]*?```/g, ' 코드 블록 생략. ');
  // Strip inline code backticks (`code` -> code)
  t = t.replace(/`([^`]+)`/g, '$1');
  // Strip markdown links [text](url) -> text
  t = t.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  // Strip markdown headers (# Header -> Header)
  t = t.replace(/^#{1,6}\s+/gm, '');
  // Strip blockquotes (> Quote -> Quote)
  t = t.replace(/^>\s+/gm, '');
  // Strip bold/italics (**text** or *text* -> text)
  t = t.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');
  // Strip bullet markers (- item -> item, * item -> item)
  t = t.replace(/^[\s]*[-*+]\s+/gm, '');
  // Strip numbered lists (1. item -> item)
  t = t.replace(/^[\s]*\d+\.\s+/gm, '');
  // Strip horizontal rules (---, ***, ___)
  t = t.replace(/^[-\*_]{3,}\s*$/gm, '');
  // Normalize line breaks: ensure punctuation at end of lines so TTS pauses naturally
  t = t.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    if (/[.!?:,;~]$/.test(line)) return line;
    return line + '.';
  }).join(' ');
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function getLatestAgentResponse(curSess) {
  if (!curSess) return '';
  const turns = curSess.turns || context.currentTurns || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t) continue;
    let text = t.agentResponse || '';
    if (!text && t.role === 'agent' && t.text) text = t.text;
    if (!text && Array.isArray(t.items)) {
      text = t.items.filter(it => it.type === 'agentMessage').map(it => it.text || '').join('\n');
    }
    if (text && text.trim()) return text.trim();
  }
  return curSess.preview || '';
}

async function speakCurrentSession(forceText = null, destination = 'device') {
  if (!tts || !isActive()) return;
  if(context.isSpeaking)await stopSpeaking();
  const curSess = context.getCurrentSession();
  const rawText = forceText || getLatestAgentResponse(curSess);
  const text = extractSpokenAgentResponse(rawText);
  if (!text) {
    console.log('[TTS] No spoken agent text available in current session.');
    return;
  }
  const hasKorean = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
  const targetLang = hasKorean ? 'ko' : languageManager.getPrimaryLanguage().id;
  const targetVoice = 'F1';

  console.log(`[TTS] Speaking (${text.length} chars, destination=${destination}, lang=${targetLang}): "${text.slice(0, 60)}..."`);
  if (destination === 'host') {
    context.isSpeakingHost = true;
  } else {
    context.isSpeakingDevice = true;
  }
  const speechGeneration=context.speechGeneration=(context.speechGeneration??0)+1;
  context.isSpeaking = true;
  void paintMk20();
  const t0 = Date.now();
  try {
    await tts.speak(text, {
      destination,
      volume: (context.volume || 75) / 100,
      language: targetLang,
      voice: targetVoice,
    });
    console.log(`[TTS] Playback (${destination}) completed in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  } catch (err) {
    console.error(`[TTS] Playback (${destination}) error:`, err.message);
    context.readerTitle='Audio unavailable';context.readerLines=[err.message];
  } finally {
    if(context.speechGeneration!==speechGeneration)return;
    if (destination === 'host') {
      context.isSpeakingHost = false;
    } else {
      context.isSpeakingDevice = false;
    }
    context.isSpeaking = context.isSpeakingDevice || context.isSpeakingHost;
    void paintMk20();
  }
}

async function stopSpeaking() {
  if (!tts) return;
  context.speechGeneration=(context.speechGeneration??0)+1;
  context.isSpeakingDevice = false;
  context.isSpeakingHost = false;
  context.isSpeaking = false;
  try {
    await tts.stop();
  } catch {}
  void paintMk20();
}

let cachedContext=mk20Contexts.get(mk20ControllerId);
if(!cachedContext&&mk20Contexts.size>=16)throw Error('MK20 controller context capacity reached');
const context = cachedContext?.context ?? new ContextManager();
const nativeDispatches = cachedContext?.nativeDispatches ?? new Map();
if(!cachedContext)mk20Contexts.set(mk20ControllerId,{context,nativeDispatches});
updateDeviceSession = (nativeSessionId, resultSessionId) => {
  if(!compositionReady||!isActive())return;
  const activeSession = context.getCurrentSession();
  if (activeSession && (activeSession.id === nativeSessionId || activeSession.id === resultSessionId)) {
    activeSession.turns = realTurnsData[resultSessionId];
    context.setSessionTurns(activeSession.turns);
    context.updateReaderForCurrentSession();
    void paintMk20();
  }
};

context.sttEngineLabel='Preparing speech';

// Configure machines
context.machines = [{ id: 'dev-pc', name: os.hostname().split('.')[0] || 'DEV-PC', isOnline: true }];

// Configure harnesses
context.harnesses = [
  { id: 'snowball.codex', name: 'Codex', isEnabled: installedVersions.codex.available },
  { id: 'snowball.antigravity', name: 'Antigrav', isEnabled: installedVersions.antigravity.available },
  { id: 'snowball.opencode', name: 'OpenCode', isEnabled: installedVersions.opencode.available }
];

// Discover and configure genuine living model catalogs dynamically for each harness
async function refreshHarnessCatalogs() {
  try {
    const catalogs = await sources.read('catalogs');
    for (const [pluginId, cat] of Object.entries(catalogs)) {
      if (Array.isArray(cat)) {
        context.setModelCatalog(cat, `dev-pc/${pluginId}`);
      }
    }
  } catch (err) {
    console.warn('[Catalog] Harness model discovery note:', err.message);
  }
}
await refreshHarnessCatalogs();

context.accessLevels = ['Native policy'];

// Observe this PC again on every selection; saved controller objects retain
// drafts and owned dispatch handles while native additions remain discoverable.
const [nativeSessions,nativeProjects]=await Promise.all([sources.read('sessions'),sources.read('projects')]);
realSessionsData=nativeSessions.sessionsByHarness;
Object.assign(realTurnsData,nativeSessions.turnsStore);
for(const [pluginId,groups] of Object.entries(realSessionsData))for(const list of Object.values(groups))for(const native of list){
  native.sessionKey=formatSessionKey({hostId,harness:{pluginId,instanceId:'default'},nativeSessionId:native.id});
  journal.registerSession(native.sessionKey,'user');
}
reconcileNativeContext(context,realSessionsData,nativeProjects);

// Function to load turns for currently selected session
async function loadCurrentSessionTurns() {
  const curSess = context.getCurrentSession();
  if (!curSess || !curSess.id) {
    context.setSessionTurns([]);
    return;
  }

  // Brand-new unsubmitted session starts with strictly empty turns
  if (curSess.id.startsWith('s-') && (!curSess.turns || curSess.turns.length === 0)) {
    context.setSessionTurns([]);
    return;
  }

  // 1. Direct in-memory session object turns
  if (curSess.turns && Array.isArray(curSess.turns) && curSess.turns.length > 0) {
    context.setSessionTurns(curSess.turns);
    if (realTurnsData) {
      realTurnsData[curSess.id] = curSess.turns;
      if (curSess.sessionKey) realTurnsData[curSess.sessionKey] = curSess.turns;
    }
    return;
  }

  // 2. Turns store cache (only for real/persisted sessions, never s-*)
  if (realTurnsData && !curSess.id.startsWith('s-')) {
    if (realTurnsData[curSess.id]) {
      context.setSessionTurns(realTurnsData[curSess.id]);
      curSess.turns = realTurnsData[curSess.id];
      return;
    }
    if (curSess.sessionKey && realTurnsData[curSess.sessionKey]) {
      context.setSessionTurns(realTurnsData[curSess.sessionKey]);
      curSess.turns = realTurnsData[curSess.sessionKey];
      return;
    }
    for (const [k, turns] of Object.entries(realTurnsData)) {
      if (k.endsWith(`/${curSess.id}`) || k === curSess.id) {
        context.setSessionTurns(turns);
        curSess.turns = turns;
        return;
      }
    }
  }

  // 3. Live fallback: Read directly via Codex Desktop named pipe if connected
  if (desktop.isConnected && !curSess.id.startsWith('s-')) {
    try {
      const threadData = await desktop.readThread(curSess.id, 15);
      if (threadData?.turns && Array.isArray(threadData.turns) && threadData.turns.length > 0) {
        const parsed = threadData.turns.map(t => {
          const userPrompt = (t.items || []).filter(i => i.type === 'userMessage').map(i => i.text || '').join('\n') || t.userPrompt || '';
          const agentResponse = (t.items || []).filter(i => i.type === 'agentMessage').map(i => i.text || '').join('\n') || t.agentResponse || '';
          const processDetails = (t.items || []).filter(i => i.type === 'commandExecution').map(i => i.command || '') || t.processDetails || [];
          return { role: 'turn', userPrompt, agentResponse, processDetails };
        });
        if (context.getCurrentSession() === curSess) context.setSessionTurns(parsed);
        curSess.turns = parsed;
        if (realTurnsData) realTurnsData[curSess.id] = parsed;
        return;
      }
    } catch {}
  }

  // 4. Live fallback: Check rollout JSONL for Codex threads
  if (!curSess.id.startsWith('s-') && context.getCurrentHarness()?.id?.includes('codex')) {
    try {
      const observed = await sources.read('sessions');
      const parsed = observed.turnsStore[curSess.sessionKey] ?? observed.turnsStore[curSess.id];
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (context.getCurrentSession() === curSess) context.setSessionTurns(parsed);
        curSess.turns = parsed;
        if (realTurnsData) realTurnsData[curSess.id] = parsed;
        return;
      }
    } catch {}
  }

  if (context.getCurrentSession() === curSess) context.setSessionTurns([]);
}

context.resolveProjectAndSession();
context.syncSessionSettings();
const mk20Ui = await controllerUiStore(directory, mk20ControllerId);
if(!cachedContext&&mk20Ui.saved)context.restoreUi(mk20Ui.saved);
const previousSkin=controllerStates.get(mk20ControllerId).preferences.skinId;
if(previousSkin){try{mk20.setSkin(previousSkin);}catch{console.warn('MK20 saved skin is unavailable; use a currently installed skin.');}}
const savedMk20Scroll = context.readerScrollLine;
context.updateReaderForCurrentSession();
await loadCurrentSessionTurns();
if(mk20Ui.saved)context.readerScrollLine=savedMk20Scroll;

let activeAudioCapture = null; // { captureId, harnessId, sessionObj }
let activeTranscriptionTimer = null;
let transcriptionPromise=null;
let activeTranscriptionCancelled = false;

function finishVoiceCapture() {
  if (!activeAudioCapture && !context.isRecordingVoice) return;
  const targetCapture = activeAudioCapture;
  activeAudioCapture = null;

  const capId = targetCapture?.captureId || currentVoiceCaptureId;
  const targetHarnessId = targetCapture?.harnessId || context.getCurrentHarness()?.id;
  const targetSessionObj = targetCapture?.sessionObj || context.getCurrentSession();
  currentVoiceCaptureId = null;

  context.isRecordingVoice = false;
  context.isTranscribingVoice = true;
  context.transcribingSeconds = 0;

  if (targetSessionObj) {
    targetSessionObj.isRecordingVoice = false;
    targetSessionObj.isTranscribingVoice = true;
    targetSessionObj.transcribingSeconds = 0;
    targetSessionObj.transcriptionCancelled = false;
  }

  context.updateReaderForCurrentSession();
  void paintMk20();

  let sec = 0;
  clearInterval(activeTranscriptionTimer);
  activeTranscriptionTimer = setInterval(() => {
    sec++;
    if(targetSessionObj?.voiceCaptureId!==capId){clearInterval(activeTranscriptionTimer);return;}
    if (targetSessionObj) targetSessionObj.transcribingSeconds = sec;
    const activeSess = context.getCurrentSession();
    if (activeSess === targetSessionObj && context.isTranscribingVoice) {
      context.transcribingSeconds = sec;
      context.updateReaderForCurrentSession();
      void paintMk20();
    }
  }, 1000);

  // Background STT processing to ensure zero UI event blocking
  transcriptionPromise = (async () => {
    try {
      const text = await voice.finish(capId);
      clearInterval(activeTranscriptionTimer);
      if(targetSessionObj?.voiceCaptureId!==capId)return;

      if (targetSessionObj?.transcriptionCancelled) {
        console.log(`[Voice] Discarding transcription for [${targetHarnessId}] because session was cancelled.`);
        if (targetSessionObj) {
          targetSessionObj.isTranscribingVoice = false;
          targetSessionObj.transcribingSeconds = 0;
          targetSessionObj.voiceDraftText = '';
        }
        const activeSess = context.getCurrentSession();
        if (activeSess === targetSessionObj) {
          context.isTranscribingVoice = false;
          context.transcribingSeconds = 0;
          context.voiceDraftText = '';
          context.updateReaderForCurrentSession();
          void paintMk20();
        }
        return;
      }

      const trimmed = (text || '').trim();
      if (targetSessionObj) {
        targetSessionObj.isTranscribingVoice = false;
        targetSessionObj.transcribingSeconds = 0;
        targetSessionObj.voiceDraftText = trimmed;
      }

      const activeHarness = context.getCurrentHarness();
      const activeSession = context.getCurrentSession();
      const isStillOnTargetSession = (activeHarness?.id === targetHarnessId) && (activeSession === targetSessionObj);

      if (isStillOnTargetSession) {
        context.isTranscribingVoice = false;
        context.transcribingSeconds = 0;
        context.voiceDraftText = trimmed;
        if (trimmed) {
          context.updateReaderForCurrentSession();
        } else {
          context.readerTitle = 'No Speech Detected';
          context.readerSubtitle = 'K20: Record again';
          context.readerLines = [
            'No speech was detected from microphone.',
            '',
            'Press [Talk] (K20) to record again.'
          ];
        }
        void paintMk20();
      } else {
        console.log(`[Voice] Background transcription completed for [${targetHarnessId}] session [${targetSessionObj?.id}]: "${trimmed.slice(0, 32)}...". Saved to session draft.`);
      }
    } catch (err) {
      clearInterval(activeTranscriptionTimer);
      if (targetSessionObj?.transcriptionCancelled || targetSessionObj?.voiceCaptureId!==capId) return;
      console.error(`[Voice] Transcription error on [${targetHarnessId}]:`, err.message);
      if (targetSessionObj) {
        targetSessionObj.isTranscribingVoice = false;
        targetSessionObj.transcribingSeconds = 0;
        targetSessionObj.lastDispatchError = err.message;
      }
      const activeHarness = context.getCurrentHarness();
      const activeSession = context.getCurrentSession();
      if (activeHarness?.id === targetHarnessId && activeSession === targetSessionObj) {
        context.isTranscribingVoice = false;
        context.transcribingSeconds = 0;
        context.voiceDraftText = '';
        context.readerTitle = 'Transcription Error';
        context.readerLines = [`Error: ${err.message}`, 'Press [Talk] (K20) to retry.'];
        void paintMk20();
      }
    }
  })().finally(async()=>{await mk20Ui.save(context.snapshotUi());});
  return transcriptionPromise;
}

async function paintMk20() {
  if (!mk20Online || !isActive()) return;
  try {
    void mk20Ui.save(context.snapshotUi()).catch(error=>console.error('MK20 state save failed:',error.code??error.message));
    const session=context.getCurrentSession(), preferences={model:'',effort:'',...context.getExecutionSettings(),view:context.viewMode,scroll:context.readerScrollLine,skinId:mk20.getActiveSkin().id};
    const selection={harnessPluginId:context.getCurrentHarness().id,harnessInstanceId:'default',...(session.sessionKey?{sessionKey:session.sessionKey}:{})};
    const previous=controllerStates.get(mk20ControllerId);
    if(JSON.stringify(previous.selection)!==JSON.stringify(selection)||JSON.stringify(previous.preferences)!==JSON.stringify(preferences))controllerStates.update(mk20ControllerId,previous.revision,{selection,preferences});
    const payload = context.toPreviewPayload();
    await mk20.preview(payload);
  } catch (err) {
    console.error('[MK20 PREVIEW ERROR]:', err.message);
  }
}

// Initial paint and periodic heartbeat
await paintMk20();
compositionReady=true;
clearInterval(startupHeartbeat);
const timer = setInterval(() => { void paintMk20(); }, 1200);
startupCleanup.push(()=>clearInterval(timer));
void speechPreparation.then(async plan=>{
  if(!isActive()||!compositionReady)return;
  const provider=new LocalWhisperProvider(plan.selectedSttModel,targetAddress,plan.modelsDir,plan.selectedBackend,new AudioTransport(targetAddress,undefined,7702,leaseToken,localBindIp));
  voice=provider;
  try{await provider.ready();if(!isActive()||!compositionReady){provider.close();return;}context.sttEngineLabel=`${plan.selectedSttModel.toUpperCase()} ${plan.selectedBackend.toUpperCase()}`;}
  catch(error){voiceError=error.message;context.sttEngineLabel='Speech unavailable';}
  await paintMk20();
}).catch(error=>{voiceError=error.message;if(isActive()&&compositionReady){context.sttEngineLabel='Speech unavailable';void paintMk20();}console.warn('Speech preparation failed:',error.message);});

// MK20 Hardware Input Dispatcher
async function handleMk20Input(input) {
  if(!isActive())return;
  if (input.kind !== 'presence') {
    console.log('[MK20 INPUT RECEIVED]:', input);
  }
  try {

  if (input.kind === 'knob-turn') {
    if (input.knob === 'left') {
      context.onLeftKnob(input.delta);
    } else if (input.knob === 'right') {
      context.onRightKnob(input.delta);
      if (tts?.setVolume) tts.setVolume((context.volume || 0) / 100, context.isMuted);
    }
    void paintMk20();
    return;
  }

  if (input.kind === 'knob-click') {
    if (input.knob === 'left') {
      const wasEditor = context.activeEditor;
      await context.onLeftKnobClick();
      if (['project', 'session', 'harness', 'machine'].includes(wasEditor)) {
        await loadCurrentSessionTurns();
      }
    } else if (input.knob === 'right') {
      context.onRightKnobClick();
      if (tts?.setVolume) tts.setVolume((context.volume || 0) / 100, context.isMuted);
    }
    await paintMk20();
    return;
  }

  if (input.kind === 'button' && input.pressed) {
    const kid = parseInt(input.button.replace('key-', ''), 10);
    if (!kid || isNaN(kid)) return;
    if (context.viewMode === 'session' && [1, 20, 16].includes(kid) &&
        (!context.getCurrentHarness().isEnabled || context.getCurrentProject().id === 'none')) {
      context.lastDispatchError = 'Native CLI and a real project are required';
      context.updateReaderForCurrentSession(); await paintMk20(); return;
    }

    // ViewMode = workspace (Files modal)
    if (context.viewMode === 'workspace') {
      if (context.isWorkspaceViewerActive) {
        if (kid === 17) {
          context.closeWorkspaceViewer();
          context.viewMode = 'session';
          context.updateReaderForCurrentSession();
        } else if ([18, 19, 20].includes(kid)) {
          const pageStart = Math.floor(context.workspaceSelectedFileIdx / 3) * 3;
          const slot = [18, 19, 20].indexOf(kid);
          const targetIdx = pageStart + slot;
          if (targetIdx < context.workspaceFiles.length) {
            if (targetIdx === context.workspaceSelectedFileIdx) {
              // Pressing active file exits back to 4x4 browser mode
              context.closeWorkspaceViewer();
            } else {
              const targetItem = context.workspaceFiles[targetIdx];
              if (targetItem.isDir) {
                context.closeWorkspaceViewer();
                if (targetItem.name === '..') {
                  const isAtRoot = path.normalize(context.filePath).toLowerCase() === path.normalize(context.fileRoot).toLowerCase();
                  const parent = isAtRoot ? context.fileRoot : path.dirname(context.filePath);
                  await context.readWorkspaceFiles(parent);
                } else {
                  await context.readWorkspaceFiles(path.join(context.filePath, targetItem.name));
                }
              } else {
                await context.openFileContent(targetIdx, targetItem.name);
              }
            }
          }
        }
        void paintMk20();
        return;
      }

      // Mode 1: 4x4 Full File Browser Mode
      if (kid === 17) {
        context.viewMode = 'session';
        context.updateReaderForCurrentSession();
      } else if (kid === 18) {
        const isAtRoot = path.normalize(context.filePath).toLowerCase() === path.normalize(context.fileRoot).toLowerCase();
        const parent = isAtRoot ? context.fileRoot : path.dirname(context.filePath);
        await context.readWorkspaceFiles(parent);
      } else if (kid === 19) {
        await context.readWorkspaceFiles(context.fileRoot);
      } else {
        // Check 16 keys grid
        const gridRows = [
          [13, 9, 5, 1],
          [14, 10, 6, 2],
          [15, 11, 7, 3],
          [16, 12, 8, 4]
        ];
        for (let r = 0; r < 4; r++) {
          const cIdx = gridRows[r].indexOf(kid);
          if (cIdx >= 0) {
            const fIdx = context.workspaceScrollRow * 4 + r * 4 + cIdx;
            if (fIdx < context.workspaceFiles.length) {
              context.workspaceCursorIdx = fIdx;
              const f = context.workspaceFiles[fIdx];
              if (f.isDir) {
                if (f.name === '..') {
                  const isAtRoot = path.normalize(context.filePath).toLowerCase() === path.normalize(context.fileRoot).toLowerCase();
                  const parent = isAtRoot ? context.fileRoot : path.dirname(context.filePath);
                  await context.readWorkspaceFiles(parent);
                } else {
                  await context.readWorkspaceFiles(path.join(context.filePath, f.name));
                }
              } else {
                await context.openFileContent(fIdx, f.name);
              }
            }
            break;
          }
        }
      }
      void paintMk20();
      return;
    }

    // ViewMode = changes (Git diff modal)
    if (context.viewMode === 'changes') {
      if (kid === 17 || kid === 7) {
        context.viewMode = 'session';
        context.updateReaderForCurrentSession();
      } else if ([18, 19, 20].includes(kid)) {
        const i = context.changesFilePage * 3 + [18, 19, 20].indexOf(kid);
        if (i < context.changedFiles.length) {
          if (context.isChangesFileSelected && context.selectedChangedFileIdx === i) {
            context.isChangesFileSelected = false;
            context.updateReaderForCurrentSession();
          } else {
            const diffLines = await GitProvider.getFileDiff(context.changedFiles[i].path, context.getCurrentProject().path);
            context.selectChangesFile(i, diffLines);
          }
        }
      }
      void paintMk20();
      return;
    }

    // ViewMode = settings
    if (context.viewMode === 'settings') {
      if (kid === 17) {
        context.viewMode = 'session';
        context.updateReaderForCurrentSession();
      }
      void paintMk20();
      return;
    }

    // ViewMode = session
    if (kid === 17) {
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      }
      context.cycleMachine();
      await loadCurrentSessionTurns();
      context.updateReaderForCurrentSession();
      void paintMk20();
    } else if (kid === 13) {
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      }
      context.cycleHarness();
      await loadCurrentSessionTurns();
      context.updateReaderForCurrentSession();
      void paintMk20();
    } else if (kid === 9) {
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      }
      context.openEditor('project');
      void paintMk20();
    } else if (kid === 5) {
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      }
      context.openEditor('session');
      void paintMk20();
    } else if (kid === 1) {
      // New session
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      }
      context.activeEditor = 'none';
      const newSessionId = `s-${Date.now().toString(36)}`;
      const newSession = {
        id: newSessionId,
        title: 'New task',
        preview: 'Start fresh conversation',
        createdAt: Date.now(),
        model: context.models[context.selectedModelIdx],
        effort: context.efforts[context.selectedEffortIdx],
        access: context.accessLevels[context.selectedAccessIdx] || 'on-request',
        turnCount: 0,
        turns: [],
        voiceDraftText: '',
        voiceSubmission: 'idle',
        lastDispatchError: null
      };
      const scopeKey = context.getFullScopeKey();
      if (!context.sessionsByScope[scopeKey]) {
        context.sessionsByScope[scopeKey] = [];
      }
      context.saveActiveSessionState();
      context.setSessionTurns([]);
      context.sessionsByScope[scopeKey].unshift(newSession);
      context.selectedSessionIdx = 0;
      context.memorySessionPerProject.set(scopeKey, newSessionId);
      context.restoreActiveSessionState();
      context.updateReaderForCurrentSession();
      void paintMk20();
    } else if (kid === 18) {
      context.openEditor('model');
    } else if (kid === 14) {
      context.openEditor('effort');
    } else if (kid === 10) {
      context.openEditor('access');
    } else if (kid === 6) {
      context.activeEditor = 'none';
      await context.readWorkspaceFiles(context.getCurrentProject().path || process.cwd());
    } else if (kid === 2) {
      context.activeEditor = 'none';
      context.viewMode = 'settings';
      context.updateReaderForCurrentSession();
    } else if ([19, 15, 11, 7, 3].includes(kid)) {
      if (context.activeEditor !== 'none') {
        const field = context.activeEditor;
        const choiceOffset = [19, 15, 11, 7, 3].indexOf(kid);
        context.commitActiveEditorChoice(context.editorChoiceWindowStart + choiceOffset);
        if (['project', 'session', 'machine', 'harness'].includes(field)) {
          await loadCurrentSessionTurns();
        }
      } else {
        if (kid === 19) {
          context.jumpPrevPrompt();
        } else if (kid === 15) {
          context.jumpNextPrompt();
        } else if (kid === 11) {
          context.toggleDetails();
        } else if (kid === 7) {
          const files = await GitProvider.getChangedFiles(context.getCurrentProject().path || process.cwd());
          context.openChangesView(files);
          if (files.length > 0) {
            const diffLines = await GitProvider.getFileDiff(files[0].path, context.getCurrentProject().path || process.cwd());
            context.selectChangesFile(0, diffLines);
          }
        }
      }
    } else if (kid === 20) {
      if(controlPaused&&!context.isRecordingVoice){context.readerTitle='Control paused';context.readerLines=['Resume control from the Snowball tray or Web UI.'];void paintMk20();return;}
      if(!voice||voiceError){context.readerTitle=voiceError?'Speech unavailable':'Preparing speech';context.readerLines=[voiceError||'The speech model is preparing in the background.','Projects and sessions remain available.'];void paintMk20();return;}
      if (context.isSpeaking) {
        await stopSpeaking();
      }
      // Talk (Voice input)
      if (context.isTranscribingVoice || (activeAudioCapture && !context.isRecordingVoice)) {
        return;
      }
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      } else {
        // Start physical MK20 recording bound to current session
        const curHarness = context.getCurrentHarness();
        const curSess = context.getCurrentSession();
        const capId = `cap_${Date.now()}`;
        activeAudioCapture = {
          captureId: capId,
          hostId, controllerId:mk20ControllerId, leaseToken,
          harnessId: curHarness.id,
          sessionObj: curSess
        };
        currentVoiceCaptureId=capId;
        context.isRecordingVoice = false;
        context.isTranscribingVoice = false;
        context.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        context.lastDispatchError = null;
        if (curSess) {
          curSess.voiceCaptureId=capId;
          curSess.isRecordingVoice = false;
          curSess.isTranscribingVoice = false;
          curSess.voiceDraftText = '';
          curSess.voiceSubmission = 'idle';
          curSess.lastDispatchError = null;
          curSess.transcriptionCancelled = false;
        }
        context.voiceDestinationLabel = curSess ? curSess.title : '';
        context.readerTitle='Starting microphone';
        context.readerLines=['Waiting for native audio and speech worker readiness'];
        void paintMk20();
        void (async()=>{try {
          await voice.start(capId);
          if(!isActive()||curSess?.voiceCaptureId!==capId){await voice.cancel(capId);return;}
          context.isRecordingVoice=true;if(curSess)curSess.isRecordingVoice=true;
          context.updateReaderForCurrentSession();await paintMk20();
        } catch (err) {
          console.error('[Voice] Start recording error:', err.message);
          if(curSess?.voiceCaptureId!==capId)return;
          context.isRecordingVoice = false;
          if (curSess) curSess.isRecordingVoice = false;
          activeAudioCapture = null;
          context.readerTitle = 'Microphone Error';
          context.readerLines = [`Failed to start recording: ${err.message}`, 'Check MK20 connection.'];
          void paintMk20();
        }})();
      }
    } else if (kid === 16) {
      if(controlPaused){context.readerTitle='Control paused';context.readerLines=['Resume control from the Snowball tray or Web UI.'];void paintMk20();return;}
      // Send / Done / Reconcile
      if (context.isTranscribingVoice) {
        return;
      }
      if (context.isRecordingVoice) {
        finishVoiceCapture();
      } else if (context.voiceSubmission === 'unknown') {
        // Reconcile delivery
        console.log('[Main] Reconciling unknown voice draft delivery...');
        const curSess = context.getCurrentSession();
        // Reading a thread is not proof that this particular draft was delivered.
        if (desktop.isConnected && curSess?.id) {
          try { await desktop.readThread(curSess.id, 5); } catch {}
        }
        context.lastDispatchError = 'Delivery remains unconfirmed. Check the native session; K4 discards the draft.';
        if (curSess) curSess.lastDispatchError = context.lastDispatchError;
        context.updateReaderForCurrentSession();
      } else if (context.voiceDraftText) {
        if(!context.getCurrentProject()?.path){context.lastDispatchError='Select a real project before Send';context.updateReaderForCurrentSession();await paintMk20();return;}
        // Send prompt
        context.lastDispatchError = null;
        const promptText = context.voiceDraftText;
        context.voiceDraftText = '';
        context.voiceSubmission = 'sending';
        context.updateReaderForCurrentSession();
        void paintMk20();

        const curHarness = context.getCurrentHarness();
        const curProj = context.getCurrentProject();
        const curSess = context.getCurrentSession();
        const targetSessionId = curSess?.id;
        const model = context.models[context.selectedModelIdx];
        const effort = context.efforts[context.selectedEffortIdx];
        const cwd = curProj.path;

        if (curSess) {
          curSess.voiceSubmission = 'sending';
          curSess.voiceDraftText = '';
          curSess.lastDispatchError = null;
        }

        const dispatchAbort = new AbortController();
        let dispatchStarted=false;
        const destinationScope = context.getFullScopeKey();
        nativeDispatches.set(curSess, dispatchAbort);
        // Non-blocking fire-and-forget background dispatch so MK20 never hangs
        void (async () => {
          try {
            await mk20Ui.save(context.snapshotUi());
            if(!isActive())throw Error("Machine selection changed before dispatch");
            if(controlPaused)throw Error('Control is paused');
            dispatchStarted=true;
            const result = await dispatchHarnessTurn({
              signal: dispatchAbort.signal,
              harnessId: curHarness.id,
              sessionId: targetSessionId,
              promptText,
              cwd,
              model,
              effort,
              onDelta: () => {}
            });

            const completedTurns = [
              {
                role: 'user',
                userPrompt: promptText,
                text: promptText,
                time: '방금'
              },
              {
                role: 'agent',
                agentResponse: result.response,
                text: result.response,
                time: '방금',
                processDetails: [`Harness: ${curHarness.name}`, `Model: ${model}`, `Effort: ${effort}`],
                status: 'completed'
              }
            ];

            if (curSess) {
              curSess.id = result.sessionId;
              if (curSess.title === 'New task' || curSess.title === 'New conversation') {
                curSess.title = promptText.slice(0, 32);
              }
              curSess.preview = promptText.slice(0, 60);
              const isBrandNewSession = targetSessionId && targetSessionId.startsWith('s-');
              const priorTurns = isBrandNewSession
                ? (curSess.turns || [])
                : (curSess.turns || realTurnsData?.[result.sessionId] || realTurnsData?.[targetSessionId] || []);
              curSess.turns = [...priorTurns, ...completedTurns];
              curSess.turnCount = curSess.turns.length;
              curSess.voiceSubmission = 'idle';
              curSess.voiceDraftText = '';
              curSess.lastDispatchError = null;

              const sessionScopeKey = destinationScope;
              curSess.sessionKey = formatSessionKey({hostId,harness:{pluginId:curHarness.id,instanceId:'default'},nativeSessionId:result.sessionId});
              journal.registerSession(curSess.sessionKey,'user');
              context.memorySessionPerProject.set(sessionScopeKey, result.sessionId);
            }

            if (realTurnsData) {
              const isBrandNewSession = targetSessionId && targetSessionId.startsWith('s-');
              const priorTurns = isBrandNewSession
                ? []
                : (realTurnsData[result.sessionId] || realTurnsData[targetSessionId] || []);
              const merged = [...priorTurns, ...completedTurns];
              realTurnsData[result.sessionId] = curSess?.turns || merged;
              if (targetSessionId && targetSessionId !== result.sessionId && !isBrandNewSession) {
                realTurnsData[targetSessionId] = curSess?.turns || merged;
              }
              if (curSess?.sessionKey) {
                realTurnsData[curSess.sessionKey] = curSess?.turns || merged;
              }
            }

            // Check if user is STILL viewing this exact harness & session on MK20
            const activeHarness = context.getCurrentHarness();
            const activeSession = context.getCurrentSession();
            const isViewingThisSession = activeHarness?.id === curHarness.id &&
              (activeSession?.id === curSess?.id || activeSession?.id === result.sessionId || activeSession === curSess);

            if (isViewingThisSession) {
              context.voiceSubmission = 'idle';
              context.voiceDraftText = '';
              context.lastDispatchError = null;
              context.setSessionTurns(curSess?.turns || completedTurns);
              context.updateReaderForCurrentSession();
              void paintMk20();
              if (context.autoTts && result.response) {
                void speakCurrentSession(result.response);
              }
            } else {
              console.log(`[Dispatch] Background turn complete for [${curHarness.id}] session [${result.sessionId}]. Persisted ${curSess?.turnCount || 2} turns in store.`);
            }
          } catch (err) {
            console.warn('[Main] Dispatch failed:', err.message);
            if (curSess) {
              curSess.voiceSubmission = dispatchStarted ? 'unknown' : 'error';
              curSess.lastDispatchError = err.message;
              curSess.voiceDraftText = promptText;
            }
            const activeHarness = context.getCurrentHarness();
            const activeSession = context.getCurrentSession();
            const isViewingThisSession = activeHarness?.id === curHarness.id &&
              (activeSession?.id === curSess?.id || activeSession === curSess);

            if (isViewingThisSession) {
              context.voiceSubmission = dispatchStarted ? 'unknown' : 'error';
              context.lastDispatchError = err.message;
              context.voiceDraftText = promptText;
              context.updateReaderForCurrentSession();
              void paintMk20();
            }
          }
        })().finally(async() => { if (nativeDispatches.get(curSess) === dispatchAbort) nativeDispatches.delete(curSess); await mk20Ui.save(context.snapshotUi()); }).catch(error=>console.error('MK20 operation state save failed:',error.message));
      }
    } else if (kid === 12) {
      // Speak on MK20 Hardware Speaker (Key 12)
      console.log(`[Main] Speak on MK20 (K12) pressed. isSpeakingDevice: ${context.isSpeakingDevice}, isSpeaking: ${context.isSpeaking}`);
      if (context.isSpeakingDevice) {
        await stopSpeaking();
      } else {
        void speakCurrentSession(null, 'device');
      }
      void paintMk20();
    } else if (kid === 8) {
      // Speak on Host PC/Mac Speaker (Key 8)
      console.log(`[Main] Speak on Host PC/Mac (K8) pressed. isSpeakingHost: ${context.isSpeakingHost}, isSpeaking: ${context.isSpeaking}`);
      if (context.isSpeakingHost) {
        await stopSpeaking();
      } else {
        void speakCurrentSession(null, 'host');
      }
      void paintMk20();
    } else if (kid === 4) {
      if (context.isSpeaking) {
        await stopSpeaking();
      }
      // Stop / Cancel / Discard
      const curSess = context.getCurrentSession();

      if (activeAudioCapture || context.isRecordingVoice || (curSess && curSess.isRecordingVoice)) {
        // Cancel active recording on this session
        context.isRecordingVoice = false;
        if (curSess) {curSess.isRecordingVoice=false;curSess.voiceCaptureId=null;}
        const capId = activeAudioCapture?.captureId || currentVoiceCaptureId;
        activeAudioCapture = null;
        currentVoiceCaptureId = null;
        if (capId) {
          void voice?.cancel(capId).catch(() => {});
        }
        context.voiceDraftText = '';
        if (curSess) curSess.voiceDraftText = '';
        context.lastDispatchError = null;
        context.updateReaderForCurrentSession();
      } else if (context.isTranscribingVoice || (curSess && curSess.isTranscribingVoice)) {
        // Cancel transcription on this session
        context.isTranscribingVoice = false;
        context.transcribingSeconds = 0;
        if (curSess) {
          curSess.isTranscribingVoice = false;
          curSess.transcribingSeconds = 0;
          curSess.transcriptionCancelled = true;
          curSess.voiceCaptureId=null;
        }
        context.voiceDraftText = '';
        if (curSess) curSess.voiceDraftText = '';
        context.lastDispatchError = null;
        context.updateReaderForCurrentSession();
      } else if (context.voiceDraftText || (curSess && curSess.voiceDraftText)) {
        // Discard draft on this session only
        context.voiceDraftText = '';
        if (curSess) curSess.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        if (curSess) curSess.voiceSubmission = 'idle';
        context.lastDispatchError = null;
        if (curSess) curSess.lastDispatchError = null;
        context.updateReaderForCurrentSession();
      } else if (context.voiceSubmission === 'sending' || (curSess && curSess.voiceSubmission === 'sending')) {
        const dispatch = nativeDispatches.get(curSess);
        if (dispatch) dispatch.abort();
        context.lastDispatchError = dispatch ? 'Native interruption requested; waiting for exit' : 'No owned dispatch process to interrupt';
        context.updateReaderForCurrentSession();
      } else if (context.voiceSubmission === 'unknown' || (curSess && curSess.voiceSubmission === 'unknown')) {
        context.voiceDraftText = '';
        if (curSess) curSess.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        if (curSess) curSess.voiceSubmission = 'idle';
        context.updateReaderForCurrentSession();
      } else {
        context.activeEditor = 'none';
        context.viewMode = 'session';
        context.updateReaderForCurrentSession();
      }
    }

    void paintMk20();
  }
  } catch (err) {
    console.error('[MK20 INPUT ERROR]:', err);
  }
}
// One physical controller processes actions in arrival order. Native dispatch
// remains asynchronous; a slow file/session read cannot reorder later choices.
let mk20InputQueue=Promise.resolve(),mk20Pending=0;
mk20.on('lab.input',input=>{
  if(!isActive())return;
  if(input.kind==='presence'||mk20Pending>=100)return;
  mk20Pending++;
  mk20InputQueue=mk20InputQueue.then(()=>handleMk20Input(input)).catch(error=>console.error('MK20 input failed:',error.code??error.message)).finally(()=>{mk20Pending--;});
});

console.log('====================================================');
console.log('  RUNNING DAEMON (Press Ctrl+C to stop)');
console.log('====================================================');

return async () => {
  compositionReady=false;mk20Online=false;
  mk20Device.release();
  clearInterval(startupHeartbeat);
  clearInterval(timer);
  if(activeAudioCapture)finishVoiceCapture();
  if(closing)voice?.close();
  if (tts) { await tts.stop().catch(()=>{}); try { tts.close(); } catch {} }
  if(transcriptionPromise)await transcriptionPromise.catch(()=>{});
  voice?.close();
  await mk20Ui.save(context.snapshotUi());
  clearInterval(activeTranscriptionTimer);
  await mk20.close();
  await mk20Ui.flush();
  await desktop.close?.();
};
} catch(error) {compositionReady=false;for(const release of startupCleanup.reverse()){try{await release();}catch{}}throw error;}
}

let closeDevice = async () => {}, closing = false, discoveryRetry;
const cleanup = async (code = 0) => {
  if (closing) return; closing = true;
  clearInterval(discoveryRetry);
  clearInterval(bootstrapTimer);
  speechAbort.abort();
  for(const cached of mk20Contexts.values())for(const operation of cached.nativeDispatches.values())operation.abort();
  await closeDevice();
  await api.close();
  await sources.close();
  await controllerPersistence.close();
  await suite?.close();
  store.close(); journal.close();
  process.exit(typeof code === 'number' ? code : 0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('disconnect', cleanup);
process.on('message', message => { if (message === 'snowball.stop') void cleanup(); });
async function openMk20Discovery() {
  let bind;
  try {bind=chooseLanAddress(undefined,process.env.SNOWBALL_BIND);}
  catch(error) {if(process.env.SNOWBALL_DEVICE_LAN_OPTIONAL==='1'&&!process.env.SNOWBALL_BIND)return false;throw error;}
  const dispose=await startMk20Lan({hostId,name:os.hostname(),bind,startRuntime:startMk20Runtime});
  if(closing){await dispose();return true;}
  closeDevice=dispose;
  console.log('MK20 discovery ready on LAN; select this machine on MK20 (K17).');
  return true;
}
try { if (profile === 'mk20' && !await openMk20Discovery()) {
  console.warn('MK20 discovery waiting for an unambiguous private LAN adapter; Web UI remains available. Use --bind if needed.');
  let starting=false;
  discoveryRetry=setInterval(async()=>{
    if(closing||starting)return;starting=true;
    try{if(await openMk20Discovery())clearInterval(discoveryRetry);}catch(error){console.error(error.message);await cleanup(1);}finally{starting=false;}
  },5000);
} }
catch (error) { console.error(error.message); await cleanup(1); }
if(process.connected&&!closing)process.send({kind:'runtime-ready',origin:api.origin});
