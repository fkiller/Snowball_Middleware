// Opt-in real approval observation. Creates only an ephemeral task in a private project.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';import {connectCodexPlugin} from '../apps/supervisor/codex-plugin.mjs';import {LocalClient} from '../packages/client-sdk/dist/index.js';
const [selectedExecutable,sha256,selectedHome,mode]=process.argv.slice(2);
if(!selectedExecutable||!selectedHome||!/^[a-f0-9]{64}$/.test(sha256??''))throw new Error('Explicit reviewed executable, hash and existing login home required');
if(mode!==undefined&&mode!=='--accept-temp-file')throw new Error('Unsupported approval verification mode');
const executable=fs.realpathSync(selectedExecutable),codexHome=fs.realpathSync(selectedHome);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-approval-verification-')),project=path.join(directory,'project');fs.mkdirSync(project);
let runtime,session;
try{
 runtime=await startLocalRuntime({dataDir:path.join(directory,'state'),createHarnessAdapters:async({hostId})=>[await connectCodexPlugin({hostId,instanceId:'verification',launch:{executable,sha256,version:'0.153.4',codexHome,workingDirectory:project}})]});
 const client=new LocalClient(runtime.origin);session=await runtime.sessions.createSession('snowball.codex',project,{ephemeral:true},'verification');
 const pending=[];runtime.sessions.on('decisionRequired',value=>{if(value.sessionKey===session.sessionKey)pending.push(value);});
 const events=[];runtime.sessions.on('sessionEvent',value=>{if(value.sessionKey===session.sessionKey&&value.kind==='turn/completed')events.push(value);});
 const initial=runtime.journal.session(session.sessionKey);
 await client.submit({commandId:'approval-probe-'+randomUUID(),sessionKey:session.sessionKey,ownerId:session.ownerId,expectedRevision:initial.revision,operation:'sessions.send',payload:{text:'In the current working directory, use a shell or patch tool to create approval_probe.txt containing exactly PROBE. Do not use another directory. If the tool requires approval, request it and wait. Do not merely describe the action.'}});
 const wait=async predicate=>{const end=Date.now()+60000;while(Date.now()<end){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Native approval verification deadline');};
 const decision=await wait(()=>pending[0]||events[0]&&'no_approval');
 if(decision==='no_approval')throw new Error('Own verification turn completed without native approval request');
 const record=runtime.journal.decision(decision.decisionId);
 const answer=mode==='--accept-temp-file'?(record.allowedAnswers.includes('accept')?'accept':undefined):(record.allowedAnswers.includes('decline')?'decline':record.allowedAnswers.includes('cancel')?'cancel':undefined);
 if(!answer)throw new Error('Requested approval answer not offered by native provider');
 const commandId='approval-decline-'+randomUUID();
 await client.submit({commandId,sessionKey:session.sessionKey,ownerId:session.ownerId,expectedRevision:runtime.journal.session(session.sessionKey).revision,operation:'decisions.resolve',payload:{answer},decision:{decisionId:record.decisionId,expectedRevision:record.revision}});
 const observed=await wait(()=>{const d=runtime.journal.decision(record.decisionId),c=runtime.journal.command(commandId);return d?.status==='resolved'&&c&&c.status!=='queued'&&c.status!=='dispatched'&&{decision:d,command:c};});
 const file=path.join(project,'approval_probe.txt');
 const effectObserved=mode==='--accept-temp-file'?await wait(()=>events[0]&&fs.existsSync(file)&&fs.readFileSync(file,'utf8').trim()==='PROBE'&&true):false;
 console.log(JSON.stringify({platform:process.platform,ownEphemeralTask:true,nativeApprovalSeen:true,answerOffered:answer,clearedDecision:observed.decision.status,answerCommand:observed.command.status,effectObserved,exactAcceptanceProof:observed.command.status==='completed',preexistingTaskCommanded:false}));
 if(observed.command.status==='completed')throw new Error('Generic clearing must not prove exact answer acceptance');
}finally{if(runtime){const active=session&&runtime.sessions.getSession(session.sessionKey)?.activeTurnId;if(active)await runtime.sessions.interruptTurn('ctl_'+'f'.repeat(16),session.sessionKey,active).catch(()=>{});await runtime.close();}try{fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch{console.error('Private verification temp cleanup pending: '+directory);}}
