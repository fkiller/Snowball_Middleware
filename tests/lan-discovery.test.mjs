import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { LanDiscovery, MdnsProbe, inScope } from '../packages/device-lan/dist/index.js';
const codec = createRequire(import.meta.url)('dns-packet');
const iface = { name:'Ethernet',address:'192.168.50.2',netmask:'255.255.255.0' };
const source = '192.168.50.20'; const service = '_snowball._tcp.local';
const fault = value => error => error.code === value;
const rec = (name,type,data,ttl=60) => ({name,type,data,ttl,class:'IN'});
const advert = (label='device',port=8443,ip=source) => [rec(service,'PTR',`${label}.${service}`),rec(`${label}.${service}`,'SRV',{target:`${label}.local`,port}),rec(`${label}.${service}`,'TXT',[Buffer.from('v=1')]),rec(`${label}.local`,'A',ip)];
function fixture(t, query=async()=>[]) {
  const calls=[];let inventory=[iface];
  const discovery = new LanDiscovery({interfaces:()=>inventory,createProbe:selected=>{
    calls.push(['open',selected]);let closed=false;return {query:(questions,signal)=>{calls.push(['query',questions]);return query(questions,signal);},close:()=>{if(!closed){calls.push(['close']);closed=true;}}};
  },resolve:async host=>{calls.push(['dns',host]);return [source];}});
  t.after(()=>discovery.disable());
  return {discovery,calls,setInventory:value=>{inventory=value;}};
}

test('network-off is inert; explicit interface pinning and disable close all pending work',async t=>{
  let resolve; const {discovery,calls}=fixture(t,()=>new Promise(r=>{resolve=r;}));
  assert.equal(discovery.enabled,false);assert.deepEqual(discovery.interfaces(),[iface]);assert.deepEqual(calls,[]);
  await assert.rejects(discovery.scan(),fault('network_disabled'));await assert.rejects(discovery.manual(source,8443),fault('network_disabled'));
  discovery.enable(iface);assert.deepEqual(calls,[]);
  const run=discovery.scan();assert.equal(calls[0][1].address,iface.address);
  discovery.disable();assert.equal(calls.at(-1)[0],'close');resolve([{source,records:advert()}]);
  assert.equal((await run).status,'cancelled');assert.deepEqual(discovery.list(),[]);
});

test('scoped advertisement creates unpaired candidates only and preserves multiple services',async t=>{
  const {discovery,calls}=fixture(t,async()=>[{source,records:[...advert('first',8443),...advert('second',8444)]}]);
  discovery.enable(iface);const result=await discovery.scan();assert.equal(result.status,'complete');assert.equal(result.candidates.length,2);
  assert.ok(result.candidates.every(c=>c.control===false&&c.enrollment==='unpaired'&&!('verifiedIdentity'in c)));
  assert.deepEqual(calls.filter(c=>c[0]==='query')[0][1],[{name:service,type:'PTR'}]);assert.equal(calls.filter(c=>c[0]==='query').length,1);
});

test('PTR then SRV/TXT then A uses bounded exact followups, not a subnet/port sweep',async t=>{
  let round=0;const records=advert();const {discovery,calls}=fixture(t,async()=>[{source,records:round++===0?[records[0]]:round===2?records.slice(1,3):[records[3]]}]);
  discovery.enable(iface);const result=await discovery.scan();assert.equal(result.candidates.length,1);
  const queries=calls.filter(c=>c[0]==='query').map(c=>c[1]);assert.equal(queries.length,3);assert.deepEqual(queries[1].map(q=>q.type),['SRV','TXT']);assert.deepEqual(queries[2],[{name:'device.local',type:'A'}]);
});

test('blocked/no mDNS gives manual fallback; hostname resolution freezes one in-scope numeric address',async t=>{
  const {discovery,calls}=fixture(t);discovery.enable(iface);
  const empty=await discovery.scan();assert.equal(empty.status,'empty');assert.match(empty.reason,/manual_address/);
  const result=await discovery.manual('controller.local',8443);assert.equal(result.address,source);assert.equal(result.protocol,'unverified');assert.equal(result.control,false);
  assert.equal(calls.filter(c=>c[0]==='query').length,1);assert.equal(calls.filter(c=>c[0]==='dns').length,1);
  for(const [host,port]of [['https://user:secret@192.168.50.20',8443],['192.168.50.20/path',8443],[source,0],[source,65536]])await assert.rejects(discovery.manual(host,port),fault('invalid_endpoint'));
  for(const address of ['8.8.8.8','127.0.0.1','0.0.0.0','224.0.0.251','192.168.51.1','192.168.50.255','192.168.50.0'])await assert.rejects(discovery.manual(address,8443),fault('endpoint_outside_selected_network'));
});

test('spoofed sender, public redirect, incompatible TXT and cross-sender record stitching never qualify',async t=>{
  for(const replies of [[{source:'8.8.8.8',records:advert()}],[{source,records:advert('x',8443,'8.8.8.8')}],[{source,records:advert().map(r=>r.type==='TXT'?{...r,data:[Buffer.from('v=9')]}:r)}],[{source,records:advert().slice(0,2)},{source:'192.168.50.21',records:advert().slice(2)}]]){
    const {discovery}=fixture(t,async()=>replies);discovery.enable(iface);assert.equal((await discovery.scan()).candidates.length,0);
  }
});

test('multi-NIC/VPN selection, removal and address changes cannot redirect an old discovery generation',async t=>{
  let resolve;const {discovery,calls,setInventory}=fixture(t,()=>new Promise(r=>{resolve=r;}));
  const vpn={name:'VPN',address:'10.20.0.2',netmask:'255.255.255.0'};setInventory([iface,vpn]);discovery.enable(iface);const run=discovery.scan();
  discovery.enable(vpn);resolve([{source,records:advert()}]);assert.equal((await run).status,'cancelled');assert.deepEqual(discovery.list(),[]);
  assert.equal(calls.filter(c=>c[0]==='open')[0][1].name,'Ethernet');
  setInventory([]);await assert.rejects(discovery.manual('10.20.0.3',8443),fault('interface_changed'));assert.equal(discovery.enabled,false);
  assert.equal(inScope('192.168.50.22',iface),true);assert.equal(inScope('192.168.50.22',{...iface,netmask:'255.0.255.0'}),false);
});

test('DNS cancellation discards late results and mixed or ambiguous answers fail closed',async t=>{
  let resolve;const discovery=new LanDiscovery({interfaces:()=>[iface],timeoutMs:20,resolve:()=>new Promise(r=>{resolve=r;})});t.after(()=>discovery.disable());discovery.enable(iface);
  await assert.rejects(discovery.manual('device.local',8443),fault('cancelled'));await assert.rejects(discovery.manual('device.local',8443),fault('resolver_busy'));
  resolve([source]);await new Promise(r=>setImmediate(r));assert.deepEqual(discovery.list(),[]);
  for(const [addresses,code]of [[[source,'8.8.8.8'],'endpoint_outside_selected_network'],[[source,'192.168.50.21'],'ambiguous_address']]){
    const other=new LanDiscovery({interfaces:()=>[iface],resolve:async()=>addresses});t.after(()=>other.disable());other.enable(iface);await assert.rejects(other.manual('device.local',8443),fault(code));
  }
});

test('TTL expiry and refreshed address stay candidate changes, never stable identity reassignment',async t=>{
  let now=100;let address=source;const discovery=new LanDiscovery({interfaces:()=>[iface],now:()=>now,createProbe:()=>({query:async()=>[{source:address,records:advert('device',8443,address).map(r=>({...r,ttl:1}))}],close(){}})});t.after(()=>discovery.disable());discovery.enable(iface);
  const old=(await discovery.scan()).candidates[0];now+=1001;assert.deepEqual(discovery.list(),[]);address='192.168.50.21';const next=(await discovery.scan()).candidates[0];
  assert.notEqual(next.candidateId,old.candidateId);assert.notEqual(next.address,old.address);assert.equal(next.enrollment,'unpaired');
});

test('real UDP driver binds chosen loopback only, exchanges bounded DNS and closes after cancel',async t=>{
  const responder=dgram.createSocket('udp4');responder.bind(0,'127.0.0.1');await once(responder,'listening');t.after(()=>responder.close());let seen;
  responder.on('message',(bytes,remote)=>{seen=remote;const query=codec.decode(bytes);const invalid=codec.encode({type:'response',id:(query.id+1)%65536,answers:advert()});const valid=codec.encode({type:'response',id:query.id,answers:advert()});responder.send(invalid,remote.port,remote.address);responder.send(valid,remote.port,remote.address);});
  const probe=new MdnsProbe('127.0.0.1',{address:'127.0.0.1',port:responder.address().port},100);t.after(()=>probe.close());
  const replies=await probe.query([{name:service,type:'PTR'}],new AbortController().signal);assert.equal(replies.length,1);assert.equal(seen.address,'127.0.0.1');assert.equal(replies[0].records.length,4);
  const run=probe.query([{name:service,type:'PTR'}],new AbortController().signal);probe.close();await assert.rejects(run,fault('cancelled'));
  assert.throws(()=>probe.query([{name:service,type:'PTR'}],new AbortController().signal),fault('probe_unavailable'));
});
