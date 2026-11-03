import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeInstalledCli, registerUserCommand} from '../scripts/installed-cli-setup.mjs';

const sourceScripts = fileURLToPath(new URL('../scripts/', import.meta.url));
function run(exe, args, cwd) {
  const result = spawnSync(exe, args, {cwd, encoding:'utf8'});
  if (result.error) throw result.error;
  return result;
}
function setupRepo(root, name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, {recursive:true});
  assert.equal(run('git', ['init', '-q', '-b', 'main'], directory).status, 0);
  assert.equal(run('git', ['remote', 'add', 'origin', `https://github.com/fkiller/${name}.git`], directory).status, 0);
  fs.writeFileSync(path.join(directory, 'tracked'), 'test\n');
  if (name === 'Snowball_Middleware') {
    fs.mkdirSync(path.join(directory, 'scripts'));
    for (const file of ['installed-cli.mjs', 'setup-profile.mjs']) fs.copyFileSync(path.join(sourceScripts, file), path.join(directory, 'scripts', file));
    fs.writeFileSync(path.join(directory, 'install.sh'), '#!/bin/sh\nprintf "INSTALLER:%s\\n" "$*"\n');
  }
  assert.equal(run('git', ['add', '.'], directory).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'test'], directory).status, 0);
  return directory;
}

test('installed update preserves the selected root and refuses experimental or dirty repositories before invoking the installer', {skip:process.platform === 'win32'}, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "snowball test '"));
  t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
  const root = path.join(temp, 'installation');
  const middleware = setupRepo(root, 'Snowball_Middleware');
  const harness = setupRepo(root, 'Snowball_Harness_Codex');
  fs.mkdirSync(path.join(root, '.snowball'));
  fs.writeFileSync(path.join(root, '.snowball', 'suite.json'), JSON.stringify({version:1, root, commits:{Snowball_Middleware:'a', Snowball_Harness_Codex:'b'}}));
  writeInstalledCli(root, process.execPath);
  const cli = path.join(root, 'snowball');
  const help = run(cli, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /snowball update/);
  const update = run(cli, ['update', '--no-start']);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /INSTALLER:/);
  assert.ok(update.stdout.includes(`--root ${root} --update --no-start`));

  assert.equal(run('git', ['checkout', '-qb', 'feat/experiment'], harness).status, 0);
  const branch = run(cli, ['update']);
  assert.equal(branch.status, 1);
  assert.match(branch.stderr, /not on main/);
  assert.doesNotMatch(branch.stdout, /INSTALLER:/);
  assert.equal(run('git', ['checkout', '-q', 'main'], harness).status, 0);
  assert.equal(run('git', ['remote', 'set-url', 'origin', 'https://example.invalid/untrusted'], harness).status, 0);
  const origin = run(cli, ['update']);
  assert.equal(origin.status, 1);
  assert.match(origin.stderr, /unexpected origin/);
  assert.doesNotMatch(origin.stdout, /INSTALLER:/);
  assert.equal(run('git', ['remote', 'set-url', 'origin', 'https://github.com/fkiller/Snowball_Harness_Codex.git'], harness).status, 0);
  fs.writeFileSync(path.join(middleware, 'tracked'), 'changed\n');
  const dirty = run(cli, ['update']);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /tracked local changes/);
  assert.doesNotMatch(dirty.stdout, /INSTALLER:/);
});

test('Windows command delegates through the install root without embedding it in cmd syntax', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball cli '));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  writeInstalledCli(root, "C:\\Users\\O'Brien\\node.exe", 'win32');
  const cmd = fs.readFileSync(path.join(root, 'snowball.cmd'), 'utf8');
  const ps = fs.readFileSync(path.join(root, 'snowball-cli.ps1'), 'utf8');
  assert.match(cmd, /%~dp0snowball-cli\.ps1/);
  assert.match(ps, /O''Brien/);
  assert.match(ps, /--root \$PSScriptRoot @args/);
});

test('direct setup refuses an experimental sibling before stopping the installed tray', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball setup guard '));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const middleware = setupRepo(root, 'Snowball_Middleware');
  const harness = setupRepo(root, 'Snowball_Harness_Codex');
  const scripts = path.join(middleware, 'scripts');
  for (const file of ['setup.mjs', 'suite-devices.mjs', 'device-preparation.mjs', 'installed-cli-setup.mjs']) fs.copyFileSync(path.join(sourceScripts, file), path.join(scripts, file));
  const marker = path.join(root, 'tray-stopped');
  fs.writeFileSync(path.join(scripts, 'start-installed.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'stopped');\n`);
  assert.equal(run('git', ['add', '.'], middleware).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'setup fixture'], middleware).status, 0);
  assert.equal(run('git', ['checkout', '-qb', 'feat/experiment'], harness).status, 0);
  const state = path.join(root, '.snowball'); fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'suite.json'), JSON.stringify({profile:'web', deviceProfiles:[]}));
  fs.writeFileSync(path.join(state, 'desktop.v1.json'), '{}');
  const result = run(process.execPath, [path.join(scripts, 'setup.mjs'), '--root', root, '--npm', process.execPath, '--profile', 'web', '--update', '--no-start']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Snowball_Harness_Codex is not on main/);
  assert.equal(fs.existsSync(marker), false);
});

test('user command is registered only on an existing PATH and never overwrites another installation', {skip:process.platform === 'win32'}, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball user command '));
  t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
  const userHome = path.join(temp, 'user home');
  const bin = path.join(userHome, '.local', 'bin');
  const firstRoot = path.join(temp, 'first installation');
  const secondRoot = path.join(temp, 'second installation');
  setupRepo(firstRoot, 'Snowball_Middleware'); setupRepo(secondRoot, 'Snowball_Middleware');
  writeInstalledCli(firstRoot, process.execPath);
  writeInstalledCli(secondRoot, process.execPath);
  assert.equal(registerUserCommand(firstRoot, {env:{HOME:userHome, PATH:'/usr/bin'}}), 'manual');
  assert.equal(fs.existsSync(bin), false);
  const env = {HOME:userHome, PATH:`${bin}:/usr/bin`};
  assert.equal(registerUserCommand(firstRoot, {env}), 'linked');
  assert.equal(fs.readlinkSync(path.join(bin, 'snowball')), path.join(firstRoot, 'snowball'));
  assert.equal(registerUserCommand(firstRoot, {env}), 'linked');
  assert.equal(registerUserCommand(secondRoot, {env}), 'conflict');
  assert.equal(fs.readlinkSync(path.join(bin, 'snowball')), path.join(firstRoot, 'snowball'));
  const help = run(path.join(bin, 'snowball'), ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /snowball update/);
  fs.unlinkSync(path.join(bin, 'snowball'));
  fs.writeFileSync(path.join(bin, 'snowball'), 'another command');
  assert.equal(registerUserCommand(firstRoot, {env}), 'conflict');
  assert.equal(fs.readFileSync(path.join(bin, 'snowball'), 'utf8'), 'another command');
  const earlier = path.join(temp, 'earlier'); fs.mkdirSync(earlier);
  fs.writeFileSync(path.join(earlier, 'snowball'), '#!/bin/sh\nexit 0\n', {mode:0o700});
  fs.unlinkSync(path.join(bin, 'snowball'));
  assert.equal(registerUserCommand(firstRoot, {env:{...env, PATH:`${earlier}:${env.PATH}`}}), 'conflict');
  assert.equal(fs.existsSync(path.join(bin, 'snowball')), false);
  assert.equal(registerUserCommand(firstRoot, {env:{...env, PATH:`relative${path.delimiter}${env.PATH}`}}), 'manual');
  assert.equal(fs.existsSync(path.join(bin, 'snowball')), false);
  assert.equal(registerUserCommand(firstRoot, {platform:'win32', env}), 'manual');
});
