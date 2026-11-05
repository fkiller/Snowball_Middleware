import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedSessionReader, parseSessionResponse, validateFingerprint } from '../pinned-remote.mjs';

const origin = 'https://pc.tailnet.ts.net', token = 'a'.repeat(43), pin = 'a1'.repeat(32);
const response = JSON.stringify({ sessions: [{ status: 'idle', harnessPluginId: 'snowball.codex' }] });
const options = { development: true, platform: 'ios' };
const native = { developmentTransportAvailable: true, protocolVersion: 1, listSessions: async () => response, cancel: async () => {} };

test('only the iOS Debug native module exposes the development reader', async () => {
  for (const [module, config] of [[null, options], [native, {}], [native, { ...options, development: false }],
    [native, { ...options, platform: 'android' }], [{ ...native, developmentTransportAvailable: false }, options],
    [{ ...native, protocolVersion: 2 }, options]]) {
    const reader = createPinnedSessionReader(module, config);
    assert.equal(reader.available, false);
    await assert.rejects(reader.listSessions(origin, token, pin), { kind: 'gateway_identity_unverified' });
  }
});

test('the native bridge receives only the confirmed exact origin, fingerprint and credential', async () => {
  let calls = 0;
  const reader = createPinnedSessionReader({ ...native, listSessions: async (id, ...args) => {
    calls++;
    assert.match(id, /^[0-9-]{1,64}$/);
    assert.deepEqual(args, [origin, pin, token]);
    return response;
  } }, options);
  assert.deepEqual(await reader.listSessions(origin + '/', token, pin.toUpperCase()), JSON.parse(response).sessions);
  for (const address of [origin + ':443', origin + '/a/..', 'https://PC.tailnet.ts.net', origin + '\\']) {
    await assert.rejects(reader.listSessions(address, token, pin));
  }
  for (const fingerprint of ['', 'a'.repeat(63), pin + ' ', null]) await assert.rejects(reader.listSessions(origin, token, fingerprint));
  assert.equal(calls, 1);
  assert.equal(validateFingerprint(pin.toUpperCase()), pin);
});

test('responses cannot introduce session content, paths, extra fields, unbounded counts or arbitrary identifiers', () => {
  for (const body of [null, {}, [], { sessions: [], secret: 'x' }, { sessions: Array(257).fill({}) },
    { sessions: [{ status: 'idle', harnessPluginId: 'snowball.codex', title: 'private' }] },
    { sessions: [{ status: 'online', harnessPluginId: 'snowball.codex' }] },
    { sessions: [{ status: 'idle', harnessPluginId: '/private/path' }] }]) {
    assert.throws(() => parseSessionResponse(JSON.stringify(body)), { kind: 'invalid_response' });
  }
  assert.throws(() => parseSessionResponse(' '.repeat(65537)), { kind: 'invalid_response' });
  assert.deepEqual(parseSessionResponse('{"sessions":[]}'), []);
});

test('cancellation reaches the native request and suppresses a late result without retrying', async () => {
  const controller = new AbortController();
  let resolve, requestId, cancelledId, count = 0;
  const reader = createPinnedSessionReader({ ...native,
    listSessions: id => { count++; requestId = id; return new Promise(done => { resolve = done; }); },
    cancel: async id => { cancelledId = id; },
  }, options);
  const pending = reader.listSessions(origin, token, pin, controller.signal);
  controller.abort(); resolve(response);
  await assert.rejects(pending, { kind: 'cancelled' });
  assert.equal(cancelledId, requestId);
  await assert.rejects(reader.listSessions(origin, token, pin, controller.signal), { kind: 'cancelled' });
  assert.equal(count, 1);
});

test('native errors expose only bounded error kinds', async () => {
  for (const [error, expected] of [[{ code: 'unauthorized', message: token }, 'unauthorized'],
    [{ code: 'gateway_identity_unverified' }, 'gateway_identity_unverified'],
    [new Error(token), 'connection_failed']]) {
    const reader = createPinnedSessionReader({ ...native, listSessions: async () => { throw error; } }, options);
    await assert.rejects(reader.listSessions(origin, token, pin), { kind: expected, message: expected });
  }
});
