import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionService,CommandJournal,formatSessionKey} from '../packages/core/dist/index.js';
const hostId='host_'+'a'.repeat(32);
const key=id=>formatSessionKey({hostId,harness:{pluginId:id,instanceId:'default'},nativeSessionId:'same'});
class Adapter extends EventEmitter {
  constructor(id){super();this.id=id;this.ownerId='owner-'+id;}
  async createSession(){return {sessionKey:key(this.id),ownerId:this.ownerId};}
  async listSessions(){return [];}
  async stop(){}
}
test('provider events cannot mutate another provider, stale adapters detach, disabled dispatch is blocked',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-session-audit-'));const journal=new CommandJournal({hostId,directory:dir});
 t.after(()=>{journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const service=new SessionService({hostId,journal});const a=new Adapter('test.alpha'),b=new Adapter('test.beta');
 service.registerAdapter(a.id,a);service.registerAdapter(b.id,b);
 await service.createSession(a.id,'/tmp');await service.createSession(b.id,'/tmp');
 a.emit('event',{sessionKey:key(b.id),kind:'turn/started',turnId:'injected'});
 a.emit('ownerLost',{sessionKey:key(b.id),ownerId:b.ownerId,reason:'injected'});
 assert.equal(service.getSession(key(b.id)).status,'idle');assert.equal(service.getSession(key(b.id)).ownerId,b.ownerId);
 const copy=service.getSession(key(b.id));copy.ownerId='tampered';assert.equal(service.getSession(key(b.id)).ownerId,b.ownerId);
 const replacement=new Adapter(a.id);replacement.ownerId='new-owner';await service.reconnectAdapter(a.id,replacement);
 assert.equal(a.listenerCount('event'),0);assert.equal(a.listenerCount('decision'),0);
 service.disableAdapter(b.id);
 await assert.rejects(service.dispatchNext(key(b.id)),{code:'harness_disabled'});
 await assert.rejects(service.interruptTurn('ctl_'+'a'.repeat(16),key(b.id),'turn'),{code:'harness_disabled'});
});
test('session creation cannot smuggle a foreign provider identity',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-session-audit-'));const journal=new CommandJournal({hostId,directory:dir});
 t.after(()=>{journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const service=new SessionService({hostId,journal});const a=new Adapter('test.alpha');a.createSession=async()=>({sessionKey:key('test.beta'),ownerId:a.ownerId});
 service.registerAdapter(a.id,a);await assert.rejects(service.createSession(a.id,'/tmp'),{code:'adapter_identity_mismatch'});
 assert.equal(journal.listSessions().length,0);
});

for (const early of [false,true]) test(`native completion correlates journal command even when completion arrives ${early?'before':'after'} receipt`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-completion-'));const journal=new CommandJournal({hostId,directory:dir});
 t.after(()=>{journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const service=new SessionService({hostId,journal});const a=new Adapter('test.alpha');
 const complete=outcome=>a.emit('event',{sessionKey:key(a.id),kind:'turn/completed',turnId:'native-turn',outcome});
 a.execute=async()=>{if(early)complete('completed');return {status:'acknowledged',correlationId:'native-turn'};};
 service.registerAdapter(a.id,a);await service.createSession(a.id,'/tmp');
 const sent=await service.sendPrompt('ctl_'+'a'.repeat(16),key(a.id),'test');
 await service.dispatchNext(key(a.id));
 if(!early){complete('failed');assert.equal(journal.command(sent.commandId).status,'acknowledged');complete('completed');}
 assert.equal(journal.command(sent.commandId).status,'completed');
 a.emit('event',{sessionKey:key(a.id),kind:'turn/started',turnId:'newer-turn'});complete('completed');
 assert.equal(service.getSession(key(a.id)).activeTurnId,'newer-turn');
});

test('late discovery cannot import sessions after adapter replacement or from another instance',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-late-list-'));const journal=new CommandJournal({hostId,directory:dir});
 t.after(()=>{journal.close();fs.rmSync(dir,{recursive:true,force:true});});
 const service=new SessionService({hostId,journal});const a=new Adapter('test.alpha');let resolve;
 a.listSessions=()=>new Promise(r=>resolve=r);service.registerAdapter(a.id,a);
 const listing=service.listSessions();service.registerAdapter(a.id,new Adapter(a.id));resolve([{nativeId:'same',sessionKey:key(a.id)}]);
 assert.deepEqual(await listing,[]);
 const b=new Adapter(a.id);b.status=()=>({instanceId:'other',connected:true,sessionListTruncated:true});b.listSessions=async()=>[{nativeId:'same',sessionKey:key(a.id)}];service.registerAdapter(b.id,b);
 assert.deepEqual(await service.listSessions(),[]);assert.equal(service.snapshotAdapters().find(a=>a.instanceId==='other').sessionListTruncated,true);
});
