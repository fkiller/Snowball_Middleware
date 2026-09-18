import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { randomBytes } from 'node:crypto';
import { LanFault, ensure, inScope, localInterfaces, MdnsProbe, type LocalInterface, type DiscoveryProbe, type DnsReply, type Question, type RecordAnswer } from './network.js';
export { LanFault, localInterfaces, inScope, MdnsProbe, type LocalInterface, type DiscoveryProbe, type DnsReply, type Question } from './network.js';
const SERVICE = '_snowball._tcp.local';
const clean = (name: unknown): string | undefined => typeof name === 'string' && name.length <= 253 && !/[\x00-\x20/\\@:#?]/.test(name) ? name.toLowerCase().replace(/\.$/, '') : undefined;
const hostName = (name: string): boolean => name.length <= 253 && name.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export interface LanCandidate {
  candidateId: string; generation: number; interface: LocalInterface; source: 'mdns' | 'manual';
  label: string; address: string; port: number; protocol: 'unverified' | 'snowball-v1-advertised';
  enrollment: 'unpaired'; control: false; observedAt: number; expiresAt: number;
}
export interface LanOptions {
  interfaces?: () => LocalInterface[];
  createProbe?: (selected: LocalInterface) => DiscoveryProbe;
  resolve?: (host: string) => Promise<string[]>;
  now?: () => number; timeoutMs?: number;
}
export class LanDiscovery {
  private selected?: LocalInterface;
  private generation = 0;
  private active?: AbortController;
  private probe?: DiscoveryProbe;
  private candidates: LanCandidate[] = [];
  private readonly inventory: () => LocalInterface[];
  private readonly createProbe: (selected: LocalInterface) => DiscoveryProbe;
  private readonly resolve: (host: string) => Promise<string[]>;
  private readonly now: () => number;
  private readonly timeout: number;
  private resolving = false;
  constructor(options: LanOptions = {}) {
    this.inventory = options.interfaces ?? localInterfaces;
    this.createProbe = options.createProbe ?? (selected => new MdnsProbe(selected.address));
    this.resolve = options.resolve ?? (async host => (await lookup(host, { family: 4, all: true })).map(a => a.address));
    this.now = options.now ?? Date.now; this.timeout = options.timeoutMs ?? 3000;
    ensure(Number.isInteger(this.timeout) && this.timeout > 0 && this.timeout <= 10000, 'invalid_timeout');
  }
  /** Pure inventory read; never enables an interface. VPNs are not chosen automatically. */
  interfaces(): LocalInterface[] { return this.inventory().map(copy); }
  get enabled(): boolean { return !!this.selected; }
  enable(selected: LocalInterface): void {
    ensure(this.inventory().some(i => i.name === selected.name && i.address === selected.address && i.netmask === selected.netmask) && inScope(selected.address, selected), 'interface_unavailable');
    this.disable(); this.selected = copy(selected);
  }
  disable(): void { this.generation++; this.active?.abort(); this.active = undefined; this.probe?.close(); this.probe = undefined; this.selected = undefined; this.candidates = []; }
  list(): LanCandidate[] { return this.candidates.filter(c => c.expiresAt > this.now()).map(copy); }
  private scope(): LocalInterface {
    ensure(this.selected, 'network_disabled');
    if (!this.inventory().some(i => i.name === this.selected!.name && i.address === this.selected!.address && i.netmask === this.selected!.netmask)) { this.disable(); throw new LanFault('interface_changed'); }
    return copy(this.selected);
  }
  private start(signal?: AbortSignal): { scope: LocalInterface; generation: number; abort: AbortController; dispose(): void } {
    const scope = this.scope(); this.active?.abort(); this.probe?.close(); this.probe = undefined;
    const generation = ++this.generation; const abort = new AbortController(); this.active = abort;
    const cancel = () => abort.abort(); if (signal?.aborted) cancel(); signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeout);
    return { scope, generation, abort, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
  }
  private candidate(scope: LocalInterface, generation: number, source: 'mdns' | 'manual', label: string, address: string, port: number, ttl = 60): LanCandidate {
    return { candidateId: randomBytes(16).toString('hex'), generation, interface: copy(scope), source, label, address, port, protocol: source === 'mdns' ? 'snowball-v1-advertised' : 'unverified', enrollment: 'unpaired', control: false, observedAt: this.now(), expiresAt: this.now() + Math.min(ttl,120) * 1000 };
  }
  async scan(signal?: AbortSignal): Promise<{ status: 'complete' | 'empty' | 'partial' | 'cancelled'; generation: number; candidates: LanCandidate[]; reason?: string }> {
    const run = this.start(signal); const issues = new Set<string>(); const found = new Map<string,LanCandidate>();
    // Records are bound to each responder; never assemble a fake service across unrelated senders.
    const cache = new Map<string,Map<string,RecordAnswer>>();
    let probe: DiscoveryProbe | undefined;
    try {
      if (run.abort.signal.aborted) throw new LanFault('cancelled');
      probe = this.createProbe(run.scope); this.probe = probe;
      let questions: Question[] = [{ name: SERVICE, type: 'PTR' }];
      for (let round = 0; round < 3 && questions.length; round++) {
        const replies = await bounded(probe.query(questions.slice(0,32), run.abort.signal), run.abort.signal);
        if (run.abort.signal.aborted || run.generation !== this.generation) throw new LanFault('cancelled');
        ensure(replies.length <= 100, 'response_limit');
        for (const reply of replies) {
          if (!inScope(reply.source, run.scope) || reply.records.length > 128) { issues.add('out_of_scope_response'); continue; }
          if (!cache.has(reply.source) && cache.size >= 100) { issues.add('response_limit'); continue; }
          const records = cache.get(reply.source) ?? new Map<string,RecordAnswer>(); cache.set(reply.source,records);
          for (const r of reply.records) {
            const name = clean(r.name);
            if (!name || !name.endsWith('.local') || !['PTR','SRV','TXT','A'].includes(r.type) || (r.class !== undefined && r.class !== 'IN') || !Number.isFinite(r.ttl) || Number(r.ttl) < 0) continue;
            const key = r.type === 'PTR' ? `PTR:${name}:${clean(r.data) ?? ''}` : `${r.type}:${name}`;
            if (r.ttl === 0) { records.delete(key); continue; }
            if (records.size < 256) records.set(key, { ...r, name });
          }
        }
        const next = new Map<string,Question>(); found.clear();
        for (const [source, records] of cache) {
          for (const pointer of [...records.values()].filter(r => r.type === 'PTR' && r.name === SERVICE)) {
          const instance = clean(pointer.data);
          if (!instance?.endsWith(`.${SERVICE}`) || instance === SERVICE) continue;
          const srv = records.get(`SRV:${instance}`); const txt = records.get(`TXT:${instance}`);
          for (const type of ['SRV','TXT'] as const) if (!records.has(`${type}:${instance}`)) next.set(`${type}:${instance}`, { name: instance, type });
          if (!srv || !txt) continue;
          const data = srv.data as { target?: unknown; port?: unknown }; const target = clean(data?.target);
          if (!target?.endsWith('.local') || !Number.isInteger(data?.port) || Number(data.port) < 1 || Number(data.port) > 65535) { issues.add('invalid_service'); continue; }
          const text = txt.data;
          if (!Array.isArray(text) || text.length > 16 || text.some(v => !Buffer.isBuffer(v) || v.length > 255) || text.filter(v => (v as Buffer).toString('utf8') === 'v=1').length !== 1) { issues.add('unsupported_advertisement'); continue; }
          const address = records.get(`A:${target}`);
          if (!address) { next.set(`A:${target}`, { name: target, type: 'A' }); continue; }
          if (address.data !== source || !inScope(source,run.scope)) { issues.add('address_mismatch'); continue; }
          const ttl = Math.min(Number(pointer!.ttl),Number(srv.ttl),Number(txt.ttl),Number(address.ttl),120);
          if (found.size < 100) found.set(`${source}:${data.port}`, this.candidate(run.scope,run.generation,'mdns',instance.slice(0,-SERVICE.length-1),source,Number(data.port),ttl));
          }
        }
        questions = [...next.values()];
        if (questions.length > 32) issues.add('question_limit');
      }
      this.scope(); // Interface changes never migrate the query to another NIC.
      ensure(run.generation === this.generation && !run.abort.signal.aborted, 'cancelled');
      this.candidates = [...found.values()];
      return { status: issues.size ? 'partial' : found.size ? 'complete' : 'empty', generation: run.generation, candidates: this.list(), ...(issues.size ? { reason: [...issues].sort().join(',') } : !found.size ? { reason: 'no_supported_reply_manual_address_available' } : {}) };
    } catch (error) {
      return { status: run.abort.signal.aborted || run.generation !== this.generation ? 'cancelled' : 'partial', generation: run.generation, candidates: [], reason: error instanceof LanFault ? error.code : 'network_unavailable' };
    } finally { probe?.close(); if (this.probe === probe) this.probe = undefined; run.dispose(); }
  }
  async manual(host: string, port: number, signal?: AbortSignal): Promise<LanCandidate> {
    const run = this.start(signal);
    try {
      ensure(typeof host === 'string' && (isIPv4(host) || hostName(host)) && Number.isInteger(port) && port > 0 && port <= 65535, 'invalid_endpoint');
      ensure(!run.abort.signal.aborted, 'cancelled');
      let addresses: string[];
      if (isIPv4(host)) addresses = [host];
      else {
        ensure(!this.resolving, 'resolver_busy'); this.resolving = true;
        addresses = await bounded(this.resolve(host).finally(() => { this.resolving = false; }), run.abort.signal);
      }
      ensure(addresses.length <= 32 && addresses.length > 0, 'name_unresolved');
      // Reject mixed public/private or multi-address ambiguity rather than silently choosing first.
      ensure(addresses.every(a => inScope(a,run.scope)), 'endpoint_outside_selected_network');
      const unique = [...new Set(addresses)]; ensure(unique.length === 1, 'ambiguous_address');
      this.scope(); ensure(run.generation === this.generation && !run.abort.signal.aborted, 'cancelled');
      const candidate = this.candidate(run.scope,run.generation,'manual',host,unique[0]!,port);
      this.candidates = [candidate]; return copy(candidate);
    } catch (error) { throw error instanceof LanFault ? error : new LanFault('name_unresolved'); }
    finally { run.dispose(); }
  }
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject) => {
    const abort = () => reject(new LanFault('cancelled'));
    if (signal.aborted) { promise.catch(()=>{}); abort(); return; }
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
