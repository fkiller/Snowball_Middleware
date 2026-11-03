import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PersistentRemoteCredentials, RemoteReadGateway, recoverAbandonedRemoteCredentialLock } from '../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';

function dir() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-remote-credentials-')); return path.join(root, 'private'); }
const create = (directory, now) => new PersistentRemoteCredentials({ directory, now, verifyPrivateDirectory: ensurePrivateStateDirectory });
function request(gateway, token) { return new Promise((resolve, reject) => {
  const req = http.get(gateway.origin + '/remote/v1/sessions', { headers: token ? { Authorization: `Bearer ${token}` } : {} }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
}); }

test('persistent grants store hashes only and survive restart until explicit per-device revocation or expiry', async t => {
  const directory = dir(); let now = 1000;
  let store = create(directory, () => now);
  let gateway = new RemoteReadGateway({ credentialStore: store, sessionService: { snapshotSessions: () => [] }, now: () => now });
  await gateway.start();
  const first = gateway.issueReadCredential('Phone'), second = gateway.issueReadCredential('Tablet');
  assert.deepEqual(gateway.listReadCredentials().map(x => x.label), ['Phone', 'Tablet']);
  assert.equal(fs.readFileSync(path.join(directory, 'remote-credentials.v1.json'), 'utf8').includes(first.token), false);
  assert.equal(JSON.stringify(gateway.listReadCredentials()).includes(first.token), false);
  assert.throws(() => create(directory, () => now), /EEXIST/);
  assert.equal(await request(gateway, first.token), 200);
  await gateway.close(); store.close();
  store = create(directory, () => now);
  gateway = new RemoteReadGateway({ credentialStore: store, sessionService: { snapshotSessions: () => [] }, now: () => now });
  await gateway.start();
  t.after(async () => { await gateway.close(); store.close(); fs.rmSync(path.dirname(directory), { recursive: true, force: true }); });
  assert.equal(await request(gateway, first.token), 200);
  gateway.revokeCredential(first.deviceId);
  assert.equal(await request(gateway, first.token), 401);
  assert.equal(await request(gateway, second.token), 200);
  now = second.expiresAt;
  assert.equal(await request(gateway, second.token), 401);
  now = 999;
  assert.equal(await request(gateway, second.token), 401);
});

test('credential tampering or an unsafe state directory fails closed', async t => {
  const directory = dir(); const store = create(directory, () => 1000);
  const gateway = new RemoteReadGateway({ credentialStore: store, sessionService: { snapshotSessions: () => [] }, now: () => 1000 });
  await gateway.start(); t.after(async () => { await gateway.close(); store.close(); fs.rmSync(path.dirname(directory), { recursive: true, force: true }); });
  const credential = gateway.issueReadCredential('Phone');
  const file = path.join(directory, 'remote-credentials.v1.json');
  const valid = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, valid.replace('Phone', 'Other'));
  assert.equal(await request(gateway, credential.token), 503);
  assert.throws(() => gateway.listReadCredentials(), /unavailable/);
  fs.writeFileSync(file, valid);
  assert.equal(await request(gateway, credential.token), 503);
  if (process.platform !== 'win32') {
    const other = path.join(path.dirname(directory), 'unsafe');
    fs.mkdirSync(other, { mode: 0o755 }); fs.chmodSync(other, 0o755);
    assert.throws(() => create(other, () => 1000), /owner\/mode/);
  }
});

test('invalid request flood cannot exhaust the authenticated device rate limit', async t => {
  let now = 1000;
  const gateway = new RemoteReadGateway({ sessionService: { snapshotSessions: () => [] }, now: () => now });
  await gateway.start(); t.after(() => gateway.close());
  const credential = gateway.issueReadCredential();
  for (let i = 0; i < 1200; i++) assert.equal(await request(gateway), 401);
  assert.equal(await request(gateway), 429);
  assert.equal(await request(gateway, credential.token), 200);
  now += 60_000;
  assert.equal(await request(gateway), 401);
});

test('offline recovery refuses a live owner and recovers only the observed dead process lock', t => {
  const directory = dir(); t.after(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }));
  const store = create(directory, () => Date.now());
  const lockPath = path.join(directory, 'remote-credentials.lock');
  let lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const recover = expectedToken => recoverAbandonedRemoteCredentialLock({ directory, expectedToken, verifyPrivateDirectory: ensurePrivateStateDirectory });
  assert.throws(() => recover(lock.token), /still running/);
  assert.throws(() => recover('00000000-0000-0000-0000-000000000000'), /metadata mismatch/);
  store.close();
  const script = `import { PersistentRemoteCredentials } from './packages/api/dist/index.js'; import { ensurePrivateStateDirectory } from './apps/supervisor/private-state.mjs'; new PersistentRemoteCredentials({directory: process.argv[1], verifyPrivateDirectory: ensurePrivateStateDirectory});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, directory], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  recover(lock.token);
  const reopened = create(directory, () => Date.now()); reopened.close();
});

test('unverified guard and older lock format never get removed automatically', t => {
  const directory=dir(); t.after(()=>fs.rmSync(path.dirname(directory),{recursive:true,force:true}));
  const store=create(directory,()=>Date.now());
  const lockPath=path.join(directory,'remote-credentials.lock');
  const guardPath=path.join(directory,'remote-credentials.guard');
  const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
  fs.writeFileSync(guardPath,'unverified',{mode:0o600});
  assert.throws(()=>store.close(),/EEXIST/);
  assert.equal(fs.readFileSync(guardPath,'utf8'),'unverified');
  assert.equal(fs.existsSync(lockPath),true);
  fs.unlinkSync(guardPath);store.close();
  fs.writeFileSync(lockPath,JSON.stringify({token:lock.token,pid:lock.pid}),{mode:0o600});
  assert.throws(()=>recoverAbandonedRemoteCredentialLock({directory,expectedToken:lock.token,verifyPrivateDirectory:ensurePrivateStateDirectory}),/unsupported version/);
  assert.equal(fs.existsSync(lockPath),true);
  assert.equal(fs.existsSync(guardPath),false);
});
