/**
 * Validate one tailnet node DNS name. This does not prove that the node is
 * owned by the current user or that an HTTPS endpoint is reachable. Callers
 * must obtain the name from a trusted local source and obtain user approval.
 */
export function parseTailscaleHost(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 254) throw new Error('Invalid Tailscale host');
  const host = (value.endsWith('.') ? value.slice(0, -1) : value).toLowerCase();
  if (host.length > 253 || !host.endsWith('.ts.net')) throw new Error('Invalid Tailscale host');
  const labels = host.split('.');
  if (labels.length < 4 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Invalid Tailscale host');
  return host;
}

/** Extract a DNS name only from the local node of a running online client. */
export function extractTailscaleSelfHost(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tailscale status unavailable');
  const status = value as Record<string, unknown>;
  const self = status.Self;
  if (status.BackendState !== 'Running' || !self || typeof self !== 'object' || Array.isArray(self) || (self as Record<string, unknown>).Online !== true) throw new Error('Tailscale node is not online');
  return parseTailscaleHost((self as Record<string, unknown>).DNSName);
}
