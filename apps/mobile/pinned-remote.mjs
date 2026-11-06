import { RemoteAccessError, validateOrigin, validateToken } from './remote.mjs';

export function validateFingerprint(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Enter the exact 64-character SHA-256 certificate fingerprint from the PC.');
  return value.toLowerCase();
}

export function validatePairingCode(value) {
  if (typeof value !== 'string') throw new Error('PC에서 발급한 연결 코드를 스캔하거나 붙여넣어 주세요.');
  const trimmed = value.trim();
  if (!/^SBP1\.[A-Za-z0-9_-]{32,2048}$/.test(trimmed)) {
    throw new Error('올바른 Snowball 연결 코드(SBP1)가 아닙니다. PC의 [휴대폰 연결] 화면에서 QR 코드를 스캔하거나 연결 코드를 다시 복사해 주세요.');
  }
  return trimmed;
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

function mapNativeError(error) {
  return new RemoteAccessError(error instanceof RemoteAccessError ? error.kind : errorKinds.has(error?.code) ? error.code : 'connection_failed');
}

// Only the bundled iOS Debug module can perform this experiment. No fetch,
// caller-provided TLS flag, Expo Go, Android or Release fallback exists.
export function createPinnedSessionReader(nativeModule, { development = false, platform } = {}) {
  const available = development === true && platform === 'ios' && nativeModule?.developmentTransportAvailable === true &&
    nativeModule?.protocolVersion === 1 && typeof nativeModule.listSessions === 'function' && typeof nativeModule.cancel === 'function';
  const initialPairingCode = available && typeof nativeModule?.initialPairingCode === 'string' ? nativeModule.initialPairingCode : '';
  return Object.freeze({
    available,
    initialPairingCode,
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
        throw mapNativeError(error);
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    async requestPairing(pairingCode, deviceLabel = '', signal) {
      if (!available || typeof nativeModule.requestPairing !== 'function') throw new RemoteAccessError('gateway_identity_unverified');
      const code = validatePairingCode(pairingCode);
      if (signal?.aborted) throw new RemoteAccessError('cancelled');
      const id = `${Date.now()}-${++sequence}`;
      const cancel = () => { try { Promise.resolve(nativeModule.cancel(id)).catch(() => {}); } catch {} };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const json = await nativeModule.requestPairing(id, code, String(deviceLabel || ''));
        if (signal?.aborted) throw new RemoteAccessError('cancelled');
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed.pairingId !== 'string' || typeof parsed.verificationCode !== 'string') {
          throw new RemoteAccessError('invalid_response');
        }
        return parsed;
      } catch (error) {
        throw mapNativeError(error);
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    async checkPairingStatus(endpoints, tlsServerName, fingerprint, signal) {
      if (!available || typeof nativeModule.checkPairingStatus !== 'function') throw new RemoteAccessError('gateway_identity_unverified');
      const pin = validateFingerprint(fingerprint);
      if (signal?.aborted) throw new RemoteAccessError('cancelled');
      const id = `${Date.now()}-${++sequence}`;
      const cancel = () => { try { Promise.resolve(nativeModule.cancel(id)).catch(() => {}); } catch {} };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const json = await nativeModule.checkPairingStatus(id, endpoints, tlsServerName, pin);
        if (signal?.aborted) throw new RemoteAccessError('cancelled');
        return JSON.parse(json);
      } catch (error) {
        throw mapNativeError(error);
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    async listSignedSessions(endpoints, tlsServerName, fingerprint, signal) {
      if (!available || typeof nativeModule.listSignedSessions !== 'function') throw new RemoteAccessError('gateway_identity_unverified');
      const pin = validateFingerprint(fingerprint);
      if (signal?.aborted) throw new RemoteAccessError('cancelled');
      const id = `${Date.now()}-${++sequence}`;
      const cancel = () => { try { Promise.resolve(nativeModule.cancel(id)).catch(() => {}); } catch {} };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const json = await nativeModule.listSignedSessions(id, endpoints, tlsServerName, pin);
        if (signal?.aborted) throw new RemoteAccessError('cancelled');
        return parseSessionResponse(json);
      } catch (error) {
        throw mapNativeError(error);
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    async scanQrCode() {
      if (!available || typeof nativeModule.scanQrCode !== 'function') throw new RemoteAccessError('unavailable');
      try {
        return await nativeModule.scanQrCode();
      } catch (error) {
        throw mapNativeError(error);
      }
    },
    async readClipboardPairingCode() {
      if (!available || typeof nativeModule.readClipboardPairingCode !== 'function') return '';
      try {
        return await nativeModule.readClipboardPairingCode();
      } catch {
        return '';
      }
    },
  });
}
