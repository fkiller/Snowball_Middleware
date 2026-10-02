import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startLocalRuntime } from '../supervisor/runtime.mjs';
import { connectCodexPlugin, connectCodexPlugins } from '../supervisor/codex-plugin.mjs';
import { connectOwnedOpenCode } from '../supervisor/opencode-owned.mjs';
import { appendCodexConnection, loadCodexConnections, removeCodexConnection, resetCodexConnections } from './codex-connections.mjs';
import { defaultDiscoveryProviders } from '../../packages/core/dist/index.js';
import { observeMk20UsbPresence } from './windows-device-presence.mjs';
import { Mk20LanPresence } from '../supervisor/mk20-lan.mjs';
const pending = new Map(); let nextId=0, runtime, started=false, stopping=false, enrolling=false, externallyConfigured=false, dataDir, savedConnectionWarning=false;
const send = value => process.parentPort.postMessage(value);
function nativeRequest(action, value) {
  if (pending.size >= 4) return Promise.reject(new Error('Native action busy'));
  const id=++nextId;
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native action timed out'));},['select-codex','confirm-disconnect-codex','confirm-reset-codex'].includes(action)?300000:60000);
    pending.set(id,{resolve,reject,timer});send({kind:'native',id,action,value});
  });
}
async function enrollCodex(signal) {
  if (!runtime || stopping || externallyConfigured) throw new Error('connection_unavailable');
  if (enrolling) throw new Error('connection_busy');
  enrolling=true;
  let binding;
  try {
    const launch=await nativeRequest('select-codex');
    if (!launch || signal?.aborted) throw new Error('selection_cancelled');
    const current=loadCodexConnections(dataDir);
    if (current.connections.length >= 8) throw new Error('connection_limit');
    if (current.connections.some(item => JSON.stringify(item.launch) === JSON.stringify(launch))) throw new Error('already_connected');
    const instanceId='local-'+randomBytes(6).toString('hex');
    binding=await connectCodexPlugin({hostId:runtime.sessions.hostId,launch,instanceId});
    if (signal?.aborted || stopping) throw new Error('selection_cancelled');
    await runtime.addHarnessAdapter(binding.pluginId,binding.adapter);
    try { appendCodexConnection(dataDir,current,launch,instanceId); }
    catch(error) { await runtime.sessions.removeAdapter(binding.pluginId,instanceId); throw error; }
    await runtime.sessions.listSessions(binding.pluginId);
    return instanceId;
  } catch(error) {
    if (binding && !runtime.sessions.getAdapter(binding.pluginId,binding.adapter.status().instanceId)) await binding.adapter.stop().catch(()=>{});
    throw error;
  } finally { enrolling=false; }
}
async function disconnectCodex(instanceId, signal) {
  if (!runtime || stopping || externallyConfigured) throw new Error('connection_unavailable');
  if (enrolling) throw new Error('connection_busy');
  enrolling=true;
  try {
    const confirmed=await nativeRequest('confirm-disconnect-codex',instanceId);
    if (!confirmed || signal?.aborted) throw new Error('selection_cancelled');
    removeCodexConnection(dataDir,instanceId);
    await runtime.sessions.removeAdapter('snowball.codex',instanceId);
    return instanceId;
  } finally { enrolling=false; }
}
async function resetCodex(signal) {
  if (!runtime || stopping || externallyConfigured) throw new Error('connection_unavailable');
  if (enrolling) throw new Error('connection_busy');
  enrolling=true;
  try {
    const confirmed=await nativeRequest('confirm-reset-codex');
    if (!confirmed || signal?.aborted) throw new Error('selection_cancelled');
    resetCodexConnections(dataDir);
    for(const item of runtime.sessions.snapshotAdapters().filter(item=>item.pluginId==='snowball.codex'))await runtime.sessions.removeAdapter(item.pluginId,item.instanceId);
    savedConnectionWarning=false;
    send({kind:'connection-warning',value:false});
    return true;
  } finally { enrolling=false; }
}
process.parentPort.on('message', async ({data}) => {
  if (data?.kind==='native-result') {
    const call=pending.get(data.id);if(!call)return;pending.delete(data.id);clearTimeout(call.timer);
    if(data.ok)call.resolve(data.value);else call.reject(new Error('Native action unavailable'));return;
  }
  if(data?.kind==='stop') { stopping=true; if(started&&!runtime)return; await runtime?.close();send({kind:'stopped'});process.exit(0); }
  if(data?.kind==='enroll-codex') {
    try { send({kind:'enrollment',ok:true,instanceId:await enrollCodex()}); }
    catch(error) { send({kind:'enrollment',ok:false,code:typeof error?.message==='string'&&['connection_unavailable','connection_busy','connection_limit','already_connected','selection_cancelled'].includes(error.message)?error.message:'connection_failed'}); }
    return;
  }
  if(data?.kind!=='start'||started)return;started=true;
  try {
    dataDir=data.dataDir;externallyConfigured=!!data.codexConfig;
    const options={dataDir,providers:defaultDiscoveryProviders(),mk20Lan:new Mk20LanPresence(dataDir),...(process.platform==='win32'?{devicePresence:observeMk20UsbPresence}:{}),desktop:{getAutostart:()=>nativeRequest('get-autostart'),setAutostart:enabled=>nativeRequest('set-autostart',enabled)},chooseWorkspace:()=>nativeRequest('choose-workspace'),...(externallyConfigured?{}:{connectCodex:signal=>enrollCodex(signal),disconnectCodex:(id,signal)=>disconnectCodex(id,signal),resetCodex:signal=>resetCodex(signal)})};
    let codexFactory;
    if(data.codexConfig) {
      if(!path.isAbsolute(data.codexConfig)||fs.statSync(data.codexConfig).size>16384)throw new Error('Invalid Codex configuration');
      const config=JSON.parse(fs.readFileSync(data.codexConfig,'utf8'));
      codexFactory=async({hostId})=>connectCodexPlugins({hostId,config});
    } else {
      let config;
      try { config=loadCodexConnections(dataDir); } catch { savedConnectionWarning=true; }
      if(config?.connections.length)codexFactory=async({hostId})=>{
        const bindings=[];
        for(const item of config.connections){
          try { bindings.push(await connectCodexPlugin({hostId,launch:item.launch,instanceId:item.instanceId})); }
          catch { savedConnectionWarning=true; }
        }
        return bindings;
      };
    }
    let opencodeConfig;
    if(data.opencodeConfig){
      if(!path.isAbsolute(data.opencodeConfig)||fs.statSync(data.opencodeConfig).size>4096)throw new Error('Invalid OpenCode observer configuration');
      opencodeConfig=JSON.parse(fs.readFileSync(data.opencodeConfig,'utf8'));
      if(!opencodeConfig||Object.keys(opencodeConfig).some(key=>!['instanceId','executable','sha256'].includes(key)))throw new Error('Invalid OpenCode observer configuration');
    }
    if(codexFactory||opencodeConfig)options.createHarnessAdapters=async({hostId})=>{
      const bindings=[];
      try{
        if(codexFactory)bindings.push(...await codexFactory({hostId}));
        if(opencodeConfig)bindings.push(await connectOwnedOpenCode({...opencodeConfig,hostId,dataDir}));
        return bindings;
      }catch(error){await Promise.allSettled(bindings.map(({adapter})=>adapter.stop()));throw error;}
    };
    runtime=await startLocalRuntime(options);if(stopping){await runtime.close();send({kind:'stopped'});process.exit(0);}send({kind:'ready',origin:runtime.origin,savedConnectionWarning});
  } catch (error) { send({kind:'failed',code:'local_runtime_start_failed',...(data.smoke?{detail:String(error.message).slice(0,300)}:{})}); process.exitCode=1; }
});
