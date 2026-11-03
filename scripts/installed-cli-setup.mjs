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
