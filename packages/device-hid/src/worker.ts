import { HidDiscovery, HidFault, loadNativeBackend, type HidBackend, type HidSafeTest } from './index.js';
import { reviewedProfiles } from './profiles.js';

let native: HidBackend | undefined;
const backend = (): HidBackend => { try { return native ??= loadNativeBackend(); } catch { throw new HidFault('backend_unavailable'); } };
const discovery = new HidDiscovery({ enumerate: (v,p) => backend().enumerate(v,p), open: p => backend().open(p) }, reviewedProfiles);
let initialized = false; let frame = Buffer.alloc(0); let test: HidSafeTest | undefined;
const pending = new Map<number, AbortController>();
const send = (value: unknown) => {
  const text = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(text) > 65536 || !process.stdout.write(text)) process.exit(2);
};
async function request(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as { jsonrpc?: string; id?: number; method?: string; params?: Record<string, unknown> };
  if (r.jsonrpc !== '2.0') return;
  if (r.method === 'plugin.cancel') { pending.get(Number(r.params?.requestId))?.abort(); return; }
  if (!Number.isSafeInteger(r.id) || Number(r.id) < 1 || pending.has(r.id!)) return;
  const id = r.id!;
  if (pending.size >= 4) { send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'busy' } }); return; }
  const abort = new AbortController(); pending.set(id, abort);
  try {
    let result: unknown;
    if (r.method === 'plugin.initialize') {
      initialized = true; result = { apiVersion: '1.0.0', pluginId: 'snowball.hid' };
    } else {
      if (!initialized) throw new HidFault('not_initialized');
      switch (r.method) {
        case 'devices.scan': result = await discovery.scan(abort.signal); break;
        case 'devices.beginTest':
          test = await discovery.beginSafeTest(String(r.params?.candidateId), Number(r.params?.generation), abort.signal); result = test.status(); break;
        case 'devices.testStatus':
          if (!test || r.params?.testId !== test.testId) throw new HidFault('unknown_test');
          result = { ...test.status(), events: test.drain() }; break;
        case 'devices.stopTest':
          if (!test || r.params?.testId !== test.testId) throw new HidFault('unknown_test');
          await test.close(); result = test.status(); break;
        default: throw new HidFault('unsupported');
      }
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (error) { send({ jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof HidFault ? error.code : 'backend_failed' } }); }
  finally { pending.delete(id); }
}
process.stdin.on('data', (chunk: Buffer) => {
  for (const byte of chunk) {
    if (byte === 10) {
      try { void request(JSON.parse(frame.toString('utf8'))); } catch { process.exit(2); }
      frame = Buffer.alloc(0);
    } else {
      if (frame.length >= 4096) process.exit(2);
      frame = Buffer.concat([frame, Buffer.from([byte])]);
    }
  }
});
process.stdin.on('end', () => { for (const controller of pending.values()) controller.abort(); void discovery.close().finally(() => process.exit(0)); });
