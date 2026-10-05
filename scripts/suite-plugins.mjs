import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginHost } from '../packages/plugin-host/dist/index.js';

// Installation approves the worker bytes from the selected public repositories.
// An edit after installation must be reviewed by rerunning setup, never silently approved at startup.
export async function loadSuitePlugins(config, { start = true } = {}) {
  if (!Array.isArray(config.plugins) || config.plugins.length !== 3) throw Error('All three harness plugins are required');
  const hosts = [], presentations = {}, seen = new Set();
  try {
    for (const plugin of config.plugins) {
      if (!['codex', 'antigravity', 'opencode'].includes(plugin.kind) || seen.has(plugin.kind)) throw Error('Invalid suite plugin');
      seen.add(plugin.kind);
      const directory = await fs.realpath(plugin.directory);
      const exported = await import(pathToFileURL(path.join(directory, 'dist/index.js')).href);
      const manifest = await exported[plugin.kind + 'Manifest']();
      if (manifest.id !== 'snowball.' + plugin.kind || manifest.integrity.entrySha256 !== plugin.entrySha256) throw Error('Installed plugin changed: ' + plugin.kind);
      presentations[manifest.id] = manifest.presentation;
      const host = new PluginHost({ directory, manifest, approvedDigests: new Map([[manifest.id, plugin.entrySha256]]) });
      hosts.push(host);
      if (start) { await host.start(); await host.request('harness.status', {}); }
    }
    return { presentations, close: () => Promise.allSettled(hosts.map(host => host.stop())) };
  } catch (error) { await Promise.allSettled(hosts.map(host => host.stop())); throw error; }
}
