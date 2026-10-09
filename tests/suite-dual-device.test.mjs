import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chooseLanAddress,parseSetupOptions} from '../scripts/setup-profile.mjs';
import {planDevices,planDeviceConfigs} from '../scripts/suite-devices.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),deviceRoot=process.env.SNOWBALL_M5STACK_ROOT;
test('real dual-device suite advertises MK20 and signs M5Stack discovery with the same actual host identity',{
  skip:!deviceRoot,timeout:120000,
},async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball dual '));
  const m5=path.join(temp,'m5');fs.mkdirSync(m5);
  for(const directory of ['scripts','src'])fs.cpSync(path.join(deviceRoot,directory),path.join(m5,directory),{recursive:true});
  fs.mkdirSync(path.join(m5,'.local'));
  const key='e'.repeat(64);fs.writeFileSync(path.join(m5,'.local','pairing.key'),key,{mode:0o600});
  fs.writeFileSync(path.join(m5,'.local','device.json'),JSON.stringify({deviceId:'m5-001122334455'}));
  const portProbe=net.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
  const bind=chooseLanAddress(),plugins=[];
  for(const kind of ['codex','antigravity','opencode']){
    const directory=path.join(root,'packages/harness-'+kind),exported=await import(pathToFileURL(path.join(directory,'dist/index.js')));
    const manifest=await exported[kind+'Manifest']();plugins.push({kind,directory,entrySha256:manifest.integrity.entrySha256});
  }
  const options=parseSetupOptions([]),profiles=planDevices(options.profile),devices=planDeviceConfigs(options,undefined,temp);
  Object.assign(devices.mk20,{controlRoot:process.env.SNOWBALL_TEST_MK20_COMPOSITION_ROOT??path.join(temp,'absent-control'),python:'python',bind,bindExplicit:true});
  Object.assign(devices.m5stack,{deviceRoot:m5,python:'python',bind,bindExplicit:true});
  assert.equal(devices.m5stack.serial,undefined);
  const config=path.join(temp,'suite.json');fs.writeFileSync(config,JSON.stringify({version:1,profile:options.profile,port,dataDir:path.join(temp,'state'),plugins,openBrowser:false,deviceProfiles:profiles,devices}));
  const peer=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{peer.once('error',reject);peer.bind(7701,bind,resolve);});
  let output='',ready=false,mk20ReplyPort,m5Offer;const frames=[];
  peer.on('message',(bytes,remote)=>{if(remote.address!==bind)return;try{const frame=JSON.parse(bytes);if(frame.type==='v2_sync')frames.push(frame);}catch{if(bytes.toString().startsWith('SNMK1\tOFFER\t'))mk20ReplyPort=remote.port;}});
  const child=spawn(process.execPath,[path.join(root,'scripts/start-suite.mjs'),'--config',config],{cwd:root,env:{...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const exited=once(child,'exit');child.on('message',m=>{if(m.kind==='suite-ready')ready=true;});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-6000);});
  t.after(async()=>{peer.close();if(child.connected)child.send('snowball.stop');const timer=setTimeout(()=>child.kill(),10000);await exited;clearTimeout(timer);assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});});
  const deadline=Date.now()+90000;while(!ready&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.ok(ready,output);
  const origin=`http://127.0.0.1:${port}`,snapshot=await (await fetch(origin+'/v1/snapshot',{headers:{Origin:origin}})).json();
  assert.equal(snapshot.hostId,JSON.parse(fs.readFileSync(path.join(temp,'state','host.v1.json'))).hostId);
  async function query(bytes,port,match){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{peer.off('message',receive);reject(Error('discovery_timeout'));},10000);function receive(bytes,remote){if(remote.address!==bind)return;const result=match(bytes.toString());if(result){clearTimeout(timer);peer.off('message',receive);resolve(result);}}peer.on('message',receive);peer.send(Buffer.from(bytes),port,bind);});}
  const mk20=await query('SNMK1\tDISCOVER\tmk20-aabbccddeeff',47772,text=>text.startsWith('SNMK1\tOFFER\t')?text.split('\t'):null);
  assert.equal(mk20[2],snapshot.hostId);
  const nonce='c'.repeat(16),sign=value=>createHmac('sha256',key).update(value).digest('hex');
  for(const version of [1,2]){
    const offer=await query(JSON.stringify({type:'snowball.discover',nonce,...(version===2?{version}: {})}),47770,text=>{try{const o=JSON.parse(text);return o.nonce===nonce?o:null;}catch{return null;}});
    assert.equal(offer.hostId,snapshot.hostId);
    m5Offer=offer;
    const proof=`discover\n${nonce}\n${offer.epoch}\n${offer.ip}\n${offer.port}\n${offer.host}`+(version===2?`\n${offer.hostId}`:'');
    assert.equal(offer.mac,sign(proof));
    assert.notEqual(offer.mac,createHmac('sha256','d'.repeat(64)).update(proof).digest('hex'));
    if(version===2)assert.notEqual(offer.mac,sign(proof.replace(offer.hostId,'host_'+'f'.repeat(32))));
  }
  if(process.env.SNOWBALL_TEST_MK20_COMPOSITION_ROOT){
    const lease='a'.repeat(32),selection=`SNMK1\tSELECT\tmk20-aabbccddeeff\t${snapshot.hostId}\t${lease}`;
    const heartbeat=setInterval(()=>peer.send(Buffer.from(selection),mk20ReplyPort,bind),1000);
    try{
      peer.send(Buffer.from(selection),mk20ReplyPort,bind);
      const until=Date.now()+60000;while(!frames.some(f=>f.lease===lease)&&child.exitCode===null&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
      assert.ok(frames.some(f=>f.lease===lease),'Actual MK20 composition did not emit a scoped frame');
      const payload=JSON.stringify({op:'poll'}),boot='b'.repeat(16),seq=1;
      const mac=sign(`request\n${m5Offer.epoch}\n${boot}\n${seq}\n${payload}`);
      const response=await fetch(`http://${bind}:47771/device`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({epoch:m5Offer.epoch,boot,seq,payload,mac}),signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,200);const envelope=await response.json();
      assert.equal(envelope.mac,sign(`response\n${m5Offer.epoch}\n${boot}\n${seq}\n${envelope.payload}`));
      const view=JSON.parse(envelope.payload);assert.equal(view.connected,true);
      assert.match(view.controllerId,/^ctl_[a-f0-9]{16}$/);
      assert.match(frames.find(f=>f.lease===lease).controllerId,/^ctl_[a-f0-9]{16}$/);
      assert.notEqual(view.controllerId,frames.find(f=>f.lease===lease).controllerId);
      assert.equal((await fetch(origin+'/v1/snapshot',{headers:{Origin:origin}})).status,200);
    }finally{clearInterval(heartbeat);peer.send(Buffer.from(`SNMK1\tRELEASE\tmk20-aabbccddeeff\t${snapshot.hostId}\t${lease}`),mk20ReplyPort,bind);}
  }
  child.send('snowball.stop');assert.equal((await exited)[0],0,output);
  await assert.rejects(fetch(origin+'/v1/snapshot'));
});
