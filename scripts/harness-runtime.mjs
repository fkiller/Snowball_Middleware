import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Resolve native executables each time; app upgrades must not leave a cached hash path.
export function resolveHarnessExecutable(kind, env = process.env, platform = process.platform) {
  if (!['codex', 'antigravity', 'opencode'].includes(kind)) throw new Error('Unknown harness');
  const name = kind === 'antigravity' ? 'agy' : kind;
  const override = env[`SNOWBALL_${name.toUpperCase()}_EXECUTABLE`];
  if (override) {
    if (!path.isAbsolute(override) || !fs.existsSync(override)) throw new Error(`${name} executable override is unavailable`);
    if (platform === 'win32' && !override.toLowerCase().endsWith('.exe')) throw new Error('Use a native .exe, not a shell wrapper');
    return override;
  }
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [];
  if (platform === 'win32') {
    for (const dir of dirs) {
      candidates.push(path.join(dir, `${name}.exe`));
      if (kind === 'codex') {
        candidates.push(path.join(dir, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'));
        candidates.push(path.join(dir, 'node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe'));
      } else if (kind === 'opencode') {
        for (const pkg of ['opencode-windows-x64', 'opencode-windows-x64-baseline']) {
          candidates.push(path.join(dir, `node_modules/opencode-ai/node_modules/${pkg}/bin/opencode.exe`));
        }
      }
    }
    if (kind === 'antigravity' && env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'agy/bin/agy.exe'));
  } else {
    candidates.push(...dirs.map(dir => path.join(dir, name)));
    if (kind === 'antigravity') candidates.push(path.join(os.homedir(), '.agy/bin/agy'));
  }
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch {}
  }
  throw new Error(`${name} CLI is unavailable; install it or set SNOWBALL_${name.toUpperCase()}_EXECUTABLE`);
}

export function readHarnessCli(kind, args) {
  return execFileSync(resolveHarnessExecutable(kind), args, {
    encoding: 'utf8', timeout: 12000, maxBuffer: 4 * 1024 * 1024,
    windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

export function installedHarnessVersions() {
  return Object.fromEntries(['codex', 'antigravity', 'opencode'].map(kind => {
    try { return [kind, { available: true, version: readHarnessCli(kind, ['--version']).trim() }]; }
    catch { return [kind, { available: false, version: null }]; }
  }));
}
