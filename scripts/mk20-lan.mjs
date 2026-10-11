import dgram from 'node:dgram';
import os from 'node:os';
import { privateIpv4 } from './setup-profile.mjs';

// Device initiated discovery and selection. This dedicated Preview endpoint
// never exposes the loopback Supervisor API, paths or arbitrary commands.
export async function startMk20Lan({ hostId, name, bind, port = 47772, startRuntime, onObserved = () => {}, now = Date.now, announce = true }) {
  if (!privateIpv4(bind)) throw Error('MK20 discovery needs a private LAN bind address');
  const socket = dgram.createSocket('udp4');
  const reply = dgram.createSocket('udp4');
  const nic=Object.values(os.networkInterfaces()).flat().find(n=>n?.address===bind&&n.family==='IPv4');
  if(!nic)throw Error('Selected MK20 LAN adapter is unavailable');
  const onLink=address=>address.split('.').every((octet,i)=>(Number(octet)&Number(nic.netmask.split('.')[i]))===(Number(bind.split('.')[i])&Number(nic.netmask.split('.')[i])));
  let active, closed = false, queue = Promise.resolve();
  const windows = new Map();
  const observations = new Map();
  const observe=(deviceId,address)=>{
    const key=deviceId+'/'+address,previous=observations.get(key);
    if(previous!==undefined&&now()-previous<2000)return;
    observations.set(key,now());if(observations.size>64)observations.delete(observations.keys().next().value);
    // Read-only presence. This never pairs, selects, dispatches or proves USB identity.
    try{onObserved({deviceId,address});}catch{}
  };
  const disposals=new Set();
  const retired = new Set();
  const send = (value, peer) => reply.send(Buffer.from(value), peer.port, peer.address, () => {});
  let safeName='';for(const char of name.replace(/[\x00-\x1f\x7f]/g,' ')){if(Buffer.byteLength(safeName+char)>63)break;safeName+=char;}
  const offer=`SNMK1\tOFFER\t${hostId}\t${safeName}\t1`;
  const stop = (record, retire = true) => {
    if (!record) return;
    if(retire){retired.add(record.key);if(retired.size>64)retired.delete(retired.values().next().value);}
    record.selected = false;
    if (active === record) active = undefined;
    const disposal=record.runtime.then(runtime=>runtime?.()).catch(error=>console.error('MK20 release:',error.message));
    disposals.add(disposal);void disposal.finally(()=>disposals.delete(disposal));
  };
  const receive = (bytes, peer) => {
    if (closed || bytes.length > 256 || !privateIpv4(peer.address) || !onLink(peer.address) || peer.port !== 7701) return;
    const second = Math.floor(now() / 1000);
    let window = windows.get(peer.address);
    if (!window || window.second !== second) windows.set(peer.address, window = { second, count: 0 });
    if (++window.count > 10) return;
    if (windows.size > 256) windows.delete(windows.keys().next().value);
    const fields = bytes.toString('ascii').split('\t');
    if (fields[0] !== 'SNMK1' || !/^mk20-[a-f0-9]{12}$/.test(fields[2] ?? '')) return;
    if (fields[1] === 'DISCOVER' && fields.length === 3) {
      observe(fields[2],peer.address);
      send(offer, peer);
    } else if (fields[1] === 'SELECT' && fields.length === 5 && fields[3] === hostId && /^[a-f0-9]{32}$/.test(fields[4])) {
      observe(fields[2],peer.address);
      const key = fields[2] + '/' + fields[4] + '/' + peer.address;
      if(retired.has(key))return;
      if (active?.key === key) { active.seen = now(); return; }
      // One controller lease per host composition. A second physical device
      // cannot steal a live lease; this profile currently supports one MK20.
      if (active && active.deviceId !== fields[2] && now() - active.seen < 8000) return;
      stop(active);
      const record = { key, deviceId: fields[2], lease: fields[4], address: peer.address, selected: true, seen: now() };
      active = record;
      // No lease/token or native session content belongs in connection diagnostics.
      console.log(`MK20 selection received from ${peer.address}; starting local runtime`);
      record.runtime = queue.then(() => record.selected ? startRuntime({ targetAddress: record.address, deviceId: record.deviceId, leaseToken: record.lease, isActive: () => record.selected && !closed }) : undefined).catch(error => {
        console.error('MK20 activation failed:', error.message);
        record.selected=false;
        if (active === record) active = undefined;
      });
      queue=record.runtime.then(()=>{});
    } else if (fields[1] === 'RELEASE' && fields.length === 5 && fields[3] === hostId && active?.key === fields[2] + '/' + fields[4] + '/' + peer.address) stop(active);
  };
  socket.on('message',receive);reply.on('message',receive);
  socket.on('error', error => console.error('MK20 discovery:', error.message));
  reply.on('error', error => console.error('MK20 reply:', error.message));
  try {
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(port, '0.0.0.0', () => { socket.off('error', reject); resolve(); }); });
    await new Promise((resolve,reject)=>{reply.once('error',reject);reply.bind(0,bind,()=>{reply.off('error',reject);resolve();});});
  } catch(error) {try{socket.close();}catch{}try{reply.close();}catch{}throw error;}
  // Broadcast response exemptions depend on the OS/profile policy. Receiving
  // an OFFER on MK20 does not prove that its SELECT can reach this socket.
  reply.setBroadcast(true);
  console.log(`MK20 discovery listening on ${bind}:${reply.address().port}; LAN queries UDP ${port}`);
  const broadcast=bind.split('.').map((octet,i)=>(Number(octet)&Number(nic.netmask.split('.')[i]))|(255^Number(nic.netmask.split('.')[i]))).join('.');
  const beacon=setInterval(()=>{if(!closed&&announce)send(offer,{address:broadcast,port:7701});},2000);
  beacon.unref();if(announce)send(offer,{address:broadcast,port:7701});
  const timer = setInterval(() => { if (active && now() - active.seen > 8000) stop(active,false); }, 1000);
  timer.unref();
  return async () => { if (closed) return; closed = true; clearInterval(timer);clearInterval(beacon); stop(active); await queue; await Promise.all([...disposals]);await Promise.all([new Promise(resolve => socket.close(resolve)),new Promise(resolve=>reply.close(resolve))]); };
}
