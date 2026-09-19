import readline from 'node:readline';
import path from 'node:path';
import { startLocalRuntime } from './runtime.mjs';

// Bootstrap codes are deliberately displayed only to an interactive local terminal,
// never to redirected stdout, a URL, a log file or a browser-storage entry.
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start in an interactive terminal to receive a private one-use connection code');
const args = process.argv.slice(2); const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--native-picker') options.enableNativePicker = true;
  else if (args[i] === '--data-dir' && args[i + 1] && path.isAbsolute(args[i + 1])) options.dataDir = args[++i];
  else if (args[i] === '--codex-executable' && args[i + 1] && path.isAbsolute(args[i + 1])) options.providers = [{ id: 'snowball.codex', knownPaths: [], commandNames: [], overrides: [args[++i]] }];
  else throw new Error('Usage: npm run start:local -- [--native-picker] [--data-dir ABSOLUTE_PATH] [--codex-executable ABSOLUTE_PATH]');
}
let runtime;
try { runtime = await startLocalRuntime(options); }
catch { console.error('Local startup failed. Inspect state ownership, storage and existing runtime locks; nothing was reset.'); process.exitCode = 1; }
if (runtime) {
  console.log(`Open ${runtime.origin} on this computer.`);
  const show = () => { try { console.log(`One-use connection code (60 seconds): ${runtime.issueBootstrap().code}`); } catch { console.log('Connection code limit reached. Wait a minute before requesting another.'); } };
  show(); console.log('Enter: new code. Ctrl+C: stop this local runtime.');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  terminal.on('line', show);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; terminal.close(); await runtime.close(); };
  terminal.on('SIGINT', () => void stop()); terminal.on('close', () => void stop());
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
}
