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

// A UI-only flag is insufficient: future call sites must also fail closed.
// This method has no transport path until a reviewed native client can verify
// the gateway identity on the same TLS connection used for the request.
export async function listSessions() {
  throw new RemoteAccessError('gateway_identity_unverified');
}
