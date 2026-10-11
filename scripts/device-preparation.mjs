import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const digest=value=>createHash('sha256').update(value).digest('hex');
function inside(root,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||/[:\0]/.test(relative)||path.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))throw Error('invalid_preparation_path');
  const target=path.join(root,relative),resolved=fs.realpathSync(target);
  if(resolved!==target||path.relative(root,resolved).startsWith('..'))throw Error('invalid_preparation_path');
  return target;
}
/** Data only: no device module is imported into the privileged host. */
export function readPreparation(device){
  if(!path.isAbsolute(device?.deviceRoot??'')||!path.isAbsolute(device?.python??''))throw Error('absolute_device_paths_required');
  const root=fs.realpathSync(device.deviceRoot),descriptorFile=inside(root,'firmware/setup.json');
  const descriptor=JSON.parse(fs.readFileSync(descriptorFile,'utf8'));
  if(![1,2].includes(descriptor.version)||!/^[-a-z0-9]{1,64}$/.test(descriptor.id??'')||typeof descriptor.name!=='string'||descriptor.name.length>80)throw Error('invalid_preparation_descriptor');
  if(!/^[a-z0-9-]{1,32}$/.test(descriptor.identity?.prefix??'')||![undefined,12,16,24,32,64].includes(descriptor.identity.hexLength))throw Error('invalid_preparation_identity');
  for(const key of ['fullBackup','preserveSettings','verifySettings','reboot'])if(descriptor.capabilities?.[key]!==true)throw Error('required_preparation_guarantee_missing');
  if(typeof descriptor.capabilities.wifiImport!=='boolean')throw Error('invalid_preparation_descriptor');
  const bridge=inside(root,descriptor.bridge),releaseFile=inside(root,descriptor.release);
  if(!bridge.endsWith('.py')||!Array.isArray(descriptor.files)||!descriptor.files.length||descriptor.files.length>64)throw Error('invalid_preparation_descriptor');
  for(const language of ['ko','en']){
    const p=descriptor.presentation?.[language];
    if(!p||!['connection','confirmation','note'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<2000)||!Array.isArray(p.steps)||!p.steps.length||p.steps.length>12||p.steps.some(s=>typeof s!=='string'||s.length>2000))throw Error('preparation_visual_guide_required');
    if(!p.diagram||!['title','selection','hint'].every(k=>typeof p.diagram[k]==='string'&&p.diagram[k].length<100)||!Array.isArray(p.diagram.buttons)||p.diagram.buttons.length>8||p.diagram.buttons.some(s=>typeof s!=='string'||s.length>32))throw Error('preparation_visual_guide_required');
    if(p.journey!==undefined&&(!Array.isArray(p.journey)||p.journey.length!==4||p.journey.some(s=>typeof s!=='string'||s.length>80)))throw Error('preparation_visual_guide_required');
  }
  const release=JSON.parse(fs.readFileSync(releaseFile,'utf8'));
  if(release.board!==descriptor.id||!/^\d+\.\d+\.\d+$/.test(release.version??''))throw Error('invalid_firmware_release');
  for(const language of ['ko','en'])if(!Array.isArray(release.changes?.[language])||!release.changes[language].length||release.changes[language].some(s=>typeof s!=='string'||s.length>2000))throw Error('firmware_changes_required');
  if(descriptor.version===2){
    if(!Array.isArray(descriptor.components)||!descriptor.components.length||descriptor.components.length>8||new Set(descriptor.components).size!==descriptor.components.length)throw Error('invalid_preparation_components');
    for(const id of descriptor.components)if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)||!/^\d+\.\d+\.\d+$/.test(release.components?.[id]?.version??'')||typeof release.components[id].name!=='string')throw Error('invalid_preparation_components');
    if(descriptor.observation!==undefined&&(!descriptor.components.includes(descriptor.observation?.component)||!descriptor.identity.hexLength))throw Error('invalid_preparation_components');
  }
  const files=new Set([descriptorFile]);
  function walk(relative){const target=inside(root,relative),stat=fs.statSync(target);if(stat.isDirectory())for(const child of fs.readdirSync(target).sort())walk(relative+'/'+child);else if(stat.isFile())files.add(target);else throw Error('invalid_preparation_path');}
  for(const relative of descriptor.files)walk(relative);
  if(!files.has(bridge)||!files.has(releaseFile))throw Error('unreviewed_preparation_helper');
  const hashes=[...files].sort().map(file=>[path.relative(root,file).replaceAll('\\','/'),digest(fs.readFileSync(file))]);
  let sharedHelper;
  if(descriptor.version===2&&descriptor.capabilities.wifiImport){
    const helper=fileURLToPath(new URL('./os_wifi.py',import.meta.url));
    if(fs.realpathSync(helper)!==helper||!fs.lstatSync(helper).isFile())throw Error('unreviewed_preparation_helper');
    sharedHelper={path:helper,sha256:digest(fs.readFileSync(helper))};
    hashes.push(['@host/os_wifi.py',sharedHelper.sha256]);
  }
  return {descriptor,release,bridge,root,sharedHelper,sha256:digest(JSON.stringify(hashes))};
}

// Eligibility depends on a reviewed preparation adapter, never on the model name.
// Legacy MK20 controlRoot resolves to its concrete bundled preparation adapter.
function candidates(config){return Object.entries(config.devices??(config.profile&&(config.deviceRoot||config.controlRoot)?{[config.profile]:config}:{})).map(([profile,device])=>{
  // Control owns the concrete MK20 source tree; older installations keep their
  // runtime paths and acquire the bundled descriptor through ordinary Update.
  if(profile==='mk20'&&device?.controlRoot&&!device.deviceRoot)device={...device,deviceRoot:path.join(device.controlRoot,'hardware','mk20')};
  return [profile,device];
}).filter(([,device])=>device?.deviceRoot);}
/** Called only by setup after the installed repositories have been reviewed. */
export function approveDevicePreparations(config){
  return candidates(config).map(([profile,device])=>{
    if(!/^[-a-z0-9]{1,64}$/.test(profile))throw Error('invalid_preparation_profile');
    const source=readPreparation(device);return {profile,id:source.descriptor.id,sha256:source.sha256};
  });
}
export function installedDevicePreparations(config){
  const approvals=config.devicePreparations??[],seen=new Set();
  if(!Array.isArray(approvals))throw Error('invalid_preparation_approval');
  return approvals.map(approval=>{
    if(!approval||!/^[-a-z0-9]{1,64}$/.test(approval.profile??'')||seen.has(approval.profile))throw Error('invalid_preparation_approval');
    seen.add(approval.profile);const device=candidates(config).find(([profile])=>profile===approval.profile)?.[1];
    if(!device)throw Error('invalid_preparation_approval');
    const source=readPreparation(device);
    if(approval.id!==source.descriptor.id||approval.sha256!==source.sha256)throw Error('installed_preparation_changed');
    return {profile:approval.profile,device};
  });
}
