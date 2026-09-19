import type { CommandInput, CommandRecord, DecisionRecord, SessionRecord, DeviceRegistry, DeviceCandidate, DiscoverySnapshot } from '@snowball/core';
import type { WorkspaceStatus } from '@snowball/core';
export interface WorkspaceSummary { workspaceId: string; projectId: string; displayName: string; status: WorkspaceStatus }

export interface Credentials { token: string; csrfToken: string; controllerId: string; expiresAt: number }
export interface Snapshot {
  cursor: string; sessions: SessionRecord[];
  commands: { commandId: string; actorId: string; sessionKey: string; ownerId: string; operation: string; status: CommandRecord['status']; revision: number; order: number; updatedAt: number }[];
  decisions: Pick<DecisionRecord, 'decisionId' | 'sessionKey' | 'ownerId' | 'status' | 'revision' | 'expiresAt'>[];
  workspaces: { workspaceId: string }[];
  workspaceDetails: WorkspaceSummary[];
  workspaceSelectionAvailable: boolean;
  devices: ReturnType<DeviceRegistry['list']>;
  deviceSources: ReturnType<DeviceRegistry['sourceStates']>;
  deviceCandidates: DeviceCandidate[];
  /** Reviewed candidate survey, or null when the runtime supplies no surveyor. Never control evidence. */
  harness: DiscoverySnapshot | null;
}
export class ClientFault extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
/** Memory-only credentials. Never automatically retry a mutation after a network failure. */
export class LocalClient {
  private credentials?: Credentials;
  // Browser fetch requires its Window receiver; Node accepts the unbound call and
  // would otherwise hide this failure until real browser onboarding.
  constructor(readonly origin: string, private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin || !url.port) throw new Error('Exact loopback origin required');
  }
  private headers(mutation = false): Record<string, string> {
    return { Origin: this.origin, ...(this.credentials ? { Authorization: `Bearer ${this.credentials.token}` } : {}), ...(mutation ? { 'Content-Type': 'application/json', ...(this.credentials ? { 'X-Snowball-CSRF': this.credentials.csrfToken } : {}) } : {}) };
  }
  private async request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.transport(this.origin + route, { method: body === undefined ? 'GET' : 'POST', headers: this.headers(body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new ClientFault(response.status, result.error ?? 'request_failed');
    return result;
  }
  async bootstrap(code: string, signal?: AbortSignal): Promise<{ controllerId: string; expiresAt: number }> {
    this.credentials = await this.request<Credentials>('/v1/bootstrap', { code }, signal);
    return { controllerId: this.credentials.controllerId, expiresAt: this.credentials.expiresAt };
  }
  snapshot(signal?: AbortSignal): Promise<Snapshot> { return this.request('/v1/snapshot', undefined, signal); }
  /** Explicit user-triggered metadata rescan. Runs no probes and grants nothing. */
  scanHarness(signal?: AbortSignal): Promise<DiscoverySnapshot> { return this.request('/v1/harness/scan', {}, signal); }
  recheckWorkspace(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceSummary> { return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/recheck`, {}, signal); }
  selectWorkspace(signal?: AbortSignal): Promise<{ selected: false } | { selected: true; workspaceId: string }> { return this.request('/v1/workspaces/select', {}, signal); }
  submit(command: Omit<CommandInput, 'actorId'>, signal?: AbortSignal): Promise<{ command: CommandRecord; replayed: boolean }> { return this.request('/v1/commands', command, signal); }
  command(commandId: string, signal?: AbortSignal): Promise<CommandRecord> { return this.request(`/v1/commands/${encodeURIComponent(commandId)}`, undefined, signal); }
  decision(decisionId: string, signal?: AbortSignal): Promise<DecisionRecord> { return this.request(`/v1/decisions/${encodeURIComponent(decisionId)}`, undefined, signal); }
  readFile(workspaceId: string, relative: string, signal?: AbortSignal): Promise<{ text: string }> { return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(relative)}`, undefined, signal); }
  async logout(signal?: AbortSignal): Promise<void> { try { await this.request('/v1/logout', {}, signal); } finally { this.credentials = undefined; } }
  /** One bounded stream connection. Caller reconnects or resnapshots; no hidden retry loop. */
  async *events(cursor: string, signal?: AbortSignal): AsyncGenerator<{ type: 'changed' | 'resync'; cursor: string }> {
    const response = await this.transport(this.origin + '/v1/events', { headers: { ...this.headers(), 'Last-Event-ID': cursor }, signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new ClientFault(response.status, 'stream_failed');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 64 * 1024) throw new ClientFault(0, 'event_limit');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const lines = frame.split('\n'); const type = lines.find(l => l.startsWith('event: '))?.slice(7);
          if (type !== 'changed' && type !== 'resync') continue;
          const payload = JSON.parse(lines.find(l => l.startsWith('data: '))?.slice(6) ?? '{}') as { cursor?: unknown };
          if (typeof payload.cursor !== 'string' || !/^[a-f0-9]{32}:\d+$/.test(payload.cursor)) throw new ClientFault(0, 'invalid_event');
          yield { type, cursor: payload.cursor };
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
