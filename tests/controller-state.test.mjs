import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ControllerStateStore,DeviceRegistry,deviceControllerId,formatSessionKey,CommandJournal} from '../packages/core/dist/index.js';
import {LocalApi} from '../packages/api/dist/index.js';
import {LocalClient} from '../packages/client-sdk/dist/index.js';
import {loadControllerStore} from '../apps/supervisor/controller-store.mjs';
import {NativeSourceService} from '../scripts/source-service.mjs';
import {ContextManager} from '../scripts/context-manager.mjs';
const a='ctl_aaaaaaaaaaaaaaaa',b='ctl_bbbbbbbbbbbbbbbb',hostId='host_'+'a'.repeat(32);
const key=id=>formatSessionKey({hostId,harness:{pluginId:'snowball.codex',instanceId:'default'},nativeSessionId:id});
test('device identity is stable and registered device uses the canonical independent context',()=>{
  const states=new ControllerStateStore(),source={pluginId:'snowball.device-m5stack',instanceId:'physical'},identity='m5-001122334455',id=deviceControllerId(source.pluginId,source.instanceId,identity);
  states.update(id,0,{selection:{sessionKey:key('one')},preferences:{skinId:'slate-dark'}});
  const devices=new DeviceRegistry(Date.now,states.contexts),generation=devices.beginScan(source);
  const candidate=devices.observe(source,generation,{nativeDeviceId:identity,label:'physical',transport:'lan',supported:true,verifiedIdentity:identity,capabilities:['display']});devices.finishScan(source,generation,'ready');
  const {binding}=devices.register(candidate.candidateId,generation);
  assert.equal(binding.controllerId,id);assert.equal(devices.getContext(id),states.contexts.getOrCreate(id));assert.equal(devices.list()[0].selection.sessionKey,key('one'));
  assert.notEqual(id,deviceControllerId(source.pluginId,source.instanceId,'m5-001122334456'));
});
test('selection, preferences and draft destination stay isolated and revision conflicts never mutate state',()=>{
  const states=new ControllerStateStore();states.update(a,0,{selection:{sessionKey:key('one')},preferences:{language:'ko',model:'native-a'},draft:{destinationKey:key('one'),text:'한글'}});
  states.update(b,0,{selection:{sessionKey:key('two')},preferences:{language:'en',model:'native-b'},draft:{destinationKey:key('two'),text:'English'}});
  states.update(a,1,{selection:{sessionKey:key('two')}});
  assert.equal(states.get(a).draft.destinationKey,key('one'));assert.equal(states.get(b).draft.text,'English');
  const before=states.snapshot();assert.throws(()=>states.update(a,0,{preferences:{language:'en'}}),/stale/);assert.throws(()=>states.update(a,2,{draft:{destinationKey:key('two'),text:'wrong'}}),/locked/);assert.deepEqual(states.snapshot(),before);
  const copy=states.get(b);copy.preferences.model='mutated';assert.equal(states.get(b).preferences.model,'native-b');
});
test('private controller state survives restart without sending any command',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-controller-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const first=await loadControllerStore(directory);first.store.update(a,0,{selection:{sessionKey:key('one')},draft:{destinationKey:key('one'),text:'unsent'}});await first.close();
  const second=await loadControllerStore(directory);assert.equal(second.store.get(a).draft.text,'unsent');assert.equal(second.store.get(a).selection.sessionKey,key('one'));assert.equal(second.store.get(b).draft,undefined);await second.close();
});
test('actual loopback clients can only update their own endpoint state and do not leak drafts through snapshot',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-controller-api-')),journal=new CommandJournal({hostId,directory});
  const api=new LocalApi({journal,noAuth:true});await api.start();t.after(async()=>{await api.close();journal.close();await fs.rm(directory,{recursive:true,force:true});});
  const first=new LocalClient(api.origin,undefined,a),second=new LocalClient(api.origin,undefined,b);
  await first.updateController(0,{selection:{sessionKey:key('one')},draft:{destinationKey:key('one'),text:'private unsent draft'}});
  assert.equal((await second.controller()).draft,undefined);assert.equal((await first.controller()).draft.text,'private unsent draft');
  await assert.rejects(first.updateController(0,{preferences:{language:'en'}}),error=>error.status===409);
  assert.ok(!JSON.stringify(await second.snapshot()).includes('private unsent draft'));assert.equal(journal.listCommands().length,0);
});
test('MK20 checkpoint recovers selection and draft while interrupted send remains unknown',()=>{
  const make=()=>{const c=new ContextManager();c.projectsByScope['dev-pc/snowball.codex']=[{id:'actual',name:'actual',path:process.cwd()}];c.sessionsByScope['dev-pc/snowball.codex/actual']=[{id:'one',title:'one'},{id:'two',title:'two'}];c.resolveProjectAndSession();return c;};
  const first=make();first.selectedSessionIdx=1;first.voiceDraftText='keep';first.voiceSubmission='sending';first.readerScrollLine=42;const saved=first.snapshotUi(),second=make();second.restoreUi(saved);
  assert.equal(second.getCurrentSession().id,'two');assert.equal(second.voiceDraftText,'keep');assert.equal(second.voiceSubmission,'unknown');assert.equal(second.readerScrollLine,42);assert.equal(first.getCurrentSession().voiceDraftText,'keep');
});
test('native catalog reads leave the main event loop responsive and coalesce concurrent reads only',async()=>{
  const sources=new NativeSourceService();let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{const first=sources.read('catalog','snowball.codex');assert.equal(first,sources.read('catalog','snowball.codex'));const result=await first;assert.ok(Array.isArray(result));assert.ok(ticks>0);await assert.rejects(sources.read('catalog','unsupported'),/unknown/);}
  finally{clearInterval(timer);await sources.close();}
});

test('MK20 local draft created with native UI identifier survives restart',()=>{
  const make=()=>{const c=new ContextManager();c.projectsByScope['dev-pc/snowball.codex']=[{id:'actual',name:'actual',path:process.cwd()}];c.sessionsByScope['dev-pc/snowball.codex/actual']=[];c.resolveProjectAndSession();return c;};
  const first=make();first.sessionsByScope['dev-pc/snowball.codex/actual'].push({id:'s-m9abc123',title:'Unsent task',createdAt:Date.now(),turns:[]});first.voiceDraftText='preserved draft';first.voiceSubmission='ready';
  const second=make();second.restoreUi(first.snapshotUi());assert.equal(second.getCurrentSession().id,'s-m9abc123');assert.equal(second.voiceDraftText,'preserved draft');assert.equal(second.getCurrentSession().turnCount,0);
});

test('native refresh separates equal project names and retains pending session ownership',async t=>{
  const {reconcileNativeContext}=await import('../scripts/native-context.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-native-context-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const left=path.join(directory,'left','same'),right=path.join(directory,'right','same');await fs.mkdir(left,{recursive:true});await fs.mkdir(right,{recursive:true});
  const c=new ContextManager(),h='snowball.codex';c.harnesses=[{id:h,name:'Codex',isEnabled:true}];
  const records={[h]:{same:[{id:'left-native',title:'Left',cwd:left},{id:'right-native',title:'Right',cwd:right}]}};
  reconcileNativeContext(c,records);const projects=c.projectsByScope['dev-pc/'+h];assert.equal(projects.length,2);assert.notEqual(projects[0].id,projects[1].id);
  const session=c.sessionsByScope['dev-pc/'+h+'/'+projects[0].id][0];assert.equal(session.cwd,projects[0].path);session.voiceSubmission='sending';session.voiceDraftText='owned draft';c.voiceSubmission='sending';c.voiceDraftText='owned draft';
  records[h].same.push({id:'new-native',title:'New',cwd:projects[0].path});reconcileNativeContext(c,records);
  assert.equal(c.sessionsByScope['dev-pc/'+h+'/'+projects[0].id][0],session);assert.equal(session.voiceSubmission,'sending');assert.equal(session.voiceDraftText,'owned draft');assert.equal(c.sessionsByScope['dev-pc/'+h+'/'+projects[0].id].length,2);
});
