import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import {
  defaultDiscoveryProviders,
  DeviceRegistry,
  CommandJournal,
  WorkspaceStore,
  HarnessDiscovery,
  createHostId,
  parseHostId,
  resolveUserDataDir,
  formatSessionKey,
  parseSessionKey,
  loadSttConfig,
  resolveSttModel,
  resolveModelsDir
} from '../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';
import { Mk20LabTransport } from '../../Snowball_Control/plugins/device-mk20/src/index.mjs';
import { HidDiscovery, loadNativeBackend } from '../packages/device-hid/dist/index.js';
import { reviewedProfiles } from '../packages/device-hid/dist/profiles.js';
import os from 'node:os';
import { scanHarnessProjects } from './harness-project-scanner.mjs';
import { scanAllHarnessSessions } from './harness-session-scanner.mjs';
import { scanAllHarnessCatalogs } from './harness-catalog-scanner.mjs';
import { installedHarnessVersions } from './harness-runtime.mjs';
import { dispatchHarnessTurn } from './harness-dispatch.mjs';

const directory = ensurePrivateStateDirectory(resolveUserDataDir());
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
const devices = new DeviceRegistry();
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
  const harnessProjectsMap = scanHarnessProjects();
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
  const { sessionsByHarness, turnsStore } = scanAllHarnessSessions();
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

const installedVersions = installedHarnessVersions();
console.log('Harness installations:', installedVersions);
const connectedHarnesses = Object.entries(installedVersions).map(([kind, info]) => ({
  pluginId: `snowball.${kind}`, instanceId: 'default', connected: info.available,
  canCreate: false, canAttach: info.available, canListModels: info.available,
}));

async function handleListModels(pluginId, instanceId) {
  const catalogs = scanAllHarnessCatalogs();
  const list = catalogs[pluginId] || [];
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

        const activeSession = typeof context !== 'undefined' ? context?.getCurrentSession?.() : null;
        if (activeSession && (activeSession.id === nativeSessionId || activeSession.id === result.sessionId)) {
          activeSession.turns = realTurnsData[result.sessionId];
          context.setSessionTurns(activeSession.turns);
          context.updateReaderForCurrentSession();
          void paintMk20();
        }

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
  harness,
  supervisor,
  port: 8765,
  hostname: os.hostname(),
  noAuth: true,
  realSessions: realSessionsData,
  turnsStore: realTurnsData,
  connectedHarnesses,
  listModels: handleListModels,
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
setInterval(refreshCode, 30_000);

console.log('====================================================');
console.log('  SNOWBALL MIDDLEWARE IS ONLINE');
console.log('====================================================');
console.log(`  Web Supervisor URL : ${api.origin}/`);
console.log(`  Bootstrap Code     : ${currentBootstrap?.code}`);
console.log('====================================================');

function findLocalBindAddress() {
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wifi') || name.toLowerCase().includes('wlan')) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.1.')) {
          return a.address;
        }
      }
    }
  }
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.1.')) {
        return a.address;
      }
    }
  }
  return '192.168.1.197';
}

const localBindIp = findLocalBindAddress();
console.log(`  Local MK20 Bind IP : ${localBindIp}`);

// Start loopback ADB Wi-Fi relay for dual-homed PC so audio capture and screen inspection work cleanly
try {
  const adbRelay = net.createServer((client) => {
    const upstream = net.connect({
      host: '192.168.1.248',
      port: 5555,
      localAddress: localBindIp
    });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  adbRelay.listen(15555, '127.0.0.1', () => {
    console.log(`  MK20 ADB Relay     : READY (127.0.0.1:15555 -> 192.168.1.248:5555 via ${localBindIp})`);
    try {
      const adbTool = path.join(process.env.LOCALAPPDATA || '', 'Temp', 'Codex-MK20-ADB', 'platform-tools', 'adb.exe');
      if (fs.existsSync(adbTool)) {
        execFileSync(adbTool, ['connect', '127.0.0.1:15555'], { windowsHide: true });
        console.log(`  MK20 ADB Tool      : CONNECTED (127.0.0.1:15555)`);
      }
    } catch {}
  });
  adbRelay.on('error', () => {});
} catch {}

// Connect to physical MK20 device at 192.168.1.248:7701
const mk20 = new Mk20LabTransport({
  labEnabled: true,
  localAddress: localBindIp,
  targetAddress: '192.168.1.248',
  targetPort: 7701
});

let mk20Online = false;
try {
  await mk20.start();
  mk20Online = true;
  console.log('  MK20 LAN Hardware  : CONNECTED (192.168.1.248:7701)');

  // Register MK20 LAN device in DeviceRegistry
  const lanSource = { pluginId: 'plugin.mk20', instanceId: 'desk-terminal' };
  const lanGen = devices.beginScan(lanSource);
  const lanCand = devices.observe(lanSource, lanGen, {
    nativeDeviceId: 'mk20-lan-192.168.1.248:7701',
    label: 'MK20 Smart Desk Terminal (192.168.1.248:7701)',
    transport: 'lan',
    capabilities: ['button', 'select-session', 'display'],
    supported: true,
    verifiedIdentity: 'mk20-hw-192.168.1.248',
  });
  devices.finishScan(lanSource, lanGen, 'ready');
  if (lanCand) {
    devices.register(lanCand.candidateId, lanGen);
  }
} catch (err) {
  console.log('  MK20 LAN Hardware  : FAILED (' + err.message + ')');
}

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
      verifiedIdentity: `mk20-qmk-${mk20Hid.vendorId}:${mk20Hid.productId}`,
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

import { ContextManager, GitProvider } from './context-manager.mjs';
import { CodexDesktopClient } from './codex-desktop-client.mjs';
import { LocalWhisperProvider } from '../../Snowball_Control/host/dist/audio/local-whisper.js';

const desktop = new CodexDesktopClient();
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

// --- Whisper STT Model Resolution & Boot Download Check ---
const sttConfig = loadSttConfig();
const modelsDir = resolveModelsDir(sttConfig);
fs.mkdirSync(modelsDir, { recursive: true });

// Ensure Python STT runtime and hardware accelerator libraries are installed
try {
  const depRes = await LocalWhisperProvider.ensureDependencies((msg) => {
    console.log(`  ${msg}`);
  });
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
    const out = execFileSync('python', [assessPy, '--json'], { encoding: 'utf8', windowsHide: true });
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

const devLabel = backendDeviceName ? ` (${backendDeviceName})` : '';
console.log(`  Whisper Model Plan : ${selectedSttModel} [${modelSelectionNote}] | Backend: ${selectedBackend.toUpperCase()}${devLabel}`);
console.log(`  Whisper Cache Dir  : ${modelsDir}`);

// Model Verification & Startup Download Check
try {
  const isDownloaded = await LocalWhisperProvider.isModelDownloaded(selectedSttModel, modelsDir);
  if (!isDownloaded) {
    console.log(`  Whisper Model DL   : Downloading '${selectedSttModel}' to local cache...`);
    const dlResult = await LocalWhisperProvider.ensureModelDownloaded(selectedSttModel, modelsDir, (msg) => {
      if (msg.includes('Download') || msg.includes('MB') || msg.includes('%')) {
        process.stdout.write(`\r    [Download] ${msg.slice(0, 65).padEnd(65)}`);
      }
    });
    if (!dlResult.ok) throw new Error(dlResult.error || 'Whisper model download was not confirmed');
    console.log(`\n  Whisper Model DL   : READY (${dlResult.status})`);
  } else {
    console.log(`  Whisper Model DL   : VERIFIED (Present in cache)`);
  }
} catch (dlErr) {
  console.warn(`  Whisper Model DL   : NOTE (${dlErr.message})`);
}

const voice = new LocalWhisperProvider(selectedSttModel, '127.0.0.1:15555', modelsDir, selectedBackend);
let currentVoiceCaptureId = null;
// Pre-warm local whisper resident worker
voice.status().catch(() => {});

const context = new ContextManager();
const nativeDispatches = new Map();
const shortGpu = backendDeviceName.includes('GeForce') ? 'RTX ' + backendDeviceName.split('GeForce')[1].trim().split(' ')[0] : (backendDeviceName.split(' ')[0] || '');
context.sttEngineLabel = `${selectedSttModel.toUpperCase()} ${selectedBackend.toUpperCase()}${shortGpu ? ' (' + shortGpu + ')' : ''}`;

// Configure machines
context.machines = [{ id: 'dev-pc', name: os.hostname().split('.')[0] || 'DEV-PC', isOnline: true }];

// Configure harnesses
context.harnesses = [
  { id: 'snowball.codex', name: 'Codex', isEnabled: installedVersions.codex.available },
  { id: 'snowball.antigravity', name: 'Antigrav', isEnabled: installedVersions.antigravity.available },
  { id: 'snowball.opencode', name: 'OpenCode', isEnabled: installedVersions.opencode.available }
];

// Discover and configure genuine living model catalogs dynamically for each harness
function refreshHarnessCatalogs() {
  try {
    const catalogs = scanAllHarnessCatalogs();
    for (const [pluginId, cat] of Object.entries(catalogs)) {
      if (Array.isArray(cat)) {
        context.setModelCatalog(cat, `dev-pc/${pluginId}`);
      }
    }
  } catch (err) {
    console.warn('[Catalog] Harness model discovery note:', err.message);
  }
}
refreshHarnessCatalogs();

context.accessLevels = ['Native policy'];

// Configure projects and sessions from real scanner data
if (realSessionsData) {
  for (const h of context.harnesses) {
    const harnessData = realSessionsData[h.id] || {};
    const scopeKey = `dev-pc/${h.id}`;
    const projs = [];
    const projEntries = Object.entries(harnessData);
    // Sort entries so current working project Snowball_Control is always prioritized first
    projEntries.sort(([a], [b]) => {
      if (a === 'Snowball_Control') return -1;
      if (b === 'Snowball_Control') return 1;
      if (a === 'Snowball_Middleware') return -1;
      if (b === 'Snowball_Middleware') return 1;
      return a.localeCompare(b);
    });
    for (const [projName, sessList] of projEntries) {
      const projPath = sessList.find(session => session.cwd && path.isAbsolute(session.cwd))?.cwd;
      if (!projPath || !fs.existsSync(projPath)) continue;
      projs.push({ id: projName, name: projName, path: projPath });
      context.sessionsByScope[`${scopeKey}/${projName}`] = sessList.map(s => ({
        id: s.id,
        sessionKey: s.sessionKey,
        title: s.title,
        preview: s.preview,
        createdAt: s.createdAt || 0,
        model: s.model,
        effort: s.effort,
        access: s.access || 'on-request',
        turnCount: s.turnCount
      }));
    }
    context.projectsByScope[scopeKey] = projs;
  }
}

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
        context.setSessionTurns(parsed);
        curSess.turns = parsed;
        if (realTurnsData) realTurnsData[curSess.id] = parsed;
        return;
      }
    } catch {}
  }

  // 4. Live fallback: Check rollout JSONL for Codex threads
  if (!curSess.id.startsWith('s-') && context.getCurrentHarness()?.id?.includes('codex')) {
    try {
      const pyScript = `import glob, os, json
sessions_dir = os.path.expanduser('~/.codex/sessions')
found = glob.glob(f"{sessions_dir}/**/rollout-*-${curSess.id}*.jsonl", recursive=True)
turns = []
if found:
    with open(found[0], 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            try:
                p = json.loads(line)
                if p.get('type') == 'response_item' and p.get('payload', {}).get('type') == 'message':
                    role = p['payload'].get('role')
                    text = '\\n'.join([c.get('text', '') for c in p['payload'].get('content', []) if isinstance(c, dict) and not c.get('text', '').startswith('<ctrl') and not c.get('text', '').startswith('# AGENTS')]).strip()
                    if text:
                        if role == 'user':
                            turns.append({'role': 'user', 'userPrompt': text, 'text': text, 'time': '최근'})
                        elif role == 'assistant':
                            turns.append({'role': 'agent', 'agentResponse': text, 'text': text, 'time': '최근', 'processDetails': []})
            except:
                pass
print(json.dumps(turns))
`;
      const out = execFileSync('python', ['-c', pyScript], { windowsHide: true, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0) {
        context.setSessionTurns(parsed);
        curSess.turns = parsed;
        if (realTurnsData) realTurnsData[curSess.id] = parsed;
        return;
      }
    } catch {}
  }

  context.setSessionTurns([]);
}

context.resolveProjectAndSession();
context.syncSessionSettings();
context.updateReaderForCurrentSession();
await loadCurrentSessionTurns();

let activeAudioCapture = null; // { captureId, harnessId, sessionObj }
let activeTranscriptionTimer = null;
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
    if (targetSessionObj) targetSessionObj.transcribingSeconds = sec;
    const activeSess = context.getCurrentSession();
    if (activeSess === targetSessionObj && context.isTranscribingVoice) {
      context.transcribingSeconds = sec;
      context.updateReaderForCurrentSession();
      void paintMk20();
    }
  }, 1000);

  // Background STT processing to ensure zero UI event blocking
  void (async () => {
    try {
      const text = await voice.finish(capId);
      clearInterval(activeTranscriptionTimer);

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
      if (targetSessionObj?.transcriptionCancelled) return;
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
  })();
}

async function paintMk20() {
  if (!mk20Online) return;
  try {
    const payload = context.toPreviewPayload();
    await mk20.preview(payload);
  } catch (err) {
    console.error('[MK20 PREVIEW ERROR]:', err.message);
  }
}

// Initial paint and periodic heartbeat
await paintMk20();
const timer = setInterval(() => { void paintMk20(); }, 1200);

// MK20 Hardware Input Dispatcher
mk20.on('lab.input', async (input) => {
  if (input.kind !== 'presence') {
    console.log('[MK20 INPUT RECEIVED]:', input);
  }
  try {

  if (input.kind === 'knob-turn') {
    if (input.knob === 'left') {
      context.onLeftKnob(input.delta);
    } else if (input.knob === 'right') {
      context.onRightKnob(input.delta);
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
      // Talk (Voice input)
      if (context.isTranscribingVoice) {
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
          harnessId: curHarness.id,
          sessionObj: curSess
        };
        context.isRecordingVoice = true;
        context.isTranscribingVoice = false;
        context.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        context.lastDispatchError = null;
        if (curSess) {
          curSess.isRecordingVoice = true;
          curSess.isTranscribingVoice = false;
          curSess.voiceDraftText = '';
          curSess.voiceSubmission = 'idle';
          curSess.lastDispatchError = null;
          curSess.transcriptionCancelled = false;
        }
        context.voiceDestinationLabel = curSess ? curSess.title : '';
        context.updateReaderForCurrentSession();
        void paintMk20();
        try {
          await voice.start(capId);
        } catch (err) {
          console.error('[Voice] Start recording error:', err.message);
          context.isRecordingVoice = false;
          if (curSess) curSess.isRecordingVoice = false;
          activeAudioCapture = null;
          context.readerTitle = 'Microphone Error';
          context.readerLines = [`Failed to start recording: ${err.message}`, 'Check MK20 connection.'];
          void paintMk20();
        }
      }
    } else if (kid === 16) {
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
        const cwd = curProj?.path || process.cwd();

        if (curSess) {
          curSess.voiceSubmission = 'sending';
          curSess.voiceDraftText = '';
          curSess.lastDispatchError = null;
        }

        const dispatchAbort = new AbortController();
        const destinationScope = context.getFullScopeKey();
        nativeDispatches.set(curSess, dispatchAbort);
        // Non-blocking fire-and-forget background dispatch so MK20 never hangs
        void (async () => {
          try {
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
              curSess.sessionKey = `${sessionScopeKey}/${result.sessionId}`;
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
            } else {
              console.log(`[Dispatch] Background turn complete for [${curHarness.id}] session [${result.sessionId}]. Persisted ${curSess?.turnCount || 2} turns in store.`);
            }
          } catch (err) {
            console.warn('[Main] Dispatch failed:', err.message);
            if (curSess) {
              curSess.voiceSubmission = 'idle';
              curSess.lastDispatchError = err.message;
              curSess.voiceDraftText = promptText;
            }
            const activeHarness = context.getCurrentHarness();
            const activeSession = context.getCurrentSession();
            const isViewingThisSession = activeHarness?.id === curHarness.id &&
              (activeSession?.id === curSess?.id || activeSession === curSess);

            if (isViewingThisSession) {
              context.voiceSubmission = 'idle';
              context.lastDispatchError = err.message;
              context.voiceDraftText = promptText;
              context.updateReaderForCurrentSession();
              void paintMk20();
            }
          }
        })().finally(() => { if (nativeDispatches.get(curSess) === dispatchAbort) nativeDispatches.delete(curSess); });
      }
    } else if (kid === 4) {
      // Stop / Cancel / Discard
      const curSess = context.getCurrentSession();

      if (context.isRecordingVoice || (curSess && curSess.isRecordingVoice)) {
        // Cancel active recording on this session
        context.isRecordingVoice = false;
        if (curSess) curSess.isRecordingVoice = false;
        const capId = activeAudioCapture?.captureId || currentVoiceCaptureId;
        activeAudioCapture = null;
        currentVoiceCaptureId = null;
        if (capId) {
          void voice.cancel(capId).catch(() => {});
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
});

console.log('====================================================');
console.log('  RUNNING DAEMON (Press Ctrl+C to stop)');
console.log('====================================================');

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

const cleanup = async () => {
  clearInterval(timer);
  await mk20.close();
  await api.close();
  store.close();
  journal.close();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
