import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ControllerStateStore} from '../../packages/core/dist/index.js';
// Trusted runtime persistence only. HTTP/plugins supply no paths or filenames.
export async function loadControllerStore(directory){
  const store=new ControllerStateStore(),file=path.join(directory,'controllers.v1.json');
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('invalid_controller_store_file');store.restore(JSON.parse(await fs.readFile(file,'utf8')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let pending=Promise.resolve(),dirty=false,error;
  const persist=()=>{
    dirty=true;
    pending=pending.then(async()=>{
      if(!dirty)return;dirty=false;const raw=JSON.stringify(store.snapshot())+'\n';
      if(Buffer.byteLength(raw)>4*1024*1024)throw Error('controller_store_capacity');
      const temporary=path.join(directory,`controllers-${process.pid}-${randomUUID()}.tmp`);
      try{await fs.writeFile(temporary,raw,{mode:0o600,flag:'wx'});await fs.rename(temporary,file);error=undefined;}
      finally{await fs.unlink(temporary).catch(()=>{});}
    }).catch(fault=>{error=fault;console.error('Controller state could not be saved:',fault.code??fault.message);});
  };
  const unsubscribe=store.subscribe(persist);
  return {store,async flush(){persist();await pending;if(error)throw error;},async close(){unsubscribe();persist();await pending;if(error)throw error;}};
}
