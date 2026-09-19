import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { HttpHarnessProbe } from '../packages/core/dist/index.js';
const policy = { healthPath: '/health', identity: { service: 'fixture' }, versionField: 'version', supportedVersions: ['1.0.0'], schema: { path: '/schema', identity: { protocol: 'fixture-v1' } } };
const json = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
async function server(t, handler) {
  const app = http.createServer(handler); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  return { app, endpoint: `http://127.0.0.1:${app.address().port}` };
}
test('real loopback GET health/schema performs only reviewed reads and returns no control grant or body secrets', async t => {
  const seen = [];
  const { endpoint } = await server(t, (req, res) => { seen.push([req.method, req.url, req.headers.authorization, req.headers.cookie]); json(res, req.url === '/health' ? { service: 'fixture', version: '1.0.0', token: 'secret' } : { protocol: 'fixture-v1' }); });
  const result = await new HttpHarnessProbe(policy).probe(endpoint);
  assert.equal(result.failure, null); assert.equal(result.assessment.reason, 'compatible'); assert.equal(result.assessment.controllable, false);
  assert.equal(result.assessment.enrollment, 'unregistered'); assert.equal(result.version, '1.0.0'); assert.ok(!JSON.stringify(result).includes('secret'));
  assert.deepEqual(seen, [['GET', '/health', undefined, undefined], ['GET', '/schema', undefined, undefined]]);
});
test('401 is needs_auth, 403 is needs_permission; neither guesses identity nor follows login', async t => {
  let status = 401; let calls = 0;
  const { endpoint } = await server(t, (req, res) => { calls++; res.writeHead(status, { Location: 'https://example.invalid/login' }); res.end('secret'); });
  const probe = new HttpHarnessProbe(policy);
  const auth = await probe.probe(endpoint); assert.equal(auth.assessment.reason, 'needs_auth'); assert.equal(auth.assessment.compatibility, 'unknown');
  status = 403; assert.equal((await probe.probe(endpoint)).assessment.reason, 'needs_permission'); assert.equal(calls, 2);
});
test('unrelated service, version and schema reject before compatibility', async t => {
  let mode = 'wrong'; let schemas = 0;
  const { endpoint } = await server(t, (req, res) => {
    if (req.url === '/schema') { schemas++; return json(res, { protocol: 'wrong' }); }
    json(res, { service: mode === 'wrong' ? 'other' : 'fixture', version: mode === 'version' ? '9.0.0' : '1.0.0' });
  });
  const probe = new HttpHarnessProbe(policy);
  assert.equal((await probe.probe(endpoint)).failure, 'wrong_service'); assert.equal(schemas, 0);
  mode = 'version'; assert.equal((await probe.probe(endpoint)).failure, 'unsupported_version'); assert.equal(schemas, 0);
  mode = 'schema'; assert.equal((await probe.probe(endpoint)).failure, 'wrong_service'); assert.equal(schemas, 1);
});
test('redirects are never followed and invalid origins cause zero requests', async t => {
  let calls = 0;
  const { endpoint } = await server(t, (req, res) => { calls++; res.writeHead(302, { Location: '/next' }); res.end(); });
  const probe = new HttpHarnessProbe(policy);
  assert.equal((await probe.probe(endpoint)).failure, 'redirect'); assert.equal(calls, 1);
  for (const bad of ['http://localhost:1234', 'http://2130706433:1234', 'http://127.1:1234', 'http://192.168.1.2', endpoint + '/command', endpoint + '?secret=x', endpoint.replace('://', '://u:p@')]) assert.equal((await probe.probe(bad)).failure, 'invalid_endpoint');
  assert.equal(calls, 1); assert.throws(() => new HttpHarnessProbe({ ...policy, healthPath: '//evil' }));
});
test('malformed, compressed, oversized body/header and truncated replies are bounded failures', async t => {
  let mode = 'malformed';
  const { endpoint } = await server(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'headers') res.setHeader('X-Huge', 'x'.repeat(9000));
    if (mode === 'compressed') res.setHeader('Content-Encoding', 'gzip');
    if (mode === 'large') { res.write('x'.repeat(64000)); return res.end('x'.repeat(64000)); }
    if (mode === 'truncated') { res.setHeader('Content-Length', 1000); res.flushHeaders(); res.write('{'); return setTimeout(() => res.destroy(), 10); }
    res.end('bad json');
  });
  const probe = new HttpHarnessProbe(policy);
  for (const [m, expected] of [['malformed', 'invalid_response'], ['compressed', 'invalid_response'], ['large', 'response_limit'], ['headers', 'response_limit'], ['truncated', 'transport_failed']]) { mode = m; assert.equal((await probe.probe(endpoint)).failure, expected); }
});
test('refused explicit endpoint distinguishes installed-but-not-running without server startup', async t => {
  const { app, endpoint } = await server(t, () => {}); await new Promise(r => app.close(r));
  const result = await new HttpHarnessProbe(policy).probe(endpoint, { installed: true });
  assert.equal(result.failure, 'not_running'); assert.equal(result.assessment.reason, 'not_running');
});
test('deadline, pre-cancel and refresh cancel sockets and cannot publish late results', async t => {
  let mode = 'hang', calls = 0;
  const { endpoint } = await server(t, (req, res) => { calls++; if (mode === 'hang') return; json(res, req.url === '/health' ? { service: 'fixture', version: '1.0.0' } : { protocol: 'fixture-v1' }); });
  const probe = new HttpHarnessProbe(policy);
  assert.equal((await probe.probe(endpoint, { timeoutMs: 40 })).failure, 'timeout');
  const pre = AbortSignal.abort(); const before = calls; assert.equal((await probe.probe(endpoint, { signal: pre })).failure, 'cancelled'); assert.equal(calls, before);
  const first = probe.probe(endpoint); await new Promise(r => setTimeout(r, 15)); mode = 'good';
  const second = await probe.probe(endpoint); assert.equal((await first).failure, 'cancelled'); assert.equal(second.failure, null); assert.equal(probe.snapshot().generation, second.generation);
});
test('global probe limit rejects overflow without opening additional connections', async t => {
  let calls = 0; const { endpoint } = await server(t, () => { calls++; });
  const probes = Array.from({ length: 5 }, () => new HttpHarnessProbe(policy));
  const pending = probes.slice(0, 4).map(p => p.probe(endpoint));
  assert.equal((await probes[4].probe(endpoint)).failure, 'busy');
  for (const p of probes) p.cancel(); await Promise.all(pending); assert.ok(calls <= 4);
});
