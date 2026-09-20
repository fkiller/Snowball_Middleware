import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandJournal, WorkspaceStore, HarnessDiscovery, createHostId, parseHostId, resolveUserDataDir } from '../../packages/core/dist/index.js';
import { LocalApi, loadSupervisorAssets } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';
import { chooseNativeWorkspace } from './native-picker.mjs';

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

/** Development composition root, not an installed service or a cloud control plane. */
export async function startLocalRuntime({ dataDir = resolveUserDataDir(), repositoryRoot = fileURLToPath(new URL('../..', import.meta.url)), providers = [], enableNativePicker = false, chooseWorkspace, noAuth = false } = {}) {
  // This boundary validates native privacy before any user registration is loaded.
  const directory = ensurePrivateStateDirectory(dataDir);
  const hostId = loadHostId(directory);
  const commandDir = ensurePrivateStateDirectory(path.join(directory, 'commands'));
  const workspaceDir = ensurePrivateStateDirectory(path.join(directory, 'workspaces'));
  let journal; let store; let api;
  const discovery = new HarnessDiscovery();
  try {
    journal = new CommandJournal({ hostId, directory: commandDir });
    store = new WorkspaceStore({ hostId, directory: workspaceDir });
    const reviewed = structuredClone(providers);
    const harness = reviewed.length && ['win32', 'darwin'].includes(process.platform) ? {
      describe: () => discovery.snapshot(),
      rescan: () => discovery.scan(reviewed, { platform: process.platform, pathValue: process.env.PATH ?? '' }),
    } : undefined;
    api = new LocalApi({ journal, workspaceStore: store, harness, noAuth,
      chooseWorkspace: chooseWorkspace ?? (enableNativePicker && ['win32', 'darwin'].includes(process.platform) ? chooseNativeWorkspace : undefined),
      supervisor: await loadSupervisorAssets(repositoryRoot) });
    await api.start();
    let closed = false;
    return {
      origin: api.origin,
      issueBootstrap: () => api.issueBootstrap(),
      journal,
      async close() {
        if (closed) return; closed = true; discovery.cancel();
        try { await api.close(); } finally { try { store.close(); } finally { journal.close(); } }
      },
    };
  } catch (error) {
    discovery.cancel(); await api?.close(); store?.close(); journal?.close(); throw error;
  }
}
