// This experimental transport permits only explicit Tailscale HTTPS origins.
// A public CA validates the server certificate using the platform TLS stack.
export class RemoteAccessError extends Error {
  constructor(kind) { super(kind); this.name = 'RemoteAccessError'; this.kind = kind; }
}

export function validateOrigin(input) {
  if (typeof input !== 'string' || input !== input.trim()) throw new Error('Enter the exact HTTPS address.');
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid HTTPS address.'); }
  const host = url.hostname;
  const labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port ||
      !host.endsWith('.ts.net') || labels.length < 4 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('Use the exact HTTPS Tailscale address, with no path or port.');
  }
  return url.origin;
}

export function validateToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Enter the 43-character gateway credential.');
  return value;
}

async function readBoundedJson(response) {
  const maxBytes = 1024 * 1024;
  const length = response.headers.get('content-length');
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) throw new RemoteAccessError('invalid_response');
  if (!response.body || typeof response.body.getReader !== 'function') throw new RemoteAccessError('invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (let count = 0; ; count++) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count >= 8192 || !(value instanceof Uint8Array) || size + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RemoteAccessError('invalid_response');
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // This endpoint contains status and plugin IDs only; both are ASCII in the
  // gateway contract. Avoid relying on a platform-specific TextDecoder global.
  let text = '';
  for (let start = 0; start < bytes.length; start += 4096) {
    const part = bytes.subarray(start, start + 4096);
    if (part.some(byte => byte > 0x7f)) throw new RemoteAccessError('invalid_response');
    text += String.fromCharCode(...part);
  }
  try { return JSON.parse(text); }
  catch { throw new RemoteAccessError('invalid_response'); }
}

export async function listSessions(origin, token, transport, signal) {
  const base = validateOrigin(origin);
  const credential = validateToken(token);
  // Own the transport signal as well as respecting lifecycle cancellation, so
  // rejecting a response also terminates the native request and its body.
  const request = new AbortController();
  const abortRequest = () => request.abort();
  if (signal?.aborted) abortRequest();
  else signal?.addEventListener('abort', abortRequest, { once: true });
  let response;
  try {
    if (request.signal.aborted) throw new Error('Request aborted');
    // expo/fetch implements redirect:error in its native iOS and Android transports.
    // Never forward a bearer credential to a redirect destination.
    response = await transport(`${base}/remote/v1/sessions`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: request.signal,
    });
    if (request.signal.aborted) throw new Error('Request aborted');
    if (!response.ok) throw new RemoteAccessError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'unavailable');
    const contentType = response.headers.get('content-type') || '';
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) throw new RemoteAccessError('invalid_response');
    const result = await readBoundedJson(response);
    if (request.signal.aborted) throw new Error('Request aborted');
    if (!result || typeof result !== 'object' || !Array.isArray(result.sessions) || result.sessions.length > 256 || result.sessions.some(item =>
      !item || typeof item !== 'object' || ['status', 'harnessPluginId'].some(key => typeof item[key] !== 'string' || item[key].length > 2048))) throw new RemoteAccessError('invalid_response');
    return result.sessions.map(({ status, harnessPluginId }) => ({ status, harnessPluginId }));
  } catch (error) {
    request.abort();
    // Even non-Expo transports can expose an independently cancellable stream.
    try {
      const body = response?.body;
      if (body && !body.locked) void Promise.resolve(body.cancel()).catch(() => {});
    } catch { /* Cancellation must not replace the original failure. */ }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortRequest);
  }
}
