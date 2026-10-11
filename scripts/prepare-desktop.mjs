import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {packager} from '@electron/packager';
import {desktopRuntime,runtimeManifest} from './desktop-runtime.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const download=spawnSync(process.execPath,[path.join(root,'node_modules/electron/install.js')],{cwd:root,windowsHide:true,stdio:'inherit'});
if(download.error)throw download.error;if(download.status!==0)throw Error('Desktop engine preparation failed');
if(!['win32','darwin'].includes(process.platform))throw Error('Desktop runtime supports Windows and macOS');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const bootstrap=`// Source suite launcher; the source path is fixed at build time.\nawait import(${JSON.stringify(pathToFileURL(path.join(root,'apps/desktop/main.mjs')).href)});\n`;
const digest=createHash('sha256').update(pkg.devDependencies.electron).update(pkg.version).update(process.platform+process.arch).update(bootstrap);
for(const file of ['icon.ico','icon.icns'])digest.update(fs.readFileSync(path.join(root,'assets',file)));
const key=digest.digest('hex');
let previousExecutable;
try{previousExecutable=desktopRuntime().executable;}catch{}
try{const previous=JSON.parse(fs.readFileSync(runtimeManifest,'utf8'));if(previous.key===key){desktopRuntime();console.log('Snowball desktop branding is current.');process.exit(0);}}catch{}
const base=path.join(root,'.state','desktop-runtimes');fs.mkdirSync(base,{recursive:true});
// Unique, verified workspace destination: never replace a running executable or delete a checkout.
const destination=fs.mkdtempSync(path.join(base,key.slice(0,12)+'-'));
const stage=path.join(destination,'source');fs.mkdirSync(stage);
fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'snowball-middleware',version:pkg.version,type:'module',main:'main.mjs',private:true}));
fs.writeFileSync(path.join(stage,'main.mjs'),bootstrap);
const [directory]=await packager({dir:stage,out:path.join(destination,'app'),name:'Snowball Middleware',executableName:'SnowballMiddleware',electronVersion:pkg.devDependencies.electron,platform:process.platform,arch:process.arch,asar:false,prune:false,overwrite:false,icon:path.join(root,'assets',process.platform==='win32'?'icon.ico':'icon.icns'),appBundleId:'local.snowball.middleware',appVersion:pkg.version,appCopyright:'Snowball contributors',win32metadata:{CompanyName:'Snowball',ProductName:'Snowball Middleware',FileDescription:'Snowball Middleware',InternalName:'SnowballMiddleware',OriginalFilename:'SnowballMiddleware.exe'}});
const executable=process.platform==='win32'?path.join(directory,'SnowballMiddleware.exe'):path.join(directory,'Snowball Middleware.app','Contents','MacOS','SnowballMiddleware');
const sha256=createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
fs.writeFileSync(runtimeManifest+'.tmp',JSON.stringify({version:1,key,platform:process.platform,arch:process.arch,executable,sha256,...(previousExecutable?{previousExecutable}:{})})+'\n');
fs.renameSync(runtimeManifest+'.tmp',runtimeManifest);desktopRuntime();
console.log('Prepared Snowball Middleware with its existing product icon and native application identity.');
