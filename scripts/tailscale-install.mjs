import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const packages = {
  x64: ['amd64', '3c41318c83c5d95d0b017b1baa08ba7c99fd5334166122bbb1931e55af99839c'],
  arm64: ['arm64', '609982de4dfe70b67a02e2a93c9c5c1dfa20addceb33a7d3b144f1d34d98f5fc'],
};
const helper = fileURLToPath(new URL('./tailscale-install-windows.ps1', import.meta.url));
function run(action, msi) {
  if (process.platform !== 'win32') throw Error('Windows is required.');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action, ...(msi ? ['-MsiPath', msi] : [])], {encoding:'utf8', windowsHide:true, shell:false, timeout:620000, maxBuffer:4096});
  try {
    const value=JSON.parse(result.stdout);
    if(typeof value.status !== 'string' || !/^[a-z_]+$/.test(value.status)) throw Error();
    return {status:value.status, ok:result.status===0};
  } catch {return {status:'unavailable',ok:false};}
}
export function inspectTailscaleInstallation(){return run('Inspect');}
export function installTailscaleInstaller(msi){return run('Install',msi);}
export async function stageTailscaleInstaller(directory,{arch=process.arch}={}) {
  if(process.platform!=='win32'||!packages[arch]||!path.isAbsolute(directory)||fs.existsSync(directory))throw Error('A new absolute Windows staging directory is required.');
  directory=path.resolve(directory);
  const [architecture,expected]=packages[arch];
  const name=`tailscale-setup-1.104.5-${architecture}.msi`;
  const response=await fetch(`https://pkgs.tailscale.com/stable/${name}`,{redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok||!response.body)throw Error('Tailscale download failed.');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,name);
  const file=fs.openSync(filename,'wx',0o600);const hash=createHash('sha256');let size=0;
  try {
    for await (const chunk of response.body){size+=chunk.length;if(size>134217728)throw Error('Installer too large.');hash.update(chunk);fs.writeFileSync(file,chunk);}
  } finally {fs.closeSync(file);}
  if(!size||hash.digest('hex')!==expected)throw Error('Tailscale installer hash failed.');
  let verification;
  for(let attempt=0;attempt<3;attempt++){
    verification=run('Verify',filename);
    if(verification.status==='verified')break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(verification.status!=='verified')throw Error('Tailscale installer signature verification failed: '+verification.status);
  return {status:'verified',msiPath:filename};
}

let direct=false;try{direct=fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{}
if(direct){
  try{
    const args=process.argv.slice(2);let result;
    if(args.length===1&&args[0]==='--inspect')result=inspectTailscaleInstallation();
    else if(args[0]==='--install'&&(args.length===1||(args.length===3&&args[1]==='--msi'&&path.isAbsolute(args[2])))){
      result=inspectTailscaleInstallation();
      if(result.status==='absent'){
        const file=args[2]??(await stageTailscaleInstaller(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'snowball-tailscale-')),'package'))).msiPath;
        result=installTailscaleInstaller(file);
      }
    } else throw Error('Invalid arguments.');
    console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
  }catch{console.error('Tailscale setup failed. No connection or Serve settings were changed.');process.exitCode=1;}
}
