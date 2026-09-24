import { randomBytes } from 'node:crypto';

/** Pure public identity contract; no core state or runtime access. */
// --- Host -----------------------------------------------------------------

export type HostId = string;
const HOST_ID_PATTERN = /^host_[0-9a-f]{32}$/;

export function isHostId(value: unknown): value is HostId {
  return typeof value === 'string' && HOST_ID_PATTERN.test(value);
}

export function parseHostId(value: unknown): HostId {
  if (!isHostId(value)) throw new Error('Invalid host id');
  return value;
}

/** One id per user on one PC, generated once and persisted. Not a hostname. */
export function createHostId(random: (size: number) => Buffer = randomBytes): HostId {
  return `host_${random(16).toString('hex')}`;
}

// --- Harness instance -------------------------------------------------------

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/;
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface HarnessRef {
  pluginId: string;
  instanceId: string;
}

export function parsePluginId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !PLUGIN_ID_PATTERN.test(value)) {
    throw new Error('Invalid harness plugin id');
  }
  return value;
}

export function parseInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw new Error('Invalid harness instance id');
  }
  return value;
}

export function parseHarnessRef(value: unknown): HarnessRef {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid harness reference');
  const record = value as Record<string, unknown>;
  return { pluginId: parsePluginId(record.pluginId), instanceId: parseInstanceId(record.instanceId) };
}

// --- Composite session key --------------------------------------------------
// Canonical form: hostId/pluginId/instanceId/escapedNativeSessionId.
// The same native id on another host or instance is a different key (A1).

export interface SessionKeyParts {
  hostId: HostId;
  harness: HarnessRef;
  nativeSessionId: string;
}

const NATIVE_ID_MAX = 256;

export function parseNativeSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > NATIVE_ID_MAX) {
    throw new Error('Invalid native session id');
  }
  if (value.trim().length === 0) throw new Error('Invalid native session id');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new Error('Invalid native session id');
  return value;
}

function escapeSegment(value: string): string {
  return value.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function unescapeSegment(value: string): string {
  if (!/^(?:[^%]|%2F|%25)+$/.test(value)) throw new Error('Invalid session key encoding');
  return value.replace(/%2F/g, '/').replace(/%25/g, '%');
}

export function formatSessionKey(parts: SessionKeyParts): string {
  parseHostId(parts.hostId);
  parseHarnessRef(parts.harness);
  parseNativeSessionId(parts.nativeSessionId);
  return `${parts.hostId}/${parts.harness.pluginId}/${parts.harness.instanceId}/${escapeSegment(parts.nativeSessionId)}`;
}

export function parseSessionKey(value: unknown): SessionKeyParts {
  if (typeof value !== 'string') throw new Error('Invalid session key');
  const segments = value.split('/');
  if (segments.length !== 4) throw new Error('Invalid session key');
  const [hostId, pluginId, instanceId, escaped] = segments as [string, string, string, string];
  const parts: SessionKeyParts = {
    hostId: parseHostId(hostId),
    harness: { pluginId: parsePluginId(pluginId), instanceId: parseInstanceId(instanceId) },
    nativeSessionId: parseNativeSessionId(unescapeSegment(escaped)),
  };
  // Canonical round-trip: reject non-canonical encodings so keys compare by string.
  if (formatSessionKey(parts) !== value) throw new Error('Invalid session key');
  return parts;
}

export function sessionKeyEquals(a: string | SessionKeyParts, b: string | SessionKeyParts): boolean {
  const left = typeof a === 'string' ? a : formatSessionKey(a);
  const right = typeof b === 'string' ? b : formatSessionKey(b);
  return left === right;
}
