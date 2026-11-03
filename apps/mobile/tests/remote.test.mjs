import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions, RemoteAccessError, validateOrigin, validateToken } from '../remote.mjs';

const credential = 'a'.repeat(43);
const valid = 'https://pc.example.ts.net';
const jsonResponse = (body, status = 200, contentType = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });

test('only a complete Tailscale HTTPS origin without credentials, path or port is allowed', () => {
  assert.equal(validateOrigin(valid + '/'), valid);
  for (const value of ['http://pc.example.ts.net', 'https://evil.example', 'https://ts.net', 'https://pc.ts.net', 'https://user:pass@pc.example.ts.net', 'https://pc.example.ts.net/a', 'https://pc.example.ts.net?x=1', 'https://pc.example.ts.net#x', 'https://pc.example.ts.net:8443', ' https://pc.example.ts.net', 'https://pc.example.ts.net.evil.com', 'https://-pc.example.ts.net']) {
    assert.throws(() => validateOrigin(value), undefined, value);
  }
});

test('oversized responses are rejected without accepting a partial session list', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(listSessions(valid, credential, async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })), e => e instanceof RemoteAccessError && e.kind === 'invalid_response');
  assert.equal(cancelled, true);
});

test('the read-only ASCII contract fails closed on unexpected non-ASCII bytes', async () => {
  await assert.rejects(listSessions(valid, credential, async () => new Response('{"sessions":[],"extra":"한"}', { headers: { 'Content-Type': 'application/json' } })), e => e instanceof RemoteAccessError && e.kind === 'invalid_response');
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
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({}, 401)), e => e instanceof RemoteAccessError && e.kind === 'unauthorized');
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({ sessions: [{ title: 'bad' }] })), e => e instanceof RemoteAccessError && e.kind === 'invalid_response');
  await assert.rejects(listSessions(valid, credential, async () => jsonResponse({}, 200, 'text/html')), e => e instanceof RemoteAccessError && e.kind === 'invalid_response');
  await assert.rejects(listSessions('http://pc.example.ts.net', credential, async () => { throw new Error('must not reach transport'); }), /HTTPS/);
});

test('rejecting an HTTP error, non-JSON response or excessive declared length cancels native request and body', async () => {
  for (const variant of ['http', 'mime', 'length']) {
    let cancelled = false;
    let requestSignal;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const response = new Response(body, {
      status: variant === 'http' ? 401 : 200,
      headers: {
        'Content-Type': variant === 'mime' ? 'text/html' : 'application/json',
        ...(variant === 'length' ? { 'Content-Length': '1048577' } : {}),
      },
    });
    await assert.rejects(listSessions(valid, credential, async (_url, init) => { requestSignal = init.signal; return response; }), RemoteAccessError);
    assert.equal(requestSignal.aborted, true, variant);
    assert.equal(cancelled, true, variant);
  }
});

test('background cancellation propagates to the native transport signal', async () => {
  const lifecycle = new AbortController();
  let requestSignal;
  const pending = listSessions(valid, credential, (_url, init) => {
    requestSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, lifecycle.signal);
  lifecycle.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(requestSignal.aborted, true);
});

test('an already cancelled request never transmits a credential', async () => {
  const lifecycle = new AbortController();
  lifecycle.abort();
  let called = false;
  await assert.rejects(listSessions(valid, credential, async () => { called = true; }, lifecycle.signal), /aborted/);
  assert.equal(called, false);
});
