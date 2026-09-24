// Private unsigned package staging: strict file allowlist, no repository/state copy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {packager} from '@electron/packager';

const root=fileURLToPath(new URL('..',import.meta.url));
if(!['win32','darwin'].includes(process.platform))throw new Error('Build on the target Windows or macOS host');
const requested=process.argv[2];
if(requested&&(!path.isAbsolute(requested)||fs.existsSync(requested)))throw new Error('Choose a new absolute output directory');
const output=requested??path.join(root,'artifacts','desktop',String(Date.now()));
fs.mkdirSync(path.join(root,'.state'),{recursive:true});
const staging=fs.mkdtempSync(path.join(root,'.state','desktop-stage-'));
const inventory=[];
function copy(relative,destination=relative){
 const source=path.join(root,relative),target=path.join(staging,destination);
 const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Expected regular reviewed file: '+relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
 inventory.push({path:destination.replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex')});
}
for(const name of ['main.mjs','core-worker.mjs','presentation.mjs','codex-connections.mjs','windows-device-presence.mjs'])copy('apps/desktop/'+name);
for(const name of ['runtime.mjs','codex-plugin.mjs','opencode-owned.mjs','settings-store.mjs','private-state.mjs','native-picker.mjs','index.html','app.js','style.css'])copy('apps/supervisor/'+name);
// Reviewed Codex control and explicitly configured OpenCode observation are
// bundled. No optional native drivers, account homes or runtime state.
const packages=['plugin-sdk','plugin-host','core','api','client-sdk','harness-codex','harness-opencode'];
for(const name of packages){
 for(const prefix of ['packages/'+name,'node_modules/@snowball/'+name]){
  copy('packages/'+name+'/package.json',prefix+'/package.json');
  for(const entry of fs.readdirSync(path.join(root,'packages',name,'src'),{withFileTypes:true})){
   if(!entry.isFile()||!entry.name.endsWith('.ts'))continue;
   copy('packages/'+name+'/dist/'+entry.name.replace(/\.ts$/,'.js'),prefix+'/dist/'+entry.name.replace(/\.ts$/,'.js'));
  }
 }
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,private:true,license:pkg.license,type:'module',main:'apps/desktop/main.mjs'},null,2));
fs.writeFileSync(path.join(staging,'BUILD-INVENTORY.json'),JSON.stringify({version:1,platform:process.platform,arch:process.arch,license:'UNLICENSED',signed:false,files:inventory},null,2));
fs.writeFileSync(path.join(staging,'README.txt'),'Private unsigned development package. A per-user Windows installer can be built separately with npm run package:windows-installer. Start SnowballMiddleware to open the native tray; no front window. Supervisor stays on 127.0.0.1 without a PIN. Select Codex CLI in the native tray and review its executable, existing login home, working directory, version and SHA-256 before connecting. Explicit --codex-control-config and --opencode-observer-config absolute JSON paths are available for development. Existing tasks require explicit attachment before commands. Codex control and OpenCode read-only observer plugins are bundled. No updater, signing or physical driver support is claimed.\n');
const paths=await packager({dir:staging,out:output,name:'Snowball Middleware',executableName:'SnowballMiddleware',electronVersion:pkg.devDependencies.electron,platform:process.platform,arch:process.arch,asar:false,prune:false,overwrite:false,appBundleId:'local.snowball.middleware',appVersion:pkg.version,win32metadata:{ProductName:'Snowball Middleware',FileDescription:'Local control middleware'}});
console.log(JSON.stringify({paths,staging,signed:false,frontWindow:false,bundledPlugins:['snowball.codex','snowball.opencode'],inventoryFiles:inventory.length}));
