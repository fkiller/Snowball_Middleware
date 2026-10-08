import test from 'node:test';
import assert from 'node:assert/strict';
import {planDevices,suiteDevices,deviceConfig,suiteRuntime} from '../scripts/suite-devices.mjs';
import {repositoriesFor} from '../scripts/setup-profile.mjs';

const interfaces={Ethernet:[{family:'IPv4',internal:false,address:'192.168.1.2',netmask:'255.255.255.0'}]};
const mk20={controlRoot:'C:/Control',python:'C:/Whisper/python.exe',bind:'192.168.8.2',bindExplicit:false};
const m5={deviceRoot:'C:/M5',python:'C:/M5/python.exe',bind:'192.168.1.2',bindExplicit:false,serial:'COM7'};
test('adding either device preserves the previous adapter; Web update retains installed hardware',()=>{
  assert.deepEqual(planDevices('m5stack',{profile:'mk20'}),['mk20','m5stack']);
  assert.deepEqual(planDevices('mk20',{profile:'m5stack'}),['m5stack','mk20']);
  assert.deepEqual(planDevices('web',{profile:'web',deviceProfiles:['mk20','m5stack']}),['mk20','m5stack']);
  assert.deepEqual(planDevices('web'),[]);
  assert.equal(deviceConfig({profile:'mk20',...mk20},'mk20').python,mk20.python);
  assert.throws(()=>suiteDevices({profile:'web',deviceProfiles:['mk20','mk20']}));
  assert.throws(()=>suiteDevices({profile:'web',deviceProfiles:['other']}));
});
test('dual adapters share one backend and keep transport settings and Python runtimes separate',()=>{
  const config={profile:'m5stack',port:8765,deviceProfiles:['mk20','m5stack'],devices:{mk20,m5stack:m5}};
  const runtime=suiteRuntime(config,interfaces);
  assert.equal(runtime.env.SNOWBALL_PROFILE,'mk20');
  assert.equal(runtime.env.PYTHON_BIN,mk20.python);
  assert.equal(runtime.env.SNOWBALL_BIND,'');
  assert.ok(runtime.gateway.args.includes(m5.python));
  assert.ok(runtime.gateway.args.includes('192.168.1.2'));
  assert.ok(runtime.gateway.args.includes('http://127.0.0.1:8765'));
  assert.deepEqual(repositoriesFor(runtime.profiles).filter(r=>/Control|Device/.test(r)),['Snowball_Control','Snowball_Device_M5Stack']);
  assert.throws(()=>suiteRuntime({...config,devices:{m5stack:m5}},interfaces),/MK20/);
  assert.throws(()=>suiteRuntime({...config,devices:{mk20}},interfaces),/M5Stack/);
});
