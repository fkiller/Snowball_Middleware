import { AntigravityObserverAdapter } from './index.js';
import { API_VERSION } from '@snowball/plugin-sdk';

let adapter: AntigravityObserverAdapter | undefined;
let initialized = false, closed = false, sequence = 0, frame = Buffer.alloc(0);
const pending = new Map<number, AbortController>();
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

const send = (value: unknown) => {
  if (closed) return;
  const text = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(text) > 65536 || process.stdout.writableLength > 262144) {
    void shutdown();
    return;
  }
  process.stdout.write(text);
};

const event = (name: string, data: unknown) =>
  send({ jsonrpc: '2.0', method: 'plugin.event', params: { sequence: ++sequence, event: `harness.${name}`, data } });

async function shutdown() {
  if (closed) return;
  closed = true;
  for (const abort of pending.values()) abort.abort();
  await adapter?.stop();
  process.stdin.pause();
  process.exitCode = 0;
}

async function handle(request: unknown) {
  if (!object(request)) return void shutdown();
  if (request.method === 'plugin.cancel' && object(request.params)) {
    pending.get(request.params.requestId)?.abort();
    return;
  }
  if (!Number.isSafeInteger(request.id) || request.id < 1 || typeof request.method !== 'string' || pending.has(request.id) || pending.size >= 16) {
    return void shutdown();
  }
  const abort = new AbortController();
  pending.set(request.id, abort);
  try {
    let result: unknown;
    if (request.method === 'plugin.initialize') {
      if (initialized || request.params?.apiVersion !== API_VERSION || request.params?.pluginId !== 'snowball.antigravity') {
        throw new Error();
      }
      initialized = true;
      adapter = new AntigravityObserverAdapter({
        hostId: request.params?.hostId || 'local-host',
        instanceId: request.params?.instanceId || 'default',
        brainDir: request.params?.brainDir,
      });
      await adapter.start();
      adapter.on('event', data => event('event', data));
      result = { apiVersion: API_VERSION, pluginId: 'snowball.antigravity' };
    } else {
      if (!initialized || !adapter) throw new Error();
      const p = request.params;
      if (request.method === 'harness.status') {
        result = adapter.status();
      } else if (request.method === 'harness.models') {
        result = await adapter.listModels();
      } else if (request.method === 'harness.list') {
        result = await adapter.listSessions(p?.limit);
      } else if (request.method === 'harness.read') {
        if (!p?.conversationId) throw new Error();
        result = await adapter.readSession(p.conversationId);
      } else if (request.method === 'harness.watch') {
        if (!p?.conversationId) throw new Error();
        adapter.watchSession(p.conversationId);
        result = { watching: true };
      } else if (request.method === 'harness.unwatch') {
        if (!p?.conversationId) throw new Error();
        adapter.unwatchSession(p.conversationId);
        result = { watching: false };
      } else {
        // Control operations (create, execute) are not supported for observe-only harness
        throw new Error('Unsupported operation');
      }
    }
    send({ jsonrpc: '2.0', id: request.id, result });
  } catch {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Antigravity operation unavailable' } });
  } finally {
    pending.delete(request.id);
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  let start = 0;
  while (!closed && start < chunk.length) {
    const end = chunk.indexOf(10, start);
    const stop = end < 0 ? chunk.length : end;
    if (frame.length + stop - start > 65536) { void shutdown(); return; }
    frame = Buffer.concat([frame, chunk.subarray(start, stop)]);
    start = stop + (end < 0 ? 0 : 1);
    if (end < 0) return;
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
      frame = Buffer.alloc(0);
      void handle(value);
    } catch {
      void shutdown();
    }
  }
});

process.stdin.on('end', () => { void shutdown(); });
process.stdin.on('error', () => { void shutdown(); });
process.stdout.on('error', () => { void shutdown(); });
