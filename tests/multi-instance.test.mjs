import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {CommandJournal,SessionService,SessionMetadataStore,formatSessionKey} from '../packages/core/dist/index.js';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';
import {LocalClient} from '../packages/client-sdk/dist/index.js';

const pluginId='test.multiple',hostId='host_'+'c'.repeat(32),actor='ctl_'+'a'.repeat(16);
function adapter(hostId,instanceId){
 const port=new EventEmitter();port.ownerId='owner-'+instanceId;port.calls=[];
 port.status=()=>({instanceId,connected:true,auth:'not_required'});
 port.createSession=async()=>{port.calls.push('create');return {ownerId:port.ownerId,sessionKey:formatSessionKey({hostId,harness:{pluginId,instanceId},nativeSessionId:'same-native-id'})};};
 port.listSessions=async()=>[];port.listModels=async()=>[{model:'model-'+instanceId,displayName:instanceId,efforts:['low'],defaultEffort:'low'}];
 port.execute=async({command})=>{port.calls.push(command.input.commandId);return {status:'acknowledged',correlationId:'turn-'+instanceId};};port.stop=async()=>{port.calls.push('stop');};return port;
}
test('same provider/native ID stays isolated by instance through dispatch, offline, disable and removal',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-multi-'));const journal=new CommandJournal({directory:dir,hostId});
 t.after(()=>{journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const service=new SessionService({hostId,journal}),a=adapter(hostId,'one'),b=adapter(hostId,'two');service.registerAdapter(pluginId,a);service.registerAdapter(pluginId,b);
 assert.equal(service.getAdapter(pluginId),undefined);assert.equal(service.snapshotAdapters().length,2);
 await assert.rejects(service.createSession(pluginId,dir),{code:'adapter_not_found'});assert.equal(a.calls.length+b.calls.length,0);
 const sa=await service.createSession(pluginId,dir,{},'one'),sb=await service.createSession(pluginId,dir,{},'two');assert.notEqual(sa.sessionKey,sb.sessionKey);
 a.emit('event',{sessionKey:sb.sessionKey,kind:'turn/started',turnId:'forged'});assert.equal(service.getSession(sb.sessionKey).status,'idle');
 const native={sessionKey:sb.sessionKey,ownerId:b.ownerId,nativeRequestId:0,nativeRevision:'native-rev'};
 b.emit('decision',{...native,allowedAnswers:['decline']});const decision=journal.listDecisions()[0];
 a.emit('decisionResolved',native);assert.equal(journal.decision(decision.decisionId).status,'pending');
 b.emit('decisionResolved',{...native,nativeRevision:'stale'});assert.equal(journal.decision(decision.decisionId).status,'pending');
 journal.enqueue({commandId:'queued-answer',actorId:actor,sessionKey:sb.sessionKey,ownerId:b.ownerId,expectedRevision:journal.session(sb.sessionKey).revision,operation:'decisions.resolve',payload:{answer:'decline'},decision:{decisionId:decision.decisionId,expectedRevision:decision.revision}});
 b.emit('decisionResolved',native);assert.equal(journal.decision(decision.decisionId).status,'resolved');assert.equal(journal.command('queued-answer').status,'cancelled');
 a.emit('offline');assert.equal(service.getSession(sa.sessionKey).status,'error');assert.equal(service.getSession(sb.sessionKey).status,'idle');
 service.disableAdapter(pluginId,'one');await assert.rejects(service.sendPrompt(actor,sa.sessionKey,'blocked'),{code:'harness_disabled'});
 const sent=await service.sendPrompt(actor,sb.sessionKey,'to two');await service.dispatchNext(sb.sessionKey);assert.ok(b.calls.includes(sent.commandId));assert.ok(!a.calls.includes(sent.commandId));
 await service.removeAdapter(pluginId,'one');assert.equal(service.getAdapter(pluginId,'two'),b);assert.equal(service.getSession(sb.sessionKey).ownerId,b.ownerId);assert.equal(b.calls.includes('stop'),false);
 assert.equal(a.listenerCount('event'),0);assert.equal(service.getSession(sa.sessionKey).readOnly,true);
});
test('HTTP creation and catalog select an explicit instance of the same plugin',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-multi-http-'));let a,b;
 const runtime=await startLocalRuntime({dataDir:path.join(dir,'state'),chooseWorkspace:async()=>({root:dir,displayName:'Test workspace'}),createHarnessAdapters:async({hostId})=>{a=adapter(hostId,'one');b=adapter(hostId,'two');return [{pluginId,adapter:a},{pluginId,adapter:b}];}});
 t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
 const client=new LocalClient(runtime.origin);assert.equal((await client.snapshot()).connectedHarnesses.length,2);
 assert.equal((await client.models(pluginId,'two')).models[0].model,'model-two');
 const workspace=await client.selectWorkspace();const created=await client.createSession({requestId:'33333333-3333-4333-8333-333333333333',pluginId,instanceId:'two',workspaceId:workspace.workspaceId});
 assert.ok(created.sessionKey.includes('/two/'));assert.equal(a.calls.length,0);assert.deepEqual(b.calls,['create']);
 await assert.rejects(client.createSession({requestId:'44444444-4444-4444-8444-444444444444',pluginId,instanceId:'missing',workspaceId:workspace.workspaceId}),e=>e.code==='create_unavailable');
});

test('uncertain create is never repeated; confirmed receipt restores without a new native create',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-create-intents-'));
 let next;
 t.after(async()=>{await next?.close();fs.rmSync(dir,{recursive:true,force:true});});
 let calls=0;
 const makeAdapter=hostId=>{
  const port=adapter(hostId,'one');
  port.createSession=async()=>{calls++;if(calls===1)return {ownerId:port.ownerId,sessionKey:formatSessionKey({hostId,harness:{pluginId,instanceId:'two'},nativeSessionId:'possibly-created-native-id'})};return {ownerId:port.ownerId,sessionKey:formatSessionKey({hostId,harness:{pluginId,instanceId:'one'},nativeSessionId:'created-native-id'})};};
  return port;
 };
 const dataDir=path.join(dir,'state');
 const runtime=await startLocalRuntime({dataDir,chooseWorkspace:async()=>({root:dir,displayName:'Test workspace'}),createHarnessAdapters:async({hostId})=>[{pluginId,adapter:makeAdapter(hostId)}]});
 const client=new LocalClient(runtime.origin),selected=await client.selectWorkspace();
 const uncertain={requestId:'55555555-5555-4555-8555-555555555555',pluginId,instanceId:'one',workspaceId:selected.workspaceId,title:'Uncertain task'};
 await assert.rejects(client.createSession(uncertain),e=>e.code==='session_creation_unconfirmed');
 assert.deepEqual(await client.createStatus(uncertain.requestId),{requestId:uncertain.requestId,status:'unconfirmed'});
 await assert.rejects(client.createSession(uncertain),e=>e.code==='session_creation_unconfirmed');assert.equal(calls,1);
 const certain={...uncertain,requestId:'66666666-6666-4666-8666-666666666666',title:'Confirmed task'};
 const created=await client.createSession(certain);assert.equal(calls,2);assert.equal(created.restoredReadOnly,false);
 const replay=await client.createSession(certain);assert.equal(replay.sessionKey,created.sessionKey);assert.equal(calls,2);
 await runtime.close();
 next=await startLocalRuntime({dataDir,createHarnessAdapters:async({hostId})=>[{pluginId,adapter:makeAdapter(hostId)}]});
 const again=new LocalClient(next.origin);
 await assert.rejects(again.createSession(uncertain),e=>e.code==='session_creation_unconfirmed');assert.equal(calls,2);
 const recovered=await again.createSession(certain);assert.equal(recovered.sessionKey,created.sessionKey);assert.equal(recovered.ownerId,null);assert.equal(recovered.restoredReadOnly,true);assert.equal(calls,2);
 assert.equal(recovered.snapshot.sessionDetails.find(s=>s.sessionKey===created.sessionKey).title,'Confirmed task');
 await assert.rejects(again.createSession({...certain,title:'Changed title'}),e=>e.code==='create_request_mismatch');assert.equal(calls,2);
});

test('restart restores only read-only destinations until exact explicit reattachment',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-restart-index-'));
 const metadataDir=path.join(dir,'metadata');
 const firstJournal=new CommandJournal({directory:path.join(dir,'commands'),hostId});
 const firstMetadata=new SessionMetadataStore(metadataDir,hostId);
 const first=new SessionService({hostId,journal:firstJournal,metadata:firstMetadata}),old=adapter(hostId,'one');first.registerAdapter(pluginId,old);
 const workspaceId='ws_'+'1'.repeat(16);
 const created=await first.createSession(pluginId,dir,{title:'Original task',workspaceId},'one');firstMetadata.close();firstJournal.close();
 const nextJournal=new CommandJournal({directory:path.join(dir,'commands'),hostId});
 const nextMetadata=new SessionMetadataStore(metadataDir,hostId);t.after(()=>{nextMetadata.close();nextJournal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const next=new SessionService({hostId,journal:nextJournal,metadata:nextMetadata});
 assert.equal(next.getSession(created.sessionKey).readOnly,true);assert.equal(next.getSession(created.sessionKey).ownerId,null);
 assert.equal(next.getSession(created.sessionKey).title,'Original task');assert.equal(next.getSession(created.sessionKey).cwd,dir);
 assert.equal(next.getSession(created.sessionKey).workspaceId,workspaceId);
 await assert.rejects(next.sendPrompt(actor,created.sessionKey,'must attach first'),{code:'read_only_session'});
 const fresh=adapter(hostId,'one');fresh.ownerId='owner-new-process';fresh.attachSession=async()=>({sessionKey:created.sessionKey,ownerId:fresh.ownerId});next.registerAdapter(pluginId,fresh);
 fresh.listSessions=async()=>[{nativeId:'same-native-id',sessionKey:created.sessionKey,cwd:dir,preview:'native preview'}];
 await next.listSessions();assert.equal(next.getSession(created.sessionKey).title,'Original task');
 await next.attachSession(created.sessionKey);assert.equal(next.getSession(created.sessionKey).ownerId,fresh.ownerId);
 const sent=await next.sendPrompt(actor,created.sessionKey,'after attach');await next.dispatchNext(created.sessionKey);
 assert.ok(fresh.calls.includes(sent.commandId));assert.ok(!old.calls.includes(sent.commandId));
});

test('explicitly attached historical task retains display metadata but loses command owner on restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-attach-metadata-'));
 const commandDir=path.join(dir,'commands'),metadataDir=path.join(dir,'metadata');
 const key=formatSessionKey({hostId,harness:{pluginId,instanceId:'one'},nativeSessionId:'historical-task'});
 const journal=new CommandJournal({directory:commandDir,hostId}),metadata=new SessionMetadataStore(metadataDir,hostId);
 const service=new SessionService({hostId,journal,metadata}),original=adapter(hostId,'one');
 original.listSessions=async()=>[{nativeId:'historical-task',sessionKey:key,cwd:dir,preview:'Historical task title'}];
 original.attachSession=async()=>({sessionKey:key,ownerId:original.ownerId});service.registerAdapter(pluginId,original);
 await service.listSessions();assert.equal(service.getSession(key).readOnly,true);
 await service.attachSession(key);assert.equal(service.getSession(key).readOnly,false);
 metadata.close();journal.close();
 const nextJournal=new CommandJournal({directory:commandDir,hostId}),nextMetadata=new SessionMetadataStore(metadataDir,hostId);
 t.after(()=>{nextMetadata.close();nextJournal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const restored=new SessionService({hostId,journal:nextJournal,metadata:nextMetadata}).getSession(key);
 assert.equal(restored.title,'Historical task title');assert.equal(restored.cwd,dir);
 assert.equal(restored.readOnly,true);assert.equal(restored.ownerId,null);
});
