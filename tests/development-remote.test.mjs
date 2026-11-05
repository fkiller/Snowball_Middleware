import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { RemoteManager } from '../apps/supervisor/remote-manager.mjs';
import { readDevelopmentRemoteConfig, startDevelopmentRemote } from '../apps/supervisor/development-remote.mjs';

test('explicit private development binding serves the owning runtime and revokes on cleanup', { timeout: 60000 }, async t => {
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['openssl'], { encoding: 'utf8' });
  const openssl = lookup.stdout?.split(/\r?\n/).find(file => path.isAbsolute(file) && fs.existsSync(file));
  if (!openssl) { t.skip('OpenSSL unavailable'); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-development-remote-'));
  const configFile = path.join(directory, 'config.v1.json');
  const host = 'node.example.ts.net';
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, host, openssl }), { mode: 0o600 });
  const config = readDevelopmentRemoteConfig(configFile);
  assert.throws(() => readDevelopmentRemoteConfig('relative.json'));
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, host, openssl, extra: true }));
  assert.throws(() => readDevelopmentRemoteConfig(configFile));
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, host, openssl }));
  if (process.platform !== 'win32') {
    fs.chmodSync(configFile, 0o644);
    assert.throws(() => readDevelopmentRemoteConfig(configFile));
    fs.chmodSync(configFile, 0o600);
  }
  let sessions = [{ status: 'unknown', harnessPluginId: 'snowball.codex' }];
  const manager = new RemoteManager({ directory, sessionService: { snapshotSessions: () => sessions } });
  t.after(async () => { await manager.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const development = await startDevelopmentRemote(manager, config);
  const binding = JSON.parse(fs.readFileSync(development.bindingFile, 'utf8'));
  assert.equal(binding.origin, `https://${host}`);
  assert.equal(binding.pid, process.pid);
  if (process.platform !== 'win32') assert.equal(fs.statSync(development.bindingFile).mode & 0o077, 0);
  const cert = JSON.parse(fs.readFileSync(path.join(directory, 'remote/tls-identity/gateway-tls-identity.v1.json'))).cert;
  const get = () => new Promise((resolve, reject) => {
    const request = https.get({ host: '127.0.0.1', port: new URL(binding.loopbackOrigin).port, servername: host,
      ca: cert, agent: false, path: '/remote/v1/sessions', headers: { Authorization: `Bearer ${binding.token}` } }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.once('error', reject);
  });
  assert.deepEqual((await get()).body.sessions, sessions);
  sessions = [...sessions, { status: 'unknown', harnessPluginId: 'snowball.opencode' }];
  assert.deepEqual((await get()).body.sessions, sessions);
  // A second development start must not disable a listener owned by the first.
  await assert.rejects(startDevelopmentRemote(manager, config), /development_remote_unavailable/);
  assert.equal((await get()).status, 200);
  await development.close(); await development.close();
  assert.equal(fs.existsSync(development.bindingFile), false);
  assert.equal((await get()).status, 401);
  await manager.disable();
  // Existing local binding files are never overwritten, even after a restart.
  fs.writeFileSync(development.bindingFile, 'existing private binding', { mode: 0o600 });
  await assert.rejects(startDevelopmentRemote(manager, config), /development_remote_unavailable/);
  assert.equal(fs.readFileSync(development.bindingFile, 'utf8'), 'existing private binding');
  assert.equal((await manager.status()).enabled, false);
  assert.equal((await manager.list()).credentials.filter(item => !item.revoked).length, 0);
});
