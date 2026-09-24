import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';

export class CodexFault extends Error {
  constructor(readonly code: string, readonly delivery: 'not_sent' | 'unknown' = 'not_sent') { super(code); }
}
export interface RpcPort {
  readonly processId?: number;
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: string | number, result: unknown): void;
  on(event: 'notification' | 'request' | 'fault', listener: (value: any) => void): this;
  stop(): Promise<void>;
}
export interface CodexLaunch {
  executable: string; sha256: string; version: '0.153.4';
  codexHome: string; workingDirectory: string;
}
function selected(value: CodexLaunch): CodexLaunch {
  if (!value || value.version !== '0.153.4' || !/^[a-f0-9]{64}$/.test(value.sha256) || ![value.executable, value.codexHome, value.workingDirectory].every(v => typeof v === 'string' && v.length <= 4096 && path.isAbsolute(v) && !/[\x00-\x1f]/.test(v)) || /\.(cmd|bat|ps1)$/i.test(value.executable)) throw new CodexFault('invalid_launch');
  return { executable: path.normalize(value.executable), sha256: value.sha256, version: value.version, codexHome: path.normalize(value.codexHome), workingDirectory: path.normalize(value.workingDirectory) };
}
export function codexLaunchDigest(value: CodexLaunch): string { return createHash('sha256').update(JSON.stringify(selected(value))).digest('hex'); }
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
type Pending = { resolve(value: unknown): void; reject(error: Error): void; dispose(): void };

/** Directly owned stdio process. No Desktop pipe, socket attach, account copying or auto-restart. */
export class CodexStdio extends EventEmitter implements RpcPort {
  #child: ChildProcessWithoutNullStreams;
  #pending = new Map<number, Pending>();
  #id = 0; #frame = Buffer.alloc(0); #closed = false;
  #window = Date.now(); #count = 0;
  get processId(): number | undefined { return this.#child.pid; }
  private constructor(child: ChildProcessWithoutNullStreams) {
    super(); this.#child = child;
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr.resume(); // Provider logs may contain account details; never forward.
    child.stdin.on('error', () => this.fail('input_closed'));
    child.on('error', () => this.fail('process_failed'));
    child.on('exit', () => this.fail('disconnected'));
  }
  static async start(launch: CodexLaunch, approvedDigest: string): Promise<CodexStdio> {
    const spec = selected(launch);
    if (codexLaunchDigest(spec) !== approvedDigest) throw new CodexFault('launch_not_approved');
    const [executable, home, cwd] = await Promise.all([realpath(spec.executable), realpath(spec.codexHome), realpath(spec.workingDirectory)]);
    if (executable !== spec.executable || home !== spec.codexHome || cwd !== spec.workingDirectory || !(await stat(home)).isDirectory() || !(await stat(cwd)).isDirectory()) throw new CodexFault('launch_path_changed');
    const info = await stat(executable);
    if (!info.isFile() || info.size > 512 * 1024 * 1024) throw new CodexFault('binary_limit');
    const stream = createReadStream(executable); const digest = createHash('sha256');
    const timer = setTimeout(() => stream.destroy(new CodexFault('verification_timeout')), 5000); let bytes = 0;
    try { for await (const chunk of stream) { bytes += chunk.length; if (bytes > 512 * 1024 * 1024) throw new CodexFault('binary_limit'); digest.update(chunk); } }
    finally { clearTimeout(timer); stream.destroy(); }
    if (digest.digest('hex') !== spec.sha256 || await realpath(spec.executable) !== executable) throw new CodexFault('binary_changed');
    const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
    for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) if (process.env[key]) env[key] = process.env[key];
    return new CodexStdio(spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, shell: false, windowsHide: true, stdio: 'pipe', env }));
  }
  private write(value: unknown): void {
    if (this.#closed || !this.#child.stdin.writable) throw new CodexFault('disconnected');
    const encoded = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(encoded) > 262144 || this.#child.stdin.writableLength > 262144) throw new CodexFault('frame_limit');
    this.#child.stdin.write(encoded, error => { if (error) this.fail('write_failed'); });
  }
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new CodexFault('cancelled'));
    if (this.#pending.size >= 32) return Promise.reject(new CodexFault('pending_limit'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const rejectPending = (code: string) => { const p = this.#pending.get(id); if (!p) return; this.#pending.delete(id); p.dispose(); reject(new CodexFault(code, 'unknown')); };
      const cancel = () => rejectPending('cancelled'); const timer = setTimeout(() => rejectPending('timeout'), 5000);
      this.#pending.set(id, { resolve, reject, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } });
      signal?.addEventListener('abort', cancel, { once: true });
      try { this.write({ id, method, params }); }
      catch (error) { const p = this.#pending.get(id); this.#pending.delete(id); p?.dispose(); reject(error); }
    });
  }
  notify(method: string, params?: unknown): void { this.write({ method, ...(params === undefined ? {} : { params }) }); }
  respond(id: string | number, result: unknown): void { this.write({ id, result }); }
  private receive(chunk: Buffer): void {
    if (this.#closed) return;
    try {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start); const stop = end < 0 ? chunk.length : end;
        // Native thread metadata can legitimately include large previews. Keep
        // this finite and separate from the 64 KiB normalized plugin boundary.
        if (this.#frame.length + stop - start > 4 * 1024 * 1024) throw new Error();
        this.#frame = Buffer.concat([this.#frame, chunk.subarray(start, stop)]); start = stop + (end < 0 ? 0 : 1);
        if (end < 0) break;
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.#frame)); this.#frame = Buffer.alloc(0);
        if (!record(value)) throw new Error();
        if (Date.now() - this.#window >= 1000) { this.#window = Date.now(); this.#count = 0; }
        if (++this.#count > 1000) throw new Error();
        // Server request IDs are in the opposite direction's namespace, even when numeric.
        if (typeof value.method === 'string') {
          if ('id' in value) {
            if (!(typeof value.id === 'string' && value.id.length <= 256 || Number.isSafeInteger(value.id))) throw new Error();
            this.emit('request', value);
          } else this.emit('notification', value);
        } else {
          if (!Number.isSafeInteger(value.id) || ('result' in value) === ('error' in value)) throw new Error();
          const pending = this.#pending.get(value.id); if (!pending) continue;
          this.#pending.delete(value.id); pending.dispose();
          if ('error' in value) pending.reject(new CodexFault('provider_rejected', 'unknown')); else pending.resolve(value.result);
        }
      }
    } catch { this.fail('protocol_failed'); }
  }
  private fail(code: string): void {
    if (this.#closed) return; this.#closed = true; this.#frame = Buffer.alloc(0);
    for (const p of this.#pending.values()) { p.dispose(); p.reject(new CodexFault(code, 'unknown')); } this.#pending.clear();
    if (code !== 'stopped') this.#child.kill(); this.emit('fault', new CodexFault(code, 'unknown'));
  }
  async stop(): Promise<void> {
    const child = this.#child;
    if (child.exitCode !== null || child.signalCode !== null) { this.fail('stopped'); return; }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 500);
      child.once('close', () => { clearTimeout(timer); resolve(); }); this.fail('stopped'); child.stdin.end();
    });
  }
}
