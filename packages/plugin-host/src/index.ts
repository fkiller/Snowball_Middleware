import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { API_VERSION, parseManifest, parseMessage, PluginFault, record, type PluginManifest } from '@snowball/plugin-sdk';
export { runBinaryProbe, binaryProbeDigest, BinaryHarnessProbe, type BinaryProbeSpec, type BinaryProbeResult } from './binary-probe.js';

export interface HostOptions {
  directory: string; manifest: unknown; approvedDigests: ReadonlyMap<string, string>;
  timeoutMs?: number; maxFrameBytes?: number; maxPending?: number;
  maxEventsPerSecond?: number; restartBackoffMs?: number;
}
type Pending = { resolve(value: unknown): void; reject(error: Error): void; dispose(): void };
export type HostState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'stopping';

/** Process isolation contains crashes, not malicious code. Only approved local plugins may run. */
export class PluginHost extends EventEmitter {
  readonly manifest: PluginManifest;
  state: HostState = 'stopped';
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private eventSequence = 0;
  private frame = Buffer.alloc(0);
  private eventWindow = 0;
  private eventCount = 0;
  private failures = 0;
  private restartAfter = 0;
  private generation = 0;
  private readonly options: Required<Omit<HostOptions, 'manifest'>>;

  constructor(options: HostOptions) {
    super();
    this.manifest = parseManifest(options.manifest);
    this.options = { directory: options.directory, approvedDigests: new Map(options.approvedDigests), timeoutMs: options.timeoutMs ?? 3000, maxFrameBytes: options.maxFrameBytes ?? 65536, maxPending: options.maxPending ?? 32, maxEventsPerSecond: options.maxEventsPerSecond ?? 100, restartBackoffMs: options.restartBackoffMs ?? 1000 };
    for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPending', 'maxEventsPerSecond', 'restartBackoffMs'] as const) {
      if (!Number.isSafeInteger(this.options[key]) || this.options[key] < 1) throw new Error(`Invalid ${key}`);
    }
  }
  async start(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'starting' || this.state === 'stopping') throw new PluginFault('unavailable', 'Lifecycle transition in progress');
    if (this.child) throw new PluginFault('unavailable', 'Previous process has not exited');
    if (Date.now() < this.restartAfter) throw new PluginFault('unavailable', 'Restart backoff active');
    this.state = 'starting';
    const generation = ++this.generation;
    try {
      const m = this.manifest;
      if (!m.platforms.includes(process.platform as never) || !m.architectures.includes(process.arch as never)) throw new PluginFault('incompatible', 'Unsupported OS/architecture');
      if (this.options.approvedDigests.get(m.id) !== m.integrity.entrySha256) throw new PluginFault('untrusted', 'Explicit plugin digest approval required');
      const directory = await realpath(this.options.directory);
      const entry = await realpath(path.join(directory, m.entrypoint));
      const relative = path.relative(directory, entry);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new PluginFault('untrusted', 'Entrypoint escapes plugin directory');
      const digest = createHash('sha256').update(await readFile(entry)).digest('hex');
      if (digest !== m.integrity.entrySha256) throw new PluginFault('untrusted', 'Entrypoint integrity mismatch');
      if (generation !== this.generation || this.state !== 'starting') throw new PluginFault('cancelled', 'Start cancelled');
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) if (process.env[key]) env[key] = process.env[key];
      const child = spawn(process.execPath, [entry], { cwd: directory, shell: false, windowsHide: true, stdio: 'pipe', env });
      this.child = child;
      this.frame = Buffer.alloc(0); this.eventSequence = 0; this.eventCount = 0; this.eventWindow = Date.now();
      child.stdout.on('data', (data: Buffer) => { if (this.child === child) this.receive(data); });
      // Do not forward arbitrary plugin stderr (may include credentials/transcripts).
      child.stderr.resume();
      child.stdin.on('error', () => { if (this.child === child) this.fail(new PluginFault('unavailable', 'Plugin input closed', 'unknown')); });
      child.on('error', () => { if (this.child === child) this.fail(new PluginFault('unavailable', 'Plugin process failed', 'unknown')); });
      child.on('exit', () => {
        if (this.child !== child) return;
        this.child = undefined;
        if (this.state === 'stopping') this.state = 'stopped';
        else if (this.state !== 'degraded') this.fail(new PluginFault('unavailable', 'Plugin exited', 'unknown'));
      });
      const hello = await this.call('plugin.initialize', { apiVersion: API_VERSION, pluginId: m.id }, undefined, true);
      if (!record(hello) || hello.apiVersion !== API_VERSION || hello.pluginId !== m.id) throw new PluginFault('incompatible', 'Plugin handshake mismatch');
      if (generation !== this.generation || this.state !== 'starting') throw new PluginFault('cancelled', 'Start cancelled');
      this.state = 'ready';
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.state !== 'ready') return Promise.reject(new PluginFault('unavailable', 'Plugin is not ready'));
    if (!this.manifest.capabilities.some(capability => capability.operation === method)) return Promise.reject(new PluginFault('unsupported', 'Operation not declared'));
    return this.call(method, params, signal);
  }
  private call(method: string, params: unknown, signal?: AbortSignal, internal = false): Promise<unknown> {
    if (!this.child || (!internal && this.state !== 'ready')) return Promise.reject(new PluginFault('unavailable', 'Plugin unavailable'));
    if (signal?.aborted) return Promise.reject(new PluginFault('cancelled', 'Request cancelled'));
    if (this.pending.size >= this.options.maxPending) return Promise.reject(new PluginFault('limit', 'Too many pending requests'));
    const id = ++this.sequence;
    let encoded: string;
    try { encoded = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'; }
    catch { return Promise.reject(new PluginFault('protocol', 'Parameters must be JSON serializable')); }
    if (Buffer.byteLength(encoded) > this.options.maxFrameBytes) return Promise.reject(new PluginFault('limit', 'Request exceeds frame limit'));
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); pending.dispose();
        // Cancellation is best effort and never evidence that the external action did not run.
        this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'plugin.cancel', params: { requestId: id } }) + '\n');
        reject(new PluginFault('cancelled', 'Request cancelled after dispatch', 'unknown'));
      };
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); pending.dispose();
        reject(new PluginFault('timeout', 'Request timed out; delivery unknown', 'unknown'));
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } });
      signal?.addEventListener('abort', cancel, { once: true });
      const child = this.child!;
      child.stdin.write(encoded, error => { if (error && this.child === child) this.fail(new PluginFault('unavailable', 'Dispatch failed', 'unknown')); });
    });
  }
  private receive(chunk: Buffer): void {
    try {
      // Inspect chunks without concatenating an unbounded stream of unterminated data.
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (this.frame.length + end - offset > this.options.maxFrameBytes) throw new PluginFault('limit', 'Plugin frame limit exceeded', 'unknown');
        this.frame = Buffer.concat([this.frame, chunk.subarray(offset, end)]);
        offset = end + (newline < 0 ? 0 : 1);
        if (newline < 0) break;
        const message = parseMessage(JSON.parse(this.frame.toString('utf8')));
        this.frame = Buffer.alloc(0);
        if ('id' in message) {
          const pending = this.pending.get(message.id);
          if (!pending) continue; // Late response after timeout/cancel: never replay.
          this.pending.delete(message.id); pending.dispose();
          if ('error' in message) pending.reject(new PluginFault('protocol', message.error.message, 'unknown'));
          else pending.resolve(message.result);
        } else {
          if (this.state !== 'ready') throw new PluginFault('protocol', 'Event before initialization');
          if (message.params.sequence <= this.eventSequence) throw new PluginFault('protocol', 'Event sequence regression');
          if (Date.now() - this.eventWindow >= 1000) { this.eventWindow = Date.now(); this.eventCount = 0; }
          if (++this.eventCount > this.options.maxEventsPerSecond) throw new PluginFault('limit', 'Plugin event rate exceeded');
          this.eventSequence = message.params.sequence;
          this.emit('event', { pluginId: this.manifest.id, generation: this.generation, sequence: message.params.sequence, event: message.params.event, data: message.params.data });
        }
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private fail(error: Error): void {
    if (this.state !== 'degraded') {
      this.failures++;
      this.restartAfter = Date.now() + Math.min(30000, this.options.restartBackoffMs * 2 ** Math.min(this.failures - 1, 5));
    }
    this.state = 'degraded';
    this.frame = Buffer.alloc(0);
    const pendingFault = new PluginFault(error instanceof PluginFault ? error.code : 'protocol', error.message, 'unknown');
    for (const pending of this.pending.values()) { pending.dispose(); pending.reject(pendingFault); }
    this.pending.clear();
    this.child?.kill();
    this.emit('fault', error);
  }
  async stop(): Promise<void> {
    ++this.generation;
    this.state = 'stopping';
    for (const pending of this.pending.values()) { pending.dispose(); pending.reject(new PluginFault('unavailable', 'Plugin stopped', 'unknown')); }
    this.pending.clear(); this.frame = Buffer.alloc(0);
    const child = this.child;
    if (child) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
    this.state = 'stopped';
  }
}
