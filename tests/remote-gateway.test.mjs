import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { RemoteReadGateway } from '../packages/api/dist/index.js';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';

const sample = { sessionKey: 'host/fixture/session', title: 'Real session', status: 'idle', harnessPluginId: 'snowball.test', updatedAt: 123,
  cwd: '/secret/local/path', preview: 'private text', access: 'sensitive', ownerId: 'local-owner' };

async function setup(t, extra = {}) {
  const gateway = new RemoteReadGateway({ sessionService: { snapshotSessions: () => [sample] }, ...extra });
  await gateway.start(); t.after(() => gateway.close()); return gateway;
}
async function get(gateway, endpoint, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(gateway.origin + endpoint, { method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end();
  });
}

test('remote listener is opt-in, loopback only, authenticated and returns only reviewed metadata', async t => {
  const gateway = await setup(t);
  assert.match(gateway.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await get(gateway, '/remote/v1/sessions')).status, 401);
  const credential = gateway.issueReadCredential();
  const headers = { Authorization: `Bearer ${credential.token}` };
  const response = await get(gateway, '/remote/v1/sessions', headers);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  // Session count and harness remain sensitive metadata; titles can be prompt
  // previews and identifiers can expose host/native session details.
  assert.deepEqual(response.body, { sessions: [{ status: sample.status, harnessPluginId: sample.harnessPluginId }] });
  for (const sensitive of [sample.title, sample.sessionKey, sample.cwd, sample.preview, sample.ownerId]) assert.equal(JSON.stringify(response.body).includes(sensitive), false);
  for (const route of ['/v1/snapshot', '/v1/commands', '/v1/workspaces', '/remote/v1/transcript']) assert.equal((await get(gateway, route, headers)).status, 404);
  assert.equal((await get(gateway, '/remote/v1/sessions', headers, 'POST')).status, 405);
  assert.equal((await get(gateway, `/remote/v1/sessions?token=${credential.token}`, headers)).status, 400);
  for (const hostile of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-origin' }])
    assert.equal((await get(gateway, '/remote/v1/sessions', { ...headers, ...hostile })).status, 403);
  gateway.revokeCredential(credential.deviceId);
  assert.equal((await get(gateway, '/remote/v1/sessions', headers)).status, 401);
});

test('credentials are separately revocable, bounded, expiring and rate limited', async t => {
  let now = 100;
  const gateway = await setup(t, { now: () => now, proxyHosts: ['host.example.ts.net'] });
  const first = gateway.issueReadCredential(), second = gateway.issueReadCredential();
  const h1 = { Host: 'host.example.ts.net', Authorization: `Bearer ${first.token}` };
  const h2 = { Authorization: `Bearer ${second.token}` };
  assert.equal((await get(gateway, '/remote/v1/sessions', h1)).status, 200);
  gateway.revokeCredential(first.deviceId);
  assert.equal((await get(gateway, '/remote/v1/sessions', h1)).status, 401);
  for (let i = 0; i < 120; i++) assert.equal((await get(gateway, '/remote/v1/sessions', h2)).status, 200);
  assert.equal((await get(gateway, '/remote/v1/sessions', h2)).status, 429);
  now += 60_000;
  assert.equal((await get(gateway, '/remote/v1/sessions', h2)).status, 200);
  now = second.expiresAt;
  assert.equal((await get(gateway, '/remote/v1/sessions', h2)).status, 401);
  assert.throws(() => new RemoteReadGateway({ sessionService: {}, proxyHosts: ['*.example'] }), /Invalid proxy Host/);
});

test('runtime leaves remote gateway off by default and closes the explicit listener with the runtime', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-remote-runtime-'));
  let runtime;
  t.after(async () => { await runtime?.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  runtime = await startLocalRuntime({ dataDir: path.join(temp, 'state') });
  assert.equal(runtime.remoteReadGateway, undefined);
  await runtime.close();
  runtime = await startLocalRuntime({ dataDir: path.join(temp, 'state'), remoteReadGateway: {} });
  const remote = runtime.remoteReadGateway, credential = remote.issueReadCredential();
  assert.deepEqual((await get(remote, '/remote/v1/sessions', { Authorization: `Bearer ${credential.token}` })).body, { sessions: [] });
  await runtime.close();
  await assert.rejects(get(remote, '/remote/v1/sessions'));
  assert.throws(() => remote.issueReadCredential(), /not listening/);
});
