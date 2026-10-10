import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSetupOptions, repositoriesFor, harnessRepositories } from './setup-profile.mjs';
import {planDevices,planDeviceConfigs} from './suite-devices.mjs';
import {approveDevicePreparations} from './device-preparation.mjs';
process.env.AGY_CLI_DISABLE_AUTO_UPDATE='true';

const options = parseSetupOptions(process.argv.slice(2));
if (!['win32', 'darwin'].includes(process.platform)) throw Error('Suite plugin workers currently support Windows and macOS');
const middleware = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(options.root ?? path.dirname(middleware));
if (path.join(root, 'Snowball_Middleware') !== path.resolve(middleware)) throw Error('Install root must contain this Snowball_Middleware checkout');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 12) throw Error('Node >=22.12 is required');
const npm = options.npm ?? process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npm)) throw Error('Cannot locate npm-cli.js. Run npm run setup -- ... or supply --npm PATH');
function run(executable, args, cwd = root, { capture = false, env = process.env } = {}) {
  const result = spawnSync(executable, args, { cwd, env, windowsHide: true, shell: false, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${path.basename(executable)} failed (${result.status}). Installation remains incomplete.`);
  return result.stdout?.trim();
}
const npmRun = (args, cwd) => run(process.execPath, [npm, ...args], cwd);
const installDir = path.join(root, '.snowball');
fs.mkdirSync(installDir, { recursive: true, mode: 0o700 });
const configFile = path.join(installDir, 'suite.json');
let previousConfig;
try { previousConfig=JSON.parse(fs.readFileSync(configFile,'utf8')); } catch {}
const deviceProfiles=planDevices(options.profile,previousConfig);
const previouslyInstalledTray=previousConfig?.desktopVersion===1;
// Stop only this installed tray before replacing dependencies; preserve all state.
if(fs.existsSync(path.join(installDir,'desktop.v1.json')))run(process.execPath,[path.join(middleware,'scripts/start-installed.mjs'),'--config',configFile,'--stop'],middleware);
const commits = {};
for (const repository of repositoriesFor(deviceProfiles)) {
  const directory = path.join(root, repository);
  if (!fs.existsSync(directory)) run('git', ['clone', '--branch', 'main', 'https://github.com/fkiller/' + repository + '.git', directory]);
  const remote = run('git', ['remote', 'get-url', 'origin'], directory, { capture: true });
  if (!new RegExp(`^(?:https://github\\.com/|git@github\\.com:)fkiller/${repository}(?:\\.git)?$`, 'i').test(remote)) throw Error('Unexpected repository origin: ' + repository);
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], directory, { capture: true })) throw Error('Tracked local changes in ' + repository + '; commit or use a separate install root');
  if(options.update){
    run('git',['fetch','origin','main'],directory);
    run('git',['merge','--ff-only','origin/main'],directory);
  }
  commits[repository] = run('git', ['rev-parse', 'HEAD'], directory, { capture: true });
}
console.log('Building Snowball Middleware and all harness plugins...');
npmRun(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], middleware);
npmRun(['run', 'build'], middleware);
npmRun(['run', 'install:desktop'], middleware);
const plugins = [];
for (const [kind, repository] of Object.entries(harnessRepositories)) {
  const directory = path.join(root, repository);
  npmRun(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
  npmRun(['run', 'build'], directory);
  const entry = await import(pathToFileURL(path.join(directory, 'dist/index.js')).href);
  const manifest = await entry[kind + 'Manifest']();
  plugins.push({ kind, directory, entrySha256: manifest.integrity.entrySha256 });
}
const config = { version: 1, desktopVersion: 1, nodeExecutable: process.execPath, profile: options.profile, root, middleware, plugins, commits, port: options.portExplicit ? options.port : previousConfig?.port ?? options.port,
  deviceProfiles, devices:planDeviceConfigs(options,previousConfig,root),
  ...(options['data-dir'] ? { dataDir: path.resolve(options['data-dir']) } : previousConfig?.dataDir ? {dataDir:previousConfig.dataDir} : {}) };
for(const profile of deviceProfiles) {
  const device=config.devices[profile];
  const python = options.python ?? (process.platform === 'win32' ? 'python' : 'python3');
  if (profile === 'm5stack') {
    const deviceRoot = device.deviceRoot;
    if (!fs.existsSync(device.python)) run(python, ['-m', 'venv', path.dirname(path.dirname(device.python))]);
    run(device.python, ['-m', 'pip', 'install', '-r', path.join(deviceRoot, 'requirements.txt')]);
    // Installing discovery never probes USB or writes firmware. Device
    // preparation is an explicit, separate operation even on upgrades.
    if(options['prepare-m5stack']) {
      const provision = [path.join(deviceRoot, 'scripts/install_device.py'), '--output', path.join(installDir, 'm5stack-device.json')];
      if (options.serial) provision.push('--port', options.serial);
      if (options['no-flash']) provision.push('--no-flash');
      run(device.python, provision, deviceRoot);
      device.serial = JSON.parse(fs.readFileSync(path.join(installDir, 'm5stack-device.json'), 'utf8')).port;
    }
  } else {
    const control = device.controlRoot;
    npmRun(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(control, 'host'));
    npmRun(['run', 'build'], path.join(control, 'host'));
    console.log('MK20 joins over Wi-Fi. Select this middleware on the device (K17); USB/ADB deployment is a separate maintenance action.');
    if (!fs.existsSync(device.python)) run(python, ['-m', 'venv', path.dirname(path.dirname(device.python))]);
    run(device.python, [path.join(middleware, 'scripts/ensure_stt_runtime.py'), '--install', '--python', device.python]);
    run(device.python, [path.join(control, 'scripts/ensure_tts_runtime.py'), '--ensure']);
  }
}
const { loadSuitePlugins } = await import('./suite-plugins.mjs');
const loaded = await loadSuitePlugins(config);
await loaded.close();
config.devicePreparations=approveDevicePreparations(config);
const temporary = configFile + '.tmp';
fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(temporary, configFile);
const launchScript = path.join(middleware, 'scripts/start-installed.mjs');
if (process.platform === 'win32') {
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const launcher = path.join(root, 'Start-Snowball.ps1');
  fs.writeFileSync(launcher, `& ${quote(process.execPath)} ${quote(launchScript)} --config ${quote(configFile)}\nexit $LASTEXITCODE\n`);
  fs.writeFileSync(path.join(root,'Register-M5Stack.ps1'),`param([string]$Serial,[switch]$Flash)\n$arguments = @(${quote(path.join(middleware,'scripts/prepare-installed-m5stack.mjs'))}, '--config', ${quote(configFile)})\nif ($Serial) { $arguments += @('--serial', $Serial) }\nif ($Flash) { $arguments += '--flash' }\n& ${quote(process.execPath)} @arguments\nexit $LASTEXITCODE\n`);
  const desktop = run('powershell.exe', ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")'], root, { capture: true });
  if (!options['no-shortcut'] && fs.existsSync(desktop)) {
    // A .lnk keeps paths with spaces/non-ASCII characters intact; no cmd interpolation.
    const {createRequire}=await import('node:module');
    const electron=createRequire(import.meta.url)('electron');
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(path.join(desktop, 'Snowball.lnk'))});$s.TargetPath=${quote(electron)};$s.Arguments=${quote('"'+path.join(middleware,'apps/desktop/main.mjs')+'" --suite-config "'+configFile+'"')};$s.WorkingDirectory=${quote(root)};$s.Save()`;
    run('powershell.exe', ['-NoProfile', '-Command', ps]);
  }
} else {
  fs.writeFileSync(path.join(root, 'Start-Snowball.sh'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${launchScript.replaceAll("'", "'\\''")}' --config '${configFile.replaceAll("'", "'\\''")}'\n`, { mode: 0o700 });
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  fs.writeFileSync(path.join(root,'Register-M5Stack.sh'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(middleware,'scripts/prepare-installed-m5stack.mjs'))} --config ${quote(configFile)} "$@"\n`,{mode:0o700});
}
console.log(`Installed Snowball (${options.profile}) with all three verified harness plugins. Launcher: ${root}`);
console.log(`Enabled device adapters: ${deviceProfiles.join(', ') || 'none (Web UI only)'}. Existing adapters and state are preserved.`);
console.log('Native Codex / Antigravity / OpenCode applications and their sign-in remain owned by their vendors. Missing native apps are shown as unavailable.');
if(deviceProfiles.includes('m5stack'))console.log('M5Stack LAN discovery is ready when the gateway starts. With firmware 0.4.0, choose a discovered PC on the device to pair over Wi-Fi; no USB registration script is required. For initial firmware or upgrades, connect USB and use the common Device setup window opened by the tray; it offers version review, full backup, reboot checks and Wi-Fi setup. Legacy Register-M5Stack launchers remain optional.');
if (!options['no-start']) run(process.execPath, [launchScript, '--config', configFile,...(previouslyInstalledTray?[]:['--register-autostart'])], middleware);
