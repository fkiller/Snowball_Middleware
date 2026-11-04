import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions, RemoteAccessError, validateOrigin, validateToken } from '../remote.mjs';

const credential = 'a'.repeat(43);
const valid = 'https://pc.example.ts.net';

test('only a complete Tailscale HTTPS origin without credentials, path or port is allowed', () => {
  assert.equal(validateOrigin(valid + '/'), valid);
  for (const value of ['http://pc.example.ts.net', 'https://evil.example', 'https://ts.net', 'https://pc.ts.net', 'https://user:pass@pc.example.ts.net', 'https://pc.example.ts.net/a', 'https://pc.example.ts.net?x=1', 'https://pc.example.ts.net#x', 'https://pc.example.ts.net:8443', ' https://pc.example.ts.net', 'https://pc.example.ts.net.evil.com', 'https://-pc.example.ts.net']) {
    assert.throws(() => validateOrigin(value));
  }
});

test('credential format is strictly bounded', () => {
  assert.equal(validateToken(credential), credential);
  for (const value of ['', 'bad', 'a'.repeat(42), 'a'.repeat(44), null, ' '.repeat(43)]) assert.throws(() => validateToken(value));
});

test('the transport entry point rejects before any caller can transmit credentials', async () => {
  let called = false;
  const transport = async () => { called = true; throw new Error('must not run'); };
  for (const signal of [undefined, new AbortController().signal]) {
    await assert.rejects(listSessions(valid, credential, transport, signal), error =>
      error instanceof RemoteAccessError && error.kind === 'gateway_identity_unverified');
  }
  assert.equal(called, false);
});
