import fs from 'node:fs/promises';
import path from 'node:path';
// Only a trusted composition root chooses the directory and controller identity.
export async function controllerUiStore(directory,controllerId){
  if(!/^ctl_[a-f0-9]{16}$/.test(controllerId))throw Error('invalid_controller');
  const file=path.join(directory,`${controllerId}.ui.json`);let saved=null;
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw Error('invalid_ui_state');saved=JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let last=saved?JSON.stringify(saved):'',pending=Promise.resolve();
  return {saved,save(value){const text=JSON.stringify(value);if(text===last)return pending;if(Buffer.byteLength(text)>2*1024*1024)throw Error('ui_capacity');last=text;
    pending=pending.catch(()=>{}).then(async()=>{const temporary=file+`.${process.pid}.tmp`;try{await fs.writeFile(temporary,text+'\n',{mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}});return pending;},flush(){return pending;}};
}
