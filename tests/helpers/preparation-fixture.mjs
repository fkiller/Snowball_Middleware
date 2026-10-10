import fs from 'node:fs';
import path from 'node:path';
// Metadata-only guard fixture: it cannot flash, enumerate or claim a working device.
export function guardPreparation(root,id='m5stack-core-esp32',prefix='m5-'){
  fs.mkdirSync(path.join(root,'firmware'),{recursive:true});fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  const text={connection:'Connect the physical device.',confirmation:'Confirm the physical model.',steps:['Follow the physical device controls.'],note:'Metadata validation only.',diagram:{title:'Settings',selection:'Network',hint:'Select',buttons:['Enter']}};
  const descriptor={version:1,id,name:id,bridge:'scripts/usb_setup.py',release:'firmware/release.json',identity:{prefix,hexLength:12},capabilities:{fullBackup:true,preserveSettings:true,verifySettings:true,reboot:true,wifiImport:true},files:['firmware','scripts'],presentation:{ko:text,en:text}};
  fs.writeFileSync(path.join(root,'firmware/setup.json'),JSON.stringify(descriptor));
  fs.writeFileSync(path.join(root,'firmware/release.json'),JSON.stringify({version:'0.5.0',board:id,changes:{ko:['Metadata validation only.'],en:['Metadata validation only.']}}));
  if(!fs.existsSync(path.join(root,'scripts/usb_setup.py')))fs.writeFileSync(path.join(root,'scripts/usb_setup.py'),"raise RuntimeError('not_executed')\n");
  return descriptor;
}
