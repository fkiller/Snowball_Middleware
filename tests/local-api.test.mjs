import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { CommandJournal, formatSessionKey } from '../packages/core/dist/index.js';
import { LocalApi, WorkspaceFiles, loadSupervisorAssets } from '../packages/api/dist/index.js';
import { LocalClient } from '../packages/client-sdk/dist/index.js';

const hostId = `host_${'a'.repeat(32)}`;
const sessionKey = formatSessionKey({ hostId, harness: { pluginId: 'snowball.test', instanceId: 'local' }, nativeSessionId: 's1' });
const ownerId = 'owner-1';
const workspaceId = `ws_${'c'.repeat(16)}`;
async function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-api-'));
  const root = path.join(directory, 'workspace'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'hello.txt'), 'local text');
  fs.writeFileSync(path.join(directory, 'outside.txt'), 'must not read');
  fs.writeFileSync(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, 'large'), Buffer.alloc(256 * 1024 + 1, 65));
  const journal = new CommandJournal({ hostId, directory: path.join(directory, 'state') }); journal.registerSession(sessionKey, ownerId);
  const workspaces = await WorkspaceFiles.create([{ workspaceId, root }]);
  const api = new LocalApi({ journal, workspaces, ...options }); await api.start();
  t.after(async () => { await api.close(); journal.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, root, journal, api, workspaces };
}
async function request(api, route, { method = 'GET', body, headers = {}, auth } = {}) {
  const response = await fetch(api.origin + route, { method, headers: { Origin: api.origin, ...(auth ? { Authorization: `Bearer ${auth.token}`, 'X-Snowball-CSRF': auth.csrfToken } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function login(api) { const grant = api.issueBootstrap(); const res = await request(api, '/v1/bootstrap', { method: 'POST', body: { code: grant.code } }); assert.equal(res.status, 201); return res.body; }
const input = (journal, commandId, extra = {}) => ({ commandId, sessionKey, ownerId, expectedRevision: journal.session(sessionKey).revision, operation: 'sessions.send', payload: { text: 'private-payload' }, ...extra });
const matches = (status, code) => error => error.status === status && (!code || error.code === code);

test('workspace candidate association uses exact registered root, not a matching display name', async t => {
  const { api, root, workspaces } = await setup(t);
  workspaces.listCandidates = () => [
    { candidateId: 'same', harness: { pluginId: 'snowball.codex', instanceId: 'local' }, nativeProjectId: 'one', root, displayName: 'workspace' },
    { candidateId: 'different', harness: { pluginId: 'snowball.codex', instanceId: 'local' }, nativeProjectId: 'two', root: path.join(path.dirname(root), 'other'), displayName: 'workspace' },
  ];
  const auth = await login(api);
  const snapshot = (await request(api, '/v1/snapshot', { auth })).body;
  assert.equal(snapshot.workspaceCandidates[0].workspaceId, workspaceId);
  assert.equal(snapshot.workspaceCandidates[1].workspaceId, undefined);
});

test('SDK default fetch retains the browser global receiver', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response(JSON.stringify({ cursor: 'test' })));
  };
  try { assert.equal((await new LocalClient('http://127.0.0.1:12345').snapshot()).cursor, 'test'); }
  finally { globalThis.fetch = original; }
});

test('loopback listener denies foreign Host/Origin, missing authentication and query credentials', async t => {
  const { api } = await setup(t); assert.equal(api.server.address().address, '127.0.0.1');
  assert.equal((await request(api, '/v1/snapshot')).status, 401);
  const auth = await login(api);
  for (const headers of [{ Host: 'localhost' }, { Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    // Native HTTP deliberately preserves hostile headers that fetch may normalize away.
    const status = await new Promise((resolve, reject) => {
      http.get(api.origin + '/v1/snapshot', { headers: { Origin: api.origin, Authorization: `Bearer ${auth.token}`, ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  const valid = await request(api, '/v1/snapshot', { auth }); assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('access-control-allow-origin'), null); assert.equal(valid.headers.get('cache-control'), 'no-store');
  const query = await request(api, `/v1/snapshot?token=${auth.token}`, { auth });
  assert.equal(query.status, 400); assert.equal(JSON.stringify(query.body).includes(auth.token), false);
  assert.equal((await request(api, '/v1/snapshot', { auth, method: 'OPTIONS' })).status, 405);
});

test('one-use bootstrap, expiry, CSRF and logout revoke control without leaking credentials', async t => {
  let now = 100; const { api, journal } = await setup(t, { now: () => now, sessionTtlMs: 1000 });
  const grant = api.issueBootstrap();
  const auth = (await request(api, '/v1/bootstrap', { method: 'POST', body: { code: grant.code } })).body;
  assert.equal((await request(api, '/v1/bootstrap', { method: 'POST', body: { code: grant.code } })).status, 401);
  assert.equal((await request(api, '/v1/commands', { auth, method: 'POST', body: input(journal, 'c1'), headers: { 'X-Snowball-CSRF': 'wrong' } })).status, 403);
  const noOrigin = await fetch(api.origin + '/v1/commands', { method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'X-Snowball-CSRF': auth.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(input(journal, 'c1')) });
  assert.equal(noOrigin.status, 403); await noOrigin.arrayBuffer();
  assert.equal(journal.listCommands().length, 0);
  assert.equal((await request(api, '/v1/logout', { auth, method: 'POST' })).status, 200);
  assert.equal((await request(api, '/v1/snapshot', { auth })).status, 401);
  const next = await login(api); now = 1100;
  assert.equal((await request(api, '/v1/snapshot', { auth: next })).status, 401);
  const expiring = api.issueBootstrap(); now += 60_000;
  const denied = await request(api, '/v1/bootstrap', { method: 'POST', body: { code: expiring.code } });
  assert.equal(denied.status, 401); assert.deepEqual(denied.body, { error: 'unauthorized' });
});

test('SDK admits durable commands with authenticated actor, exact retries and stale conflicts; never dispatches', async t => {
  const { api, journal } = await setup(t); const client = new LocalClient(api.origin);
  const { controllerId } = await client.bootstrap(api.issueBootstrap().code);
  const command = input(journal, 'c1'); const accepted = await client.submit(command);
  assert.equal(accepted.command.status, 'queued'); assert.equal(accepted.command.input.actorId, controllerId);
  assert.equal((await client.submit(command)).replayed, true);
  await assert.rejects(client.submit({ ...command, payload: {} }), matches(409, 'idempotency_conflict'));
  await assert.rejects(client.submit({ ...command, commandId: 'c2' }), matches(409, 'stale_revision'));
  await assert.rejects(client.submit({ ...input(journal, 'c3'), actorId: controllerId }), matches(400, 'actor_is_authenticated'));
  const other = new LocalClient(api.origin); await other.bootstrap(api.issueBootstrap().code);
  await assert.rejects(other.submit(command), matches(403, 'command_owner_denied'));
  const snapshot = await client.snapshot(); assert.equal(snapshot.commands.length, 1);
  assert.equal(JSON.stringify(snapshot).includes('private-payload'), false);
  assert.equal((await client.command('c1')).input.payload.text, 'private-payload');
  assert.equal(journal.command('c1').status, 'queued');
  await client.logout(); await assert.rejects(client.snapshot(), matches(401));
});

test('body completion rechecks revocation before admitting a command', async t => {
  const { api, journal } = await setup(t); const auth = await login(api);
  const body = JSON.stringify(input(journal, 'c1'));
  const req = http.request(api.origin + '/v1/commands', { method: 'POST', headers: { Origin: api.origin, Authorization: `Bearer ${auth.token}`, 'X-Snowball-CSRF': auth.csrfToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  const response = once(req, 'response'); req.write(body.slice(0, -1));
  await new Promise(r => setTimeout(r, 20)); api.revokeController(auth.controllerId); req.end(body.slice(-1));
  const [res] = await response; res.resume(); await once(res, 'end');
  assert.equal(res.statusCode, 401); assert.equal(journal.listCommands().length, 0);
});

test('SSE replays retained invalidations; gaps and new epoch demand a consistent snapshot', async t => {
  const { api, journal } = await setup(t, { eventCapacity: 2 }); const client = new LocalClient(api.origin);
  await client.bootstrap(api.issueBootstrap().code); const before = await client.snapshot();
  await client.submit(input(journal, 'c1'));
  let stream = client.events(before.cursor, AbortSignal.timeout(2000));
  const replay = await stream.next(); assert.equal(replay.value.type, 'changed');
  assert.equal(replay.value.cursor, (await client.snapshot()).cursor); await stream.return();
  await client.submit(input(journal, 'c2')); await client.submit(input(journal, 'c3'));
  for (const cursor of [before.cursor, `${'0'.repeat(32)}:0`, `${api.cursor.split(':')[0]}:99999`]) {
    stream = client.events(cursor, AbortSignal.timeout(2000)); const result = await stream.next();
    assert.equal(result.value.type, 'resync'); await stream.return();
    const current = await client.snapshot(); assert.equal(current.commands.length, 3); assert.equal(current.cursor, api.cursor);
  }
  const snapshot = await client.snapshot(); stream = client.events(snapshot.cursor, AbortSignal.timeout(2000));
  const next = stream.next(); await new Promise(r => setTimeout(r, 30)); await client.submit(input(journal, 'c4'));
  assert.equal((await next).value.type, 'changed'); await stream.return();
});

test('stream sessions are revoked and connection limits reject excess observers', async t => {
  const { api } = await setup(t); const auth = await login(api);
  const headers = { Origin: api.origin, Authorization: `Bearer ${auth.token}` };
  const first = await fetch(api.origin + '/v1/events', { headers }); const second = await fetch(api.origin + '/v1/events', { headers });
  const excess = await fetch(api.origin + '/v1/events', { headers }); assert.equal(excess.status, 429); await excess.arrayBuffer();
  api.revokeController(auth.controllerId);
  assert.match(await first.text(), /event: resync/); assert.match(await second.text(), /event: resync/);
});

test('registered workspace reads reject outside roots, traversal, ADS, symlinks, binary and oversized files', async t => {
  const { api, root, directory } = await setup(t); const client = new LocalClient(api.origin); await client.bootstrap(api.issueBootstrap().code);
  assert.deepEqual(await client.readFile(workspaceId, 'hello.txt'), { text: 'local text' });
  for (const relative of ['../outside.txt', 'sub/../../outside.txt', '/outside.txt', 'C:/outside.txt', 'hello.txt:secret', '\\outside.txt', 'binary', 'large']) {
    await assert.rejects(client.readFile(workspaceId, relative), matches(404, 'file_unavailable'));
  }
  await assert.rejects(client.readFile(`ws_${'d'.repeat(16)}`, 'hello.txt'), matches(404));
  // Windows directory junctions can be created without Developer Mode/admin privileges.
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(client.readFile(workspaceId, 'link/secret.txt'), matches(404));
});

test('SDK credentials only use headers/body, event fetch has no URL token and mutation network failures are not retried', async () => {
  const calls = []; let failNext = false;
  const client = new LocalClient('http://127.0.0.1:12345', async (url, options) => {
    calls.push({ url, options });
    if (failNext) throw new Error('lost connection');
    return new Response(JSON.stringify({ token: 'token-secret', csrfToken: 'csrf-secret', controllerId: 'controller', expiresAt: 99999 }), { status: 201 });
  });
  await client.bootstrap('bootstrap-secret'); failNext = true;
  await assert.rejects(client.submit({ commandId: 'c1' }), /lost connection/); assert.equal(calls.length, 2);
  assert.ok(calls.every(c => !c.url.includes('secret')));
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token-secret');
  assert.equal(calls[1].options.headers['X-Snowball-CSRF'], 'csrf-secret');
  assert.equal(calls[1].options.redirect, 'error');
  assert.throws(() => new LocalClient('http://localhost:12345'));
  assert.throws(() => new LocalClient('http://127.0.0.1:12345/path'));
});

test('malformed, compressed and oversized bodies cannot admit work', async t => {
  const { api, journal } = await setup(t); const auth = await login(api);
  const headers = { Origin: api.origin, Authorization: `Bearer ${auth.token}`, 'X-Snowball-CSRF': auth.csrfToken, 'Content-Type': 'application/json' };
  for (const [body, extra, expected] of [['{', {}, 400], ['[]', {}, 400], ['{}', { 'Content-Encoding': 'gzip' }, 415]]) {
    const response = await fetch(api.origin + '/v1/commands', { method: 'POST', headers: { ...headers, ...extra }, body });
    assert.equal(response.status, expected); await response.arrayBuffer();
  }
  try {
    const response = await fetch(api.origin + '/v1/commands', { method: 'POST', headers, body: JSON.stringify(input(journal, 'oversize', { payload: 'x'.repeat(129 * 1024) })) });
    assert.equal(response.status, 413); await response.arrayBuffer();
  } catch (error) { assert.equal(error instanceof TypeError, true, 'An oversized socket may be closed before a response'); }
  assert.equal(journal.listCommands().length, 0);
});

test('published OpenAPI routes and SDK operations describe the implemented v1 surface', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../packages/api/openapi.v1.json', import.meta.url)));
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(Object.keys(spec.paths).length, 20);
  assert.equal(spec.paths['/v1/sessions/create-status'].post.operationId, 'readHarnessSessionCreateReceipt');
  assert.ok(spec.paths['/v1/sessions/create'].post.requestBody.content['application/json'].schema.required.includes('requestId'));
  assert.equal(spec.components.schemas.SessionSummary.properties.workspaceId.pattern, '^ws_[0-9a-f]{16}$');
  assert.equal(spec.paths['/v1/harness/scan'].post.operationId, 'scanHarness');
  assert.equal(spec.paths['/v1/harness/connect-codex'].post.operationId, 'connectCodex');
  assert.equal(spec.paths['/v1/harness/disconnect-codex'].post.operationId, 'disconnectCodex');
  assert.equal(spec.paths['/v1/harness/reset-codex'].post.operationId, 'resetCodex');
  assert.equal(spec.paths['/v1/workspaces/{workspaceId}/recheck'].post.operationId, 'recheckWorkspace');
  assert.deepEqual(spec.paths['/v1/bootstrap'].post.security, []);
  assert.ok(spec.paths['/v1/commands'].post.responses['202']);
  assert.equal(spec.components.schemas.CommandInput.properties.actorId, undefined);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) assert.ok(value.$ref.split('/').slice(1).reduce((node, key) => node?.[key], spec), value.$ref);
    for (const child of Object.values(value)) visit(child);
  }; visit(spec);
});

test('workspace onboarding exposes repair state and rechecks only existing grants with CSRF', async t => {
  const { api, root, directory } = await setup(t);
  const client = new LocalClient(api.origin); await client.bootstrap(api.issueBootstrap().code);
  const initial = await client.snapshot();
  assert.equal(initial.workspaceDetails[0].status, 'ready');
  assert.equal(initial.workspaceDetails[0].workspaceId, workspaceId);
  assert.equal(initial.workspaceDetails[0].root, undefined);
  fs.renameSync(root, path.join(directory, 'moved'));
  assert.equal((await client.snapshot()).workspaceDetails[0].status, 'ready'); // snapshot does not scan
  assert.equal((await client.recheckWorkspace(workspaceId)).status, 'missing');
  const after = await client.snapshot(); assert.notEqual(after.cursor, initial.cursor);
  assert.equal(after.workspaceDetails[0].status, 'missing');
  const auth = await login(api);
  const route = `/v1/workspaces/${workspaceId}/recheck`;
  assert.equal((await request(api, route, { method: 'POST', body: {} })).status, 401);
  assert.equal((await request(api, route, { method: 'POST', body: {}, auth, headers: { 'X-Snowball-CSRF': 'wrong' } })).status, 403);
  assert.equal((await request(api, route, { method: 'POST', body: { root: directory }, auth })).status, 400);
  await assert.rejects(client.recheckWorkspace(`ws_${'e'.repeat(16)}`), matches(404, 'workspace_unavailable'));
  fs.renameSync(path.join(directory, 'moved'), root);
  assert.equal((await client.recheckWorkspace(workspaceId)).status, 'ready');
  const stable = (await client.snapshot()).cursor;
  await client.recheckWorkspace(workspaceId);
  assert.equal((await client.snapshot()).cursor, stable); // no notification storm for unchanged status
});

test('optional Supervisor serves only reviewed same-origin assets; data still requires authentication', async t => {
  const supervisor = await loadSupervisorAssets(process.cwd());
  const { api } = await setup(t, { supervisor });
  const page = await fetch(api.origin);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /id="content"/);
  const script = await fetch(api.origin + '/supervisor/app.js');
  assert.equal(script.status, 200); assert.match(await script.text(), /LocalClient/);
  assert.equal((await request(api, '/v1/snapshot')).status, 401);
  assert.equal((await request(api, '/supervisor/unknown.js')).status, 401);
  assert.equal((await request(api, '/supervisor/app.js?token=bad')).status, 400);
  assert.equal((await request(api, '/', { headers: { Origin: 'https://example.test' } })).status, 403);
});

test('workspace recheck has a deadline, retains hung-work slot and rechecks session revocation', async t => {
  let release;
  const workspaces = { list: () => [], describe: () => [], subscribe: () => () => {},
    recheck: () => new Promise(resolve => { release = () => resolve({ workspaceId, projectId: `prj_${'f'.repeat(16)}`, displayName: 'Test', status: 'empty' }); }) };
  const { api } = await setup(t, { workspaces });
  const auth = await login(api); const route = `/v1/workspaces/${workspaceId}/recheck`;
  const pending = request(api, route, { method: 'POST', body: {}, auth });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request(api, route, { method: 'POST', body: {}, auth })).status, 429);
  assert.equal((await pending).status, 504);
  assert.equal((await request(api, route, { method: 'POST', body: {}, auth })).status, 429);
  release(); await new Promise(resolve => setImmediate(resolve)); release = undefined;
  const next = request(api, route, { method: 'POST', body: {}, auth });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  api.revokeController(auth.controllerId); release();
  assert.equal((await next).status, 401);
});

test('onboarding shows reviewed harness candidates; snapshot never scans and claims no control', async t => {
  const empty = { generation: 0, status: 'complete', stale: false, candidates: [], issues: [] };
  const candidate = { id: 'c1', providerId: 'test.codex', kind: 'file', locator: 'C:\\tools\\codex.exe', sources: ['known'], aliases: [], stamp: null, version: null, connection: 'unprobed', controllable: false };
  let describes = 0; let rescans = 0; let current = empty;
  const surveyor = { describe: () => { describes++; return current; }, rescan: async () => { rescans++; current = { ...empty, generation: 1, candidates: [candidate] }; return current; } };
  const { api } = await setup(t, { harness: surveyor });
  const client = new LocalClient(api.origin); await client.bootstrap(api.issueBootstrap().code);
  assert.deepEqual((await client.snapshot()).harness.candidates, []);
  assert.equal(describes, 1); assert.equal(rescans, 0);
  assert.equal((await client.scanHarness()).candidates.length, 1);
  assert.equal(rescans, 1);
  const after = await client.snapshot();
  assert.equal(after.harness.candidates.length, 1);
  assert.equal(after.harness.candidates[0].controllable, false);
  assert.equal(after.harness.candidates[0].version, null);
  assert.equal(after.harness.candidates[0].connection, 'unprobed');
  const auth = await login(api); const route = '/v1/harness/scan';
  assert.equal((await request(api, route, { method: 'POST', body: {} })).status, 401);
  assert.equal((await request(api, route, { method: 'POST', body: {}, auth, headers: { 'X-Snowball-CSRF': 'wrong' } })).status, 403);
  assert.equal((await request(api, route, { method: 'POST', body: { provider: 'x' }, auth })).status, 400);
});

test('absent harness surveyor reports null; busy, failed and revoked scans stay safe', async t => {
  const { api } = await setup(t);
  const client = new LocalClient(api.origin); await client.bootstrap(api.issueBootstrap().code);
  assert.equal((await client.snapshot()).harness, null);
  await assert.rejects(client.scanHarness(), matches(404, 'harness_unavailable'));
  const empty = { generation: 0, status: 'complete', stale: false, candidates: [], issues: [] };
  let release; let calls = 0;
  const hung = { describe: () => empty, rescan: () => { calls++; return new Promise(resolve => { release = () => resolve(empty); }); } };
  const second = await setup(t, { harness: hung });
  const auth = await login(second.api); const route = '/v1/harness/scan';
  const pending = request(second.api, route, { method: 'POST', body: {}, auth });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request(second.api, route, { method: 'POST', body: {}, auth })).status, 429);
  release(); assert.equal((await pending).status, 200); assert.equal(calls, 1);
  const failing = await setup(t, { harness: { describe: () => empty, rescan: async () => { throw new Error('surveyor failed'); } } });
  const failingAuth = await login(failing.api);
  assert.equal((await request(failing.api, route, { method: 'POST', body: {}, auth: failingAuth })).status, 503);
});

test('served supervisor assets reference no remote origin; Internet-off keeps local onboarding usable', async () => {
  const supervisor = await loadSupervisorAssets(process.cwd());
  const client = fs.readFileSync(new URL('../packages/client-sdk/dist/index.js', import.meta.url), 'utf8');
  for (const [name, text] of [['index.html', supervisor.html], ['app.js', supervisor.script], ['style.css', supervisor.style], ['client.js', client]]) {
    assert.ok(!text.includes('https://'), name);
    assert.ok(!/http:\/\/(?!127\.0\.0\.1)/.test(text), name);
    assert.ok(!text.includes('wss://'), name);
  }
});
