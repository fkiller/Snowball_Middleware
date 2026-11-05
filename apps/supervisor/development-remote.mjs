import fs from 'node:fs';
import path from 'node:path';
import { parseTailscaleHost } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';

// Explicit local development composition only. The path is never accepted
// from HTTP or IPC, and no Tailscale configuration is changed here.
export function readDevelopmentRemoteConfig(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('invalid_development_remote_config');
  const directory = ensurePrivateStateDirectory(path.dirname(file), [path.basename(file), 'mobile-binding.v1.json']);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid_development_remote_config');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config || Object.keys(config).sort().join(',') !== 'host,openssl,version' || config.version !== 1 ||
      typeof config.openssl !== 'string' || !path.isAbsolute(config.openssl)) throw Error('invalid_development_remote_config');
  return { directory, host: parseTailscaleHost(config.host), openssl: config.openssl };
}

export async function startDevelopmentRemote(manager, config) {
  const bindingFile = path.join(config.directory, 'mobile-binding.v1.json');
  let credential, enabled = false, closed = false;
  try {
    const listener = await manager.enableTls(config);
    enabled = true;
    credential = await manager.issue();
    const binding = { version: 1, pid: process.pid, deviceId: credential.deviceId, origin: `https://${listener.host}`,
      loopbackOrigin: listener.origin, fingerprint: listener.fingerprint, token: credential.token, expiresAt: credential.expiresAt };
    fs.writeFileSync(bindingFile, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return {
      bindingFile,
      async close() {
        if (closed) return;
        await manager.revoke(credential.deviceId);
        closed = true;
        let current;
        try { current = JSON.parse(fs.readFileSync(bindingFile, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        if (current.deviceId === credential.deviceId && current.pid === process.pid) fs.unlinkSync(bindingFile);
      },
    };
  } catch {
    if (credential) await manager.revoke(credential.deviceId).catch(() => {});
    if (enabled) await manager.disable().catch(() => {});
    throw Error('development_remote_unavailable');
  }
}
