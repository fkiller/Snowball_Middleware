import fs from 'node:fs';
import path from 'node:path';

// Install-root-specific commands do not modify the user's PATH or shell profile.
export function writeInstalledCli(root, nodeExecutable, platform = process.platform) {
  if (platform === 'win32') {
    const node = "'" + nodeExecutable.replaceAll("'", "''") + "'";
    fs.writeFileSync(path.join(root, 'snowball-cli.ps1'), `& ${node} (Join-Path $PSScriptRoot 'Snowball_Middleware/scripts/installed-cli.mjs') --root $PSScriptRoot @args\nexit $LASTEXITCODE\n`);
    fs.writeFileSync(path.join(root, 'snowball.cmd'), '@powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0snowball-cli.ps1" %*\r\n@exit /b %ERRORLEVEL%\r\n');
  } else {
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const script = path.join(root, 'Snowball_Middleware', 'scripts', 'installed-cli.mjs');
    fs.writeFileSync(path.join(root, 'snowball'), `#!/bin/sh\nexec ${quote(nodeExecutable)} ${quote(script)} --root ${quote(root)} "$@"\n`, {mode: 0o700});
  }
}

// Respect the user's existing PATH and existing commands. Do not edit shell
// profiles or replace a link belonging to another Snowball installation.
export function registerUserCommand(root, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return 'manual';
  if (!env.HOME || !path.isAbsolute(env.HOME)) return 'manual';
  const bin = path.join(env.HOME, '.local', 'bin');
  const entries = (env.PATH ?? '').split(path.delimiter).map(entry => path.isAbsolute(entry) ? path.resolve(entry) : null);
  const binIndex = entries.indexOf(bin);
  if (binIndex === -1) return 'manual';
  // Relative and empty PATH entries depend on the shell's working directory.
  // Do not claim that our command wins when an earlier entry is unknown.
  if (entries.slice(0, binIndex).includes(null)) return 'manual';
  const target = path.join(root, 'snowball');
  const destination = path.join(bin, 'snowball');
  try {
    // A command earlier on PATH would shadow our link even if creation worked.
    for (const entry of entries.slice(0, binIndex)) {
      try { fs.accessSync(path.join(entry, 'snowball'), fs.constants.X_OK); return 'conflict'; }
      catch (error) { if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error; }
    }
    fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
    try {
      fs.symlinkSync(target, destination);
      return 'linked';
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = fs.lstatSync(destination);
      if (existing.isSymbolicLink() && path.resolve(bin, fs.readlinkSync(destination)) === path.resolve(target)) return 'linked';
      return 'conflict';
    }
  } catch { return 'manual'; }
}
