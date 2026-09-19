// Explicit native handshake verification; never uses/copies the user's credential home.
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexManifest, codexLaunchDigest } from '../packages/harness-codex/dist/index.js';
import { PluginHost, runBinaryProbe, binaryProbeDigest } from '../packages/plugin-host/dist/index.js';
import { fileURLToPath } from 'node:url';
const [executableArg, sha256] = process.argv.slice(2);
if (!executableArg || !/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('Provide selected executable and reviewed lowercase SHA-256');
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'snowball-native-codex-')));
const executable = await realpath(executableArg); let host;
try {
  const versionSpec = { id: 'snowball.codex-version', executable: { path: executable, sha256 }, args: ['--version'], artifacts: [], versions: { 'codex-cli 0.153.4': '0.153.4' } };
  const version = await runBinaryProbe(versionSpec, new Map([[versionSpec.id, binaryProbeDigest(versionSpec)]]), { timeoutMs: 5000 });
  if (version.status !== 'supported') throw new Error(`Selected version probe failed: ${version.status}`);
  const launch = { executable, sha256, version: '0.153.4', codexHome: directory, workingDirectory: directory };
  const manifest = await codexManifest();
  host = new PluginHost({ directory: fileURLToPath(new URL('../packages/harness-codex', import.meta.url)), manifest, approvedDigests: new Map([[manifest.id, manifest.integrity.entrySha256]]), timeoutMs: 15000 });
  await host.start(); const initial = await host.request('harness.status', {});
  if (initial.connected !== false) throw new Error('Plugin startup must not start a harness');
  const status = await host.request('harness.connect', { launch, approvedDigest: codexLaunchDigest(launch), binding: { hostId: `host_${'f'.repeat(32)}`, instanceId: 'isolated-verification' } });
  const sessions = await host.request('harness.list', {});
  await host.stop();
  let childExited = false; try { process.kill(status.runtimeProcessId, 0); } catch { childExited = true; }
  if (!childExited) throw new Error('Owned native process survived worker shutdown');
  console.log(JSON.stringify({ platform: process.platform, version: version.version, sha256, connected: status.connected, auth: status.auth, credentialSource: status.credentialSource, existingDesktopControl: status.existingDesktopControl, sessionCount: sessions.length, inferenceSent: false, isolatedWorker: true, nativeChildExited: childExited }));
} finally { if (host) await host.stop(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
