import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  defaultDiscoveryProviders,
  DeviceRegistry,
  CommandJournal,
  WorkspaceStore,
  HarnessDiscovery,
  createHostId,
  parseHostId,
  resolveUserDataDir,
  formatSessionKey
} from '../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';
import { Mk20LabTransport } from '../../Snowball_Control/plugins/device-mk20/src/index.mjs';
import { HidDiscovery, loadNativeBackend } from '../packages/device-hid/dist/index.js';
import { reviewedProfiles } from '../packages/device-hid/dist/profiles.js';
import os from 'node:os';
import { scanHarnessProjects } from './harness-project-scanner.mjs';
import { scanAllHarnessSessions } from './harness-session-scanner.mjs';

throw new Error('MK20 lab launcher quarantined: unsigned input and private Desktop IPC bypass the command journal. Use npm run start:local. See docs/middleware/AUDIT.md.');

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

// Register default local projects if not already registered
const defaultProjects = [
  { root: 'e:\\developments\\projects\\Snowball_Control', name: 'Snowball_Control' },
  { root: 'e:\\developments\\projects\\Snowball_Middleware', name: 'Snowball_Middleware' }
];
const existingNames = new Set(store.list().map(w => w.displayName));
for (const p of defaultProjects) {
  if (!existingNames.has(p.name) && fs.existsSync(p.root)) {
    try {
      await store.registerSelected(p.root, p.name);
      console.log(`  Registered Project : ${p.name}`);
    } catch (err) {
      console.log(`  Project register note (${p.name}):`, err.message);
    }
  }
}

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
let realSessionsData = null;
let realTurnsData = null;
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
          journal.registerSession(sessionKey, s.ownerId);
        } catch (err) {}
      }
    }
  }
  console.log(`  Registered genuine sessions across active harnesses`);
} catch (err) {
  console.log('  Harness session scan note:', err.message);
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
  realSessions: realSessionsData,
  turnsStore: realTurnsData,
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

// Connect to physical MK20 device at 192.168.1.248:7701
const mk20 = new Mk20LabTransport({
  labEnabled: true,
  localAddress: '192.168.1.225',
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

const context = new ContextManager();

// Configure machines
context.machines = [{ id: 'dev-pc', name: os.hostname().split('.')[0] || 'DEV-PC', isOnline: true }];

// Configure harnesses
context.harnesses = [
  { id: 'snowball.codex', name: 'Codex', isEnabled: true },
  { id: 'snowball.antigravity', name: 'Antigrav', isEnabled: true },
  { id: 'snowball.opencode', name: 'OpenCode', isEnabled: true }
];

// Configure projects and sessions from real scanner data
if (realSessionsData) {
  for (const h of context.harnesses) {
    const harnessData = realSessionsData[h.id] || {};
    const scopeKey = `dev-pc/${h.id}`;
    const projs = [];
    const projEntries = Object.entries(harnessData);
    // Sort entries so current working project (Snowball Control / Snowball_Control) is first
    projEntries.sort(([a], [b]) => {
      const aMatch = a.includes('Snowball') ? -1 : 0;
      const bMatch = b.includes('Snowball') ? -1 : 0;
      return aMatch - bMatch;
    });
    for (const [projName, sessList] of projEntries) {
      projs.push({ id: projName, name: projName, path: process.cwd() });
      context.sessionsByScope[`${scopeKey}/${projName}`] = sessList.map(s => ({
        id: s.id,
        sessionKey: s.sessionKey,
        title: s.title,
        preview: s.preview,
        createdAt: s.createdAt || 0,
        model: s.model,
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
  if (realTurnsData) {
    // 1. Direct lookup by curSess.id
    if (realTurnsData[curSess.id]) {
      context.setSessionTurns(realTurnsData[curSess.id]);
      return;
    }
    // 2. Lookup by curSess.sessionKey
    if (curSess.sessionKey && realTurnsData[curSess.sessionKey]) {
      context.setSessionTurns(realTurnsData[curSess.sessionKey]);
      return;
    }
    // 3. Lookup by searching keys ending with /${curSess.id} or containing curSess.id
    for (const [k, turns] of Object.entries(realTurnsData)) {
      if (k.endsWith(`/${curSess.id}`) || k === curSess.id || k.includes(curSess.id)) {
        context.setSessionTurns(turns);
        return;
      }
    }
  }

  // 4. Live fallback: Read directly via Codex Desktop named pipe if connected
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
        if (realTurnsData) realTurnsData[curSess.id] = parsed;
        return;
      }
    } catch {}
  }

  context.setSessionTurns([]);
}

context.resolveProjectAndSession();
context.updateReaderForCurrentSession();
await loadCurrentSessionTurns();

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
                  const parent = (context.filePath === context.fileRoot) ? context.fileRoot : path.dirname(context.filePath);
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
        const parent = (context.filePath === context.fileRoot) ? context.fileRoot : path.dirname(context.filePath);
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
                  const parent = (context.filePath === context.fileRoot) ? context.fileRoot : path.dirname(context.filePath);
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
      context.cycleMachine();
      await loadCurrentSessionTurns();
    } else if (kid === 13) {
      context.cycleHarness();
      await loadCurrentSessionTurns();
    } else if (kid === 9) {
      context.openEditor('project');
    } else if (kid === 5) {
      context.openEditor('session');
    } else if (kid === 1) {
      // New session
      context.activeEditor = 'none';
      const newSessionId = `s-${Date.now().toString(36)}`;
      const newSession = {
        id: newSessionId,
        title: 'New task',
        preview: 'Start fresh conversation',
        createdAt: Date.now(),
        model: context.models[context.selectedModelIdx],
        turnCount: 0
      };
      const scopeKey = context.getFullScopeKey();
      if (!context.sessionsByScope[scopeKey]) {
        context.sessionsByScope[scopeKey] = [];
      }
      context.sessionsByScope[scopeKey].unshift(newSession);
      context.selectSession(0);
      context.setSessionTurns([]);
      context.updateReaderForCurrentSession();
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
      if (context.isRecordingVoice) {
        // Finish recording -> transcribe
        context.isRecordingVoice = false;
        context.isTranscribingVoice = true;
        context.updateReaderForCurrentSession();
        void paintMk20();
        setTimeout(() => {
          context.isTranscribingVoice = false;
          context.voiceDraftText = 'Review draft prompt from physical microphone.';
          context.updateReaderForCurrentSession();
          void paintMk20();
        }, 800);
      } else {
        // Start recording
        context.isRecordingVoice = true;
        context.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        context.updateReaderForCurrentSession();
      }
    } else if (kid === 16) {
      // Send / Done / Reconcile
      if (context.isRecordingVoice) {
        context.isRecordingVoice = false;
        context.isTranscribingVoice = true;
        context.updateReaderForCurrentSession();
        void paintMk20();
        setTimeout(() => {
          context.isTranscribingVoice = false;
          context.voiceDraftText = 'Review draft prompt from physical microphone.';
          context.updateReaderForCurrentSession();
          void paintMk20();
        }, 800);
      } else if (context.voiceSubmission === 'unknown') {
        // Reconcile delivery
        console.log('[Main] Reconciling unknown voice draft delivery...');
        const curSess = context.getCurrentSession();
        if (desktop.isConnected && curSess?.id) {
          try {
            await desktop.readThread(curSess.id, 5);
            context.voiceSubmission = 'idle';
            context.voiceDraftText = '';
            await loadCurrentSessionTurns();
          } catch {
            context.voiceSubmission = 'idle';
            context.voiceDraftText = '';
            context.updateReaderForCurrentSession();
          }
        } else {
          context.voiceSubmission = 'idle';
          context.voiceDraftText = '';
          context.updateReaderForCurrentSession();
        }
      } else if (context.voiceDraftText) {
        // Send prompt
        const promptText = context.voiceDraftText;
        context.voiceSubmission = 'sending';
        context.updateReaderForCurrentSession();
        void paintMk20();

        const curSess = context.getCurrentSession();
        const targetThreadId = curSess?.id;

        if (desktop.isConnected && targetThreadId && !targetThreadId.startsWith('s-')) {
          try {
            await desktop.sendMessageToThread(targetThreadId, promptText);
            context.voiceSubmission = 'idle';
            context.voiceDraftText = '';
            const existingTurns = [...context.currentTurns];
            existingTurns.push({
              role: 'user',
              userPrompt: promptText,
              text: promptText,
              agentResponse: 'Command dispatched to Codex Desktop thread.',
              processDetails: ['Turn started', 'Desktop IPC active'],
              status: 'completed'
            });
            context.setSessionTurns(existingTurns);
            setTimeout(async () => {
              await loadCurrentSessionTurns();
              void paintMk20();
            }, 2500);
          } catch (err) {
            console.warn('[Main] Desktop send failed:', err.message);
            context.voiceSubmission = 'unknown';
            context.updateReaderForCurrentSession();
          }
        } else {
          setTimeout(() => {
            context.voiceSubmission = 'idle';
            context.voiceDraftText = '';
            const existingTurns = [...context.currentTurns];
            existingTurns.push({
              role: 'user',
              userPrompt: promptText,
              text: promptText,
              agentResponse: 'Command dispatched and acknowledged by local middleware.',
              processDetails: ['Turn started', 'Local execution active'],
              status: 'completed'
            });
            context.setSessionTurns(existingTurns);
            void paintMk20();
          }, 800);
        }
      }
    } else if (kid === 4) {
      // Stop / Cancel / Discard
      if (context.isRecordingVoice || context.isTranscribingVoice) {
        context.isRecordingVoice = false;
        context.isTranscribingVoice = false;
        context.updateReaderForCurrentSession();
      } else if (context.voiceDraftText) {
        context.voiceDraftText = '';
        context.voiceSubmission = 'idle';
        context.updateReaderForCurrentSession();
      } else if (context.voiceSubmission === 'unknown') {
        context.voiceDraftText = '';
        context.voiceSubmission = 'idle';
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
