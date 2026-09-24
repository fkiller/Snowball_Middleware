import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {manifest} from './manifest.mjs';
test('standalone worker handshake, no harness control, distinct device destinations',async t=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url))],{stdio:'pipe',windowsHide:true});
  t.after(()=>child.kill());
  const messages=[];let buffer='';
  child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)messages.push(JSON.parse(line));});
  let id=0;
  async function request(method,params){const n=++id;child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');for(let i=0;i<200;i++){const r=messages.find(m=>m.id===n);if(r)return r;await new Promise(r=>setTimeout(r,10));}throw Error('worker deadline');}
  assert.ok((await request('devices.list',{})).error);
  assert.equal((await request('plugin.initialize',{apiVersion:'1.0.0',pluginId:'example.virtual-device'})).result.apiVersion,'1.0.0');
  assert.equal((await request('devices.list',{})).result.length,2);
  for(const deviceId of ['virtual-1','virtual-2'])assert.equal((await request('devices.render',{deviceId,text:deviceId})).result.deviceId,deviceId);
  assert.ok((await request('sessions.send',{text:'never'})).error);
  assert.equal((await manifest()).integrity.entrySha256.length,64);
  child.stdin.end();
});
