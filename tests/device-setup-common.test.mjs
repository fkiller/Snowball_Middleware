import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readPreparation,approveDevicePreparations,installedDevicePreparations} from '../scripts/device-preparation.mjs';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
import {guardPreparation} from './helpers/preparation-fixture.mjs';
import {readBackupProgress} from '../apps/desktop/device-setup.mjs';

test('backup counters reject malformed, changed-capacity and regressing native progress without exporting raw tool output',()=>{
  const first=readBackupProgress({bytes:16777216,completedBytes:8388608,elapsedSeconds:200,password:'never export',raw:'private diagnostic'});
  assert.deepEqual(first,{bytes:16777216,completedBytes:8388608,elapsedSeconds:200});
  for(const extra of [{bytes:0},{bytes:4194304},{completedBytes:-1},{completedBytes:16777217},{completedBytes:1},{elapsedSeconds:199},{elapsedSeconds:NaN},{bytes:Infinity}])assert.equal(readBackupProgress({...first,...extra},first),first);
  assert.equal(readBackupProgress({bytes:16777216}),undefined,'older helpers remain usable without invented counters');
  assert.deepEqual(readBackupProgress({bytes:16777216,completedBytes:16777216,elapsedSeconds:400},first),{bytes:16777216,completedBytes:16777216,elapsedSeconds:400});
});

test('installed preparation registration includes MK20 under the same guarantees and pins the actual helper bytes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-preparation-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const devices={};
  for(const profile of ['guard-one','guard-two','mk20']){
    const deviceRoot=path.join(root,profile);guardPreparation(deviceRoot,profile,profile+'-');
    devices[profile]={deviceRoot,python:path.join(root,'never-execute')};
  }
  // Metadata admission only: no fixture executes or represents a working MK20 updater.
  devices['runtime-only']={controlRoot:path.join(root,'absent-control'),python:path.join(root,'never-execute')};
  const config={devices};config.devicePreparations=approveDevicePreparations(config);
  assert.equal(config.devicePreparations.length,3);
  const adapters=installedDevicePreparations(config);
  const hub=new DeviceSetupHub({adapters,backupDirectory:root});
  assert.deepEqual(hub.view().profiles.map(p=>p.profile),['guard-one','guard-two','mk20']);
  assert.equal([...hub.setups.values()].every(s=>s.children.size===0),true);
  const single={profile:'mk20',...devices.mk20};
  single.devicePreparations=approveDevicePreparations(single);
  assert.equal(installedDevicePreparations(single)[0].profile,'mk20');
  const approved=config.devicePreparations;
  config.devicePreparations=[approved[2],approved[2]];
  assert.throws(()=>installedDevicePreparations(config),/invalid_preparation_approval/);
  config.devicePreparations=approved;
  fs.appendFileSync(path.join(devices['guard-two'].deviceRoot,'scripts/usb_setup.py'),'# changed after approval\n');
  assert.throws(()=>installedDevicePreparations(config),/installed_preparation_changed/);
  await hub.close();
  await assert.rejects(hub.setups.get('guard-one').run('list'),/usb_setup_closed/);
});

test('missing backup guarantees, visual guidance and out-of-root helper paths reject admission without executing code',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-preparation-guards-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const device={deviceRoot:root,python:path.join(root,'never-execute')};
  for(const key of ['fullBackup','preserveSettings','verifySettings','reboot']){
    const descriptor=guardPreparation(root,'mk20','mk20-');descriptor.capabilities[key]=false;
    fs.writeFileSync(path.join(root,'firmware/setup.json'),JSON.stringify(descriptor));
    assert.throws(()=>readPreparation(device),/required_preparation_guarantee_missing/);
  }
  let descriptor=guardPreparation(root);descriptor.presentation.en.steps=[];
  fs.writeFileSync(path.join(root,'firmware/setup.json'),JSON.stringify(descriptor));
  assert.throws(()=>readPreparation(device),/visual_guide_required/);
  descriptor=guardPreparation(root);descriptor.bridge='../outside.py';
  fs.writeFileSync(path.join(root,'firmware/setup.json'),JSON.stringify(descriptor));
  assert.throws(()=>readPreparation(device),/invalid_preparation_path/);
});

test('common action router rejects unknown devices, cross-model writes and writes while another adapter owns USB',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-preparation-router-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const adapters=['guard-one','guard-two'].map(profile=>{const deviceRoot=path.join(root,profile);guardPreparation(deviceRoot,profile,profile+'-');return {profile,device:{deviceRoot,python:path.join(root,'never-execute')}};});
  const hub=new DeviceSetupHub({adapters,backupDirectory:root});
  await assert.rejects(hub.action({profile:'arbitrary',action:'install'}),/unknown_preparation_profile/);
  hub.setups.get('guard-two').records.set('COM7',{hello:{deviceId:'guard-two-001122334455'}});
  await assert.rejects(hub.action({profile:'guard-one',action:'install',port:'COM7'}),/device_type_conflict/);
  hub.setups.get('guard-two').job=Promise.resolve();
  await assert.rejects(hub.action({profile:'guard-one',action:'install',port:'COM8'}),/usb_setup_busy/);
  hub.setups.get('guard-two').job=null;
  assert.equal([...hub.setups.values()].every(s=>s.children.size===0),true);
  await hub.close();
});

test('manual refresh joins discovery and coalesces one forced pass without concurrent adapter access',async()=>{
  // Scheduler-only barriers: no hardware response, firmware success or elapsed delay is simulated.
  const hub=new DeviceSetupHub({adapters:[],backupDirectory:os.tmpdir()});
  const passes=[],waiting=[];let active=0,maximum=0;
  hub.setups.set('scheduler',{view:()=>({}),close:async()=>{},scan:async force=>{
    passes.push(force);maximum=Math.max(maximum,++active);
    await new Promise(resolve=>waiting.push(resolve));active--;
  }});
  const checks=[];hub.on('change',view=>checks.push(view.checking));
  const automatic=hub.scan();
  const first=hub.action({profile:'scheduler',action:'refresh'});
  const second=hub.action({profile:'scheduler',action:'refresh'});
  await Promise.resolve();assert.equal(hub.view().checking,true);
  assert.deepEqual(passes,[false]);waiting.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(passes,[false,true]);
  const third=hub.action({profile:'scheduler',action:'refresh'});
  waiting.shift()();await Promise.all([automatic,first,second,third]);
  assert.equal(maximum,1);assert.deepEqual(passes,[false,true]);
  assert.equal(hub.view().checking,false);assert.deepEqual(checks,[true,false]);
  await hub.close();
});

test('an explicit action waits for discovery, reserves the lease, and checks the refreshed target',async()=>{
  // Scheduler barriers only; no native response or device operation is simulated.
  const hub=new DeviceSetupHub({adapters:[],backupDirectory:os.tmpdir()});
  let finishRead,readDone=false,actions=0;
  hub.setups.set('scheduler',{view:()=>({}),records:new Map(),close:async()=>{},scan:async()=>{await new Promise(resolve=>{finishRead=resolve;});readDone=true;},action:async()=>{actions++;assert.equal(readDone,true);throw Error('setup_target_disconnected');}});
  const scan=hub.scan();await Promise.resolve();
  const action=hub.action({profile:'scheduler',action:'install',port:'gone'});
  assert.equal(hub.view().busy,true);assert.equal(actions,0);
  await assert.rejects(hub.action({profile:'scheduler',action:'install',port:'gone'}),/usb_setup_busy/);
  await hub.scan();assert.equal(actions,0,'another poll cannot steal the reserved action lease');
  finishRead();await scan;await assert.rejects(action,/setup_target_disconnected/);
  assert.equal(actions,1);assert.equal(hub.view().busy,false);await hub.close();
});

test('refresh still rejects an active update and validates its closed request shape',async()=>{
  const hub=new DeviceSetupHub({adapters:[],backupDirectory:os.tmpdir()});
  hub.setups.set('scheduler',{view:()=>({}),close:async()=>{},job:Promise.resolve()});
  await assert.rejects(hub.action({profile:'scheduler',action:'refresh'}),/usb_setup_busy/);
  hub.setups.get('scheduler').job=null;
  await assert.rejects(hub.action({profile:'scheduler',action:'refresh',port:'COM7'}),/invalid_setup_action/);
  await hub.close();
});
