#!/usr/bin/env node
// Development-only source installation. The supplied SHA manifest is a trust
// input, not a signature or an approval of the source code it identifies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORIES = Object.freeze([
  'Snowball_Control', 'Snowball_Device_M5Stack', 'Snowball_Harness_Antigravity',
  'Snowball_Harness_Codex', 'Snowball_Harness_OpenCode', 'Snowball_Middleware',
]);
const harnesses = Object.freeze({ codex: 'Snowball_Harness_Codex', antigravity: 'Snowball_Harness_Antigravity', opencode: 'Snowball_Harness_OpenCode' });
const safeGitEnvironment = () => {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
  return env;
};

export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.repositories) || manifest.repositories.length !== REPOSITORIES.length) throw Error('Expected a six-repository version 1 SHA manifest');
  return REPOSITORIES.map((name, index) => {
    const item = manifest.repositories[index];
    if (!item || item.name !== name || typeof item.branch !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(item.branch) || item.branch.includes('..') || item.branch.includes('//') || item.branch.endsWith('/') || item.branch.endsWith('.') || item.branch.endsWith('.lock') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.head ?? '')) throw Error('Invalid repository, branch or exact commit in SHA manifest');
    return { name, branch: item.branch, head: item.head };
  });
}

function exec(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw Error(`${path.basename(file)} failed; pinned development installation is incomplete`);
  return result.stdout?.trim() ?? '';
}

function npmCli(explicit) {
  const candidates = [explicit, process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const result = candidates.find(item => typeof item === 'string' && path.isAbsolute(item) && fs.existsSync(item));
  if (!result) throw Error('npm-cli.js is required; provide --npm with its absolute path');
  return path.resolve(result);
}

function git(directory, args, run = exec) {
  return run('git', ['-C', directory, ...args], { env: safeGitEnvironment(), stdio: 'pipe' });
}

export function verifyCheckouts(root, records, run = exec) {
  for (const record of records) {
    const dir = path.join(root, record.name);
    const top = fs.realpathSync(git(dir, ['rev-parse', '--show-toplevel'], run));
    const head = git(dir, ['rev-parse', '--verify', 'HEAD^{commit}'], run);
    const dirty = git(dir, ['status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=none'], run);
    const remote = git(dir, ['remote', 'get-url', 'origin'], run);
    if (top !== fs.realpathSync(dir) || head !== record.head || dirty || remote !== `https://github.com/fkiller/${record.name}.git`) throw Error(`Pinned checkout verification failed: ${record.name}`);
  }
}

async function verifyInstalledSuite(root, records) {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.snowball', 'suite.json'), 'utf8'));
  if (config.version !== 1 || config.profile !== 'web' || path.resolve(config.root ?? '') !== root || !config.commits || !Array.isArray(config.plugins) || config.plugins.length !== 3) throw Error('Invalid isolated development suite configuration');
  for (const name of ['Snowball_Middleware', ...Object.values(harnesses)]) {
    if (config.commits[name] !== records.find(item => item.name === name).head) throw Error(`Installed commit mismatch: ${name}`);
  }
  const seen = new Set();
  for (const plugin of config.plugins) {
    const name = harnesses[plugin.kind];
    if (!name || seen.has(name) || !/^[a-f0-9]{64}$/.test(plugin.entrySha256 ?? '')) throw Error('Invalid installed harness digest');
    seen.add(name);
    const directory = fs.realpathSync(path.join(root, name));
    if (fs.realpathSync(plugin.directory) !== directory) throw Error('Installed harness directory mismatch');
    const module = await import(pathToFileURL(path.join(directory, 'dist', 'index.js')).href);
    const manifest = await module[`${plugin.kind}Manifest`]();
    if (manifest.id !== `snowball.${plugin.kind}` || manifest.integrity?.entrySha256 !== plugin.entrySha256 || typeof manifest.entrypoint !== 'string') throw Error('Installed harness manifest mismatch');
    const entry = fs.realpathSync(path.join(directory, manifest.entrypoint));
    const relative = path.relative(directory, entry);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Installed harness entrypoint escapes its repository');
    if (createHash('sha256').update(fs.readFileSync(entry)).digest('hex') !== plugin.entrySha256) throw Error('Installed harness entrypoint digest mismatch');
  }
}

/** Optional runner is an internal test seam, not a CLI or manifest setting. */
export async function installLockedDevelopment({ root, manifest, npm, checkoutOnly = false }, run = exec) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('An absolute, new --root is required');
  const target = path.resolve(root);
  if (target === path.parse(target).root) throw Error('The filesystem root cannot be an installation root');
  const records = validateManifest(manifest);
  const cli = checkoutOnly ? undefined : npmCli(npm);
  // mkdir without recursive is deliberate: an existing installation, even an
  // empty directory or symlink, is never adopted or overwritten.
  try { fs.mkdirSync(target, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Installation root already exists; choose a new path'); throw error; }
  for (const record of records) {
    const dir = path.join(target, record.name);
    const url = `https://github.com/fkiller/${record.name}.git`;
    run('git', ['clone', '--no-checkout', '--single-branch', '--branch', record.branch, '--', url, dir], { env: safeGitEnvironment(), stdio: 'inherit' });
    // Fetch the exact commit as well: the branch may have advanced since the
    // manifest was captured. The accepted URL remains fixed to the official repo.
    run('git', ['-C', dir, 'fetch', '--no-tags', 'origin', record.head], { env: safeGitEnvironment(), stdio: 'inherit' });
    run('git', ['-C', dir, 'checkout', '--detach', record.head], { env: safeGitEnvironment(), stdio: 'inherit' });
  }
  verifyCheckouts(target, records, run);
  if (checkoutOnly) return { root: target, checkoutsVerified: true, suiteInstalled: false };
  const middleware = path.join(target, 'Snowball_Middleware');
  const setup = path.join(middleware, 'scripts', 'setup.mjs');
  // Older snapshots do not contain the contract that suppresses PATH changes.
  if (!fs.readFileSync(setup, 'utf8').includes('snowball-isolated-setup-v1')) throw Error('Pinned Middleware does not support isolated setup; use a newer trusted manifest');
  run(process.execPath, [setup, '--root', target, '--npm', cli, '--profile', 'web', '--no-start', '--no-shortcut', '--no-command-link'], { cwd: middleware, stdio: 'inherit' });
  verifyCheckouts(target, records, run);
  await verifyInstalledSuite(target, records);
  return { root: target, checkoutsVerified: true, suiteInstalled: true };
}

function parse(args) {
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--checkout-only' && !options.checkoutOnly) { options.checkoutOnly = true; continue; }
    if (!['--root', '--manifest', '--npm'].includes(flag) || !args.length || options[flag.slice(2)]) throw Error('Usage: node scripts/install-locked-development.mjs --manifest FILE --root NEW_ABSOLUTE_PATH [--npm FILE] [--checkout-only]');
    options[flag.slice(2)] = args.shift();
  }
  if (!options.root || !options.manifest || !path.isAbsolute(options.manifest)) throw Error('An absolute --manifest and a new absolute --root are required');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    console.log('Unsigned development source installation. Only use a SHA manifest you trust.');
    const result = await installLockedDevelopment({ ...options, manifest });
    console.log(result.suiteInstalled ? `Pinned web development suite installed without starting or changing PATH: ${result.root}` : `Pinned checkouts verified; suite not installed: ${result.root}`);
  } catch (error) { console.error(`Snowball development installer: ${error.message}`); process.exitCode = 1; }
}
