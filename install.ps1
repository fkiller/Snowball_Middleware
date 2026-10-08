[CmdletBinding()]
param(
    [ValidateSet('web','mk20','m5stack')] [string]$Profile = 'web',
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Snowball'),
    [string]$Serial,
    [string]$Bind,
    [string]$Device,
    [string]$Mk20Address,
    [string]$Adb,
    [string]$Python,
    [int]$Port = 8765,
    [string]$DataDir,
    [switch]$NoStart,
    [switch]$NoFlash,
    [switch]$NoShortcut,
    [switch]$Update
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$tools = Join-Path $InstallRoot '.snowball\tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed ($LASTEXITCODE); installation is incomplete." }
}
function Refresh-Path {
    $env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
}

# Use a supported existing Node, otherwise install a user-local official LTS ZIP.
$node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
$validNode = $false
if ($node) {
    $nodeVersion = (& $node --version).Trim().TrimStart('v')
    $validNode = [version]$nodeVersion -ge [version]'22.12.0'
}
if (-not $validNode) {
    $cachedNodes = Get-ChildItem -LiteralPath $tools -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    foreach ($candidate in $cachedNodes) {
        $candidateVersion = (& $candidate.FullName --version).Trim().TrimStart('v')
        if ([version]$candidateVersion -ge [version]'22.12.0') { $node = $candidate.FullName; $validNode = $true; break }
    }
}
if (-not $validNode) {
    $arch = if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'Arm64') {'arm64'} else {'x64'}
    $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $release = $releases | Where-Object { $_.lts -and [version]($_.version.TrimStart('v')) -ge [version]'22.12.0' } | Select-Object -First 1
    if (-not $release) { throw 'No supported Node LTS release found.' }
    $filename = "node-$($release.version)-win-$arch.zip"
    $base = "https://nodejs.org/dist/$($release.version)"
    $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $line = $sums -split '\r?\n' | Where-Object { $_ -match ('  ' + [regex]::Escape($filename) + '$') } | Select-Object -First 1
    if (-not $line) { throw 'Official Node checksum missing.' }
    $zip = Join-Path $tools $filename
    Invoke-WebRequest "$base/$filename" -OutFile $zip -UseBasicParsing
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $line.Substring(0,64)) { throw 'Node download checksum mismatch.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
    $node = Join-Path $tools "node-$($release.version)-win-$arch\node.exe"
}
$nodeDirectory = Split-Path $node
$env:PATH = $nodeDirectory + ';' + $env:PATH
$npm = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npm)) { throw 'This Node installation lacks npm; use the official Node distribution.' }

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows or Windows App Installer (winget), then rerun this command.' }
    Invoke-Checked 'winget.exe' @('install','--id','Git.Git','--exact','--silent','--accept-package-agreements','--accept-source-agreements')
    Refresh-Path
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { $env:PATH = (Join-Path $env:ProgramFiles 'Git\cmd') + ';' + $env:PATH }
}
if ($Profile -ne 'web') {
    if (-not $Python) {
        $Python = Get-Command python.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' } | Select-Object -ExpandProperty Source -First 1
        if ($Python) {
            & $Python -c 'import sys;sys.exit(0 if sys.version_info >= (3,12) else 1)'
            if ($LASTEXITCODE -ne 0) { $Python = $null }
        }
        if (-not $Python) {
            Invoke-Checked 'winget.exe' @('install','--id','Python.Python.3.12','--exact','--scope','user','--silent','--accept-package-agreements','--accept-source-agreements')
            Refresh-Path
            $Python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
        }
    }
    if (-not (Test-Path -LiteralPath $Python)) { throw 'Python 3.12 installation was not found. Supply -Python PATH.' }
}
$middleware = Join-Path $InstallRoot 'Snowball_Middleware'
if (-not (Test-Path -LiteralPath $middleware)) {
    Invoke-Checked 'git.exe' @('clone','--branch','main','https://github.com/fkiller/Snowball_Middleware.git',$middleware)
}
if ($Update) {
    $origin = (& git.exe -C $middleware remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)fkiller/Snowball_Middleware(\.git)?$') { throw 'Unexpected middleware repository origin.' }
    $changes = & git.exe -C $middleware status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Tracked local changes exist; preserve them before updating.' }
    Invoke-Checked 'git.exe' @('-C',$middleware,'fetch','origin','main')
    Invoke-Checked 'git.exe' @('-C',$middleware,'merge','--ff-only','origin/main')
}
$arguments = @((Join-Path $middleware 'scripts\setup.mjs'),'--profile',$Profile,'--root',$InstallRoot,'--npm',$npm,'--port',"$Port")
foreach ($pair in @(@('serial',$Serial),@('bind',$Bind),@('device',$Device),@('mk20-address',$Mk20Address),@('adb',$Adb),@('python',$Python),@('data-dir',$DataDir))) {
    if ($pair[1]) { $arguments += ('--' + $pair[0]); $arguments += $pair[1] }
}
if ($NoStart) { $arguments += '--no-start' }
if ($NoFlash) { $arguments += '--no-flash' }
if ($NoShortcut) { $arguments += '--no-shortcut' }
if ($Update) { $arguments += '--update' }
Invoke-Checked $node $arguments
