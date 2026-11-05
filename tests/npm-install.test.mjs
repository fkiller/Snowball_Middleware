import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerCommand, runInstaller } from '../scripts/npm-install.mjs';

test('one CLI maps the chosen root and update options to the native installers without a shell', () => {
  const root = `A path with spaces & 'quotes'`;
  const args = ['--root', root, '--update', '--profile', 'web', '--no-start'];
  const unix = installerCommand(args, 'linux');
  assert.equal(unix.executable, 'bash');
  assert.match(unix.args[0], /install\.sh$/);
  assert.deepEqual(unix.args.slice(1), args);
  const windows = installerCommand(args, 'win32');
  assert.equal(windows.executable, 'powershell.exe');
  assert.match(windows.args[4], /install\.ps1$/);
  assert.deepEqual(windows.args.slice(5), ['-InstallRoot', root, '-Update', '-Profile', 'web', '-NoStart']);
  let invoked = false;
  const status = runInstaller(args, { platform: 'linux', run: (file, argv, options) => {
    invoked = true;
    assert.equal(file, 'bash');
    assert.deepEqual(argv.slice(1), args);
    assert.equal(options.shell, false);
    return { status: 0 };
  } });
  assert.equal(invoked, true);
  assert.equal(status, 0);
});

test('invalid options fail before an installer can run', () => {
  for (const args of [['--root'], ['--root', '--update'], ['--root', '-Update'], ['--unknown'], ['--update', '--update'], ['--help', '--update']]) {
    assert.throws(() => installerCommand(args, 'linux'));
  }
  assert.throws(() => installerCommand([], 'unsupported'));
  assert.equal(installerCommand(['--help'], 'linux').help, true);
  assert.equal(runInstaller([], { platform: 'linux', run: () => ({ status: 7 }) }), 7);
});

test('pinned development mode invokes the separate installer and cannot update an existing suite', () => {
  const args = ['--manifest', 'A manifest path/lock.json', '--root', 'A new install path', '--checkout-only'];
  for (const platform of ['win32', 'darwin', 'linux']) {
    const command = installerCommand(args, platform);
    assert.equal(command.executable, process.execPath);
    assert.match(command.args[0], /install-locked-development\.mjs$/);
    assert.deepEqual(command.args.slice(1), args);
  }
  for (const options of [
    ['--manifest', 'lock.json'], ['--checkout-only', '--root', 'root'],
    ['--manifest', 'lock.json', '--root', 'root', '--update'],
    ['--manifest', 'lock.json', '--root', 'root', '--profile', 'all'],
    ['--manifest', 'lock.json', '--root', 'root', '--root', 'other'],
  ]) assert.throws(() => installerCommand(options, 'linux'));
});

test('explicit Tailscale modes select only the verified prerequisite helper', () => {
  const install = installerCommand(['--tailscale'], 'win32');
  assert.equal(install.executable, process.execPath);
  assert.match(install.args[0], /tailscale-install\.mjs$/);
  assert.deepEqual(install.args.slice(1), ['--install']);
  const msi = "C:\\Installers with spaces & apostrophe's\\tailscale.msi";
  const offline = installerCommand(['--tailscale', '--msi', msi], 'win32');
  assert.deepEqual(offline.args.slice(1), ['--install', '--msi', msi]);
  assert.deepEqual(installerCommand(['--tailscale-status'], 'win32').args.slice(1), ['--inspect']);
  let invocations = 0;
  assert.equal(runInstaller(['--tailscale', '--msi', msi], { platform: 'win32', run(file, args, options) {
    invocations++;
    assert.equal(file, process.execPath);
    assert.deepEqual(args.slice(1), ['--install', '--msi', msi]);
    assert.equal(options.shell, false);
    return { status: 17 };
  } }), 17);
  assert.equal(invocations, 1);
});

test('Tailscale automation refuses implicit or mixed installation and unsupported platforms', () => {
  for (const args of [
    ['--tailscale', '--update'], ['--tailscale', '--root', 'C:\\Snowball'],
    ['--manifest', 'lock.json', '--root', 'new', '--tailscale'],
    ['--tailscale', '--profile', 'web'], ['--tailscale', '--tailscale'],
    ['--tailscale', '--help'], ['--tailscale-status', '--tailscale'],
    ['--tailscale-status', '--msi', 'C:\\verified.msi'], ['--tailscale', '--msi'],
    ['--tailscale', '--msi', 'relative.msi'], ['--tailscale', '--msi', '/rooted.msi'],
    ['--tailscale', '--msi', '\\\\server\\share\\install.msi'],
    ['--tailscale', '--msi', 'C:\\installer.exe'],
    ['--tailscale', '--msi', 'C:\\bad\"path.msi'],
    ['--tailscale', '--msi', 'C:\\bad\npath.msi'],
    ['--tailscale', '--msi', 'C:\\bad\0path.msi'],
    ['--msi', 'C:\\verified.msi'],
  ]) {
    assert.throws(() => runInstaller(args, { platform: 'win32', run() { assert.fail('must not launch'); } }));
  }
  for (const platform of ['darwin', 'linux']) {
    assert.throws(() => installerCommand(['--tailscale'], platform), /https:\/\/tailscale.com\/docs\/install/);
    assert.throws(() => installerCommand(['--tailscale-status'], platform), /available on Windows/);
  }
});

test('rejected option strings and spawn errors cannot disclose arbitrary input', () => {
  const privateValue = 'sentinel-private-command-value';
  for (const args of [[privateValue], ['--tailscale', privateValue], ['--manifest', 'lock.json', privateValue]]) {
    assert.throws(() => installerCommand(args, 'win32'), error => !error.message.includes(privateValue));
  }
  assert.throws(() => runInstaller(['--tailscale'], { platform: 'win32', run: () => ({ error: Error(privateValue) }) }),
    error => error.message === 'Installer process could not be started.');
});

test('a packed installer actually runs through the npm executable shim', { timeout: 60000 }, t => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-npm-installer-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const npmCandidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const npmCli = npmCandidates.find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));
  if (!npmCli) { t.skip('npm CLI is not available to test its executable shim'); return; }
  const env = { ...process.env, npm_config_cache: path.join(temp, 'cache') };
  const pack = spawnSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', temp],
    { cwd: repository, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(pack.status, 0, pack.stderr);
  const [metadata] = JSON.parse(pack.stdout);
  assert.ok(metadata.size < 100000, 'the bootstrap should not bundle the entire source tree');
  const packedFiles = metadata.files.map(file => file.path);
  assert.ok(packedFiles.includes('scripts/tailscale-install.mjs'));
  assert.ok(packedFiles.includes('scripts/tailscale-install-windows.ps1'));
  assert.equal(packedFiles.some(name => /\.msi$|(?:^|\/)\.state\//i.test(name)), false);
  const archive = path.join(temp, metadata.filename);
  const run = spawnSync(process.execPath, [npmCli, 'exec', '--yes', '--offline', `--package=${archive}`, '--', 'snowball-install', '--help'],
    { cwd: temp, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Snowball source installer/);
  assert.match(run.stdout, /--update/);
  assert.match(run.stdout, /--manifest/);
  assert.match(run.stdout, /--tailscale/);
  const locked = spawnSync(process.execPath, [npmCli, 'exec', '--yes', '--offline', `--package=${archive}`, '--',
    'snowball-install', '--manifest', path.join(temp, 'absent.json'), '--root', path.join(temp, 'must-not-exist')],
    { cwd: temp, env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(locked.status, 0);
  assert.match(locked.stderr, /Snowball development installer:/);
  assert.equal(fs.existsSync(path.join(temp, 'must-not-exist')), false);
});
