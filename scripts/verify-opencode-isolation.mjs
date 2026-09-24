// Opt-in real OpenCode storage isolation probe. Creates only a temporary local verification session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const selected = process.argv[2];
if (!selected || !path.isAbsolute(selected)) throw new Error('Absolute OpenCode executable required');
const executable = fs.realpathSync(selected);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-opencode-isolation-'));
const listener = net.createServer();
await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const password = randomBytes(32).toString('base64url');
const authorization = `Basic ${Buffer.from(`snowball-verification:${password}`).toString('base64')}`;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(directory, 'data'),
  XDG_CONFIG_HOME: path.join(directory, 'config'),
  XDG_CACHE_HOME: path.join(directory, 'cache'),
  XDG_STATE_HOME: path.join(directory, 'state'),
  OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_SERVER_USERNAME: 'snowball-verification',
};
const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: directory, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env,
});
child.stdout.resume(); child.stderr.resume();
const request = async (route, init = {}, timeoutMs = 5000) => {
  const response = await fetch(origin + route, {
    ...init,
    headers: { Authorization: authorization, 'Content-Type': 'application/json', ...init.headers },
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${route} returned ${response.status}`);
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error('OpenCode response too large');
  return body ? JSON.parse(body) : null;
};
try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error('Owned OpenCode server exited during startup');
    try { healthy = (await request('/global/health'))?.healthy === true; if (healthy) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!healthy) throw new Error('Owned OpenCode server not healthy');
  const providerCatalog = await request('/config/providers');
  const firstProvider = Array.isArray(providerCatalog?.providers) ? providerCatalog.providers[0] : undefined;
  const firstModel = firstProvider?.models && typeof firstProvider.models === 'object' ? Object.values(firstProvider.models)[0] : undefined;
  const initial = await request('/session');
  if (!Array.isArray(initial) || initial.length !== 0) throw new Error('XDG storage did not isolate pre-existing sessions; no mutation attempted');
  const created = await request('/session', { method: 'POST', body: JSON.stringify({ title: 'Snowball isolation verification' }) });
  if (typeof created?.id !== 'string' || !/^ses_[A-Za-z0-9]+$/.test(created.id)) throw new Error('OpenCode create returned no usable identity');
  const listed = await request('/session');
  const read = await request(`/session/${encodeURIComponent(created.id)}`);
  if (!Array.isArray(listed) || listed.length !== 1 || listed[0]?.id !== created.id || read?.id !== created.id) throw new Error('Owned session identity mismatch');
  let modelResult;
  if (process.env.SNOWBALL_TEST_OPENCODE_MODEL === '1') {
    const modelID = 'ling-3.0-flash-fin-free';
    const provider = providerCatalog.providers.find(item => item.id === 'opencode');
    if (!provider?.models?.[modelID]) throw new Error('Selected free verification model missing from live catalog');
    const reply = await request(`/session/${encodeURIComponent(created.id)}/message`, {
      method: 'POST', body: JSON.stringify({
        model: { providerID: 'opencode', modelID },
        tools: { bash: false, edit: false, write: false, read: false, glob: false, grep: false, webfetch: false, websearch: false },
        parts: [{ type: 'text', text: 'Reply with exactly SNOWBALL_OPENCODE_OK. Do not call tools.' }],
      }),
    }, 90000);
    const text = reply?.parts?.filter(part => part?.type === 'text').map(part => part.text).join('') ?? '';
    modelResult = { model: 'opencode/' + modelID, messageId: reply?.info?.id ?? null, exactMarker: text.trim() === 'SNOWBALL_OPENCODE_OK', partTypes: reply?.parts?.map(part => part.type) ?? [] };
    if (!modelResult.exactMarker || typeof modelResult.messageId !== 'string') throw new Error('Real OpenCode verification response did not match: ' + JSON.stringify({
      messageId: modelResult.messageId, partTypes: modelResult.partTypes, textLength: text.length,
      errorName: reply?.info?.error?.name ?? null, errorCode: reply?.info?.error?.data?.code ?? null,
      statusCode: reply?.info?.error?.data?.statusCode ?? null, errorDataKeys: Object.keys(reply?.info?.error?.data ?? {}),
      providerMessage: String(reply?.info?.error?.data?.message ?? '').slice(0,200),
    }));
  }
  await request(`/session/${encodeURIComponent(created.id)}/abort`, { method: 'POST', body: '{}' });
  console.log(JSON.stringify({ version: (await request('/global/health')).version, initialSessions: 0, createdSessionListedAndRead: true, abortAccepted: true, modelCommandSent: !!modelResult, existingTaskCommanded: false,
    ...(modelResult ? { modelResult } : {}), catalogShape: { providers: providerCatalog?.providers?.length ?? null, providerIds: providerCatalog?.providers?.map(p => p.id) ?? [], firstProviderKeys: firstProvider ? Object.keys(firstProvider) : [], firstModelKeys: firstModel ? Object.keys(firstModel) : [], firstModelVariantsType: firstModel?.variants === undefined ? 'absent' : Array.isArray(firstModel.variants) ? 'array' : typeof firstModel.variants } }));
} finally {
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
