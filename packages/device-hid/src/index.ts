import { createHash, randomBytes } from 'node:crypto';
import type { HidBackend, HidDescriptor, HidHandle } from './backend.js';
export { loadNativeBackend, type HidBackend, type HidDescriptor, type HidHandle } from './backend.js';

export class HidFault extends Error { constructor(readonly code: string) { super(code); } }
function check(condition: unknown, code: string): asserts condition { if (!condition) throw new HidFault(code); }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const token = () => randomBytes(16).toString('hex');
export interface HidProfile {
  id: string; vendorId: number; productId: number;
  /** Exact OS-specific top-level collection selector, including firmware release. */
  selectors: { platform: 'win32' | 'darwin'; interface: number; usagePage: number; usage: number; release: number }[];
  report: { length: number; reportId: number; buttons: { id: string; offset: number; mask: number }[] };
  identificationButton: string;
}
export interface HidCandidate {
  candidateId: string; generation: number; profileId: string; label: string;
  vendorId: number; productId: number; usagePage: number; usage: number;
  interface: number; release: number;
  identity: 'physical_confirmation_required'; reason: 'missing_serial' | 'duplicate_serial' | 'unverified_serial';
}
interface Located { public: HidCandidate; descriptor: HidDescriptor; profile: HidProfile }
export type ScanResult = { generation: number; status: 'complete' | 'partial' | 'cancelled'; candidates: HidCandidate[]; issues: string[] };
export type SafeInput = { testId: string; kind: 'button'; button: string; pressed: boolean; sequence: number };
function profile(raw: HidProfile): HidProfile {
  check(/^[a-z][a-z0-9.-]{1,100}$/.test(raw.id), 'invalid_profile');
  for (const n of [raw.vendorId, raw.productId]) check(Number.isInteger(n) && n > 0 && n <= 65535, 'invalid_profile');
  check(raw.selectors.length > 0 && raw.selectors.length <= 16, 'invalid_profile');
  for (const s of raw.selectors) {
    // Generic desktop keyboard/mouse, consumer control and standard typing pages are never opened.
    check(['win32', 'darwin'].includes(s.platform) && Number.isInteger(s.interface) && s.interface >= -1 && s.interface <= 255, 'invalid_profile');
    check(Number.isInteger(s.usagePage) && s.usagePage >= 0xff00 && s.usagePage <= 0xffff, 'unsafe_collection');
    check(Number.isInteger(s.usage) && s.usage > 0 && s.usage <= 65535 && Number.isInteger(s.release) && s.release >= 0 && s.release <= 65535, 'invalid_profile');
  }
  const r = raw.report;
  check(Number.isInteger(r.length) && r.length >= 2 && r.length <= 4096 && Number.isInteger(r.reportId) && r.reportId >= 1 && r.reportId <= 255, 'invalid_report');
  check(r.buttons.length > 0 && r.buttons.length <= 32 && new Set(r.buttons.map(b => b.id)).size === r.buttons.length, 'invalid_report');
  const used = new Map<number, number>();
  for (const b of r.buttons) {
    check(/^[a-z][a-z0-9-]{0,31}$/.test(b.id) && Number.isInteger(b.offset) && b.offset >= 1 && b.offset < r.length && [1,2,4,8,16,32,64,128].includes(b.mask), 'invalid_report');
    check(((used.get(b.offset) ?? 0) & b.mask) === 0, 'overlapping_report'); used.set(b.offset, (used.get(b.offset) ?? 0) | b.mask);
  }
  check(r.buttons.some(b => b.id === raw.identificationButton), 'invalid_profile'); return clone(raw);
}
const match = (p: HidProfile, d: HidDescriptor, platform: string) => d.vendorId === p.vendorId && d.productId === p.productId && p.selectors.some(s => s.platform === platform && s.interface === d.interface && s.usagePage === d.usagePage && s.usage === d.usage && s.release === d.release);
const same = (a: HidDescriptor, b: HidDescriptor) => ['path','vendorId','productId','release','interface','usagePage','usage','serialNumber'].every(k => a[k as keyof HidDescriptor] === b[k as keyof HidDescriptor]);
const errorCode = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  return ['EACCES','EPERM'].includes(code ?? '') ? 'needs_permission' : code === 'EBUSY' ? 'busy' : code === 'ENOENT' || code === 'ENODEV' ? 'offline' : error instanceof HidFault ? error.code : 'open_failed';
};

/** All profiles are trusted plugin code; never accept arbitrary profiles from Web clients. */
export class HidDiscovery {
  private readonly profiles: HidProfile[];
  private generation = 0;
  private readonly candidates = new Map<string, Located>();
  private scanAbort?: AbortController;
  private nativeBusy = false;
  private opening = false;
  private active?: HidSafeTest;
  private closed = false;
  constructor(private readonly backend: HidBackend, profiles: readonly HidProfile[], private readonly platform: string = process.platform, private readonly deadlineMs = 3000) {
    check(profiles.length <= 32 && Number.isSafeInteger(deadlineMs) && deadlineMs > 0, 'invalid_limits');
    this.profiles = profiles.map(profile); check(new Set(this.profiles.map(p => p.id)).size === this.profiles.length, 'duplicate_profile');
  }
  async scan(signal?: AbortSignal): Promise<ScanResult> {
    check(!this.closed, 'closed'); this.scanAbort?.abort(); const abort = new AbortController(); this.scanAbort = abort;
    const generation = ++this.generation; this.candidates.clear();
    if (this.active) await this.active.close('rescan');
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.deadlineMs); const issues: string[] = []; const found: Located[] = [];
    try {
      const pairs = [...new Map(this.profiles.filter(p => p.selectors.some(s => s.platform === this.platform)).map(p => [`${p.vendorId}:${p.productId}`, p])).values()];
      for (const p of pairs) {
        if (abort.signal.aborted) break;
        if (this.nativeBusy) { issues.push('native_busy'); break; }
        this.nativeBusy = true;
        const enumeration = this.backend.enumerate(p.vendorId, p.productId).finally(() => { this.nativeBusy = false; });
        const rows = await abortable(enumeration, abort.signal).catch(error => { issues.push(errorCode(error)); return []; });
        if (abort.signal.aborted || generation !== this.generation) break;
        if (rows.length > 256) { issues.push('candidate_limit'); continue; }
        for (const d of rows) {
          if (typeof d.path !== 'string' || d.path.length === 0 || d.path.length > 2048) continue;
          const matches = this.profiles.filter(p => match(p, d, this.platform));
          if (matches.length !== 1) { if (matches.length > 1) issues.push('ambiguous_profile'); continue; }
          if (found.some(c => c.descriptor.path === d.path)) { issues.push('ambiguous_locator'); continue; }
          if (found.length >= 100) { issues.push('candidate_limit'); break; }
          const profile = matches[0]!;
          const candidate: HidCandidate = { candidateId: token(), generation, profileId: profile.id, label: (d.product ?? profile.id).slice(0,128), vendorId: d.vendorId, productId: d.productId, usagePage: d.usagePage, usage: d.usage, interface: d.interface, release: d.release, identity: 'physical_confirmation_required', reason: d.serialNumber ? 'unverified_serial' : 'missing_serial' };
          found.push({ public: candidate, descriptor: clone(d), profile });
        }
      }
      if (abort.signal.aborted || generation !== this.generation) return { generation, status: 'cancelled', candidates: [], issues: [...new Set([...issues, 'cancelled_or_deadline'])] };
      for (const c of found) {
        if (c.descriptor.serialNumber && found.filter(x => x.descriptor.vendorId === c.descriptor.vendorId && x.descriptor.productId === c.descriptor.productId && x.descriptor.serialNumber === c.descriptor.serialNumber).length > 1) c.public.reason = 'duplicate_serial';
        this.candidates.set(c.public.candidateId, c);
      }
      return { generation, status: issues.length ? 'partial' : 'complete', candidates: found.map(c => clone(c.public)), issues: [...new Set(issues)] };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  /** Explicit selected-candidate safe test. It never sends a device report or harness command. */
  async beginSafeTest(candidateId: string, generation: number, signal?: AbortSignal): Promise<HidSafeTest> {
    check(!this.closed && !this.opening && !this.active?.isOpen, 'busy');
    const c = this.candidates.get(candidateId); check(c && generation === this.generation && c.public.generation === generation, 'stale_candidate');
    this.opening = true; const abort = new AbortController();
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.deadlineMs); let handle: HidHandle | undefined;
    try {
      check(!abort.signal.aborted, 'cancelled');
      check(!this.nativeBusy, 'native_busy'); this.nativeBusy = true;
      const enumeration = this.backend.enumerate(c.descriptor.vendorId, c.descriptor.productId).finally(() => { this.nativeBusy = false; });
      const rows = await abortable(enumeration, abort.signal);
      const current = rows.filter(d => d.path === c.descriptor.path);
      check(current.length === 1 && same(current[0]!, c.descriptor), 'stale_candidate');
      check(generation === this.generation && !this.closed, 'stale_candidate');
      this.nativeBusy = true;
      const opening = this.backend.open(c.descriptor.path).then(async h => {
        if (abort.signal.aborted || generation !== this.generation || this.closed) { await h.close(); throw new HidFault('cancelled'); }
        return h;
      }).finally(() => { this.nativeBusy = false; });
      handle = await abortable(opening, abort.signal);
      const actual = await abortable(handle.info(), abort.signal);
      check(same(actual, c.descriptor) && match(c.profile, actual, this.platform) && generation === this.generation && !this.closed && !abort.signal.aborted, 'stale_candidate');
      const test = new HidSafeTest(handle, c.profile, candidateId, signal); this.active = test; return test;
    } catch (error) { if (handle) await handle.close().catch(() => {}); throw new HidFault(errorCode(error)); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.opening = false; }
  }
  async close(): Promise<void> { this.closed = true; this.generation++; this.scanAbort?.abort(); this.candidates.clear(); await this.active?.close('closed'); }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new HidFault('cancelled'));
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class HidSafeTest {
  readonly testId = token();
  isOpen = true;
  private state: 'waiting_neutral' | 'waiting_press' | 'waiting_release' | 'identified' | 'closed' = 'waiting_neutral';
  private reason?: string;
  private events: SafeInput[] = [];
  private previous = new Set<string>();
  private sequence = 0;
  private reportWindow = Date.now(); private reports = 0;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly cancel = () => { void this.close('cancelled'); };
  constructor(private readonly handle: HidHandle, private readonly profile: HidProfile, readonly candidateId: string, private readonly signal?: AbortSignal) {
    this.timer = setTimeout(() => { void this.close('test_expired'); }, 30_000); this.timer.unref();
    signal?.addEventListener('abort', this.cancel, { once: true });
    handle.onError(() => { void this.close('offline_or_access_changed'); });
    if (this.isOpen) handle.onData(data => this.receive(data));
    if (signal?.aborted) this.cancel();
  }
  private receive(data: Buffer): void {
    if (!this.isOpen) return;
    if (Date.now() - this.reportWindow >= 1000) { this.reportWindow = Date.now(); this.reports = 0; }
    if (++this.reports > 1000) { void this.close('report_rate_limit'); return; }
    const r = this.profile.report;
    if (!Buffer.isBuffer(data) || data.length !== r.length || data[0] !== r.reportId) { void this.close('report_contract_mismatch'); return; }
    const pressed = new Set(r.buttons.filter(b => (data[b.offset]! & b.mask) !== 0).map(b => b.id));
    if (this.state === 'waiting_neutral' && pressed.size === 0) this.state = 'waiting_press';
    else if (this.state === 'waiting_press' && pressed.size === 1 && pressed.has(this.profile.identificationButton)) this.state = 'waiting_release';
    else if (this.state === 'waiting_release' && pressed.size === 0) this.state = 'identified';
    else if (this.state === 'waiting_release' && [...pressed].some(b => b !== this.profile.identificationButton)) this.state = 'waiting_neutral';
    for (const button of r.buttons) if (pressed.has(button.id) !== this.previous.has(button.id)) this.events.push({ testId: this.testId, kind: 'button', button: button.id, pressed: pressed.has(button.id), sequence: ++this.sequence });
    this.previous = pressed;
    if (this.events.length > 64) { this.events = []; void this.close('event_limit'); }
  }
  status(): { testId: string; candidateId: string; state: string; reason?: string } { return { testId: this.testId, candidateId: this.candidateId, state: this.state, ...(this.reason ? { reason: this.reason } : {}) }; }
  drain(): SafeInput[] { const events = this.events; this.events = []; return clone(events); }
  /** Volatile evidence only; never use as a durable hardware identity or network credential. */
  physicalEvidence(): { candidateId: string; testId: string; profileDigest: string } {
    check(this.isOpen && this.state === 'identified', 'physical_confirmation_required');
    return { candidateId: this.candidateId, testId: this.testId, profileDigest: createHash('sha256').update(JSON.stringify(this.profile)).digest('hex') };
  }
  async close(reason = 'closed'): Promise<void> {
    if (!this.isOpen) return; this.isOpen = false; this.state = 'closed'; this.reason = reason; this.events = [];
    clearTimeout(this.timer); this.signal?.removeEventListener('abort', this.cancel);
    await this.handle.close().catch(() => { this.reason = 'close_failed'; });
  }
}
