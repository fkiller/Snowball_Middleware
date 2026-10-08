import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LocalClient} from '../packages/client-sdk/dist/index.js';

const root=fileURLToPath(new URL('..',import.meta.url));
let nativeAvailable=false;
try{nativeAvailable=fs.existsSync(createRequire(import.meta.url)('electron'));}catch{}
test('installed suite: native tray owns the real runtime after launcher exit and stops its children',{
  skip:!['win32','darwin'].includes(process.platform)||!nativeAvailable,timeout:150000,
},async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-installed-'));
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const plugins=[];
  for(const kind of ['codex','antigravity','opencode']){
    const directory=path.join(root,'packages/harness-'+kind);
    const module=await import(pathToFileURL(path.join(directory,'dist/index.js')));
    const manifest=await module[kind+'Manifest']();plugins.push({kind,directory,entrySha256:manifest.integrity.entrySha256});
  }
  const config=path.join(temp,'suite.json');
  fs.writeFileSync(config,JSON.stringify({version:1,desktopVersion:1,nodeExecutable:process.execPath,profile:'web',port,dataDir:path.join(temp,'state'),plugins}));
  async function launch(extra=[],file=config,expected=0){
    const child=spawn(process.execPath,[path.join(root,'scripts/start-installed.mjs'),'--config',file,...extra],{cwd:root,env:{...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:'true'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>output+=bytes);
    const timer=setTimeout(()=>child.kill(),110000);
    const [code]=await once(child,'exit');clearTimeout(timer);
    assert.equal(code,expected,output);return output;
  }
  t.after(async()=>{try{await launch(['--stop']);}finally{fs.rmSync(temp,{recursive:true,force:true});}});
  assert.match(await launch(),/running in the background/);
  const marker=JSON.parse(fs.readFileSync(path.join(temp,'desktop.v1.json')));
  process.kill(marker.pid,0);
  const client=new LocalClient(`http://127.0.0.1:${port}`);
  let snapshot=await client.snapshot();
  assert.equal(snapshot.accessMode,'local-no-auth');assert.equal(snapshot.desktopCapabilities.tray,true);
  const conflict=path.join(temp,'conflict');fs.mkdirSync(conflict);
  const conflictingConfig=path.join(conflict,'suite.json');
  fs.writeFileSync(conflictingConfig,JSON.stringify({...JSON.parse(fs.readFileSync(config)),dataDir:path.join(conflict,'state')}));
  assert.match(await launch([],conflictingConfig,1),/startup failed/);
  assert.equal((await client.snapshot()).desktopCapabilities.tray,true,'An occupied port must not terminate its owner');
  await client.updateSettings(snapshot.settings.revision,{controlPaused:true,language:'en'});
  snapshot=await client.snapshot();assert.equal(snapshot.settings.controlPaused,true);
  assert.match(await launch(),/already running/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'desktop.v1.json'))).pid,marker.pid);
  await launch(['--stop']);assert.equal(fs.existsSync(path.join(temp,'desktop.v1.json')),false);
  await assert.rejects(client.snapshot());
  assert.match(await launch(),/running in the background/);
  snapshot=await client.snapshot();assert.equal(snapshot.settings.controlPaused,true);assert.equal(snapshot.settings.language,'en');
  await client.updateSettings(snapshot.settings.revision,{controlPaused:false});
});
