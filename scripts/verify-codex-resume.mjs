// Explicit real-account acceptance: creates and commands only its own verification task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';
import {connectCodexPlugin} from '../apps/supervisor/codex-plugin.mjs';
import {LocalClient} from '../packages/client-sdk/dist/index.js';
import {parseSessionKey} from '../packages/plugin-sdk/dist/index.js';
import {CodexStdio,CodexOwnedAdapter,codexLaunchDigest} from '../packages/harness-codex/dist/index.js';
const [selectedExecutable,sha256,selectedHome]=process.argv.slice(2);
if(!selectedExecutable||!selectedHome||!/^[a-f0-9]{64}$/.test(sha256??''))throw new Error('Explicit reviewed executable, hash and existing login home required');
const executable=fs.realpathSync(selectedExecutable),codexHome=fs.realpathSync(selectedHome);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-resume-verification-')),project=path.join(directory,'project');fs.mkdirSync(project);
const launch={executable,sha256,version:'0.153.4',codexHome,workingDirectory:project};
let runtime,created,hostId,archived=false;const events=[];
const start=()=>startLocalRuntime({dataDir:path.join(directory,'state'),chooseWorkspace:async()=>({root:project,displayName:'Isolated verification workspace'}),createHarnessAdapters:async binding=>{
 hostId=binding.hostId;return [await connectCodexPlugin({hostId,instanceId:'verification',launch})];
}});
const wait=async predicate=>{const end=Date.now()+60000;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Verification deadline');};
try{
 runtime=await start();let client=new LocalClient(runtime.origin);
 const {models}=await client.models('snowball.codex','verification');const model=models.find(m=>m.efforts.includes('low'));if(!model)throw new Error('No low-effort catalog model');
 const workspace=await client.selectWorkspace();
 created=await client.createSession({pluginId:'snowball.codex',instanceId:'verification',workspaceId:workspace.workspaceId,title:'Snowball isolated resume verification',model:model.model});
 // A first native turn materializes the rollout before the owned app-server exits.
 const submit=async(commandId,operation,payload)=>{
  const s=(await client.snapshot()).sessions.find(s=>s.sessionKey===created.sessionKey);
  if(!s)throw new Error('Own verification session missing');
  return client.submit({commandId,sessionKey:created.sessionKey,ownerId:s.ownerId,expectedRevision:s.revision,operation,payload});
 };
 await submit('verify-persist','sessions.send',{text:'Reply exactly SNOWBALL_PERSIST_OK. Do not use tools.',model:model.model,effort:'low'});
 await wait(async()=>{const c=await client.command('verify-persist');if(['failed','unknown'].includes(c.status))throw new Error('Initial turn '+c.status);return c.status==='completed';});
 const oldOwner=created.ownerId;
 await runtime.close();runtime=await start();client=new LocalClient(runtime.origin);
 runtime.sessions.on('sessionEvent',e=>{if(e.sessionKey===created.sessionKey)events.push(e);});
 const restored=runtime.sessions.getSession(created.sessionKey);
 if(!restored?.readOnly||restored.ownerId!==null)throw new Error('Persisted session must restore read-only before explicit attach');
 await client.attachSession(created.sessionKey);
 if(runtime.sessions.getSession(created.sessionKey).ownerId===oldOwner)throw new Error('Owner must change after process restart');
 await submit('verify-resumed','sessions.send',{text:'Reply exactly SNOWBALL_RESUME_OK. Do not use tools.',model:model.model,effort:'low'});
 await wait(async()=>{const c=await client.command('verify-resumed');if(['failed','unknown'].includes(c.status))throw new Error('Resumed turn '+c.status);return c.status==='completed';});
 const marker=(await client.snapshot()).sessionMessages[created.sessionKey]?.some(m=>m.text.includes('SNOWBALL_RESUME_OK'));
 if(!marker)throw new Error('Native resumed response absent');
 await submit('verify-long-turn','sessions.send',{text:'Write the integers from 1 through 2000, one integer per line. Do not use tools.',model:model.model,effort:'low'});
 const turn=await wait(async()=>{
  const command=await client.command('verify-long-turn');
  if(['failed','unknown','completed'].includes(command.status))throw new Error('Interrupt target no longer active: '+command.status);
  const session=runtime.sessions.getSession(created.sessionKey);return command.status==='acknowledged'&&session.activeTurnId;
 });
 await submit('verify-interrupt','sessions.interrupt',{turnId:turn});
 await wait(async()=>{const c=await client.command('verify-interrupt');if(['failed','unknown'].includes(c.status))throw new Error('Interrupt '+c.status);return c.status==='acknowledged';});
 await wait(()=>events.some(e=>e.turnId===turn&&e.kind==='turn/completed'&&e.outcome==='interrupted'));
 console.log(JSON.stringify({platform:process.platform,version:'0.153.4',httpWorkspaceCreation:true,restoredReadOnly:true,restartResume:true,ownerChanged:true,selectedModel:model.model,selectedEffort:'low',responseMarkerReceived:marker,journalCompleted:true,nativeInterruptConfirmed:true,preexistingTaskCommanded:false}));
}finally{
 if(runtime){const active=created&&runtime.sessions.getSession(created.sessionKey)?.activeTurnId;if(active)await runtime.sessions.interruptTurn('ctl_'+'f'.repeat(16),created.sessionKey,active).catch(()=>{});await runtime.close();}
 // Public archive RPC is cleanup-only and bound to the ID created above, never user history.
 if(created){let rpc;try{
  rpc=await CodexStdio.start(launch,codexLaunchDigest(launch));const adapter=new CodexOwnedAdapter(rpc,{hostId,instanceId:'cleanup',codexHome});await adapter.initialize();
  await rpc.request('thread/archive',{threadId:parseSessionKey(created.sessionKey).nativeSessionId});archived=true;
 }finally{await rpc?.stop();console.log(JSON.stringify({verificationTaskArchived:archived}));}}
 fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
