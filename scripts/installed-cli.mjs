import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repositoriesFor} from './setup-profile.mjs';

function fail(message) { throw new Error(message); }
function git(directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], {encoding:'utf8', windowsHide:true});
  if (result.error || result.status !== 0) fail(`Cannot inspect repository ${directory}; update stopped.`);
  return result.stdout.trim();
}

// Check every recorded checkout before the installer changes any of them.
// Experimental branches must never silently merge the public main branch.
export function checkUpdate(root) {
  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.snowball', 'suite.json'), 'utf8')); }
  catch { fail('Installed suite configuration is missing or invalid; update stopped.'); }
  if (config.version !== 1 || path.resolve(config.root || '') !== root || !config.commits || typeof config.commits !== 'object' || Array.isArray(config.commits)) fail('Installed suite configuration does not match this install root; update stopped.');
  const repositories = Object.keys(config.commits);
  const permitted = new Set(repositoriesFor('all'));
  if (!repositories.includes('Snowball_Middleware') || repositories.some(name => !permitted.has(name))) fail('Invalid suite repository inventory; update stopped.');
  // The normal update may add adapters which were not in the old inventory.
  // Preflight any already-existing checkout it could subsequently use as well.
  const present = [...permitted].filter(name => fs.existsSync(path.join(root, name)));
  for (const repository of new Set([...repositories, ...present])) {
    const directory = path.join(root, repository);
    if (git(directory, ['branch', '--show-current']) !== 'main') fail(`${repository} is not on main. Experimental or detached checkouts cannot use this updater.`);
    const origin = git(directory, ['remote', 'get-url', 'origin']);
    if (![ `https://github.com/fkiller/${repository}`, `https://github.com/fkiller/${repository}.git`, `git@github.com:fkiller/${repository}`, `git@github.com:fkiller/${repository}.git` ].includes(origin)) fail(`${repository} has an unexpected origin; update stopped.`);
    if (git(directory, ['status', '--porcelain', '--untracked-files=no'])) fail(`${repository} has tracked local changes; update stopped.`);
  }
}

export function runCli(args) {
  if (args[0] !== '--root' || !args[1]) fail('Install root not supplied. Run the installed snowball command.');
  const root = path.resolve(args[1]);
  const command = args[2];
  if (!command || command === '--help' || command === '-h') {
    console.log('Usage: snowball update [--no-start]\nUpdate this source installation. This does not update device firmware.');
    return 0;
  }
  if (command !== 'update' || args.slice(3).some(arg => arg !== '--no-start') || args.length > 4) fail('Usage: snowball update [--no-start]');
  checkUpdate(root);
  const windows = process.platform === 'win32';
  const source = path.join(root, 'Snowball_Middleware', windows ? 'install.ps1' : 'install.sh');
  // Copy the entry script first: git may replace the checkout while it runs.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-update-'));
  try {
    const entry = path.join(temp, windows ? 'install.ps1' : 'install.sh');
    fs.copyFileSync(source, entry);
    const extra = args[3] ? [windows ? '-NoStart' : '--no-start'] : [];
    const exe = windows ? 'powershell.exe' : 'bash';
    const childArgs = windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', entry, '-InstallRoot', root, '-Update', ...extra] : [entry, '--root', root, '--update', ...extra];
    const result = spawnSync(exe, childArgs, {stdio:'inherit', windowsHide:false});
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runCli(process.argv.slice(2)); }
  catch (error) { console.error(`Snowball: ${error.message}`); process.exitCode = 1; }
}
