import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandJournal, SessionService, SessionMetadataStore, SessionCreateStore, WorkspaceStore, HarnessDiscovery, DeviceRegistry, createHostId, parseHostId, resolveUserDataDir, recoverAbandonedJournalLock } from '../../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';
import { chooseNativeWorkspace } from './native-picker.mjs';
import { loadSettings, saveSettings } from './settings-store.mjs';

function loadHostId(directory) {
  const file = path.join(directory, 'host.v1.json');
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ version: 1, hostId: createHostId() }) + '\n'); fs.fsyncSync(fd);
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  if (fs.statSync(file).size > 1024) throw new Error('Host identity file too large');
  const identity = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (identity.version !== 1) throw new Error('Unsupported host identity');
  return parseHostId(identity.hostId);
}

function privateJournalDirectory(directory) {
  const checked = ensurePrivateStateDirectory(directory);
  const lockPath = path.join(checked, 'commands.lock');
  if (fs.existsSync(lockPath)) {
    // A crash may leave a lock after its owner died. The core helper rereads
    // the exact token and proves the PID is gone before removing only that lock.
    const { token } = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    recoverAbandonedJournalLock(checked, token);
  }
  return checked;
}

/** Local composition root for the CLI and native tray; no cloud control plane. */
export async function startLocalRuntime({ dataDir = resolveUserDataDir(), repositoryRoot = fileURLToPath(new URL('../..', import.meta.url)), providers = [], enableNativePicker = false, chooseWorkspace, connectCodex, disconnectCodex, resetCodex, devicePresence, mk20Lan, noAuth = true, createHarnessAdapters = async () => [], desktop } = {}) {
  // This boundary validates native privacy before any user registration is loaded.
  const directory = ensurePrivateStateDirectory(dataDir);
  const hostId = loadHostId(directory);
  const commandDir = privateJournalDirectory(path.join(directory, 'commands'));
  const workspaceDir = privateJournalDirectory(path.join(directory, 'workspaces'));
  let journal; let store; let metadata; let creates; let api; let sessions; let bindings = []; let deviceScanTimer; let deviceScanPromise;
  const dispatches = new Map(); let stopping = false;
  const discovery = new HarnessDiscovery();
  const devices = devicePresence || mk20Lan ? new DeviceRegistry() : undefined;
  const qmkSource = { pluginId: 'snowball.device-presence', instanceId: 'windows-qmk-hid' };
  const cdcSource = { pluginId: 'snowball.device-presence', instanceId: 'windows-product-cdc' };
  const lanSource = { pluginId: 'snowball.device-presence', instanceId: 'mk20-lan-lab' };
  const scanDevicePresence = () => {
    if (!devices || stopping) return Promise.resolve();
    if (deviceScanPromise) return deviceScanPromise;
    deviceScanPromise = (async () => {
    try {
      // The USB and LAN probes are independent; one failure cannot hide the other.
      const [usb, lan] = await Promise.allSettled([devicePresence?.(), mk20Lan?.probe()]);
      if (stopping) return;
      if (devicePresence) {
        const observation = usb.status === 'fulfilled' ? usb.value : null;
        const qmkGeneration = devices.beginScan(qmkSource);
        if (observation === true || observation?.qmkHidObserved) devices.observe(qmkSource, qmkGeneration, {
          nativeDeviceId: 'usb-4250-426f', label: 'MK20 키 컨트롤러 USB (QMK HID)', transport: 'hid', capabilities: [], supported: false,
        });
        devices.finishScan(qmkSource, qmkGeneration, usb.status === 'fulfilled' ? 'ready' : 'failed');
        const cdcGeneration = devices.beginScan(cdcSource);
        if (observation?.productCdcObserved) devices.observe(cdcSource, cdcGeneration, {
          nativeDeviceId: 'usb-1d6b-0104', label: 'MK20 본체 USB (제품 CDC)', transport: 'serial', capabilities: [], supported: false,
        });
        devices.finishScan(cdcSource, cdcGeneration, usb.status === 'fulfilled' ? 'ready' : 'failed');
      }
      if (mk20Lan) {
        const generation = devices.beginScan(lanSource);
        if (lan.status === 'fulfilled' && lan.value) devices.observe(lanSource, generation, {
          nativeDeviceId: lan.value.targetAddress,
          label: `MK20로 설정한 Wi-Fi 주소 ${lan.value.targetAddress} (개발 포트 응답)`,
          transport: 'lan', capabilities: [], supported: false,
        });
        devices.finishScan(lanSource, generation, lan.status === 'fulfilled' ? 'ready' : 'failed');
      }
    }
    finally { deviceScanPromise = undefined; }
    })();
    return deviceScanPromise;
  };
  const rescanAfterConfiguration = async () => {
    if (deviceScanPromise) await deviceScanPromise;
    await scanDevicePresence();
  };
  try {
    journal = new CommandJournal({ hostId, directory: commandDir });
    metadata = new SessionMetadataStore(privateJournalDirectory(path.join(directory, 'session-metadata')), hostId);
    creates = new SessionCreateStore(privateJournalDirectory(path.join(directory, 'session-creates')), hostId);
    sessions = new SessionService({ hostId, journal, metadata });
    bindings = await createHarnessAdapters({ hostId });
    for (const { pluginId, adapter } of bindings) {
      if (sessions.getAdapter(pluginId, adapter.status?.().instanceId ?? 'default')) throw new Error('Duplicate harness instance registration');
      sessions.registerAdapter(pluginId, adapter);
    }
    await sessions.listSessions();
    const queueDispatch = key => {
      if (stopping || dispatches.has(key)) return;
      // One dispatcher per immutable destination. Journal controls receipt certainty and retries.
      const pending = (async () => {
        while (!stopping) { const result = await sessions.dispatchNext(key); if (!result) break; }
      })().catch(() => { /* Journal retains admission/unknown; never claim execution on failure. */ }).finally(() => dispatches.delete(key));
      dispatches.set(key, pending);
    };
    store = new WorkspaceStore({ hostId, directory: workspaceDir });
    // Restored grants deliberately start unavailable. Recheck their saved filesystem
    // identities before showing them as usable after a normal application restart.
    await Promise.allSettled(store.list().map(workspace => store.refresh(workspace.workspaceId)));
    await scanDevicePresence();
    const initialSettings = loadSettings(directory);
    initialSettings.autostart = desktop ? await desktop.getAutostart() : false;
    const reviewed = structuredClone(providers);
    const harness = reviewed.length && ['win32', 'darwin'].includes(process.platform) ? {
      describe: () => discovery.snapshot(),
      rescan: () => discovery.scan(reviewed, { platform: process.platform, pathValue: process.env.PATH ?? '' }),
    } : undefined;
    api = new LocalApi({ journal, workspaceStore: store, devices, harness, noAuth, sessionService: sessions, createStore: creates, onCommandQueued: queueDispatch,
      initialSettings, desktopCapabilities: {tray: !!desktop, autostart: !!desktop, codexSelection: !!connectCodex},
      applySettings: async (next, previous) => {
        const changedAutostart = next.autostart !== previous.autostart;
        if (changedAutostart) { if (!desktop) throw new Error('Autostart unavailable'); await desktop.setAutostart(next.autostart); }
        try { saveSettings(directory, next); }
        catch (error) { if (changedAutostart) await desktop.setAutostart(previous.autostart); throw error; }
      },
      chooseWorkspace: chooseWorkspace ?? (enableNativePicker && ['win32', 'darwin'].includes(process.platform) ? chooseNativeWorkspace : undefined), connectCodex, disconnectCodex, resetCodex,
      mk20Lan: mk20Lan ? { describe: () => mk20Lan.describe(), configure: async value => { mk20Lan.configure(value); await rescanAfterConfiguration(); return mk20Lan.describe(); }, remove: async () => { mk20Lan.remove(); await rescanAfterConfiguration(); return mk20Lan.describe(); } } : undefined,
      supervisor: await loadSupervisorAssets(repositoryRoot) });
    await api.start();
    if (devices) { deviceScanTimer = setInterval(() => void scanDevicePresence(), 15000); deviceScanTimer.unref(); }
    let closed = false;
    return {
      origin: api.origin,
      issueBootstrap: () => api.issueBootstrap(),
      journal, sessions,
      async addHarnessAdapter(pluginId, adapter) {
        if (stopping || closed) throw new Error('Local runtime is closing');
        const instanceId = adapter.status?.().instanceId ?? 'default';
        if (sessions.getAdapter(pluginId, instanceId)) throw new Error('Harness instance already registered');
        sessions.registerAdapter(pluginId, adapter);
        bindings.push({ pluginId, adapter });
        sessions.emit('adapterAdded', { pluginId, instanceId, ownerId: adapter.ownerId });
      },
      async close() {
        if (closed) return; closed = true; stopping = true; discovery.cancel();
        clearInterval(deviceScanTimer);
        try { await api.close(); for (const { pluginId, adapter } of bindings) await sessions.removeAdapter(pluginId, adapter.status?.().instanceId ?? 'default'); await Promise.allSettled(dispatches.values()); } finally { try { store.close(); } finally { creates.close(); metadata.close(); journal.close(); } }
      },
    };
  } catch (error) {
    stopping = true; clearInterval(deviceScanTimer); discovery.cancel(); await api?.close(); for (const { adapter } of bindings) await adapter.stop?.().catch(() => {}); await Promise.allSettled(dispatches.values()); store?.close(); creates?.close(); metadata?.close(); journal?.close(); throw error;
  }
}
