import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions, validateOrigin, validateToken } from '../remote.mjs';

const credential = 'a'.repeat(43);
const valid = 'https://pc.example.ts.net';
const jsonResponse = (body, status = 200, contentType = 'application/json') => ({ ok: status === 200, status, headers: { get: () => contentType }, json: async () => body });

test('only a complete Tailscale HTTPS origin without credentials, path or port is allowed', () => {
  assert.equal(validateOrigin(valid + '/'), valid);
  for (const value of ['http://pc.example.ts.net', 'https://evil.example', 'https://ts.net', 'https://pc.ts.net', 'https://user:pass@pc.example.ts.net', 'https://pc.example.ts.net/a', 'https://pc.example.ts.net?x=1', 'https://pc.example.ts.net#x', 'https://pc.example.ts.net:8443', ' https://pc.example.ts.net', 'https://pc.example.ts.net.evil.com', 'https://-pc.example.ts.net']) {
    assert.throws(() => validateOrigin(value), undefined, value);
  }
});

test('credential is fixed-size and never placed in URL; redirects and cookies are forbidden', async () => {
  assert.throws(() => validateToken('bad'));
  const calls = [];
  const sessions = [{ status: 'active', harnessPluginId: 'snowball.codex', extra: 'discarded' }];
  const actual = await listSessions(valid, credential, async (url, init) => { calls.push({ url, init }); return jsonResponse({ sessions }); });
  assert.equal(calls[0].url, valid + '/remote/v1/sessions');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${credential}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(actual, [{ status: 'active', harnessPluginId: 'snowball.codex' }]);
});

test('authorization failures and malformed session metadata fail closed', async () => {
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({}, 401)), /not authorized/);
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({ sessions: [{ title: 'bad' }] })), /Unexpected/);
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({}, 200, 'text/html')), /Unexpected/);
  await assert.rejects(listSessions('http://pc.example.ts.net', credential, async () => { throw new Error('must not reach transport'); }), /HTTPS/);
});
