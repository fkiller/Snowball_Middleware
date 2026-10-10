import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {firmwareRelation,validUsbPort,publicDevice,M5StackSetup} from '../apps/desktop/m5stack-setup.mjs';

test('firmware comparison distinguishes upgrades, current builds and unsafe downgrades',()=>{
  assert.equal(firmwareRelation('0.4.0','0.5.0'),'older');assert.equal(firmwareRelation('0.5.0','0.5.0'),'current');
  assert.equal(firmwareRelation('0.10.0','0.5.0'),'newer');assert.equal(firmwareRelation(null,'0.5.0'),'unknown');
  assert.equal(validUsbPort('COM12'),true);assert.equal(validUsbPort('/dev/cu.SLAB_USBtoUART'),true);
  for(const port of ['COM0','COM1;whoami','/dev/../../tmp/x','/tmp/ttyUSB0'])assert.equal(validUsbPort(port),false);
});
test('USB status exports firmware/network state without any device secrets',()=>{
  const result=publicDevice({deviceId:'m5-001122334455',firmware:'0.5.0',wifiConfigured:true,wifiSsid:'network',password:'fixture',key:'fixture',hosts:['fixture']});
  assert.deepEqual(Object.keys(result),['deviceId','firmware','wifiConfigured','wifiSsid']);
  assert.throws(()=>publicDevice({deviceId:'wrong',firmware:'0.5.0'}));
});
test('setup rejects unapproved writes and saved-network migration before launching any helper',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-usb-review-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'firmware'));fs.writeFileSync(path.join(root,'firmware/release.json'),JSON.stringify({version:'0.5.0',board:'m5stack-core-esp32'}));
  const setup=new M5StackSetup({device:{deviceRoot:root,python:path.join(root,'never-execute')},backupDirectory:root});
  setup.records.set('COM7',{port:'COM7',online:true,hello:{firmware:'0.4.0',wifiConfigured:true,usbSetup:true}});
  await assert.rejects(setup.action({action:'install',port:'COM7',version:'0.5.0',confirmBoard:false}),/review_required/);
  await assert.rejects(setup.action({action:'install',port:'COM7',version:'0.4.0',confirmBoard:true}),/review_required/);
  await assert.rejects(setup.action({action:'migrate',port:'COM7',ssid:'network'}),/review_required/);
  setup.records.get('COM7').hello.firmware='0.6.0';
  await assert.rejects(setup.action({action:'install',port:'COM7',version:'0.5.0',confirmBoard:true}),/review_required/);
  await assert.rejects(setup.action({action:'install',port:'COM7',version:'0.5.0',confirmBoard:true,path:'arbitrary'}),/invalid_setup_action/);
  assert.equal(setup.children.size,0);assert.equal(setup.job,undefined);
});

test('installed USB helper really enumerates OS ports and reads non-secret Wi-Fi status',{
  skip:!process.env.SNOWBALL_M5STACK_ROOT||!process.env.SNOWBALL_M5_PYTHON,timeout:30000
},async()=>{
  const setup=new M5StackSetup({device:{deviceRoot:process.env.SNOWBALL_M5STACK_ROOT,python:process.env.SNOWBALL_M5_PYTHON},backupDirectory:path.resolve(os.tmpdir())});
  const list=await setup.run('list');assert.equal(list.event,'ports');assert.ok(Array.isArray(list.ports));
  const wifi=await setup.run('wifi');assert.equal(wifi.event,'wifi');assert.equal('password' in (wifi.network??{}),false);
  await setup.close();
});

test('a failed helper protocol terminates its real owned descendant before UART reuse',{
  skip:!process.env.SNOWBALL_M5_PYTHON,timeout:20000
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-usb-teardown-'));
  let descendant;
  t.after(()=>{if(descendant)try{process.kill(descendant);}catch{}assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'firmware'));fs.mkdirSync(path.join(root,'scripts'));
  fs.writeFileSync(path.join(root,'firmware/release.json'),JSON.stringify({version:'0.5.0',board:'m5stack-core-esp32'}));
  // Exercise real OS process cleanup, not a device or an update success.
  fs.writeFileSync(path.join(root,'scripts/usb_setup.py'),`import subprocess,sys,time\nfrom pathlib import Path\nchild=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])\nPath(${JSON.stringify(path.join(root,'descendant.pid'))}).write_text(str(child.pid))\nprint('invalid-protocol',flush=True)\ntime.sleep(60)\n`);
  const setup=new M5StackSetup({device:{deviceRoot:root,python:process.env.SNOWBALL_M5_PYTHON},backupDirectory:root});
  await assert.rejects(setup.run('list'),/invalid_usb_response/);
  descendant=Number(fs.readFileSync(path.join(root,'descendant.pid'),'utf8'));
  let alive=true;const deadline=Date.now()+5000;
  while(alive&&Date.now()<deadline){try{process.kill(descendant,0);await new Promise(r=>setTimeout(r,50));}catch{alive=false;}}
  assert.equal(alive,false,'a helper failure must not leave a flasher descendant alive');
  descendant=undefined;await setup.close();
});
