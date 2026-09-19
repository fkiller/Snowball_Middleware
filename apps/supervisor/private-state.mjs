import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const windowsPrivateDirectory = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$stateRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$statePath = [System.IO.Path]::GetFullPath($stateRequest.directory)
$stateSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if (-not [System.IO.Directory]::Exists($statePath)) {
  $stateAcl = New-Object System.Security.AccessControl.DirectorySecurity
  $stateAcl.SetOwner($stateSid)
  $stateAcl.SetAccessRuleProtection($true, $false)
  $stateRule = New-Object System.Security.AccessControl.FileSystemAccessRule($stateSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $stateAcl.AddAccessRule($stateRule)
  [void][System.IO.Directory]::CreateDirectory($statePath, $stateAcl)
}
$stateTargets = @($statePath)
foreach ($stateName in @('host.v1.json', 'commands.lock', 'commands.v1.jsonl')) {
  $stateChild = [System.IO.Path]::Combine($statePath, $stateName)
  if ([System.IO.File]::Exists($stateChild) -or [System.IO.Directory]::Exists($stateChild)) { $stateTargets += $stateChild }
}
foreach ($stateTarget in $stateTargets) {
if (([System.IO.File]::GetAttributes($stateTarget) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked state directory' }
if ([System.IO.Directory]::Exists($stateTarget)) { $stateAcl = [System.IO.Directory]::GetAccessControl($stateTarget) }
else { $stateAcl = [System.IO.File]::GetAccessControl($stateTarget) }
if ($stateAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $stateSid.Value) { throw 'Foreign state owner' }
$stateRules = $stateAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$stateFull = $false
foreach ($stateAccess in $stateRules) {
  if ($stateAccess.AccessControlType -eq 'Allow') {
    if ($stateAccess.IdentityReference.Value -notin @($stateSid.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'State accessible to another principal' }
    if ($stateAccess.IdentityReference.Value -eq $stateSid.Value -and ($stateAccess.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and ($stateAccess.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) { $stateFull = $true }
  }
}
if (-not $stateFull) { throw 'No current-user full control' }
}
[Console]::Write('ok')
`;

/** Create only an app-owned directory; never repair permissions on existing user data. */
export function ensurePrivateStateDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error('Absolute state directory required');
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', windowsPrivateDirectory], {
      input: JSON.stringify({ directory }), encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.trim() !== 'ok') throw new Error('Private state validation failed');
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('State directory owner/mode requires review');
    for (const name of ['host.v1.json', 'commands.lock', 'commands.v1.jsonl']) {
      const file = path.join(directory, name);
      let item; try { item = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!item.isFile() || item.isSymbolicLink() || item.uid !== process.getuid() || (item.mode & 0o077)) throw new Error('State file owner/mode requires review');
    }
  }
  return fs.realpathSync(directory);
}
