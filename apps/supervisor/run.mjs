import readline from 'node:readline';
import fs from 'node:fs';
import { connectCodexPlugins } from './codex-plugin.mjs';
import { connectOwnedOpenCode } from './opencode-owned.mjs';
import path from 'node:path';
import { defaultDiscoveryProviders, resolveUserDataDir } from '../../packages/core/dist/index.js';
import { startLocalRuntime } from './runtime.mjs';

// Bootstrap codes are deliberately displayed only to an interactive local terminal,
// never to redirected stdout, a URL, a log file or a browser-storage entry.
const requireAuth = process.argv.includes('--require-auth');
if (requireAuth && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Token mode requires an interactive terminal');
const args = process.argv.slice(2);
const options = {
  enableNativePicker: true,
  noAuth: !requireAuth,
  providers: defaultDiscoveryProviders(),
};
let codexConfig, opencodeConfig;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--require-auth') continue;
  if (args[i] === '--native-picker') options.enableNativePicker = true;
  else if (args[i] === '--no-native-picker') options.enableNativePicker = false;
  else if (args[i] === '--data-dir' && args[i + 1] && path.isAbsolute(args[i + 1])) options.dataDir = args[++i];
  else if (args[i] === '--codex-control-config' && args[i + 1] && path.isAbsolute(args[i + 1])) {
    const configPath = args[++i]; if (fs.statSync(configPath).size > 16384) throw new Error('Codex config too large');
    codexConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  else if (args[i] === '--opencode-observer-config' && args[i + 1] && path.isAbsolute(args[i + 1])) {
    const configPath = args[++i]; if (fs.statSync(configPath).size > 4096) throw new Error('OpenCode config too large');
    opencodeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!opencodeConfig || Object.keys(opencodeConfig).some(key => !['instanceId','executable','sha256'].includes(key))) throw new Error('Invalid OpenCode observer configuration');
  }
  else if (args[i] === '--codex-executable' && args[i + 1] && path.isAbsolute(args[i + 1])) options.providers = [{ id: 'snowball.codex', knownPaths: [], commandNames: [], overrides: [args[++i]] }];
  else throw new Error('Usage: npm run start:local -- [--native-picker] [--no-native-picker] [--data-dir ABSOLUTE_PATH] [--codex-executable ABSOLUTE_PATH] [--codex-control-config ABSOLUTE_JSON_PATH] [--opencode-observer-config ABSOLUTE_JSON_PATH] [--require-auth]');
}
if (codexConfig || opencodeConfig) options.createHarnessAdapters = async ({hostId}) => {
  const bindings = [];
  try {
    if (codexConfig) bindings.push(...await connectCodexPlugins({hostId,config:codexConfig}));
    if (opencodeConfig) bindings.push(await connectOwnedOpenCode({...opencodeConfig,hostId,dataDir:options.dataDir ?? resolveUserDataDir()}));
    return bindings;
  } catch (error) { await Promise.allSettled(bindings.map(({adapter}) => adapter.stop())); throw error; }
};
let runtime;
try { runtime = await startLocalRuntime(options); }
catch { console.error('Local startup failed. Inspect state ownership, storage and existing runtime locks; nothing was reset.'); process.exitCode = 1; }
if (runtime) {
  console.log(`Open ${runtime.origin} on this computer.`);
  const show = () => { try { console.log(`One-use connection code (60 seconds): ${runtime.issueBootstrap().code}`); } catch { console.log('Connection code limit reached. Wait a minute before requesting another.'); } };
  if (requireAuth) { show(); console.log('Enter: new code. Ctrl+C: stop this local runtime.'); }
  else console.log('Local UI: no login or PIN. Listening on 127.0.0.1 only.');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (requireAuth) terminal.on('line', show);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; terminal.close(); await runtime.close(); };
  terminal.on('SIGINT', () => void stop()); if (process.stdin.isTTY) terminal.on('close', () => void stop());
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
}
