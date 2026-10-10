import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readPreparation,approveDevicePreparations,installedDevicePreparations} from '../scripts/device-preparation.mjs';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
import {guardPreparation} from './helpers/preparation-fixture.mjs';

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
