// Read-only native verification. Does not attach or command any existing task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectCodexSelection, appendCodexConnection, loadCodexConnections, removeCodexConnection } from '../apps/desktop/codex-connections.mjs';
import { connectCodexPlugin, connectCodexPlugins } from '../apps/supervisor/codex-plugin.mjs';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';

const [executable,codexHome,workingDirectory]=process.argv.slice(2);
if(![executable,codexHome,workingDirectory].every(value=>value&&path.isAbsolute(value)))throw new Error('Provide selected absolute executable, Codex home and working directory');
const launch=await inspectCodexSelection({executable,codexHome,workingDirectory});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-native-enroll-'));
const dataDir=path.join(temporary,'state');let runtime,binding;
try {
  runtime=await startLocalRuntime({dataDir});
  const first=new LocalClient(runtime.origin);const before=await first.snapshot();
  binding=await connectCodexPlugin({hostId:runtime.sessions.hostId,launch,instanceId:'verification'});
  await runtime.addHarnessAdapter(binding.pluginId,binding.adapter);
  appendCodexConnection(dataDir,loadCodexConnections(dataDir),launch,'verification');
  await runtime.sessions.listSessions(binding.pluginId);
  const after=await first.snapshot();
  if(after.connectedHarnesses.length!==1||after.connectedHarnesses[0].connected!==true||after.cursor===before.cursor||after.sessionDetails.some(s=>s.ownerId||!s.readOnly))throw new Error('Live enrollment did not preserve read-only discovery');
  await runtime.close();runtime=undefined;binding=undefined;
  const saved=loadCodexConnections(dataDir);
  runtime=await startLocalRuntime({dataDir,createHarnessAdapters:({hostId})=>connectCodexPlugins({hostId,config:saved})});
  const restored=await new LocalClient(runtime.origin).snapshot();
  if(restored.connectedHarnesses.length!==1||restored.connectedHarnesses[0].instanceId!=='verification'||restored.sessionDetails.some(s=>s.ownerId||!s.readOnly))throw new Error('Saved connection did not restore safely');
  removeCodexConnection(dataDir,'verification');
  await runtime.sessions.removeAdapter('snowball.codex','verification');
  const removed=await new LocalClient(runtime.origin).snapshot();
  if(removed.connectedHarnesses.length||removed.sessionDetails.some(s=>s.ownerId||!s.readOnly)||loadCodexConnections(dataDir).connections.length)throw new Error('Removal retained an owner or saved connection');
  console.log(JSON.stringify({platform:process.platform,version:launch.version,selectedHashLength:launch.sha256.length,dynamicEnrollment:true,restoredConnection:true,disconnectedReadOnly:true,observedSessions:restored.sessionDetails.length,existingTaskCommanded:false}));
} finally {
  await runtime?.close().catch(()=>{});if(binding)await binding.adapter.stop().catch(()=>{});
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
