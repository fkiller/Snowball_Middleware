import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installLockedDevelopment, loadManifest, REPOSITORIES, validateManifest, verifyCheckouts } from '../scripts/install-locked-development.mjs';
import { parseSetupOptions } from '../scripts/setup-profile.mjs';
import { registerUserCommand } from '../scripts/installed-cli-setup.mjs';

function execute(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', ...options, stdio: 'pipe' });
  if (result.error || result.status !== 0) throw new Error(`${file} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

function fixtureRepositories(root) {
  const records = [];
  for (const name of REPOSITORIES) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    execute('git', ['init', '-q', '-b', 'feat/remote-expansion', directory]);
    fs.writeFileSync(path.join(directory, 'README'), `${name}\n`);
    execute('git', ['-C', directory, 'add', 'README']);
    execute('git', ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    records.push({ name, branch: 'feat/remote-expansion', head: execute('git', ['-C', directory, 'rev-parse', 'HEAD']) });
  }
  return { version: 1, repositories: records };
}

test('manifest loading supports Windows PowerShell redirection and never exposes invalid contents', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-manifest-encoding-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'lock.json');
  const manifest = { version: 1, repositories: [] };
  for (const bytes of [Buffer.from(JSON.stringify(manifest)), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(manifest))]),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(manifest), 'utf16le')])]) {
    fs.writeFileSync(file, bytes);
    assert.deepEqual(loadManifest(file), manifest);
  }
  fs.writeFileSync(file, '{"private":"do-not-print"');
  assert.throws(() => loadManifest(file), error => error.message === 'Manifest could not be read or parsed');
  fs.writeFileSync(file, Buffer.alloc(64 * 1024 + 1));
  assert.throws(() => loadManifest(file), /Manifest could not be read or parsed/);
});

// Substitute local repositories only inside the explicit internal test seam;
// production always receives the fixed official GitHub URLs.
function fixtureRunner(sourceRoot) {
  return (file, args, options = {}) => {
    if (file === 'git' && args[0] === 'clone') {
      const url = args.at(-2), target = args.at(-1);
      const name = path.basename(target);
      assert.equal(url, `https://github.com/fkiller/${name}.git`);
      const copy = [...args]; copy[copy.length - 2] = path.join(sourceRoot, name);
      execute(file, copy, options);
      execute('git', ['-C', target, 'remote', 'set-url', 'origin', url]);
      return '';
    }
    if (file === 'git' && args[0] === '-C' && args[2] === 'fetch') {
      // The object was cloned above. Verify it locally instead of networking.
      execute('git', ['-C', args[1], 'cat-file', '-e', `${args.at(-1)}^{commit}`]);
      return '';
    }
    return execute(file, args, options);
  };
}

test('isolated development checkout pins all six official repositories and rejects drift', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-locked-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'sources'); fs.mkdirSync(source);
  const manifest = fixtureRepositories(source);
  const root = path.join(temp, 'new install');
  const result = await installLockedDevelopment({ root, manifest, checkoutOnly: true }, fixtureRunner(source));
  assert.deepEqual(result, { root, checkoutsVerified: true, suiteInstalled: false });
  assert.equal(fs.existsSync(path.join(root, '.snowball')), false);
  for (const record of manifest.repositories) {
    const checkout = path.join(root, record.name);
    assert.equal(execute('git', ['-C', checkout, 'rev-parse', 'HEAD']), record.head);
    assert.equal(execute('git', ['-C', checkout, 'branch', '--show-current']), '');
    assert.equal(execute('git', ['-C', checkout, 'remote', 'get-url', 'origin']), `https://github.com/fkiller/${record.name}.git`);
  }
  await assert.rejects(installLockedDevelopment({ root, manifest, checkoutOnly: true }, fixtureRunner(source)), /already exists/);
  fs.writeFileSync(path.join(root, 'Snowball_Control', 'untracked'), 'local');
  assert.throws(() => verifyCheckouts(root, validateManifest(manifest)), /verification failed/);
});

test('malformed manifests fail before creating an install root and isolated setup does not register PATH', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-locked-invalid-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const records = REPOSITORIES.map(name => ({ name, branch: 'feat/remote-expansion', head: 'a'.repeat(40) }));
  const root = path.join(temp, 'not-created');
  for (const repositories of [records.slice(1), records.map((item, i) => i ? item : { ...item, name: '../foreign' }),
    records.map((item, i) => i ? item : { ...item, branch: '--upload-pack=unsafe' }),
    records.map((item, i) => i ? item : { ...item, head: 'not-a-commit' })]) {
    await assert.rejects(installLockedDevelopment({ root, manifest: { version: 1, repositories }, checkoutOnly: true }));
    assert.equal(fs.existsSync(root), false);
  }
  assert.equal(parseSetupOptions(['--profile', 'web', '--no-start', '--no-command-link'])['no-command-link'], true);
  const bin = path.join(temp, 'home', '.local', 'bin'); fs.mkdirSync(bin, { recursive: true });
  assert.equal(registerUserCommand(root, { env: { HOME: path.join(temp, 'home'), PATH: bin }, disabled: true }), 'manual');
  assert.equal(fs.existsSync(path.join(bin, 'snowball')), false);
});
