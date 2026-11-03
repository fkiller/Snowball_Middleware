import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RemoteManager, handleRemoteControl, closeRemoteAndDevice} from '../apps/supervisor/remote-manager.mjs';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';

test('local manager is opt-in, closes the listener, retains expiring credentials and revokes them', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-remote-control-'));
  let manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  t.after(async()=>{await manager.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  assert.deepEqual(await manager.status(),{enabled:false,origin:null,credentials:null});
  assert.equal(fs.existsSync(path.join(directory,'remote')),false);
  // A stop requested before a slow start finishes must retire that new listener.
  const starting=manager.enable(), stopping=manager.disable();
  const [interrupted,stopped]=await Promise.all([starting,stopping]);
  assert.equal(stopped.enabled,false);
  await assert.rejects(fetch(interrupted.origin+'/remote/v1/sessions'));
  const first=await manager.enable(); assert.match(first.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  const credential=await manager.issue();
  const headers={Authorization:`Bearer ${credential.token}`};
  assert.equal((await fetch(first.origin+'/remote/v1/sessions',{headers})).status,200);
  await manager.disable(); await assert.rejects(fetch(first.origin+'/remote/v1/sessions',{headers}));
  assert.equal((await manager.list()).credentials.length,1);
  await manager.close();
  manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  assert.equal((await manager.status()).enabled,false);
  assert.equal((await manager.list()).credentials[0].deviceId,credential.deviceId);
  const second=await manager.enable();
  assert.equal((await fetch(second.origin+'/remote/v1/sessions',{headers})).status,200);
  await manager.revoke(credential.deviceId);
  assert.equal((await fetch(second.origin+'/remote/v1/sessions',{headers})).status,401);
});

test('remote control IPC accepts only exact action shapes and never returns internal errors', async () => {
  let calls=0;
  const manager={status:()=>{calls++;throw Error('secret internal details');}};
  assert.equal(await handleRemoteControl(manager,{kind:'remote-control',id:1,action:'status',url:'x'}),undefined);
  assert.equal(await handleRemoteControl(manager,{kind:'remote-control',id:2,action:'unknown'}),undefined);
  assert.equal(await handleRemoteControl(manager,{kind:'remote-control',id:-1,action:'status'}),undefined);
  assert.deepEqual(await handleRemoteControl(manager,{kind:'remote-control',id:3,action:'status'}),{kind:'remote-result',id:3,ok:false});
  assert.equal(calls,1);
});

test('damaged remote lock cannot prevent the existing local API from closing', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-remote-close-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const runtime=await startLocalRuntime({dataDir:directory,desktop:{getAutostart:async()=>false,setAutostart:async()=>{}}});
  const remote=await runtime.remoteControl.enable();
  fs.writeFileSync(path.join(directory,'remote','remote-credentials.lock'),'{}');
  await runtime.close();
  await assert.rejects(fetch(runtime.origin+'/v1/snapshot'));
  await assert.rejects(fetch(remote.origin+'/remote/v1/sessions'));
});

test('remote listener closes while device cleanup is still waiting', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-remote-delayed-close-'));
  const manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  t.after(async()=>{await manager.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  const remote=await manager.enable();
  let release; const pendingDevice=new Promise(resolve=>{release=resolve;});
  const cleanup=closeRemoteAndDevice(manager,()=>pendingDevice);
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(fetch(remote.origin+'/remote/v1/sessions'));
  release(); await cleanup;
});
