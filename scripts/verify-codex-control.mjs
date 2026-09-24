// Explicit opt-in real-account verification. Never selects or commands a pre-existing task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { connectCodexPlugin } from '../apps/supervisor/codex-plugin.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
const [selectedExecutable,sha256,selectedHome]=process.argv.slice(2);
const executable=selectedExecutable?fs.realpathSync(selectedExecutable):'';const codexHome=selectedHome?fs.realpathSync(selectedHome):'';
if(!path.isAbsolute(executable??'')||!/^[a-f0-9]{64}$/.test(sha256??'')||!path.isAbsolute(codexHome??''))throw new Error('Provide reviewed executable, SHA-256 and explicitly selected existing CODEX_HOME');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-real-control-'));const project=path.join(directory,'project');fs.mkdirSync(project);
let runtime;let deadline;
try{
  runtime=await startLocalRuntime({dataDir:path.join(directory,'state'),createHarnessAdapters:async({hostId})=>[await connectCodexPlugin({hostId,instanceId:'verification',launch:{executable,sha256,version:'0.153.4',codexHome,workingDirectory:project}})]});
  const client=new LocalClient(runtime.origin);let models;
  try { ({models}=await client.models('snowball.codex','verification')); }
  catch { await runtime.sessions.listModels('snowball.codex','verification'); throw new Error('Catalog API failed'); }
  const model=models.find(m=>m.efforts.includes('low'))??models[0];if(!model)throw new Error('No model catalog');
  const effort=model.efforts.includes('low')?'low':model.efforts[0];
  // Ephemeral native session prevents persisting a test task into the user's history.
  const created=await runtime.sessions.createSession('snowball.codex',project,{title:'Snowball native verification',ephemeral:true,model:model.model});
  let resolveComplete;const completed=new Promise(resolve=>{resolveComplete=resolve;});
  runtime.sessions.on('sessionEvent',event=>{if(event.sessionKey===created.sessionKey&&event.kind==='turn/completed')resolveComplete(event);});
  const session=runtime.journal.session(created.sessionKey);
  const commandId='verify-native-model-effort';
  await client.submit({commandId,sessionKey:created.sessionKey,ownerId:created.ownerId,expectedRevision:session.revision,operation:'sessions.send',payload:{text:'Reply with exactly SNOWBALL_NATIVE_OK. Do not use tools or inspect files.',model:model.model,...(effort?{effort}:{})}});
  let timedOut=false;
  await Promise.race([completed,new Promise(resolve=>{deadline=setTimeout(()=>{timedOut=true;resolve();},60000);})]);
  clearTimeout(deadline);
  const command=await client.command(commandId);const messages=(await client.snapshot()).sessionMessages?.[created.sessionKey]??[];
  const marker=messages.some(m=>m.text.includes('SNOWBALL_NATIVE_OK'));
  if(timedOut){const active=runtime.sessions.getSession(created.sessionKey)?.activeTurnId;if(active)await runtime.sessions.interruptTurn('ctl_'+'f'.repeat(16),created.sessionKey,active).catch(()=>{});}
  console.log(JSON.stringify({platform:process.platform,version:'0.153.4',catalogCount:models.length,selectedModel:model.model,selectedEffort:effort??null,commandStatus:command.status,commandReason:command.reason??null,nativeTurnCompleted:!timedOut,responseMarkerReceived:marker,ephemeral:true,preexistingTaskCommanded:false}));
  if(timedOut||!marker||!['acknowledged','completed'].includes(command.status))process.exitCode=1;
}finally{clearTimeout(deadline);await runtime?.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
