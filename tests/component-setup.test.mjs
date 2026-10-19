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
import {preparationNeedsUpdate,preparationNeedsReview} from '../apps/desktop/device-setup.mjs';
const control=process.env.SNOWBALL_TEST_MK20_COMPOSITION_ROOT??fileURLToPath(new URL('../../Snowball_Control',import.meta.url));

test('review uses the component version and keeps current/newer images quiet',()=>{
  const release={version:'0.2.6',components:{runtime:{version:'0.2.6'},qmk:{version:'2026.9.18'}}};
  const runtime={component:'runtime',currentVersion:'0.2.6',online:true,phase:'ready',imageMatch:true,transport:'usb',usbIdentity:'verified-runtime',writable:true,nextStep:'ready'};
  assert.equal(preparationNeedsUpdate(runtime,release),false);
  assert.equal(preparationNeedsReview(runtime,release),false);
  assert.equal(preparationNeedsReview({...runtime,currentVersion:'0.2.5'},release),true);
  assert.equal(preparationNeedsReview({...runtime,imageMatch:false},release),false,'same-version repair remains a manual choice');
  assert.equal(preparationNeedsReview({...runtime,currentVersion:'0.2.7',imageMatch:false},release),false);
  assert.equal(preparationNeedsReview({...runtime,currentVersion:'0.2.5',online:false},release),false);
  assert.equal(preparationNeedsReview({...runtime,currentVersion:'0.2.5',phase:'failed'},release),false);
  const qmk={...runtime,component:'qmk',currentVersion:null,nextStep:'enter-dfu'};
  assert.equal(preparationNeedsReview(qmk,release),false,'HID cannot prove an outdated image');
  assert.equal(preparationNeedsReview({...qmk,currentVersion:'2026.9.17',nextStep:'ready'},release),true);
  assert.equal(preparationNeedsUpdate({...qmk,currentVersion:'2026.9.18'},release),false);
});

test('automatic review requires a supported versioned USB update, never LAN/SD/pending/unknown observations',()=>{
  const release={version:'0.5.7'};
  const usb={transport:'usb',usbIdentity:'usb-one',online:true,phase:'ready',status:'snowball',hello:{firmware:'0.5.6'}};
  assert.equal(preparationNeedsReview(usb,release),true);
  for(const changed of [{transport:'lan'},{transport:'maintenance'},{transport:'storage'},{transport:undefined},{usbIdentity:''},{online:false},{phase:'failed'},{phase:'checking'},{pending:true},{status:'unknown'},{hello:{firmware:'unknown'}},{hello:{firmware:'0.5.7'}},{hello:{firmware:'0.5.8'}}])assert.equal(preparationNeedsReview({...usb,...changed},release),false,JSON.stringify(changed));
});

test('startup inventory stays quiet; eligible USB hotplug opens once until real disconnect',{skip:!fs.existsSync(path.join(control,'hardware/mk20/firmware/setup.json'))},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-usb-attention-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const hub=new DeviceSetupHub({adapters:[{profile:'mk20',device:{deviceRoot:path.join(control,'hardware/mk20'),python:path.join(root,'not-run')}}],backupDirectory:root});
  const setup=hub.setups.get('mk20'),reviews=[];hub.on('review',value=>reviews.push(value));
  const usb={port:'usb-one',transport:'usb',usbIdentity:'supported-one',online:true,phase:'ready',component:'runtime',writable:true,nextStep:'ready',currentVersion:'0.0.1'};
  setup.records.set(usb.port,usb);hub.reviewUsbAttachments('mk20',setup);
  assert.equal(reviews.length,0,'existing devices at startup do not reopen a window');
  setup.records.clear();hub.reviewUsbAttachments('mk20',setup);
  setup.records.set(usb.port,{...usb,currentVersion:null});hub.reviewUsbAttachments('mk20',setup);
  assert.equal(reviews.length,0,'presence without a version is insufficient');
  setup.records.set(usb.port,usb);hub.reviewUsbAttachments('mk20',setup);assert.equal(reviews.length,1);
  for(let i=0;i<4;i++){setup.records.set(usb.port,{...usb,wifiConfigured:!!(i%2)});hub.reviewUsbAttachments('mk20',setup);}
  assert.equal(reviews.length,1,'refresh and metadata changes do not reopen a dismissed window');
  setup.code='usb_operation_failed';setup.records.clear();hub.reviewUsbAttachments('mk20',setup);
  setup.code=null;setup.records.set(usb.port,usb);hub.reviewUsbAttachments('mk20',setup);assert.equal(reviews.length,1,'failed enumeration is not unplugging');
  setup.records.clear();hub.reviewUsbAttachments('mk20',setup);setup.records.set(usb.port,usb);hub.reviewUsbAttachments('mk20',setup);assert.equal(reviews.length,2);
  const empty=new DeviceSetupHub({adapters:[],backupDirectory:root});assert.deepEqual(empty.view().profiles,[]);await empty.scan();await empty.close();await hub.close();
});

test('disconnected targets disappear, pending boot checks survive, and reconnect re-arms attention',{skip:!fs.existsSync(path.join(control,'hardware/mk20/firmware/setup.json'))},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-presence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const hub=new DeviceSetupHub({adapters:[{profile:'mk20',device:{deviceRoot:path.join(control,'hardware/mk20'),python:path.join(root,'never-execute')}}],backupDirectory:root});
  const setup=hub.setups.get('mk20'),port='t-'+'a'.repeat(32),pending='t-'+'b'.repeat(32);
  assert.throws(()=>setup.target({component:'qmk',currentVersion:null,nextStep:'qmk-readback',writable:false,returnSupported:'yes'}),/invalid_device_response/);
  assert.equal(setup.target({component:'qmk',currentVersion:null,nextStep:'qmk-readback',writable:false,returnSupported:true}).returnSupported,true);
  const record={port,online:true,wasPresent:true,component:'qmk',currentVersion:'2026.9.17',phase:'ready'};
  setup.records.set(port,record);setup.records.set(pending,{port:pending,online:false,phase:'awaiting-device'});
  let announcements=0;hub.on('attached',()=>announcements++);
  setup.emit('attached',record);setup.emit('attached',{...record});assert.equal(announcements,1,'forced probes do not reopen the same review');
  // Enumeration-only fixture: no native firmware response or write is simulated.
  setup.run=async command=>{assert.equal(command,'list');return {event:'ports',ports:[]};};
  await setup.scan();assert.equal(setup.records.has(port),false);assert.equal(setup.records.has(pending),true);
  record.online=true;setup.records.set(port,record);setup.emit('attached',record);assert.equal(announcements,2,'reconnection opens review again');
  setup.records.set(port,{...record,currentVersion:setup.release.components.qmk.version,writable:true});
  await assert.rejects(setup.action({action:'install',port,version:setup.release.version,confirmBoard:true}),/review_required/);
  setup.records.set(port,{...record,prepareSupported:true,component:'runtime',transport:'lan'});
  await assert.rejects(setup.action({action:'prepare',port,version:setup.release.version,confirmBoard:true}),/review_required/,'LAN discovery grants no UART maintenance access');
  setup.records.set(port,{...record,prepareSupported:true,component:'runtime',transport:'maintenance'});
  await assert.rejects(setup.action({action:'return-keyboard',port,version:setup.release.version,confirmBoard:true}),/review_required/);
  await assert.rejects(setup.action({action:'prepare',port,version:setup.release.version,confirmBoard:false}),/review_required/);
  await assert.rejects(setup.action({action:'prepare',port,version:setup.release.version,confirmBoard:true,network:{ssid:'never-used',password:'never-used'}}),/review_required/);
  setup.records.set(port,{...record,component:'qmk',writable:true,nextStep:'ready'});
  await assert.rejects(setup.action({action:'return-keyboard',port,version:setup.release.version,confirmBoard:false}),/review_required/);
  await assert.rejects(setup.action({action:'return-keyboard',port,version:setup.release.version,confirmBoard:true,network:{ssid:'never-used',password:'never-used'}}),/review_required/);
  setup.records.set(port,{...record,component:'qmk',writable:false,nextStep:'enter-dfu'});
  await assert.rejects(setup.action({action:'return-keyboard',port,version:setup.release.version,confirmBoard:true}),/review_required/);
  assert.equal(setup.children.size,0);await hub.close();
});

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
