import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkBoundaries} from '../scripts/check-boundaries.mjs';
import {PluginHost} from '../packages/plugin-host/dist/index.js';
import {manifest} from '../examples/standalone-device-plugin/manifest.mjs';
import {fileURLToPath} from 'node:url';
test('package imports preserve declared public dependency boundaries',()=>assert.deepEqual(checkBoundaries(),[]));
test('standalone reference conforms to the real plugin host',async t=>{
 const m=await manifest();const host=new PluginHost({directory:fileURLToPath(new URL('../examples/standalone-device-plugin',import.meta.url)),manifest:m,approvedDigests:new Map([[m.id,m.integrity.entrySha256]])});
 t.after(()=>host.stop());await host.start();
 assert.equal((await host.request('devices.list',{})).length,2);
 await assert.rejects(host.request('sessions.send',{}));
});
