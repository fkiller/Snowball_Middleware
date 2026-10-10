import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {DeviceSetup,firmwareRelation} from './device-setup.mjs';

const targetId=value=>typeof value==='string'&&/^t-[a-f0-9]{32}$/.test(value);
const code=error=>/^[a-z0-9_]{1,80}$/.test(error?.message??'')?error.message:'device_setup_failed';
const steps=new Set(['ready','enter-dfu','usb-driver','insert-card','return-card']);
async function hash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}

/** Version-2 component/transport contract; the hub and native window stay shared. */
export class ComponentSetup extends DeviceSetup {
  view(){return {...super.view(),contract:2,components:this.descriptor.components};}
  target(value){
    if(!value||!this.descriptor.components.includes(value.component)||!steps.has(value.nextStep)||typeof value.writable!=='boolean'||(value.currentVersion!==null&&!/^\d+\.\d+\.\d+$/.test(value.currentVersion)))throw Error('invalid_device_response');
    if(value.wifiConfigured!==undefined&&typeof value.wifiConfigured!=='boolean')throw Error('invalid_device_response');
    if(value.pending!==undefined&&typeof value.pending!=='boolean')throw Error('invalid_device_response');
    return Object.fromEntries(['component','currentVersion','nextStep','writable','wifiConfigured','pending'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
  }
  async scan(force=false){
    if(this.closed||this.scanning||this.job)return;this.scanning=true;
    try{
      const result=await this.run('list');if(this.closed)return;
      if(result.event!=='ports'||!Array.isArray(result.ports)||result.ports.length>32)throw Error('invalid_device_response');
      const ports=result.ports.filter(p=>targetId(p.port));const present=new Set(ports.filter(p=>p.present!==false).map(p=>p.port));
      for(const r of this.records.values())r.online=present.has(r.port);
      for(const candidate of ports){
        let record=this.records.get(candidate.port);const identity=String(candidate.usbIdentity??'').slice(0,256);
        if(!record||record.usbIdentity!==identity||(!record.wasPresent&&candidate.present!==false)||force){
          const previous=record;
          record={port:candidate.port,label:String(candidate.label??this.descriptor.name).slice(0,128),usbIdentity:identity,online:candidate.present!==false,wasPresent:true,phase:'checking',status:'unknown'};
          this.records.set(record.port,record);
          try{
            const response=await this.run('probe',record.port);if(response.event!=='target')throw Error('invalid_device_response');
            Object.assign(record,this.target(response.target),{phase:previous?.phase==='awaiting-device'||response.target.pending?'awaiting-device':'ready'});
            if(previous?.backup)record.backup=previous.backup;
          }catch(error){record.phase='failed';record.code=code(error);}
          this.emit('attached',record);
        }
      }
      for(const record of this.records.values())record.wasPresent=record.online;
      if(this.records.size>64)for(const [id,record]of this.records)if(!record.online&&record.phase!=='awaiting-device'){this.records.delete(id);if(this.records.size<=64)break;}
      this.code=null;
    }catch(error){this.code=code(error);}finally{this.scanning=false;this.changed();}
  }
  async backup(file,component,target){
    if(typeof file!=='string'||path.dirname(file)!==this.backupDirectory||!file.endsWith('.bin'))throw Error('backup_incomplete');
    const metaFile=file.replace(/\.bin$/,'.json');
    for(const p of [file,metaFile]){const stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink())throw Error('backup_incomplete');}
    const meta=JSON.parse(fs.readFileSync(metaFile,'utf8')),stat=fs.statSync(file);
    if(stat.size<=0||meta.bytes!==stat.size||meta.component!==component||(target&&meta.target!==target)||meta.sha256!==await hash(file))throw Error('backup_incomplete');
  }
  async action(request){
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['action','port','version','confirmBoard','ssid','migrateWifi','network'].includes(k)))throw Error('invalid_setup_action');
    if(['refresh','wifi'].includes(request.action))return super.action(request);
    if(this.closed||this.job||this.scanning)throw Error('usb_setup_busy');
    const record=this.records.get(request.port);
    if(!targetId(request.port)||!record)throw Error('setup_target_disconnected');
    if(request.action==='install'){
      if(!record.online||!record.writable||request.confirmBoard!==true||request.version!==this.release.version||firmwareRelation(record.currentVersion,this.release.components[record.component].version)==='newer')throw Error('firmware_review_required');
      if(request.migrateWifi===true&&(record.component!=='runtime'||record.wifiConfigured===true||request.ssid!==this.network?.ssid||this.network.enterprise))throw Error('wifi_review_required');
      if(request.network!==undefined){
        const n=request.network;
        if(this.descriptor.capabilities.manualWifi!==true||record.component!=='runtime'||record.wifiConfigured===true||request.migrateWifi===true||!n||typeof n!=='object'||Array.isArray(n)||Object.keys(n).some(k=>!['ssid','password'].includes(k))||typeof n.ssid!=='string'||!Buffer.byteLength(n.ssid)||Buffer.byteLength(n.ssid)>32||typeof n.password!=='string'||(n.password.length&&(Buffer.byteLength(n.password)<8||Buffer.byteLength(n.password)>63)))throw Error('wifi_review_required');
      }
    }else if(request.action!=='verify'||record.phase!=='awaiting-device')throw Error('invalid_setup_action');
    const phases=new Set();record.code=null;record.phase=request.action==='verify'?'reboot':'identify';
    this.job=(async()=>{
      try{
        const lan=Object.values(os.networkInterfaces()).flat().filter(n=>n.family==='IPv4'&&!n.internal).slice(0,16).map(n=>({address:n.address,netmask:n.netmask}));
        const result=await this.run(request.action,record.port,{version:request.version,confirmBoard:request.confirmBoard,usbIdentity:record.usbIdentity,ssid:request.ssid,migrateWifi:request.migrateWifi===true,lan,...(request.network?{network:request.network}:{})},event=>{
          if(event.event==='progress'&&['identify','backup','backup-verified','build','flash','verify-settings','reboot'].includes(event.phase)){
            phases.add(event.phase);record.phase=event.phase;if(event.backup&&path.dirname(event.backup)===this.backupDirectory&&event.backup.endsWith('.bin'))record.backup=event.backup;this.changed();
          }
        });
        if(result.component!==record.component||!['awaiting-device','verified'].includes(result.event))throw Error('invalid_device_response');
        if(request.action==='install'&&!['backup-verified','flash','verify-settings'].every(p=>phases.has(p)))throw Error('firmware_verification_incomplete');
        await this.backup(result.backup,record.component,record.port);record.backup=result.backup;
        if(result.event==='verified'){
          if(result.version!==this.release.components[record.component].version||!phases.has('reboot'))throw Error('firmware_verification_incomplete');
          record.currentVersion=result.version;record.phase='complete';record.nextStep='ready';
        }else{record.phase='awaiting-device';record.nextStep='return-card';}
      }catch(error){record.phase='failed';record.code=code(error);}finally{this.job=null;this.changed();}
    })();this.changed();return this.view();
  }
}
