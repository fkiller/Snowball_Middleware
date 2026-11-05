# Used by the optional Snowball prerequisite installer. Never runs Tailscale commands.
# The only elevated process is Windows Installer with the fixed, reviewed MSI.
param(
  [ValidateSet('Inspect', 'Verify', 'Install')][string]$Action = 'Inspect',
  [string]$MsiPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.ServiceProcess
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')

function Write-Result([string]$Status, [int]$Code = 0) {
  [Console]::WriteLine((@{ status = $Status } | ConvertTo-Json -Compress))
  exit $Code
}

function Test-PathPresent([string]$Candidate) {
  try { [void][System.IO.File]::GetAttributes($Candidate); return $true }
  catch [System.IO.FileNotFoundException] { return $false }
  catch [System.IO.DirectoryNotFoundException] { return $false }
}

function Read-Installation {
  # Any unreadable inventory is unknown, never permission to overwrite an installation.
  $existing = $false
  $statePresent = $false
  $busy = $false
  $services = [System.ServiceProcess.ServiceController]::GetServices()
  try { $existing = @($services | Where-Object { $_.ServiceName -eq 'Tailscale' }).Count -gt 0 }
  finally { foreach ($service in $services) { $service.Dispose() } }
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        foreach ($keyName in @('SOFTWARE\Tailscale', 'SOFTWARE\Policies\Tailscale')) {
          $key = $base.OpenSubKey($keyName)
          if ($null -ne $key) { $statePresent = $true; $key.Dispose() }
        }
        $key = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\InProgress')
        if ($null -ne $key) { $busy = $true; $key.Dispose() }
        $uninstall = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
        if ($null -ne $uninstall) {
          try {
            foreach ($name in $uninstall.GetSubKeyNames()) {
              $entry = $uninstall.OpenSubKey($name)
              if ($null -eq $entry) { throw 'Inventory changed' }
              try { if ([string]$entry.GetValue('DisplayName') -match '(?i)\btailscale\b') { $existing = $true } }
              finally { $entry.Dispose() }
            }
          } finally { $uninstall.Dispose() }
        }
      } finally { $base.Dispose() }
    }
  }
  foreach ($folder in @([Environment]::GetFolderPath('ProgramFiles'), [Environment]::GetFolderPath('ProgramFilesX86'))) {
    if ($folder -and (Test-PathPresent ([IO.Path]::Combine($folder, 'Tailscale')))) { $existing = $true }
  }
  foreach ($folder in @([Environment]::GetFolderPath('CommonApplicationData'), [Environment]::GetFolderPath('LocalApplicationData'))) {
    if ($folder -and (Test-PathPresent ([IO.Path]::Combine($folder, 'Tailscale')))) { $statePresent = $true }
  }
  # A portable/custom CLI in PATH is evidence of an existing user setup, not an
  # executable we trust or launch. Ignore network/relative PATH entries.
  foreach ($folder in [Environment]::GetEnvironmentVariable('PATH').Split(';')) {
    if ($folder -match '^[a-zA-Z]:\\' -and (Test-PathPresent ([IO.Path]::Combine($folder, 'tailscale.exe')))) { $existing = $true }
  }
  if ($busy) { return 'busy' }
  if ($existing) { return 'existing' }
  if ($statePresent) { return 'preserved_state' }
  return 'absent'
}

function Open-ReviewedInstaller([string]$Candidate) {
  if (-not $Candidate -or $Candidate -notmatch '^[a-zA-Z]:\\' -or $Candidate -match '["\x00-\x1f]' -or $Candidate.Substring(2).Contains(':')) { throw 'Invalid path' }
  $full = [IO.Path]::GetFullPath($Candidate)
  $pins = @{
    'tailscale-setup-1.104.5-amd64.msi' = '3c41318c83c5d95d0b017b1baa08ba7c99fd5334166122bbb1931e55af99839c'
    'tailscale-setup-1.104.5-arm64.msi' = '609982de4dfe70b67a02e2a93c9c5c1dfa20addceb33a7d3b144f1d34d98f5fc'
  }
  $name = [IO.Path]::GetFileName($full)
  if (-not $pins.ContainsKey($name)) { throw 'Unreviewed package' }
  $ancestor = $full
  while ($ancestor) {
    if (([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked path' }
    $ancestor = [IO.Path]::GetDirectoryName($ancestor)
  }
  # Deny writes, deletion and replacement until msiexec has completed. The
  # signature and SHA256 checks refer to the same locked file the installer reads.
  $locked = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    if ($locked.Length -lt 1 -or $locked.Length -gt 134217728) { throw 'Invalid size' }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($locked))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    if ($digest -ne $pins[$name]) { throw 'Package digest mismatch' }
    $signature = Get-AuthenticodeSignature -LiteralPath $full
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne 'Tailscale Inc.') { throw 'Package signature mismatch' }
    return @{ Path = $full; Name = $name; Stream = $locked }
  } catch { $locked.Dispose(); throw }
}

try {
  if ($Action -eq 'Inspect') { $state = Read-Installation; Write-Result $state ([int]($state -notin @('absent', 'existing'))) }
  if ($Action -eq 'Install') {
    $state = Read-Installation
    if ($state -ne 'absent') { Write-Result $state ([int]($state -ne 'existing')) }
  }
} catch { Write-Result 'unknown' 1 }

$package = $null
try { $package = Open-ReviewedInstaller $MsiPath }
catch { Write-Result 'verification_failed' 1 }

try {
  if ($Action -eq 'Verify') { Write-Result 'verified' }
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $expected = if ($architecture -eq 'X64') { 'amd64' } elseif ($architecture -eq 'Arm64') { 'arm64' } else { '' }
  if (-not $expected -or $package.Name -ne ('tailscale-setup-1.104.5-' + $expected + '.msi')) { Write-Result 'unsupported' 1 }
  # Recheck after downloading/verification. No repair, upgrade, uninstall,
  # policy switches, unattended settings, login keys, Serve or Funnel commands.
  $state = Read-Installation
  if ($state -ne 'absent') { Write-Result $state ([int]($state -ne 'existing')) }
  $msiexec = [IO.Path]::Combine([Environment]::SystemDirectory, 'msiexec.exe')
  $arguments = @('/i', ('"' + $package.Path + '"'), '/quiet', '/norestart', 'TS_NOLAUNCH=1')
  try { $installer = Start-Process -FilePath $msiexec -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru }
  catch [System.ComponentModel.Win32Exception] {
    if ($_.Exception.NativeErrorCode -eq 1223) { Write-Result 'install_cancelled' 1 }
    throw
  }
  # Never kill another MSI transaction or claim success while it is running.
  if (-not $installer.WaitForExit(600000)) { Write-Result 'install_in_progress' 1 }
  $installer.Refresh()
  if ($installer.ExitCode -eq 3010) { Write-Result 'restart_required' }
  if ($installer.ExitCode -eq 1602) { Write-Result 'install_cancelled' 1 }
  if ($installer.ExitCode -eq 1618) { Write-Result 'busy' 1 }
  if ($installer.ExitCode -ne 0) { Write-Result 'install_failed' 1 }
  if ((Read-Installation) -ne 'existing') { Write-Result 'install_unconfirmed' 1 }
  Write-Result 'installed'
} catch { Write-Result 'install_failed' 1 }
finally { if ($null -ne $package) { $package.Stream.Dispose() } }
