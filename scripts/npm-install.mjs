#!/usr/bin/env node
// Optional Node/npm bootstrap for the existing per-user source installer.
// This does not publish a package or turn source checkouts into signed releases.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const valueFlags = new Map([
  ['--root', ['--root', '-InstallRoot']], ['--profile', ['--profile', '-Profile']],
  ['--python', ['--python', '-Python']], ['--port', ['--port', '-Port']],
  ['--bind', ['--bind', '-Bind']], ['--data-dir', ['--data-dir', '-DataDir']],
  ['--mk20-address', ['--mk20-address', '-Mk20Address']], ['--adb', ['--adb', '-Adb']],
  ['--device', ['--device', '-Device']],
]);
const switches = new Map([
  ['--update', ['--update', '-Update']], ['--no-start', ['--no-start', '-NoStart']],
  ['--no-shortcut', ['--no-shortcut', '-NoShortcut']],
]);

export function installerCommand(args, platform = process.platform) {
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw Error('Windows, macOS or Linux is required.');
  const windows = platform === 'win32';
  const forwarded = [];
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help' || option === '-h') {
      if (args.length !== 1) throw Error('Use --help by itself.');
      return { help: true };
    }
    if (seen.has(option)) throw Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (switches.has(option)) forwarded.push(switches.get(option)[windows ? 1 : 0]);
    else if (valueFlags.has(option)) {
      const value = args[++i];
      if (!value || value.startsWith('-') || value.includes('\0')) throw Error(`Missing value for ${option}`);
      forwarded.push(valueFlags.get(option)[windows ? 1 : 0], value);
    } else throw Error(`Unknown option: ${option}`);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const script = path.join(root, windows ? 'install.ps1' : 'install.sh');
  return windows
    ? { executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...forwarded] }
    : { executable: 'bash', args: [script, ...forwarded] };
}

export function runInstaller(args, { platform = process.platform, run = spawnSync } = {}) {
  const command = installerCommand(args, platform);
  if (command.help) {
    console.log('Snowball source installer\n\nUsage: snowball-install [--update] [--root PATH] [--profile all|web|mk20|m5stack] [--no-start] [--no-shortcut]\n\nNode/npm, Git and platform-specific prerequisites are required. This installs the existing source-based main suite; it is not a signed release installer.');
    return 0;
  }
  const result = run(command.executable, command.args, { stdio: 'inherit', shell: false, windowsHide: false });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// npm invokes bin files through a symlink on Unix and a generated shim on
// Windows. Compare real paths so a packaged `npx` invocation actually runs.
let invokedDirectly = false;
try { invokedDirectly = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch {}
if (invokedDirectly) {
  try { process.exitCode = runInstaller(process.argv.slice(2)); }
  catch (error) { console.error(`Snowball: ${error.message}`); process.exitCode = 1; }
}
