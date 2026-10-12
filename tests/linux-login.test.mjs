import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {linuxLogin} from '../apps/desktop/linux-login.mjs';

test('Linux login preserves disabled choice, migrates only its exact entry and refuses foreign content', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-login-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const old = {path:'/old app/SnowballMiddleware', args:['--suite-config', '/suite root/suite.json']};
  const current = {...old, path:'/new app/SnowballMiddleware'};
  const original = linuxLogin(old, 'suite-one', [], directory);
  const updated = linuxLogin(current, 'suite-one', [old], directory);
  updated.migrate();
  assert.equal(updated.get(), false);
  original.set(true);
  updated.migrate();
  assert.equal(updated.get(), true);
  const [name] = fs.readdirSync(directory);
  const payload = fs.readFileSync(path.join(directory, name), 'utf8');
  assert.match(payload, /Exec="\/new app\/SnowballMiddleware" "--suite-config" "\/suite root\/suite.json"/);
  updated.set(false);
  assert.equal(updated.get(), false);
  updated.set(true);
  fs.writeFileSync(path.join(directory, name), 'foreign entry');
  assert.throws(() => updated.set(false), /differs/);
  updated.migrate();
  assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), 'foreign entry');
});

test('Linux desktop launcher delivers exact quoted arguments to a real process', {skip:process.platform!=='linux'||!fs.existsSync('/usr/bin/gio')}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball desktop-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const recorder = path.join(directory, 'record args.py'), output = path.join(directory, 'args.json');
  fs.writeFileSync(recorder, 'import json,sys\nwith open(sys.argv[1],"w") as f: json.dump(sys.argv[2:], f)\n');
  const expected = ['space path', '100% $HOME `id` "quoted" \\'];
  const entries = path.join(directory, 'autostart');
  linuxLogin({path:'/usr/bin/python3', args:[recorder, output, ...expected]}, 'real-launch', [], entries).set(true);
  const result = spawnSync('/usr/bin/gio', ['launch', path.join(entries, fs.readdirSync(entries)[0])], {encoding:'utf8', timeout:10000});
  assert.equal(result.status, 0, result.stderr);
  const deadline = Date.now()+5000;
  while (!fs.existsSync(output) && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), expected);
});

test('Linux Exec escapes desktop field codes and reserved characters without a shell', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-login-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const login = linuxLogin({path:'/apps/Snowball', args:['100% $HOME `id` "quoted" \\']}, 'quoted', [], directory);
  login.set(true);
  const payload = fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8');
  assert.ok(payload.includes('100%% \\\\$HOME \\\\`id\\\\` \\\\"quoted\\\\" \\\\\\\\'));
  assert.throws(() => linuxLogin({path:'/app',args:['bad\nExec=other']}, 'invalid', [], directory), /Invalid/);
});
