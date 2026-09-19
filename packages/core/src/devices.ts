import { randomBytes } from 'node:crypto';
import { ControllerContext, type ControllerSelection } from './context.js';
import { createControllerId, parseControllerId, parseInstanceId, parsePluginId, parseSessionKey, type PersistedController } from './identity.js';
import { copy, isRecord, nonnegative, requireThat } from './journal-model.js';

export interface DeviceSource { pluginId: string; instanceId: string }
export type DeviceTransport = 'virtual' | 'hid' | 'lan';
export interface DeviceObservation {
  nativeDeviceId: string; label: string; transport: DeviceTransport;
  capabilities: ('button' | 'select-session' | 'display')[];
  supported: boolean;
  /** Trusted plugin verification, never IP/OS path/display name. Absence means ephemeral. */
  verifiedIdentity?: string;
}
export interface DeviceCandidate extends DeviceObservation { candidateId: string; source: DeviceSource; generation: number }
export interface DeviceBinding {
  deviceId: string; controllerId: string; source: DeviceSource; label: string;
  transport: DeviceTransport; capabilities: DeviceObservation['capabilities'];
  verifiedIdentity?: string; revision: number;
}
export type DeviceInput = { kind: 'select-session'; sessionKey: string } | { kind: 'button'; button: 'confirm' | 'cancel' };
interface Connection { candidateId: string; nativeDeviceId: string; lease: string; lastSequence: number; state: 'ready' | 'offline' | 'degraded' }
interface SourceState { generation: number; status: 'scanning' | 'ready' | 'failed' | 'missing_plugin' }
const sourceKey = (source: DeviceSource) => `${parsePluginId(source.pluginId)}/${parseInstanceId(source.instanceId)}`;
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`;
const deviceId = (value: unknown): string => { requireThat(typeof value === 'string' && /^dev_[a-f0-9]{32}$/.test(value), 'Invalid device ID'); return value; };
function observation(raw: unknown): DeviceObservation {
  requireThat(isRecord(raw), 'Invalid device observation');
  requireThat(typeof raw.nativeDeviceId === 'string' && raw.nativeDeviceId.length > 0 && raw.nativeDeviceId.length <= 256 && !/[\x00-\x1f]/.test(raw.nativeDeviceId), 'Invalid native device');
  requireThat(typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 128, 'Invalid device label');
  requireThat(['virtual', 'hid', 'lan'].includes(String(raw.transport)) && typeof raw.supported === 'boolean', 'Invalid transport/support');
  requireThat(Array.isArray(raw.capabilities) && raw.capabilities.length <= 3 && raw.capabilities.every(c => ['button', 'select-session', 'display'].includes(c)) && new Set(raw.capabilities).size === raw.capabilities.length, 'Invalid semantic capabilities');
  if (raw.verifiedIdentity !== undefined) requireThat(typeof raw.verifiedIdentity === 'string' && raw.verifiedIdentity.length > 0 && raw.verifiedIdentity.length <= 256, 'Invalid verified identity');
  return { nativeDeviceId: raw.nativeDeviceId, label: raw.label, transport: raw.transport as DeviceTransport, supported: raw.supported, capabilities: [...raw.capabilities] as DeviceObservation['capabilities'], ...(raw.verifiedIdentity !== undefined ? { verifiedIdentity: raw.verifiedIdentity as string } : {}) };
}

/** Hardware is optional. This registry has no OS enumeration/network/process dependency. */
export class DeviceRegistry {
  private readonly sources = new Map<string, SourceState>();
  private readonly candidates = new Map<string, DeviceCandidate>();
  private readonly bindings = new Map<string, DeviceBinding>();
  private readonly contexts = new Map<string, ControllerContext>();
  private readonly connections = new Map<string, Connection>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly now: () => number = Date.now) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot change authority. */ } } }
  beginScan(source: DeviceSource): number {
    const key = sourceKey(source); const generation = (this.sources.get(key)?.generation ?? 0) + 1;
    requireThat(this.sources.has(key) || this.sources.size < 64, 'Device source limit', 'capacity');
    this.sources.set(key, { generation, status: 'scanning' });
    for (const [id, c] of this.candidates) if (sourceKey(c.source) === key) this.candidates.delete(id);
    this.changed(); return generation;
  }
  observe(source: DeviceSource, generation: number, raw: DeviceObservation): DeviceCandidate | undefined {
    const key = sourceKey(source); const current = this.sources.get(key);
    if (current?.generation !== generation || current.status !== 'scanning') return undefined;
    const value = observation(raw);
    const prior = [...this.candidates.values()].find(c => sourceKey(c.source) === key && c.nativeDeviceId === value.nativeDeviceId && c.transport === value.transport);
    requireThat(prior || this.candidates.size < 256, 'Device candidate limit', 'capacity');
    const candidate = { ...value, candidateId: prior?.candidateId ?? id('candidate'), source: { pluginId: source.pluginId, instanceId: source.instanceId }, generation };
    this.candidates.set(candidate.candidateId, candidate); this.changed(); return copy(candidate);
  }
  finishScan(source: DeviceSource, generation: number, status: 'ready' | 'failed' | 'missing_plugin'): void {
    const key = sourceKey(source); const current = this.sources.get(key);
    if (current?.generation !== generation) return;
    requireThat(['ready', 'failed', 'missing_plugin'].includes(status), 'Invalid source status');
    this.sources.set(key, { generation, status });
    if (status !== 'ready') for (const b of this.bindings.values()) if (sourceKey(b.source) === key) this.disconnect(b.deviceId, 'degraded');
    this.changed();
  }
  listCandidates(): DeviceCandidate[] { return [...this.candidates.values()].map(copy); }
  list(): (DeviceBinding & { state: Connection['state']; selection: ControllerSelection })[] {
    return [...this.bindings.values()].map(b => ({ ...copy(b), state: this.connections.get(b.deviceId)?.state ?? 'offline', selection: this.contexts.get(b.controllerId)!.getSelection() }));
  }
  sourceStates(): { source: string; generation: number; status: SourceState['status'] }[] { return [...this.sources].map(([source, s]) => ({ source, ...s })); }
  private candidate(candidateId: string, generation: number): DeviceCandidate {
    const c = this.candidates.get(candidateId);
    const source = c ? this.sources.get(sourceKey(c.source)) : undefined;
    requireThat(c && c.generation === generation && source?.generation === generation && (source.status === 'ready' || source.status === 'scanning'), 'Candidate stale or unavailable', 'stale_device');
    requireThat(c.supported, 'No supporting plugin; candidate has no control rights', 'unsupported'); return c;
  }
  /** Explicit user registration after adapter-specific physical/pairing verification. */
  register(candidateId: string, generation: number): { binding: DeviceBinding; lease: string } {
    const c = this.candidate(candidateId, generation);
    requireThat(c.transport !== 'lan' || !!c.verifiedIdentity, 'LAN pairing identity required', 'unpaired');
    requireThat(this.bindings.size < 64, 'Device registration limit', 'capacity');
    requireThat(![...this.connections.values()].some(x => x.candidateId === candidateId && x.state === 'ready'), 'Candidate already registered', 'conflict');
    requireThat(!c.verifiedIdentity || ![...this.bindings.values()].some(b => sourceKey(b.source) === sourceKey(c.source) && b.verifiedIdentity === c.verifiedIdentity), 'Verified device already registered; reconnect explicitly', 'conflict');
    const binding: DeviceBinding = { deviceId: id('dev'), controllerId: createControllerId(), source: copy(c.source), label: c.label, transport: c.transport, capabilities: [...c.capabilities], revision: 0, ...(c.verifiedIdentity ? { verifiedIdentity: c.verifiedIdentity } : {}) };
    this.bindings.set(binding.deviceId, binding); this.contexts.set(binding.controllerId, new ControllerContext(binding.controllerId));
    const lease = secretLease(); this.connections.set(binding.deviceId, { candidateId, nativeDeviceId: c.nativeDeviceId, lease, lastSequence: 0, state: 'ready' }); this.changed();
    return { binding: copy(binding), lease };
  }
  reconnect(id: string, candidateId: string, generation: number, expectedRevision: number): { binding: DeviceBinding; lease: string } {
    const b = this.bindings.get(id); const c = this.candidate(candidateId, generation);
    requireThat(b && b.revision === expectedRevision, 'Device revision changed', 'stale_device');
    requireThat(sourceKey(b.source) === sourceKey(c.source) && !!b.verifiedIdentity && b.verifiedIdentity === c.verifiedIdentity, 'Physical identity must be confirmed again', 'needs_identification');
    requireThat(b.transport === c.transport && JSON.stringify([...b.capabilities].sort()) === JSON.stringify([...c.capabilities].sort()), 'Device contract changed; explicit registration review required', 'needs_review');
    const lease = secretLease(); const next = { ...b, revision: b.revision + 1 };
    this.bindings.set(id, next); this.connections.set(id, { candidateId, nativeDeviceId: c.nativeDeviceId, lease, lastSequence: 0, state: 'ready' }); this.changed();
    return { binding: copy(next), lease };
  }
  disconnect(id: string, state: 'offline' | 'degraded' = 'offline'): void {
    const connection = this.connections.get(id); if (connection) { this.connections.set(id, { ...connection, lease: '', state }); this.changed(); }
  }
  revoke(id: string): void {
    const binding = this.bindings.get(id);
    if (binding) {
      this.bindings.delete(id);
      this.connections.delete(id);
      // Context in this.contexts is preserved so existing drafts or running tasks
      // are NOT aborted (D16: harness task는 자동 취소하지 않음).
      this.changed();
    }
  }
  forget(id: string): void {
    this.revoke(id);
  }
  handlePluginCrash(pluginId: string): void {
    for (const b of this.bindings.values()) {
      if (b.source.pluginId === pluginId) {
        this.disconnect(b.deviceId, 'degraded');
      }
    }
    this.changed();
  }
  getContext(controllerId: string): ControllerContext | undefined {
    return this.contexts.get(controllerId);
  }
  private connection(id: string, lease: string): { binding: DeviceBinding; connection: Connection; context: ControllerContext } {
    const binding = this.bindings.get(id); const connection = this.connections.get(id);
    requireThat(binding && connection?.state === 'ready' && connection.lease === lease, 'Device lease unavailable', 'offline');
    return { binding, connection, context: this.contexts.get(binding.controllerId)! };
  }
  input(id: string, lease: string, sequence: number, observedAt: number, event: DeviceInput): { controllerId: string; selection: ControllerSelection; event: DeviceInput } {
    const { binding, connection, context } = this.connection(id, lease);
    nonnegative(sequence, 'input sequence'); nonnegative(observedAt, 'input time');
    requireThat(sequence > connection.lastSequence && observedAt <= this.now() + 1000 && observedAt >= this.now() - 2000, 'Stale/replayed input', 'stale_input');
    requireThat(isRecord(event) && binding.capabilities.includes(event.kind), 'Unsupported semantic input', 'unsupported');
    if (event.kind === 'select-session') { parseSessionKey(event.sessionKey); context.selectScope({ sessionKey: event.sessionKey }); }
    else requireThat(event.kind === 'button' && ['confirm', 'cancel'].includes(event.button), 'Invalid semantic button');
    connection.lastSequence = sequence;
    this.changed();
    // A semantic input is not authorization to send. Runtime must use the central command journal.
    return { controllerId: binding.controllerId, selection: context.getSelection(), event: copy(event) };
  }
  output(id: string, lease: string, controllerId: string, text: string): { source: DeviceSource; nativeDeviceId: string; controllerId: string; selection: ControllerSelection; text: string } {
    const current = this.connection(id, lease);
    requireThat(current.binding.controllerId === controllerId && current.binding.capabilities.includes('display'), 'Output controller/connection mismatch', 'stale_device');
    requireThat(typeof text === 'string' && Buffer.byteLength(text) <= 8192, 'Display limit', 'capacity');
    return { source: copy(current.binding.source), nativeDeviceId: current.connection.nativeDeviceId, controllerId, selection: current.context.getSelection(), text };
  }
  exportState(): { schema: 1; bindings: DeviceBinding[]; controllers: PersistedController[] } {
    return { schema: 1, bindings: [...this.bindings.values()].map(copy), controllers: [...this.contexts.values()].map(c => c.snapshot()) };
  }
  /** Validate atomically into a fresh registry; no lease/candidate/input is persisted or replayed. */
  static restore(raw: unknown, now: () => number = Date.now): DeviceRegistry {
    requireThat(isRecord(raw) && raw.schema === 1 && Array.isArray(raw.bindings) && Array.isArray(raw.controllers) && raw.bindings.length <= 64 && raw.controllers.length === raw.bindings.length, 'Invalid device store');
    const registry = new DeviceRegistry(now);
    for (const entry of raw.bindings) {
      requireThat(isRecord(entry) && isRecord(entry.source), 'Invalid device binding');
      const source = { pluginId: parsePluginId(entry.source.pluginId), instanceId: parseInstanceId(entry.source.instanceId) };
      const value = observation({ ...entry, supported: true, nativeDeviceId: 'restore-placeholder' });
      const binding: DeviceBinding = { deviceId: deviceId(entry.deviceId), controllerId: parseControllerId(entry.controllerId), source, label: value.label, transport: value.transport, capabilities: value.capabilities, revision: nonnegative(entry.revision, 'revision'), ...(value.verifiedIdentity ? { verifiedIdentity: value.verifiedIdentity } : {}) };
      requireThat(!registry.bindings.has(binding.deviceId) && !registry.contexts.has(binding.controllerId), 'Duplicate device/controller');
      const saved = raw.controllers.find(c => isRecord(c) && c.controllerId === binding.controllerId);
      requireThat(saved, 'Missing controller context');
      const context = new ControllerContext(binding.controllerId); context.restore(saved as PersistedController);
      registry.bindings.set(binding.deviceId, binding); registry.contexts.set(binding.controllerId, context);
    }
    return registry;
  }
}
const secretLease = () => randomBytes(32).toString('base64url');
