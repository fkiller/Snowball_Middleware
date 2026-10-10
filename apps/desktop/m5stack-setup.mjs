import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

export function firmwareRelation(installed, available) {
  const parse=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null;
  const a=parse(installed),b=parse(available);if(!a||!b)return 'unknown';
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?'older':'newer';return 'current';
}
export const validUsbPort=value=>typeof value==='string'&&/^(?:COM[1-9][0-9]*|\/dev\/(?:tty|cu\.)[a-zA-Z0-9._-]+)$/.test(value);
export const publicDevice=hello=>{
  if(!hello||!/^m5-[a-f0-9]{12}$/.test(hello.deviceId??'')||!/^\d+\.\d+\.\d+$/.test(hello.firmware??''))throw Error('invalid_device_response');
  return Object.fromEntries(['deviceId','firmware','faces','flashBytes','lanPairing','usbSetup','wifiConfigured','wifiConnected','wifiSsid'].filter(k=>hello[k]!==undefined).map(k=>[k,hello[k]]));
};

/** Trusted desktop only; renderer supplies selections, never paths or commands. */
export class M5StackSetup extends EventEmitter {
  constructor({device,backupDirectory,uart=async()=>{}}) {
    super();if(!path.isAbsolute(device.deviceRoot)||!path.isAbsolute(device.python)||!path.isAbsolute(backupDirectory))throw Error('absolute_device_paths_required');
    this.device=device;this.backupDirectory=backupDirectory;this.uart=uart;this.records=new Map();this.children=new Set();
    this.release=JSON.parse(fs.readFileSync(path.join(device.deviceRoot,'firmware/release.json'),'utf8'));
    if(this.release.board!=='m5stack-core-esp32'||firmwareRelation(this.release.version,this.release.version)!=='current')throw Error('invalid_firmware_release');
  }
  view(){return {release:this.release,devices:[...this.records.values()].map(r=>({...r})),busy:!!this.job,checking:!!this.scanning,network:this.network??null,code:this.code??null};}
  changed(){this.emit('change',this.view());}
  run(command,port,payload={},onEvent=()=>{}) {
    return new Promise((resolve,reject)=>{
      const argv=[path.join(this.device.deviceRoot,'scripts/usb_setup.py'),'--command',command,...(port?['--port',port]:[]),...(command==='install'?['--backup-dir',this.backupDirectory]:[])];
      const child=spawn(this.device.python,argv,{cwd:this.device.deviceRoot,windowsHide:true,shell:false,detached:process.platform!=='win32',env:{...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:'true',PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']});
      this.children.add(child);let buffer='',last,failure,bytes=0,termination;
      const terminate=()=>{
        if(termination||!child.pid)return termination;
        // Never resume a UART while a timed-out flasher/build descendant lives.
        termination=new Promise(resolve=>{
          if(process.platform==='win32'){
            const killer=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
            killer.once('error',()=>{failure='usb_stop_unconfirmed';child.kill();resolve();});
            killer.once('exit',code=>{if(code&&child.exitCode===null){failure='usb_stop_unconfirmed';child.kill();}resolve();});
          }else{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')failure='usb_stop_unconfirmed';}resolve();}
        });return termination;
      };
      child.stopOwned=terminate;
      const timer=setTimeout(()=>{failure='usb_operation_timed_out';void terminate();},command==='install'?1500000:command==='migrate'?100000:command==='wifi'?70000:15000);
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload)+'\n');child.stderr.resume();
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        bytes+=chunk.length;buffer+=chunk.toString('utf8');if(bytes>1024*1024||buffer.length>65536){failure='usb_response_limit';void terminate();return;}
        let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line);}catch{failure='invalid_usb_response';void terminate();return;}last=event;if(event.event==='error')failure=/^[a-z0-9_]{1,80}$/.test(event.code)?event.code:'usb_operation_failed';else try{onEvent(event);}catch{/* A progress-view failure must never kill a real flasher. */}}
      });
      child.once('error',()=>{failure='usb_helper_unavailable';});
      child.once('close',async code=>{clearTimeout(timer);await termination;this.children.delete(child);if(code||failure||!last)reject(Error(failure??'usb_operation_failed'));else resolve(last);});
    });
  }
  async withUart(port,fn){
    let safeToResume=true;
    try{await this.uart('release',port);return await fn();}catch(error){safeToResume=error.message!=='usb_stop_unconfirmed';throw error;}finally{if(safeToResume)await this.uart('resume',port);}
  }
  async probe(record){
    record.phase='checking';this.changed();
    try{
      const result=await this.withUart(record.port,()=>this.run('probe',record.port));
      if(this.closed)return;
      if(result.event!=='device')throw Error('invalid_device_response');
      record.hello=result.hello?publicDevice(result.hello):null;record.status=result.status;record.phase='ready';record.code=null;
    }catch(error){record.phase='failed';record.code=error.message;}
    this.changed();
    if(!this.closed)this.emit('attached',record);
  }
  async scan(force=false){
    if(this.closed||this.scanning||this.job)return;this.scanning=true;
    try{
      const result=await this.run('list');if(this.closed)return;
      if(result.event!=='ports'||!Array.isArray(result.ports)||result.ports.length>32)throw Error('invalid_usb_response');
      const ports=result.ports.filter(p=>validUsbPort(p.port));
      const present=new Set(ports.map(p=>p.port));
      for(const r of this.records.values())r.online=present.has(r.port);
      for(const candidate of ports){
        let record=this.records.get(candidate.port);
        const identity=String(candidate.usbIdentity??'').slice(0,128);
        if(!record||record.usbIdentity!==identity||!record.wasPresent||force){
          record={port:candidate.port,label:String(candidate.label??'CP210x USB UART').slice(0,128),usbIdentity:identity,online:true,wasPresent:true,phase:'checking',hello:null,status:'unknown'};
          this.records.set(record.port,record);await this.probe(record);
        }
      }
      for(const record of this.records.values())record.wasPresent=record.online;
      if(this.records.size>32)for(const [port,record]of this.records)if(!record.online)this.records.delete(port);
      this.code=null;
    }catch(error){this.code=error.message;}finally{this.scanning=false;this.changed();}
  }
  start(){void this.scan();this.timer=setInterval(()=>void this.scan(),3000);this.timer.unref();}
  async action(request){
    if(this.closed||!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['action','port','version','confirmBoard','ssid','migrateWifi'].includes(k)))throw Error('invalid_setup_action');
    if(this.job||(this.scanning&&request.action!=='wifi'))throw Error('usb_setup_busy');
    if(request.action==='refresh'){await this.scan(true);return this.view();}
    if(request.action==='wifi'){
      const result=await this.run('wifi');this.network=result.network?.ssid?{ssid:String(result.network.ssid).slice(0,32),enterprise:result.network.enterprise===true}:null;this.changed();return this.view();
    }
    const record=this.records.get(request.port);
    if(!validUsbPort(request.port)||!record?.online)throw Error('usb_device_disconnected');
    if(request.action==='install'){
      if(request.version!==this.release.version||request.confirmBoard!==true||firmwareRelation(record.hello?.firmware,this.release.version)==='newer')throw Error('firmware_review_required');
      if(request.migrateWifi===true&&(typeof request.ssid!=='string'||request.ssid!==this.network?.ssid||this.network.enterprise))throw Error('wifi_review_required');
    }else if(request.action==='migrate'){
      if(record.hello?.usbSetup!==true||record.hello?.wifiConfigured!==false||typeof request.ssid!=='string'||request.ssid!==this.network?.ssid||this.network.enterprise)throw Error('wifi_review_required');
    }else throw Error('invalid_setup_action');
    record.code=null;record.phase=request.action==='install'?'identify':'wifi';
    const job=(async()=>{
      try{
        await this.withUart(record.port,async()=>{
        const result=await this.run(request.action,record.port,{version:request.version,confirmBoard:request.confirmBoard,deviceId:record.hello?.deviceId,usbIdentity:record.usbIdentity,ssid:request.ssid},event=>{
          if(event.event==='progress'&&['identify','backup','backup-verified','build','flash','verify-nvs','reboot'].includes(event.phase)){
            record.phase=event.phase;if(event.backup&&path.dirname(event.backup)===this.backupDirectory)record.backup=event.backup;this.changed();
          }
        });
        record.hello=publicDevice(result.hello);record.status='snowball';
        if(request.action==='install'&&request.migrateWifi===true&&record.hello.usbSetup===true&&record.hello.wifiConfigured===false){
          record.phase='wifi';this.changed();
          const migrated=await this.run('migrate',record.port,{ssid:request.ssid,deviceId:record.hello.deviceId});
          record.hello=publicDevice(migrated.hello);
        }
        });
        record.phase='complete';
      }catch(error){record.phase='failed';record.code=error.message;}finally{this.job=null;this.changed();}
    })();
    this.job=job;this.changed();return this.view();
  }
  async close(){this.closed=true;clearInterval(this.timer);if(this.job)await this.job;await Promise.allSettled([...this.children].map(child=>child.stopOwned()));}
}
