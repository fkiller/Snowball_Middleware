// This experimental transport permits only explicit Tailscale HTTPS origins.
// A public CA validates the server certificate using the platform TLS stack.
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

export async function listSessions(origin, token, transport, signal) {
  const base = validateOrigin(origin);
  const credential = validateToken(token);
  // expo/fetch implements redirect:error in its native iOS and Android transports.
  // Never forward a bearer credential to a redirect destination.
  const response = await transport(`${base}/remote/v1/sessions`, {
    method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Connection was not authorized. The credential may have expired.' : `Connection failed (${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) throw new Error('Unexpected response from the gateway.');
  const result = await response.json();
  if (!result || typeof result !== 'object' || !Array.isArray(result.sessions) || result.sessions.length > 256 || result.sessions.some(item =>
    !item || typeof item !== 'object' || ['status', 'harnessPluginId'].some(key => typeof item[key] !== 'string' || item[key].length > 2048))) throw new Error('Unexpected response from the gateway.');
  return result.sessions.map(({ status, harnessPluginId }) => ({ status, harnessPluginId }));
}
