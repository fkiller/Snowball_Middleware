import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../../packages/plugin-host/dist/index.js';
import { codexManifest, codexLaunchDigest } from '../../packages/harness-codex/dist/index.js';

/** Trusted composition bridge. Plugins receive RPC data, never a core/journal reference. */
export async function connectCodexPlugin({ hostId, launch, instanceId = 'local' }) {
  const manifest = await codexManifest();
  const host = new PluginHost({ directory: fileURLToPath(new URL('../../packages/harness-codex', import.meta.url)), manifest, approvedDigests: new Map([[manifest.id, manifest.integrity.entrySha256]]), timeoutMs: 15000 });
  const adapter = new EventEmitter(); let state;
  host.on('event', e => {
    if (e.event === 'harness.offline' && state) state = {...state, connected:false};
    if (e.event === 'harness.authChanged' && state) state = {...state, auth:'unknown'};
    if (['harness.event', 'harness.decision', 'harness.decisionResolved', 'harness.ownerLost', 'harness.offline', 'harness.authChanged'].includes(e.event)) adapter.emit(e.event.slice(8), e.data);
  });
  host.on('fault', () => { if (state) state = { ...state, connected: false }; adapter.emit('offline'); });
  try {
    await host.start();
    state = await host.request('harness.connect', { launch, approvedDigest: codexLaunchDigest(launch), binding: { hostId, instanceId } });
    if (!state || typeof state.ownerId !== 'string' || state.instanceId !== instanceId) throw new Error('Invalid harness binding');
    Object.defineProperty(adapter, 'ownerId', { value: state.ownerId });
    adapter.status = () => structuredClone(state);
    adapter.listSessions = async () => { const sessions=await host.request('harness.list', {}); state=await host.request('harness.status', {}); return sessions; };
    adapter.listModels = () => host.request('harness.models', {});
    adapter.attachSession = threadId => host.request('harness.attach', { threadId });
    adapter.createSession = (root, options = {}) => host.request('harness.create', { root, ...options });
    adapter.execute = (envelope, signal) => host.request('harness.execute', { envelope }, signal);
    adapter.stop = () => host.stop();
    return { pluginId: manifest.id, adapter };
  } catch (error) { await host.stop(); throw error; }
}

/** Explicitly configured instances only; never infer an account or reuse the first match. */
export async function connectCodexPlugins({hostId,config}) {
  const entries=Array.isArray(config?.connections)?config.connections:[config];
  if(entries.length<1||entries.length>8)throw new Error('One to eight explicit Codex connections required');
  const ids=new Set();
  for(const entry of entries){
    const id=entry?.instanceId??'local';
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)||ids.has(id)||!entry?.launch)throw new Error('Invalid or duplicate Codex instance');
    ids.add(id);
  }
  const bindings=[];
  try{for(const entry of entries)bindings.push(await connectCodexPlugin({hostId,launch:entry.launch,instanceId:entry.instanceId??'local'}));return bindings;}
  catch(error){await Promise.allSettled(bindings.map(({adapter})=>adapter.stop()));throw error;}
}
