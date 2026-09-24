import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../../packages/plugin-host/dist/index.js';
import { opencodeManifest } from '../../packages/harness-opencode/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';

const supportedVersion = '1.18.31';
const safeInstance = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function freeLoopbackPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function boundedHealth(response) {
  if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) return null;
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 16 * 1024) return null;
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); }
}

function isolatedEnvironment(executable, root, password) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name];
  const directories = {};
  for (const name of ['home', 'data', 'config', 'cache', 'state', 'tmp', 'appdata', 'localappdata'])
    directories[name] = ensurePrivateStateDirectory(path.join(root, name));
  Object.assign(env, {
    HOME: directories.home, USERPROFILE: directories.home,
    XDG_DATA_HOME: directories.data, XDG_CONFIG_HOME: directories.config,
    XDG_CACHE_HOME: directories.cache, XDG_STATE_HOME: directories.state,
    APPDATA: directories.appdata, LOCALAPPDATA: directories.localappdata,
    TMP: directories.tmp, TEMP: directories.tmp, TMPDIR: directories.tmp,
    PATH: [path.dirname(executable), process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32')].filter(Boolean).join(path.delimiter),
    OPENCODE_SERVER_USERNAME: 'snowball-owned', OPENCODE_SERVER_PASSWORD: password,
  });
  return env;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

/** Trusted composition boundary. An arbitrary discovered OpenCode server is never commandable. */
export async function connectOwnedOpenCode({ hostId, instanceId, executable, sha256, dataDir }) {
  if (typeof hostId !== 'string' || !/^host_[a-f0-9]{32}$/.test(hostId) ||
      typeof instanceId !== 'string' || !safeInstance.test(instanceId) ||
      typeof executable !== 'string' || !path.isAbsolute(executable) || /\.(cmd|bat|ps1)$/i.test(executable) ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
      typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('Invalid reviewed OpenCode selection');
  const canonical = await fs.realpath(executable);
  if (canonical !== path.normalize(executable)) throw new Error('OpenCode executable path changed');
  const info = await fs.stat(canonical);
  if (!info.isFile() || info.size > 512 * 1024 * 1024 || await fileHash(canonical) !== sha256) throw new Error('OpenCode executable hash changed');
  const root = ensurePrivateStateDirectory(path.join(ensurePrivateStateDirectory(dataDir), 'opencode-' + instanceId));
  const password = randomBytes(32).toString('base64url');
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(canonical, ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--pure'], {
    cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedEnvironment(canonical, root, password),
  });
  let childError;
  child.on('error', error => { childError = error; });
  let output = '', announced = false;
  child.stdout.on('data', chunk => {
    if (output.length < 65536) {
      output += chunk.toString('utf8');
      announced ||= output.includes(`opencode server listening on ${origin}`);
      output = output.slice(-65536);
    }
  });
  child.stderr.resume();
  let host; let stopping = false;
  try {
    const headers = { Authorization: 'Basic ' + Buffer.from(`snowball-owned:${password}`).toString('base64') };
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (childError) throw new Error('Owned OpenCode server could not start');
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned OpenCode server exited');
      try {
        const response = await fetch(origin + '/global/health', { headers, redirect: 'error', signal: AbortSignal.timeout(500) });
        if (response.ok) {
          const body = await boundedHealth(response);
          if (body?.healthy === true && body.version === supportedVersion && announced) { healthy = true; break; }
          if (body?.version && body.version !== supportedVersion) throw new Error('Unsupported OpenCode server version');
        }
      } catch (error) { if (error?.message === 'Unsupported OpenCode server version') throw error; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!healthy || await fileHash(canonical) !== sha256) throw new Error('Owned OpenCode server did not pass pinned startup');
    const anonymous = await fetch(origin + '/global/health', { redirect: 'error', signal: AbortSignal.timeout(2000) });
    await anonymous.body?.cancel().catch(() => {});
    if (anonymous.status !== 401) throw new Error('Owned OpenCode server requires private Basic authentication');
    const manifest = await opencodeManifest();
    host = new PluginHost({ directory: fileURLToPath(new URL('../../packages/harness-opencode', import.meta.url)), manifest,
      approvedDigests: new Map([[manifest.id, manifest.integrity.entrySha256]]), timeoutMs: 15000 });
    const adapter = new EventEmitter(); let state;
    host.on('event', event => {
      if (event.event === 'harness.offline' && state) state = { ...state, connected: false };
      if (['harness.event', 'harness.decision', 'harness.offline', 'harness.ownerLost'].includes(event.event)) adapter.emit(event.event.slice(8), event.data);
    });
    host.on('fault', () => { if (state) state = { ...state, connected: false }; adapter.emit('offline'); });
    child.on('exit', () => {
      if (stopping) return;
      if (state) state = { ...state, connected: false };
      adapter.emit('offline');
      void host.stop();
    });
    await host.start();
    state = await host.request('harness.connect', { binding: { hostId, instanceId, baseUrl: origin, authUsername: 'snowball-owned', authPassword: password } });
    if (!state?.connected || !state.readOnly || state.providerVersion !== supportedVersion || state.instanceId !== instanceId || typeof state.ownerId !== 'string') throw new Error('Invalid OpenCode observer binding');
    Object.defineProperty(adapter, 'ownerId', { value: state.ownerId });
    adapter.status = () => structuredClone(state);
    adapter.listSessions = async () => { const list = await host.request('harness.list', {}); state = await host.request('harness.status', {}); return list; };
    adapter.readSession = nativeId => host.request('harness.read', { sessionId: nativeId });
    adapter.listModels = () => host.request('harness.models', {});
    adapter.execute = () => ({ status: 'not_sent', reason: 'owner_protocol_unverified' });
    adapter.stop = async () => { stopping = true; await host.stop(); await stopChild(child); };
    return { pluginId: manifest.id, adapter };
  } catch (error) { stopping = true; await host?.stop().catch(() => {}); await stopChild(child); throw error; }
}
