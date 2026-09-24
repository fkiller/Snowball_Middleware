import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';
import {LocalClient} from '../packages/client-sdk/dist/index.js';
test('native setting success requires an actual side-effect port and durable settings; rejected effect leaves revision unchanged',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-native-settings-'));let installed=false,calls=0,reject=false;
 const runtime=await startLocalRuntime({dataDir:path.join(directory,'state'),desktop:{getAutostart:async()=>installed,setAutostart:async enabled=>{calls++;if(reject)throw new Error('OS rejected');installed=enabled;}}});
 t.after(async()=>{await runtime.close();fs.rmSync(directory,{recursive:true,force:true});});
 const client=new LocalClient(runtime.origin);let state=await client.snapshot();assert.equal(state.desktopCapabilities.autostart,true);
 await client.updateSettings(state.settings.revision,{autostart:true});assert.equal(installed,true);assert.equal(calls,1);
 state=await client.snapshot();const revision=state.settings.revision;reject=true;
 await assert.rejects(client.updateSettings(revision,{autostart:false}),e=>e.code==='settings_apply_failed');
 assert.equal((await client.snapshot()).settings.revision,revision);assert.equal((await client.snapshot()).settings.autostart,true);
 const saved=JSON.parse(fs.readFileSync(path.join(directory,'state','settings.v1.json'),'utf8'));assert.equal(saved.settings.autostart,true);
});
