import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveHarnessExecutable} from './harness-runtime.mjs';
const execute=promisify(execFile);
let cached,loading;

// Discover the installed app-server's supported turn-level approval policies.
// No sandbox or filesystem grants are changed by this selector.
export function policiesFromSchema(schema){
  const property=schema?.properties?.approvalPolicy;
  if(!property)return [];
  const visit=node=>{
    if(!node||typeof node!=='object')return [];
    if(node.$ref?.startsWith('#/definitions/'))return visit(schema.definitions?.[node.$ref.slice(14)]);
    return [...(node.type==='string'&&Array.isArray(node.enum)?node.enum.filter(v=>typeof v==='string'&&v.length<=64):[]),
      ...(node.anyOf??node.oneOf??[]).flatMap(visit)];
  };
  return [...new Set(visit(property))];
}
export async function listNativeAccess(pluginId){
  if(pluginId!=='snowball.codex')return [];
  const executable=resolveHarnessExecutable('codex'),stat=await fs.stat(executable);
  const identity=executable+':'+stat.size+':'+stat.mtimeMs;
  if(cached?.identity===identity)return [...cached.values];
  if(loading?.identity===identity)return [...await loading.promise];
  const promise=(async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-access-'));
    try{
      await execute(executable,['app-server','generate-json-schema','--out',directory],{windowsHide:true,timeout:12000,maxBuffer:1024*1024});
      const schema=JSON.parse(await fs.readFile(path.join(directory,'v2','TurnStartParams.json'),'utf8'));
      const values=policiesFromSchema(schema);cached={identity,values};return values;
    }finally{await fs.rm(directory,{recursive:true,force:true});}
  })();
  loading={identity,promise};
  try{return [...await promise];}finally{if(loading?.promise===promise)loading=null;}
}
export async function nativeAccessParams(pluginId,access){
  if(access===undefined||access===null||access==='')return {};
  if(typeof access!=='string'||!(await listNativeAccess(pluginId)).includes(access))throw Error('unsupported_native_access');
  return {approvalPolicy:access};
}
