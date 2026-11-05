import { RemoteAccessError, validateOrigin, validateToken } from './remote.mjs';

export function validateFingerprint(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Enter the exact 64-character SHA-256 certificate fingerprint from the PC.');
  return value.toLowerCase();
}

export function parseSessionResponse(json) {
  try {
    if (typeof json !== 'string' || json.length > 64 * 1024) throw Error();
    const body = JSON.parse(json);
    if (!body || Object.keys(body).join(',') !== 'sessions' || !Array.isArray(body.sessions) || body.sessions.length > 256) throw Error();
    return body.sessions.map(item => {
      if (!item || Object.keys(item).sort().join(',') !== 'harnessPluginId,status' ||
          !['idle', 'busy', 'error', 'unknown'].includes(item.status) || typeof item.harnessPluginId !== 'string' ||
          item.harnessPluginId.length > 128 || (item.harnessPluginId !== 'unknown' && !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(item.harnessPluginId))) throw Error();
      return { status: item.status, harnessPluginId: item.harnessPluginId };
    });
  } catch { throw new RemoteAccessError('invalid_response'); }
}

let sequence = 0;
const errorKinds = new Set(['invalid_input', 'gateway_identity_unverified', 'redirect_denied', 'invalid_response',
  'unauthorized', 'forbidden', 'rate_limited', 'unavailable', 'cancelled', 'timeout', 'host_unresolved', 'host_unreachable', 'connection_failed']);

// Only the bundled iOS Debug module can perform this experiment. No fetch,
// caller-provided TLS flag, Expo Go, Android or Release fallback exists.
export function createPinnedSessionReader(nativeModule, { development = false, platform } = {}) {
  const available = development === true && platform === 'ios' && nativeModule?.developmentTransportAvailable === true &&
    nativeModule?.protocolVersion === 1 && typeof nativeModule.listSessions === 'function' && typeof nativeModule.cancel === 'function';
  return Object.freeze({
    available,
    async listSessions(origin, token, fingerprint, signal) {
      if (!available) throw new RemoteAccessError('gateway_identity_unverified');
      const address = validateOrigin(origin), credential = validateToken(token), pin = validateFingerprint(fingerprint);
      if (signal?.aborted) throw new RemoteAccessError('cancelled');
      const id = `${Date.now()}-${++sequence}`;
      const cancel = () => { try { Promise.resolve(nativeModule.cancel(id)).catch(() => {}); } catch { /* The native timeout remains bounded. */ } };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const json = await nativeModule.listSessions(id, address, pin, credential);
        if (signal?.aborted) throw new RemoteAccessError('cancelled');
        return parseSessionResponse(json);
      } catch (error) {
        throw new RemoteAccessError(error instanceof RemoteAccessError ? error.kind : errorKinds.has(error?.code) ? error.code : 'connection_failed');
      } finally { signal?.removeEventListener('abort', cancel); }
    },
  });
}
