import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {approveDevicePreparations,installedDevicePreparations} from '../scripts/device-preparation.mjs';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
import {ComponentSetup} from '../apps/desktop/component-setup.mjs';
const control=process.env.SNOWBALL_TEST_MK20_COMPOSITION_ROOT??fileURLToPath(new URL('../../Snowball_Control',import.meta.url));

test('legacy MK20 controlRoot enrolls its concrete component adapter without USB, ADB or any helper execution',{skip:!fs.existsSync(path.join(control,'hardware/mk20/firmware/setup.json'))},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-components-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config={profile:'mk20',controlRoot:control,python:path.join(root,'never-execute')};config.devicePreparations=approveDevicePreparations(config);
  assert.equal(config.devicePreparations[0].id,'mk20');
  const hub=new DeviceSetupHub({adapters:installedDevicePreparations(config),backupDirectory:root});
  const setup=hub.setups.get('mk20');assert.ok(setup instanceof ComponentSetup);assert.deepEqual(setup.view().components,['qmk','runtime']);
  assert.equal(setup.source.sharedHelper.sha256,createHash('sha256').update(fs.readFileSync(setup.source.sharedHelper.path)).digest('hex'));
  assert.equal(setup.children.size,0);
  setup.job=Promise.resolve();
  hub.observe({profile:'mk20',deviceId:'mk20-aabbccddeeff',address:'8.8.8.8'});
  assert.equal(setup.observations,undefined);
  hub.observe({profile:'mk20',deviceId:'mk20-aabbccddeeff',address:'192.168.1.2'});
  assert.equal(setup.observations.size,1);assert.equal(setup.children.size,0);assert.equal(setup.records.size,0);
  setup.job=null;
  const port='t-'+'a'.repeat(32);setup.records.set(port,{port,online:true,writable:true,component:'runtime',currentVersion:null,wifiConfigured:true});
  await assert.rejects(setup.action({action:'install',port,version:setup.release.version,confirmBoard:false}),/review_required/);
  await assert.rejects(setup.action({action:'install',port,version:setup.release.version,confirmBoard:true,network:{ssid:'network',password:'never-used'}}),/review_required/);
  await assert.rejects(setup.action({action:'verify',port}),/invalid_setup_action/);
  await assert.rejects(setup.action({action:'install',port,version:setup.release.version,confirmBoard:true,path:'outside'}),/invalid_setup_action/);
  assert.equal(setup.children.size,0);await hub.close();
});

test('component recovery receipts stream-check actual backup bytes and reject modified data',{skip:!fs.existsSync(path.join(control,'hardware/mk20/firmware/setup.json'))},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-receipt-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const setup=new ComponentSetup({device:{deviceRoot:path.join(control,'hardware/mk20'),python:path.join(root,'never-execute')},profile:'mk20',backupDirectory:root});
  const file=path.join(root,'recovery.bin'),bytes=Buffer.alloc(1024*1024,0x23);fs.writeFileSync(file,bytes);
  fs.writeFileSync(path.join(root,'recovery.json'),JSON.stringify({component:'runtime',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  await setup.backup(file,'runtime');await assert.rejects(setup.backup(file,'qmk'),/backup_incomplete/);
  fs.appendFileSync(file,'changed');await assert.rejects(setup.backup(file,'runtime'),/backup_incomplete/);await setup.close();
});
