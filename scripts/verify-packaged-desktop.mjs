import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const packageDir=process.argv[2];
if(!packageDir||!path.isAbsolute(packageDir))throw new Error('Absolute package directory required');
const appDir=process.platform==='win32'?path.join(packageDir,'resources','app'):path.join(packageDir,'Snowball Middleware.app','Contents','Resources','app');
const inventory=JSON.parse(fs.readFileSync(path.join(appDir,'BUILD-INVENTORY.json'),'utf8'));
if(inventory.platform!==process.platform||inventory.arch!==process.arch||inventory.signed!==false||!Array.isArray(inventory.files))throw new Error('Unexpected package inventory');
const expected=new Map(inventory.files.map(item=>[item.path,item.sha256]));
if(expected.size!==inventory.files.length)throw new Error('Duplicate inventory path');
const allowed=new Set([...expected.keys(),'BUILD-INVENTORY.json','README.txt','package.json']);
const actual=[];
function walk(directory,prefix=''){
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const name=prefix?prefix+'/'+item.name:item.name,absolute=path.join(directory,item.name);
    if(item.isDirectory())walk(absolute,name);
    else if(item.isFile()&&!item.isSymbolicLink())actual.push(name);
    else throw new Error('Linked or unexpected package entry');
  }
}
walk(appDir);
if(actual.length!==allowed.size||actual.some(name=>!allowed.has(name)))throw new Error('Unexpected or missing packaged application file');
for(const [name,hash] of expected){const actualHash=createHash('sha256').update(fs.readFileSync(path.join(appDir,name))).digest('hex');if(actualHash!==hash)throw new Error('Packaged application hash mismatch');}
const executable=process.platform==='win32'?path.join(packageDir,'SnowballMiddleware.exe'):path.join(packageDir,'Snowball Middleware.app','Contents','MacOS','SnowballMiddleware');
const output=await new Promise((resolve,reject)=>{
  const child=spawn(executable,['--smoke-test'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const deadline=setTimeout(()=>{child.kill();reject(new Error('Packaged tray smoke timed out'));},40000);
  child.stdout.on('data',data=>{stdout+=data;if(stdout.length>65536)child.kill();});
  child.stderr.on('data',data=>{stderr+=data;if(stderr.length>65536)child.kill();});
  child.once('error',error=>{clearTimeout(deadline);reject(error);});
  child.once('exit',code=>{clearTimeout(deadline);if(code!==0)reject(new Error('Packaged tray smoke failed: '+stderr.slice(0,400)));else resolve(stdout);});
});
const line=output.split(/\r?\n/).find(value=>value.startsWith('{')&&value.includes('native-tray'));
const smoke=JSON.parse(line??'null');
if(smoke?.trayCreated!==true||smoke?.mainWindows!==0||smoke?.loopbackNoPin!==true||smoke?.pauseRoundtrip!==true||smoke?.autostartChanged!==false)throw new Error('Packaged tray smoke did not meet local contract');
console.log(JSON.stringify({packageDir,applicationFiles:actual.length,verifiedHashes:expected.size,smoke}));
