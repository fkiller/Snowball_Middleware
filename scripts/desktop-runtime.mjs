import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
export const runtimeManifest=path.join(root,'.state','desktop-runtime.json');
export function desktopRuntime({allowLegacy=false}={}){
  try{
    const data=JSON.parse(fs.readFileSync(runtimeManifest,'utf8'));
    const relative=path.relative(path.join(root,'.state','desktop-runtimes'),data.executable);
    if(data.version!==1||data.platform!==process.platform||data.arch!==process.arch||!relative||relative.startsWith('..')||path.isAbsolute(relative)||!/^[a-f0-9]{64}$/.test(data.sha256))throw Error();
    if(fs.realpathSync(data.executable)!==data.executable||createHash('sha256').update(fs.readFileSync(data.executable)).digest('hex')!==data.sha256)throw Error();
    return {executable:data.executable,args:[],branded:true};
  }catch{
    // Only the updater's stop handshake may use the old unbranded launcher.
    if(allowLegacy)return {executable:createRequire(import.meta.url)('electron'),args:[fileURLToPath(new URL('../apps/desktop/main.mjs',import.meta.url))],branded:false};
    throw Error('Snowball desktop runtime is missing or changed; run npm run install:desktop');
  }
}
