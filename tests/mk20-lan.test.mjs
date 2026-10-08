import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import os from 'node:os';
import { once } from 'node:events';
import { startMk20Lan } from '../scripts/mk20-lan.mjs';
import { chooseLanAddress } from '../scripts/setup-profile.mjs';

test('real LAN UDP selection renews, releases, expires and fences stale operations', {timeout:20000}, async t => {
  const bind = chooseLanAddress(os.networkInterfaces());
  const peer = dgram.createSocket('udp4');
  await new Promise(resolve => peer.bind(7701, bind, resolve));
  t.after(() => peer.close());
  let now=1000, records=[], closed=[],finishCleanup;
  const cleanupPending=new Promise(resolve=>finishCleanup=resolve);
  const stop = await startMk20Lan({hostId:'host_test',name:'Actual test transport',bind,port:47773,now:()=>now,announce:false,
    startRuntime: async record => { records.push(record); return async()=>{if(record.leaseToken==='a'.repeat(32))await cleanupPending;closed.push(record.leaseToken);}; }});
  t.after(async()=>{finishCleanup();await stop();});
  const send=message=>new Promise((resolve,reject)=>peer.send(Buffer.from(message),47773,bind,error=>error?reject(error):resolve()));
  const settle=()=>new Promise(resolve=>setTimeout(resolve,100));
  const id='mk20-aabbccddeeff', a='a'.repeat(32), b='b'.repeat(32);
  // Other real middleware hosts broadcast on this LAN too. Inspect only the
  // response from this test's endpoint, not whichever host announces first.
  const response=(async()=>{for(;;){const message=await once(peer,'message');if(message[1].address===bind)return message;}})(); await send(`SNMK1\tDISCOVER\t${id}`);
  assert.equal((await response)[0].toString(),'SNMK1\tOFFER\thost_test\tActual test transport\t1');
  await send(`SNMK1\tSELECT\t${id}\thost_other\t${a}`); await settle();assert.equal(records.length,0);
  await send(`SNMK1\tSELECT\t${id}\thost_test\t${a}`);await settle();assert.equal(records.length,1);assert.equal(records[0].isActive(),true);
  await send(`SNMK1\tSELECT\t${id}\thost_test\t${a}`);await settle();assert.equal(records.length,1);
  await send(`SNMK1\tSELECT\tmk20-000000000000\thost_test\t${b}`);await settle();assert.equal(records.length,1);
  now+=1000;
  await send(`SNMK1\tSELECT\t${id}\thost_test\t${b}`);await settle();assert.equal(records.length,2);assert.equal(records[0].isActive(),false);assert.deepEqual(closed,[]);finishCleanup();await settle();
  await send(`SNMK1\tRELEASE\t${id}\thost_test\t${a}`);await settle();assert.equal(records[1].isActive(),true);
  await send(`SNMK1\tSELECT\t${id}\thost_test\t${a}`);await settle();assert.equal(records.length,2);assert.equal(records[1].isActive(),true);
  now+=9000;await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(records[1].isActive(),false);
  assert.deepEqual(closed,[a,b]);
});
