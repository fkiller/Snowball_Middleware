import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectServeStatus } from '../apps/desktop/tailscale-serve-status.mjs';

const options = { listenPort: 443, backendPort: 24123 };
const raw = () => ({ TCP: { '443': { TCPForward: '127.0.0.1:24123' } } });
const result = snapshot => ({ snapshot, connection: 'not_tested', identity: 'not_verified', backendOwnership: 'not_verified' });

test('recognizes an exact raw TCP snapshot in background or foreground only', () => {
  assert.deepEqual(inspectServeStatus(raw(), options), result('matched'));
  assert.deepEqual(inspectServeStatus({ Foreground: { session: raw() } }, options), result('matched'));
  assert.deepEqual(inspectServeStatus({ TCP: { '443': { TCPForward: '127.0.0.1:24123', HTTP: false, HTTPS: false, TerminateTLS: '', ProxyProtocol: 0 } } }, options), result('matched'));
  assert.deepEqual(inspectServeStatus({}, options), result('unconfigured'));
  assert.deepEqual(inspectServeStatus({ TCP: { '8443': { TCPForward: '127.0.0.1:9999' } } }, options), result('unconfigured'));
});

test('rejects a different destination, TLS termination, HTTP mode, or proxy protocol', () => {
  for (const handler of [
    { TCPForward: '127.0.0.1:24124' }, { TCPForward: 'localhost:24123' },
    { TCPForward: '127.0.0.1:24123', TerminateTLS: 'pc.tail.ts.net' },
    { TCPForward: '127.0.0.1:24123', HTTPS: true },
    { TCPForward: '127.0.0.1:24123', HTTP: true },
    { TCPForward: '127.0.0.1:24123', ProxyProtocol: 2 },
  ]) assert.deepEqual(inspectServeStatus({ TCP: { '443': handler } }, options), result('conflict'));
  assert.deepEqual(inspectServeStatus(raw(), { listenPort: 443, backendPort: 24124 }), result('conflict'));
});

test('foreground, web and Funnel listeners cannot be overlooked', () => {
  const web = { Web: { 'pc.tail.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:24123' } } } } };
  assert.deepEqual(inspectServeStatus(web, options), result('conflict'));
  assert.deepEqual(inspectServeStatus({ ...raw(), Foreground: { other: web } }, options), result('conflict'));
  assert.deepEqual(inspectServeStatus({ ...raw(), Foreground: { other: raw() } }, options), result('conflict'));
  assert.deepEqual(inspectServeStatus({ ...raw(), AllowFunnel: { 'pc.tail.ts.net:443': true } }, options), result('public'));
  assert.deepEqual(inspectServeStatus({ ...raw(), Foreground: { other: { AllowFunnel: { 'other.tail.ts.net:443': true } } } }, options), result('public'));
  assert.deepEqual(inspectServeStatus({ ...raw(), AllowFunnel: { 'pc.tail.ts.net:443': false } }, options), result('matched'));
});

test('unknown, malformed and unreviewed configuration never implies a free port', () => {
  for (const value of [
    null, [], 'No serve config', { future: {} }, { TCP: [] },
    { TCP: { '443': { TCPForward: '127.0.0.1:24123', FutureOption: true } } },
    { TCP: { '0443': { TCPForward: '127.0.0.1:24123' } } },
    { Foreground: { session: { Foreground: {} } } },
    { AllowFunnel: { 'pc.tail.ts.net:443': 'true' } },
    { Web: { 'bad/authority': { Handlers: {} } } },
    { Services: { 'svc:unknown': {} } },
  ]) assert.deepEqual(inspectServeStatus(value, options), result('unknown'));
  assert.deepEqual(inspectServeStatus(raw(), { listenPort: 0, backendPort: 24123 }), result('unknown'));
  assert.deepEqual(inspectServeStatus(raw(), { listenPort: 443, backendPort: '24123' }), result('unknown'));
});
