import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeInstalledCli} from '../scripts/installed-cli-setup.mjs';

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
