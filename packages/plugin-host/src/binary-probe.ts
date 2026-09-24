import { spawn } from 'node:child_process';
import { realpath, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface BinaryProbeSpec {
  id: string;
  executable: { path: string; sha256: string };
  /** Fixed reviewed argv only. Selecting a candidate never constructs these automatically. */
  args: string[];
  /** Script/config artifacts used by fixed argv must also be reviewed and pinned. */
  artifacts: { path: string; sha256: string }[];
  /** Exact bounded stdout text -> tested version; unknown output is unsupported. */
  versions: Record<string, string>;
}
export interface BinaryProbeResult {
  status: 'supported' | 'unsupported' | 'untrusted' | 'changed' | 'needs_permission' | 'missing' | 'timeout' | 'cancelled' | 'output_limit' | 'failed' | 'busy';
  version: string | null;
  presence: 'installed' | 'unknown';
  controllable: false;
}
class Fault extends Error { constructor(readonly status: BinaryProbeResult['status']) { super(status); } }
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const fileValid = (v: BinaryProbeSpec['executable']) => v && typeof v.path === 'string' && v.path.length <= 4096 && path.isAbsolute(v.path) && !/[\x00-\x1f]/.test(v.path) && /^[a-f0-9]{64}$/.test(v.sha256);
function specCopy(spec: BinaryProbeSpec): BinaryProbeSpec {
  if (!spec || typeof spec.id !== 'string' || !/^[a-z][a-z0-9.-]{1,127}$/.test(spec.id) || !fileValid(spec.executable) || /\.(cmd|bat|ps1)$/i.test(spec.executable.path) || !Array.isArray(spec.args) || spec.args.length > 32 || spec.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\x00\r\n]/.test(arg)) || !Array.isArray(spec.artifacts) || spec.artifacts.length > 16 || spec.artifacts.some(a => !fileValid(a)) || !spec.versions || typeof spec.versions !== 'object' || Array.isArray(spec.versions) || Object.keys(spec.versions).length < 1 || Object.keys(spec.versions).length > 128 || Object.entries(spec.versions).some(([output, version]) => output.length > 256 || typeof version !== 'string' || !/^[0-9][A-Za-z0-9.+-]{0,63}$/.test(version))) throw new Fault('untrusted');
  return { id: spec.id, executable: { ...spec.executable }, args: [...spec.args], artifacts: spec.artifacts.map(a => ({ ...a })), versions: Object.fromEntries(Object.entries(spec.versions).sort(([a], [b]) => a.localeCompare(b))) };
}
/** Used by the trusted review/approval UI; never auto-added to approval storage. */
export function binaryProbeDigest(spec: BinaryProbeSpec): string { return hash(JSON.stringify(specCopy(spec))); }
let active = 0;
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new Fault(signal.reason === 'deadline' ? 'timeout' : 'cancelled'); };
async function verify(file: BinaryProbeSpec['executable'], signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  const canonical = await realpath(file.path); checkAbort(signal);
  if (canonical !== path.normalize(file.path)) throw new Fault('changed');
  const handle = await open(canonical, 'r');
  try {
    const info = await handle.stat(); checkAbort(signal);
    if (!info.isFile() || info.size > 512 * 1024 * 1024) throw new Fault('changed');
    const digest = createHash('sha256'); const chunk = Buffer.alloc(65536); let count = 0;
    for (;;) {
      checkAbort(signal); const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      count += bytesRead; if (count > 512 * 1024 * 1024) throw new Fault('changed');
      digest.update(chunk.subarray(0, bytesRead));
    }
    if (digest.digest('hex') !== file.sha256 || await realpath(file.path) !== canonical) throw new Fault('changed');
    checkAbort(signal);
  } finally { await handle.close(); }
}
async function execute(spec: BinaryProbeSpec, signal: AbortSignal): Promise<BinaryProbeResult> {
  for (const file of [spec.executable, ...spec.artifacts]) await verify(file, signal);
  checkAbort(signal);
  return new Promise(resolve => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) if (process.env[key]) env[key] = process.env[key];
    // No shell, PATH lookup, inherited NODE_OPTIONS, provider tokens or auto-login environment.
    const child = spawn(spec.executable.path, spec.args, { cwd: path.dirname(spec.executable.path), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let size = 0; const chunks: Buffer[] = []; let failure: BinaryProbeResult['status'] | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (status: BinaryProbeResult['status']) => {
      failure ??= status; child.kill();
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 250);
    };
    const cancel = () => stop(signal.reason === 'deadline' ? 'timeout' : 'cancelled');
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    const collect = (chunk: Buffer, stdout: boolean) => {
      size += chunk.length;
      if (size > 65536) return stop('output_limit');
      if (stdout && !failure) chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
    child.on('error', (error: NodeJS.ErrnoException) => { failure = ['EACCES', 'EPERM'].includes(error.code ?? '') ? 'needs_permission' : error.code === 'ENOENT' ? 'missing' : 'failed'; });
    child.on('close', code => {
      if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', cancel);
      let version: string | null = null;
      if (!failure && code === 0) {
        try { const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).trim(); if (Object.hasOwn(spec.versions, output)) version = spec.versions[output]!; }
        catch { failure = 'failed'; }
      }
      resolve({ status: failure ?? (code !== 0 ? 'failed' : version ? 'supported' : 'unsupported'), version, presence: 'installed', controllable: false });
    });
  });
}

/** Explicit reviewed process probe under the same digest-approval trust model as PluginHost. */
export async function runBinaryProbe(spec: BinaryProbeSpec, approvedDigests: ReadonlyMap<string, string>, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BinaryProbeResult> {
  const result = (status: BinaryProbeResult['status']): BinaryProbeResult => ({ status, version: null, presence: 'unknown', controllable: false });
  let selected: BinaryProbeSpec;
  try { selected = specCopy(spec); if (approvedDigests.get(selected.id) !== binaryProbeDigest(selected)) return result('untrusted'); }
  catch { return result('untrusted'); }
  const timeout = options.timeoutMs ?? 3000;
  // Explicit, reviewed probes may need longer to hash large executables on a
  // busy disk. The normal three-second discovery default remains unchanged.
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 12000) return result('untrusted');
  if (options.signal?.aborted) return result('cancelled');
  if (active >= 4) return result('busy');
  active++;
  const abort = new AbortController(); const cancel = () => abort.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => abort.abort('deadline'), timeout);
  const stopped = new Promise<BinaryProbeResult>(resolve => abort.signal.addEventListener('abort', () => resolve(result(abort.signal.reason === 'deadline' ? 'timeout' : 'cancelled')), { once: true }));
  const work = execute(selected, abort.signal).catch(error => {
    if (error instanceof Fault) return result(error.status);
    const code = (error as NodeJS.ErrnoException)?.code;
    return result(code === 'ENOENT' ? 'missing' : ['EACCES', 'EPERM'].includes(code ?? '') ? 'needs_permission' : 'failed');
  }).finally(() => { active--; });
  try { return await Promise.race([work, stopped]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}

/** Per-selection generation guard for UI/runtime callers. Re-selection uses a new instance. */
export class BinaryHarnessProbe {
  readonly #spec: BinaryProbeSpec;
  readonly #approved: ReadonlyMap<string, string>;
  #generation = 0;
  #abort?: AbortController;
  #result?: BinaryProbeResult & { generation: number; observedAt: number };
  constructor(spec: BinaryProbeSpec, approvedDigests: ReadonlyMap<string, string>) {
    this.#spec = specCopy(spec); this.#approved = new Map(approvedDigests);
  }
  snapshot(): (BinaryProbeResult & { generation: number; observedAt: number }) | undefined { return this.#result && structuredClone(this.#result); }
  cancel(): void { this.#abort?.abort(); }
  async probe(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BinaryProbeResult & { generation: number; observedAt: number }> {
    this.#abort?.abort(); const abort = new AbortController(); this.#abort = abort; const generation = ++this.#generation;
    const cancel = () => abort.abort(); options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) cancel();
    try {
      const result = { ...await runBinaryProbe(this.#spec, this.#approved, { ...options, signal: abort.signal }), generation, observedAt: Date.now() };
      if (generation === this.#generation) this.#result = result;
      return structuredClone(result);
    } finally { options.signal?.removeEventListener('abort', cancel); if (generation === this.#generation) this.#abort = undefined; }
  }
}
