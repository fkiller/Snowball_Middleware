import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export interface DiscoveryProvider {
  id: string;
  /** Explicit paths supplied by provider configuration, not recursively searched. */
  knownPaths: string[];
  commandNames: string[];
  overrides?: string[];
  /** Registered literal-loopback URLs only. Discovery does not connect. */
  endpoints?: string[];
}
export interface FileFact { canonicalPath: string; stamp: string; }
export interface DiscoveryIO { inspect(file: string): Promise<FileFact | null>; }
export const localDiscoveryIO: DiscoveryIO = {
  async inspect(file) {
    const canonicalPath = await realpath(file);
    const info = await stat(canonicalPath);
    if (!info.isFile()) return null;
    return { canonicalPath, stamp: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}` };
  },
};
export interface HarnessCandidate {
  id: string; providerId: string; kind: 'file' | 'endpoint'; locator: string;
  sources: ('override' | 'known' | 'path' | 'registered')[];
  aliases: string[]; stamp: string | null;
  version: null; connection: 'unprobed'; controllable: false;
}
export interface DiscoverySnapshot {
  generation: number; status: 'idle' | 'complete' | 'cancelled' | 'partial';
  stale: boolean; candidates: HarnessCandidate[];
  issues: { providerId: string; locator: string; reason: string }[];
}
const copy = <T>(v: T): T => structuredClone(v);
const validText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
class Stop extends Error {}

/** Candidate collection only; does not infer account, owner, version or execution permission. */
export class HarnessDiscovery {
  #generation = 0;
  #abort?: AbortController;
  #busy = false;
  #snapshot: DiscoverySnapshot = { generation: 0, status: 'idle', stale: false, candidates: [], issues: [] };
  constructor(private readonly io: DiscoveryIO = localDiscoveryIO) {}
  snapshot(): DiscoverySnapshot { return copy(this.#snapshot); }
  cancel(): void { this.#abort?.abort(); }
  async scan(providers: DiscoveryProvider[], options: { platform: 'win32' | 'darwin'; pathValue: string; deadlineMs?: number }): Promise<DiscoverySnapshot> {
    const deadline = options.deadlineMs ?? 2000;
    if (!['win32', 'darwin'].includes(options.platform) || !Number.isInteger(deadline) || deadline < 10 || deadline > 5000 || typeof options.pathValue !== 'string' || options.pathValue.length > 32768 || !Array.isArray(providers) || providers.length > 16) throw new Error('invalid_discovery_request');
    // Copy before any await: caller changes cannot redirect an active scan.
    const config = copy(providers);
    const paths = options.platform === 'win32' ? path.win32 : path.posix;
    const absolute = (v: unknown): v is string => validText(v) && paths.isAbsolute(v) && (options.platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(v));
    const ids = new Set<string>();
    for (const provider of config) {
      if (!provider || !validText(provider.id) || provider.id.length > 128 || ids.has(provider.id)) throw new Error('invalid_provider');
      ids.add(provider.id);
      for (const list of [provider.knownPaths, provider.commandNames, provider.overrides ?? [], provider.endpoints ?? []]) if (!Array.isArray(list) || list.length > 32 || list.some(v => !validText(v))) throw new Error('invalid_provider');
      if (provider.commandNames.some(v => /[\\/:]/.test(v) || v === '.' || v === '..')) throw new Error('invalid_command_name');
    }
    this.#abort?.abort();
    const abort = new AbortController(); this.#abort = abort;
    const generation = ++this.#generation;
    const previous = this.#snapshot.candidates;
    const candidates = new Map<string, HarnessCandidate>();
    const issues: DiscoverySnapshot['issues'] = [];
    let attempts = 0;
    const issue = (providerId: string, locator: string, reason: string) => { if (issues.length < 256) issues.push({ providerId, locator, reason }); };
    const dirs = [...new Set(options.pathValue.split(options.platform === 'win32' ? ';' : ':').filter(absolute))];
    if (dirs.length > 32) issue('', '', 'path_directory_limit');
    const timer = setTimeout(() => abort.abort('deadline'), deadline);
    const stopped = new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Stop()), { once: true }));
    // Avoid an unhandled rejection if cancellation arrives between filesystem calls.
    void stopped.catch(() => {});
    const add = (providerId: string, kind: HarnessCandidate['kind'], locator: string, alias: string, source: HarnessCandidate['sources'][number], stamp: string | null) => {
      if (kind === 'file') {
        const parsed = paths.parse(locator);
        for (const existing of candidates.values()) {
          if (existing.providerId === providerId && existing.kind === 'file') {
            const existingParsed = paths.parse(existing.locator);
            const sameDir = paths.normalize(existingParsed.dir).toLowerCase() === paths.normalize(parsed.dir).toLowerCase();
            const sameStem = existingParsed.name.toLowerCase() === parsed.name.toLowerCase();
            if (sameDir && sameStem) {
              if (!existing.sources.includes(source)) existing.sources.push(source);
              if (!existing.aliases.includes(locator)) existing.aliases.push(locator);
              if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
              return;
            }
          }
        }
      }
      if (kind === 'endpoint') {
        const existingFile = [...candidates.values()].find(c => c.providerId === providerId && c.kind === 'file');
        if (existingFile) {
          if (!existingFile.sources.includes('registered')) existingFile.sources.push('registered');
          if (!existingFile.aliases.includes(locator)) existingFile.aliases.push(locator);
          if (!existingFile.aliases.includes(alias)) existingFile.aliases.push(alias);
          return;
        }
      }
      if (kind === 'file') {
        const existingEndpointEntry = [...candidates.entries()].find(([_, c]) => c.providerId === providerId && c.kind === 'endpoint');
        if (existingEndpointEntry) {
          const [oldKey, oldCandidate] = existingEndpointEntry;
          candidates.delete(oldKey);
          const key = JSON.stringify([providerId, kind, locator]);
          const mergedAliases = [...new Set([alias, oldCandidate.locator, ...oldCandidate.aliases])];
          const mergedSources = [...new Set([source, ...oldCandidate.sources])];
          candidates.set(key, {
            id: createHash('sha256').update(key).digest('hex'),
            providerId,
            kind,
            locator,
            sources: mergedSources,
            aliases: mergedAliases,
            stamp,
            version: null,
            connection: 'unprobed',
            controllable: false,
          });
          return;
        }
      }
      const key = JSON.stringify([providerId, kind, locator]);
      const existing = candidates.get(key);
      if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); if (!existing.aliases.includes(alias)) existing.aliases.push(alias); return; }
      candidates.set(key, { id: createHash('sha256').update(key).digest('hex'), providerId, kind, locator, sources: [source], aliases: [alias], stamp, version: null, connection: 'unprobed', controllable: false });
    };
    try {
      for (const provider of config) {
        const requested: { locator: string; source: 'override' | 'known' | 'path' }[] = [
          ...(provider.overrides ?? []).map(locator => ({ locator, source: 'override' as const })),
          ...provider.knownPaths.map(locator => ({ locator, source: 'known' as const })),
          ...dirs.slice(0, 32).flatMap(dir => provider.commandNames.map(name => ({ locator: paths.join(dir, name), source: 'path' as const }))),
        ];
        const inspected = new Map<string, FileFact | null>();
        for (const item of requested) {
          if (abort.signal.aborted) throw new Stop();
          if (!absolute(item.locator)) { issue(provider.id, item.locator, 'absolute_local_path_required'); continue; }
          const normalized = paths.normalize(item.locator);
          let fact = inspected.get(normalized);
          if (!inspected.has(normalized)) {
            if (attempts++ >= 256) { issue(provider.id, '', 'inspection_limit'); break; }
            if (this.#busy) { issue(provider.id, normalized, 'filesystem_busy'); throw new Stop(); }
            this.#busy = true;
            const operation = Promise.resolve().then(() => this.io.inspect(normalized)).finally(() => { this.#busy = false; });
            try { fact = await Promise.race([operation, stopped]); }
            catch (error) {
              if (error instanceof Stop) throw error;
              const code = (error as NodeJS.ErrnoException)?.code;
              issue(provider.id, normalized, code === 'ENOENT' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : 'inspection_failed');
              fact = null;
            }
            inspected.set(normalized, fact ?? null);
          }
          if (generation !== this.#generation || abort.signal.aborted) throw new Stop();
          if (fact && absolute(fact.canonicalPath) && validText(fact.stamp)) add(provider.id, 'file', paths.normalize(fact.canonicalPath), normalized, item.source, fact.stamp);
          else if (item.source === 'override') issue(provider.id, normalized, 'file_unavailable');
        }
        for (const endpoint of provider.endpoints ?? []) {
          if (attempts++ >= 256) { issue(provider.id, '', 'inspection_limit'); break; }
          try {
            // Literal spelling checked before URL canonicalization (no alternate numeric IPs).
            if (!/^https?:\/\/(127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?(?:\/|$)/.test(endpoint)) throw new Error();
            const url = new URL(endpoint);
            if (url.username || url.password || url.search || url.hash) throw new Error();
            add(provider.id, 'endpoint', url.href, endpoint, 'registered', null);
          } catch { issue(provider.id, '[invalid endpoint]', 'literal_loopback_endpoint_required'); }
        }
      }
      if (generation !== this.#generation || abort.signal.aborted) throw new Stop();
      this.#snapshot = { generation, status: issues.some(i => i.reason.endsWith('_limit')) ? 'partial' : 'complete', stale: false, candidates: [...candidates.values()], issues };
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      if (generation === this.#generation) this.#snapshot = { generation, status: abort.signal.aborted && abort.signal.reason !== 'deadline' ? 'cancelled' : 'partial', stale: true, candidates: previous, issues: [...issues, { providerId: '', locator: '', reason: abort.signal.reason === 'deadline' ? 'deadline' : abort.signal.aborted ? 'cancelled' : 'filesystem_busy' }] };
    } finally { clearTimeout(timer); if (generation === this.#generation) this.#abort = undefined; }
    return this.snapshot();
  }
}

/** Default discovery providers for zero-config harness discovery on Windows and macOS. */
export function defaultDiscoveryProviders(platform: 'win32' | 'darwin' = (process.platform === 'win32' ? 'win32' : 'darwin')): DiscoveryProvider[] {
  const isWin = platform === 'win32';
  const localAppData = process.env.LOCALAPPDATA || '';
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const providers: DiscoveryProvider[] = [];

  // Codex
  const codexKnown: string[] = [];
  if (isWin && /^[A-Za-z]:[\\/]/.test(localAppData)) {
    codexKnown.push(path.win32.join(localAppData, 'Programs', 'Codex', 'codex.exe'));
  } else if (!isWin) {
    codexKnown.push('/Applications/Codex.app/Contents/MacOS/Codex');
  }
  providers.push({
    id: 'snowball.codex',
    commandNames: isWin ? ['codex.exe', 'codex.cmd'] : ['codex'],
    knownPaths: codexKnown,
  });

  // OpenCode
  providers.push({
    id: 'snowball.opencode',
    commandNames: isWin ? ['opencode.cmd', 'opencode.exe'] : ['opencode'],
    knownPaths: [],
    endpoints: ['http://127.0.0.1:4096'],
  });

  // Antigravity
  const agyKnown: string[] = [];
  if (isWin && /^[A-Za-z]:[\\/]/.test(localAppData)) {
    agyKnown.push(path.win32.join(localAppData, 'agy', 'bin', 'agy.exe'));
  } else if (!isWin) {
    if (home && path.posix.isAbsolute(home)) agyKnown.push(path.posix.join(home, '.agy', 'bin', 'agy'));
    agyKnown.push('/usr/local/bin/agy');
  }
  providers.push({
    id: 'snowball.antigravity',
    commandNames: isWin ? ['agy.exe', 'agy.cmd'] : ['agy'],
    knownPaths: agyKnown,
  });

  return providers;
}
