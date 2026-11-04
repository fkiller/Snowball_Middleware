// Read-only interpretation of a single Tailscale Serve configuration snapshot.
// This does not check the live listener, TLS identity, tailnet policy, ownership,
// or connectivity, and MUST NOT be used as authorization to modify Serve.
// Tailscale's JSON is not a stable API; unsupported shapes remain unknown.
// The raw TCP forwarder must not terminate TLS or add a PROXY header.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAllowed = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const portValid = value => Number.isInteger(value) && value >= 1 && value <= 65535;
const mapValid = value => object(value) && Object.keys(value).length <= 128;

function authorityPort(authority) {
  if (typeof authority !== 'string' || authority.length > 260) return null;
  const match = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):([1-9][0-9]{0,4})$/i.exec(authority);
  if (!match || match[1].split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  const port = Number(match[2]);
  return portValid(port) ? port : null;
}

function portMap(value) {
  if (value === undefined || value === null) return {};
  if (!mapValid(value)) throw new Error('unknown');
  for (const [port, handler] of Object.entries(value)) {
    if (!/^[1-9][0-9]{0,4}$/.test(port) || !portValid(Number(port)) || !object(handler)) throw new Error('unknown');
    if (!keysAllowed(handler, ['HTTP', 'HTTPS', 'TCPForward', 'TerminateTLS', 'ProxyProtocol'])) throw new Error('unknown');
    if (handler.HTTP !== undefined && typeof handler.HTTP !== 'boolean') throw new Error('unknown');
    if (handler.HTTPS !== undefined && typeof handler.HTTPS !== 'boolean') throw new Error('unknown');
    if (handler.TCPForward !== undefined && typeof handler.TCPForward !== 'string') throw new Error('unknown');
    if (handler.TerminateTLS !== undefined && typeof handler.TerminateTLS !== 'string') throw new Error('unknown');
    if (handler.ProxyProtocol !== undefined && !Number.isSafeInteger(handler.ProxyProtocol)) throw new Error('unknown');
  }
  return value;
}

function webMap(value) {
  if (value === undefined || value === null) return {};
  if (!mapValid(value)) throw new Error('unknown');
  for (const [authority, server] of Object.entries(value)) {
    if (authorityPort(authority) === null || !object(server) || !keysAllowed(server, ['Handlers']) || !mapValid(server.Handlers)) throw new Error('unknown');
    for (const [mount, handler] of Object.entries(server.Handlers)) {
      if (!mount.startsWith('/') || mount.length > 2048 || !object(handler)) throw new Error('unknown');
      // Future handler forms are not considered evidence that the port is free.
      if (!keysAllowed(handler, ['Path', 'Proxy', 'Text', 'AcceptAppCaps', 'Redirect'])) throw new Error('unknown');
    }
  }
  return value;
}

function funnelMap(value) {
  if (value === undefined || value === null) return {};
  if (!mapValid(value)) throw new Error('unknown');
  for (const [authority, enabled] of Object.entries(value)) {
    if (authorityPort(authority) === null || typeof enabled !== 'boolean') throw new Error('unknown');
  }
  return value;
}

function scope(value, foreground = false) {
  if (!object(value) || !keysAllowed(value, foreground ? ['TCP', 'Web', 'AllowFunnel'] : ['TCP', 'Web', 'AllowFunnel', 'Foreground', 'Services'])) throw new Error('unknown');
  // Services use distinct virtual IPs and have their own configuration model.
  // Do not infer that a port is free while any such unreviewed config exists.
  if (value.Services !== undefined && value.Services !== null && (!mapValid(value.Services) || Object.keys(value.Services).length)) throw new Error('unknown');
  return { tcp: portMap(value.TCP), web: webMap(value.Web), funnel: funnelMap(value.AllowFunnel) };
}

/**
 * Inspect only the snapshot's declared raw TCP configuration. `matched` means
 * precisely one node/foreground TCP handler points to 127.0.0.1:backendPort,
 * TLS is not terminated and Funnel is not enabled for the listen port. It does
 * not prove that a live service, correct certificate or safe connection exists.
 */
export function inspectServeStatus(value, { listenPort, backendPort } = {}) {
  const result = snapshot => ({ snapshot, connection: 'not_tested', identity: 'not_verified', backendOwnership: 'not_verified' });
  if (!portValid(listenPort) || !portValid(backendPort)) return result('unknown');
  try {
    const scopes = [scope(value)];
    if (value.Foreground !== undefined && value.Foreground !== null) {
      if (!mapValid(value.Foreground)) throw new Error('unknown');
      for (const nested of Object.values(value.Foreground)) scopes.push(scope(nested, true));
    }
    if (scopes.some(item => Object.entries(item.funnel).some(([authority, enabled]) => enabled && authorityPort(authority) === listenPort))) return result('public');
    const portKey = String(listenPort);
    const tcpHandlers = scopes.filter(item => Object.hasOwn(item.tcp, portKey)).map(item => item.tcp[portKey]);
    const webUsesPort = scopes.some(item => Object.keys(item.web).some(authority => authorityPort(authority) === listenPort));
    if (webUsesPort || tcpHandlers.length > 1) return result('conflict');
    if (!tcpHandlers.length) return result('unconfigured');
    const handler = tcpHandlers[0];
    if (handler.TCPForward !== `127.0.0.1:${backendPort}` || handler.HTTP === true || handler.HTTPS === true || (handler.TerminateTLS ?? '') !== '' || (handler.ProxyProtocol ?? 0) !== 0) return result('conflict');
    return result('matched');
  } catch { return result('unknown'); }
}
