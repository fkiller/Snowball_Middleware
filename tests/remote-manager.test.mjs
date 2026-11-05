import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import tls from 'node:tls';
import {createHash} from 'node:crypto';
import {RemoteManager, handleRemoteControl, closeRemoteAndDevice} from '../apps/supervisor/remote-manager.mjs';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';

test('trusted local TLS listener uses its persistent identity and stays off IPC', {timeout:60000}, async t => {
  const lookup=spawnSync(process.platform==='win32'?'where.exe':'which',['openssl'],{encoding:'utf8',timeout:5000});
  const openssl=lookup.status===0?lookup.stdout.split(/\r?\n/).find(line=>path.isAbsolute(line)&&fs.existsSync(line)):undefined;
  if(!openssl){t.skip('OpenSSL unavailable');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-manager-tls-'));
  const manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  t.after(async()=>{await manager.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  assert.equal(await handleRemoteControl(manager,{kind:'remote-control',id:1,action:'enableTls'}),undefined);
  const host='node.example.ts.net';
  const first=await manager.enableTls({host,openssl});
  assert.match(first.origin,/^https:\/\/127\.0\.0\.1:\d+$/);
  assert.match(first.fingerprint,/^[a-f0-9]{64}$/);
  const cert=JSON.parse(fs.readFileSync(path.join(directory,'remote','tls-identity','gateway-tls-identity.v1.json'),'utf8')).cert;
  await new Promise((resolve,reject)=>{
    const socket=tls.connect({host:'127.0.0.1',port:Number(new URL(first.origin).port),servername:host,ca:cert,
      checkServerIdentity:(name,peer)=>tls.checkServerIdentity(name,peer)||(createHash('sha256').update(peer.raw).digest('hex')===first.fingerprint?undefined:Error('pin mismatch'))});
    socket.once('secureConnect',()=>{socket.end();resolve();});socket.once('error',reject);
  });
  await assert.rejects(manager.enableTls({host,openssl}),/remote_already_enabled/);
  await manager.disable();
  const second=await manager.enableTls({host});
  assert.equal(second.fingerprint,first.fingerprint);
  await manager.disable();
  await assert.rejects(manager.enableTls({host:'other.example.ts.net',openssl}),/not replaced/);
  assert.equal((await manager.status()).enabled,false);
});

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

test('explicit local recovery preserves credentials and refuses missing, live, or guarded locks', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-remote-recovery-'));
  let manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  t.after(async()=>{await manager.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  // A missing lock is not reported as a successful recovery.
  assert.deepEqual(await handleRemoteControl(manager,{kind:'remote-control',id:1,action:'recoverLock'}),{kind:'remote-result',id:1,ok:false});
  // A store already owned by this runtime is not eligible for recovery.
  await manager.list();
  assert.deepEqual(await handleRemoteControl(manager,{kind:'remote-control',id:2,action:'recoverLock'}),{kind:'remote-result',id:2,ok:false});
  const competing=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  assert.deepEqual(await handleRemoteControl(competing,{kind:'remote-control',id:5,action:'recoverLock'}),{kind:'remote-result',id:5,ok:false});
  assert.equal((await manager.list()).enabled,false);
  await competing.close();
  await manager.close();
  const childScript=`import {PersistentRemoteCredentials} from './packages/api/dist/index.js'; import {ensurePrivateStateDirectory} from './apps/supervisor/private-state.mjs'; const store=new PersistentRemoteCredentials({directory:process.argv[1],verifyPrivateDirectory:ensurePrivateStateDirectory}); store.issue('Test device');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',childScript,path.join(directory,'remote')],{cwd:process.cwd(),encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  manager=new RemoteManager({directory,sessionService:{snapshotSessions:()=>[]}});
  const guard=path.join(directory,'remote','remote-credentials.guard');
  fs.writeFileSync(guard,'unverified',{mode:0o600});
  assert.deepEqual(await handleRemoteControl(manager,{kind:'remote-control',id:3,action:'recoverLock'}),{kind:'remote-result',id:3,ok:false});
  assert.equal(fs.readFileSync(guard,'utf8'),'unverified');
  assert.equal(fs.existsSync(path.join(directory,'remote','remote-credentials.lock')),true);
  // Fixture cleanup simulates offline support; product code never deletes it.
  fs.unlinkSync(guard);
  const recovered=await handleRemoteControl(manager,{kind:'remote-control',id:4,action:'recoverLock'});
  assert.equal(recovered.ok,true);
  assert.equal(recovered.value.enabled,false);
  assert.equal(recovered.value.credentials.length,1);
  assert.equal(recovered.value.credentials[0].label,'Test device');
  assert.equal('token' in recovered.value.credentials[0],false);
});
