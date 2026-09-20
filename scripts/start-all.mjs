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
  resolveUserDataDir
} from '../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';
import { Mk20LabTransport } from '../../Snowball_Control/plugins/device-mk20/src/index.mjs';
import { HidDiscovery, loadNativeBackend } from '../packages/device-hid/dist/index.js';
import { reviewedProfiles } from '../packages/device-hid/dist/profiles.js';

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
  noAuth: true,
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

// Map of MK20 physical keys to labels
const keyLabels = [
  { id: 1, top: 'Turn', main: 'APPROVE', flags: 1 },
  { id: 2, top: 'Turn', main: 'REJECT', flags: 2 },
  { id: 3, top: 'Turn', main: 'RETRY', flags: 0 },
  { id: 4, top: 'Turn', main: 'CANCEL', flags: 4 },
  { id: 5, top: 'Harness', main: 'CODEX', flags: 1 },
  { id: 6, top: 'Harness', main: 'ANTIGRAV', flags: 1 },
  { id: 7, top: 'View', main: 'PLAN', flags: 0 },
  { id: 8, top: 'View', main: 'DIFF', flags: 0 },
  { id: 9, top: 'Files', main: 'BROWSE', flags: 0 },
  { id: 10, top: 'Files', main: 'CHANGES', flags: 0 },
  { id: 11, top: 'Voice', main: 'TALK', flags: 1 },
  { id: 12, top: 'Voice', main: 'SEND', flags: 2 },
  { id: 13, top: 'Proj', main: 'LIST', flags: 0 },
  { id: 14, top: 'Proj', main: 'SWITCH', flags: 0 },
  { id: 15, top: 'Session', main: 'NEW', flags: 1 },
  { id: 16, top: 'Session', main: 'ATTACH', flags: 0 },
  { id: 17, top: 'Action', main: 'OK', flags: 1 },
  { id: 18, top: 'Action', main: 'BACK', flags: 0 },
  { id: 19, top: 'Action', main: 'UP', flags: 0 },
  { id: 20, top: 'Action', main: 'DOWN', flags: 0 }
];

let tick = 0;
async function paintMk20() {
  if (!mk20Online) return;
  tick++;
  const activeHarnesses = harness.describe().candidates.filter(c => c.controllable).map(c => c.id.replace('snowball.', '')).join(', ') || 'Codex, Antigrav';
  const projects = store.list();
  const projName = projects[0]?.displayName || 'Snowball_Control';

  try {
    await mk20.preview({
      title: 'Snowball Middleware',
      subtitle: `Online: ${api.origin}`,
      lines: [
        `Web UI: ${api.origin}/`,
        `Project: ${projName} (${projects.length} loaded)`,
        `Harnesses: ${activeHarnesses}`,
        `Status: READY (tick #${tick})`
      ],
      scroll: 0,
      totalLines: 4,
      volume: 60,
      muted: false,
      keys: keyLabels
    });
  } catch (err) {
    // ignore transient network error
  }
}

// Initial paint and periodic heartbeat
await paintMk20();
const timer = setInterval(() => { void paintMk20(); }, 1500);

mk20.on('lab.input', input => {
  console.log('[MK20 INPUT RECEIVED]:', input);
  void paintMk20();
});

console.log('====================================================');
console.log('  RUNNING DAEMON (Press Ctrl+C to stop)');
console.log('====================================================');

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
