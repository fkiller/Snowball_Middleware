import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LanHostRegistry, LanHostListener, LanHostFederator, CommandJournal } from '../packages/core/dist/index.js';
import { LocalApi } from '../packages/api/dist/index.js';
import { AntigravityObserverAdapter } from '../packages/harness-antigravity/dist/index.js';
const hostId='host_'+'a'.repeat(32);
const registry=()=>new LanHostRegistry({hostId,name:'local',platform:'win32'});
test('local no-auth works without PIN while strict mode remains available',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-audit-'));
  const journal=new CommandJournal({hostId,directory});
  t.after(()=>{journal.close();fs.rmSync(directory,{recursive:true,force:true});});
  const api=new LocalApi({journal,noAuth:true}); await api.start();t.after(()=>api.close());
  assert.equal((await fetch(api.origin+'/v1/snapshot')).status,200);
  assert.equal((await (await fetch(api.origin+'/v1/snapshot')).json()).accessMode,'local-no-auth');
  const headers={Origin:api.origin,'Content-Type':'application/json'};
  const res=await fetch(api.origin+'/v1/settings',{method:'PATCH',headers,body:JSON.stringify({expectedRevision:1,patch:{controlPaused:true}})});
  assert.equal(res.status,200);
  assert.equal((await fetch(api.origin+'/v1/snapshot',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(api.origin+'/v1/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  // Foreign Host is covered by raw node:http requests in local-api.test.mjs; fetch normalizes Host.

  const strict=new LocalApi({journal,noAuth:false});await strict.start();t.after(()=>strict.close());
  assert.equal((await fetch(strict.origin+'/v1/snapshot')).status,401);
});
test('untrusted peer cannot mint its own PIN or enroll over HTTP; external listener refused',async t=>{
  const r=registry();const listener=new LanHostListener(r);await listener.start();t.after(()=>listener.close());
  for(const route of ['initiate','verify']) {
    const res=await fetch(listener.origin+'/peer/pair/'+route,{method:'POST',body:'{}'});
    assert.equal(res.status,403);assert.equal((await res.json()).pin,undefined);
  }
  assert.equal(r.listPairedHosts().length,0);
  await assert.rejects(new LanHostListener(r,{host:'0.0.0.0'}).start(),{code:'authenticated_lan_transport_required'});
});
test('signed peer requests cannot be replayed and a hanging peer cannot block local aggregation forever',async t=>{
  const a=registry(), b=new LanHostRegistry({hostId:'host_'+'b'.repeat(32),name:'peer',platform:'darwin'});
  const session=a.initiatePairing();a.verifyPairing(session.pairingId,session.pin,{...b.getLocalHost(),address:'127.0.0.1',port:1234});
  const listener=new LanHostListener(a);await listener.start();t.after(()=>listener.close());
  const timestamp=Date.now();const headers={'x-snowball-host-id':b.hostId,'x-snowball-timestamp':String(timestamp),'x-snowball-signature':b.signPayload(timestamp+':GET:/peer/status:')};
  assert.equal((await fetch(listener.origin+'/peer/status',{headers})).status,200);
  const replay=await fetch(listener.origin+'/peer/status',{headers});assert.equal(replay.status,401);assert.equal((await replay.json()).error,'replayed_request');
  const federator=new LanHostFederator(a,{listSessions:async()=>[{id:'local'}]},{peerTimeoutMs:25,requestPeer:()=>new Promise(()=>{})});
  const result=await federator.aggregate();assert.equal(result[0].sessions[0].id,'local');assert.equal(result[1].error,'peer_timeout');
});
test('Antigravity rejects path traversal and oversized transcripts before reading',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-brain-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const adapter=new AntigravityObserverAdapter({hostId,instanceId:'test',brainDir:root});
  for(const id of ['../outside','C:/outside','..','bad/id']) {await assert.rejects(adapter.readSession(id),/invalid_session_id/);assert.throws(()=>adapter.watchSession(id),/invalid_session_id/);}
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';const dir=path.join(root,id,'.system_generated','logs');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'transcript.jsonl'),Buffer.alloc(4*1024*1024+1));
  await assert.rejects(adapter.readSession(id),/transcript_limit/);
});
