/** Protocol 1. New incompatible major versions require an explicit migration. */
export const API_VERSION = '1.0.0';
export const SDK_API_RANGE = '^1.0.0';
export type PluginKind = 'hardware' | 'harness' | 'speech';
export interface Capability { operation: string; access: 'observe' | 'control' }
export interface PluginManifest {
  id: string; publisher: string; version: string; kind: PluginKind;
  sdkApiRange: typeof SDK_API_RANGE; entrypoint: string;
  platforms: Array<'win32' | 'darwin' | 'linux'>; architectures: Array<'x64' | 'arm64'>;
  capabilities: Capability[]; permissions: string[];
  configSchema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: false };
  integrity: { entrySha256: string }; license: string;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid plugin manifest: ${message}`);
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const operationPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;
export function parseManifest(value: unknown): PluginManifest {
  required(record(value), 'object required');
  required(typeof value.id === 'string' && /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(value.id) && value.id.length <= 128, 'namespaced id required');
  required(nonempty(value.publisher) && nonempty(value.license), 'publisher/license required');
  required(typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version), 'version must be major.minor.patch');
  required(['hardware', 'harness', 'speech'].includes(String(value.kind)), 'unknown kind');
  required(value.sdkApiRange === SDK_API_RANGE, `only ${SDK_API_RANGE} is supported in protocol 1; other ranges fail closed`);
  required(typeof value.entrypoint === 'string' && /^[a-zA-Z0-9_./-]+\.m?js$/.test(value.entrypoint) && !value.entrypoint.startsWith('/') && !value.entrypoint.split('/').includes('..'), 'relative JS entrypoint required');
  for (const [field, allowed] of [['platforms', ['win32', 'darwin', 'linux']], ['architectures', ['x64', 'arm64']]] as const) {
    const values = value[field];
    required(Array.isArray(values) && values.length > 0 && values.every(v => allowed.includes(v as never)), `${field} invalid`);
  }
  required(Array.isArray(value.capabilities) && value.capabilities.length <= 128, 'capabilities required');
  const operations = new Set<string>();
  for (const capability of value.capabilities) {
    required(record(capability) && typeof capability.operation === 'string' && operationPattern.test(capability.operation) && !capability.operation.startsWith('plugin.'), 'invalid operation');
    required(capability.access === 'observe' || capability.access === 'control', 'capability access invalid');
    const prefix = value.kind === 'hardware' ? 'devices.' : value.kind === 'harness' ? 'harness.' : 'speech.';
    required(capability.operation.startsWith(prefix), 'operation outside plugin kind scope');
    required(!operations.has(capability.operation), 'duplicate operation');
    operations.add(capability.operation);
  }
  required(Array.isArray(value.permissions) && value.permissions.every(nonempty), 'permissions required');
  required(record(value.configSchema) && value.configSchema.type === 'object' && record(value.configSchema.properties) && value.configSchema.additionalProperties === false, 'closed object config schema required');
  required(record(value.integrity) && typeof value.integrity.entrySha256 === 'string' && /^[a-f0-9]{64}$/.test(value.integrity.entrySha256), 'SHA-256 entry integrity required');
  // Serialize to detach caller-owned references and strip prototypes.
  const manifest = JSON.parse(JSON.stringify(value)) as PluginManifest;
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(manifest);
  return manifest;
}
export interface RpcRequest { jsonrpc: '2.0'; id: number; method: string; params: unknown }
export type RpcResponse = { jsonrpc: '2.0'; id: number; result: unknown } | { jsonrpc: '2.0'; id: number; error: { code: number; message: string } };
export interface PluginEvent { jsonrpc: '2.0'; method: 'plugin.event'; params: { sequence: number; event: string; data: unknown } }
export function parseMessage(value: unknown): RpcResponse | PluginEvent {
  if (!record(value) || value.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC envelope');
  if ('id' in value) {
    if (!Number.isSafeInteger(value.id) || Number(value.id) < 1 || ('result' in value) === ('error' in value)) throw new Error('Invalid RPC response');
    if ('error' in value && (!record(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string')) throw new Error('Invalid RPC error');
    return value as unknown as RpcResponse;
  }
  if (value.method !== 'plugin.event' || !record(value.params) || !Number.isSafeInteger(value.params.sequence) || Number(value.params.sequence) < 1 || typeof value.params.event !== 'string' || !operationPattern.test(value.params.event)) throw new Error('Invalid plugin event');
  return value as unknown as PluginEvent;
}
export class PluginFault extends Error {
  constructor(public readonly code: 'untrusted' | 'incompatible' | 'protocol' | 'unavailable' | 'unsupported' | 'limit' | 'timeout' | 'cancelled', message: string, public readonly delivery: 'not_sent' | 'unknown' = 'not_sent') {
    super(message); this.name = 'PluginFault';
  }
}

export * from './identity.js';
export * from './dispatch.js';
