import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Unix bootstrap parses on Bash 3+, prints help and rejects incomplete/unknown options before installing', {skip:process.platform==='win32'}, () => {
  const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
  const run = args => spawnSync('bash', args, {encoding:'utf8', timeout:10000});
  assert.equal(run(['-n', installer]).status, 0);
  const help = run([installer, '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root PATH/);
  for (const args of [['--root'], ['--python'], ['--bad-option'], ['--root', '--update']]) {
    const result = run([installer, ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing value|Unknown option/);
  }
});

test('direct source updater refuses a sibling experimental branch before any fetch', {skip:process.platform==='win32'}, t => {
  if (process.getuid?.() === 0) return t.skip('bootstrap intentionally rejects root');
  const py = spawnSync('python3', ['-c', 'import sys, venv; sys.exit(0 if sys.version_info >= (3,12) else 1)']);
  if (py.status !== 0) return t.skip('requires Python 3.12');
  const git = spawnSync('which', ['git'], {encoding:'utf8'}).stdout.trim();
  if (!git) return t.skip('requires git');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball preflight '));
  t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
  const root = path.join(temp, 'installation'); fs.mkdirSync(root);
  const setup = name => {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    const run = args => spawnSync(git, ['-C', dir, ...args], {encoding:'utf8'});
    assert.equal(run(['init', '-q', '-b', 'main']).status, 0);
    assert.equal(run(['remote', 'add', 'origin', `https://github.com/fkiller/${name}.git`]).status, 0);
    fs.writeFileSync(path.join(dir, 'tracked'), 'unchanged\n');
    assert.equal(run(['add', '.']).status, 0);
    assert.equal(run(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']).status, 0);
    return {dir, run};
  };
  const middleware = setup('Snowball_Middleware');
  const harness = setup('Snowball_Harness_Codex');
  assert.equal(harness.run(['checkout', '-qb', 'feat/experiment']).status, 0);
  const original = middleware.run(['rev-parse', 'HEAD']).stdout.trim();
  const fakeBin = path.join(temp, 'bin'); fs.mkdirSync(fakeBin);
  const marker = path.join(temp, 'fetched');
  const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
  fs.writeFileSync(path.join(fakeBin, 'git'), `#!/bin/sh\ncase " $* " in *' status '*) if [ "\${SNOWBALL_TEST_FAIL_STATUS:-0}" = 1 ]; then exit 78; fi;; *' fetch '*|*' clone '*) : > ${shellQuote(marker)}; exit 99;; esac\nexec ${shellQuote(git)} "$@"\n`, {mode:0o700});
  const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
  const env = {...process.env, PATH:`${fakeBin}${path.delimiter}${process.env.PATH}`, DISPLAY:process.env.DISPLAY || ':99'};
  const bootstrap = (installRoot, update, extraEnv = {}) => spawnSync('bash', [installer, '--root', installRoot, '--profile', 'web', ...(update ? ['--update'] : []), '--no-start'], {encoding:'utf8', timeout:20000, env:{...env, ...extraEnv}});
  const result = bootstrap(root, true);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Snowball_Harness_Codex is not on main/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(middleware.run(['rev-parse', 'HEAD']).stdout.trim(), original);
  assert.equal(harness.run(['branch', '--show-current']).stdout.trim(), 'feat/experiment');
  assert.equal(harness.run(['checkout', '-q', 'main']).status, 0);
  const failedInspection = bootstrap(root, true, {SNOWBALL_TEST_FAIL_STATUS:'1'});
  assert.equal(failedInspection.status, 1, failedInspection.stderr);
  assert.match(failedInspection.stderr, /Cannot inspect Snowball_Middleware changes/);
  assert.equal(fs.existsSync(marker), false);
  const mainUpdate = bootstrap(root, true);
  assert.equal(mainUpdate.status, 99, mainUpdate.stderr);
  assert.equal(fs.existsSync(marker), true, 'clean main checkouts reach fetch');
  fs.unlinkSync(marker);
  const freshRoot = path.join(temp, 'fresh');
  const freshInstall = bootstrap(freshRoot, false);
  assert.equal(freshInstall.status, 99, freshInstall.stderr);
  assert.equal(fs.existsSync(marker), true, 'fresh install reaches clone');
});
