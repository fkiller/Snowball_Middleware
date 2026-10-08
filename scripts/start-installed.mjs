import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]!=='--config'||!args[1]||args.slice(2).some(x=>!['--register-autostart','--stop'].includes(x)))throw Error('Usage: start-installed.mjs --config PATH [--register-autostart|--stop]');
const configFile=path.resolve(args[1]),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const require=createRequire(import.meta.url),electron=require('electron');
if(!fs.existsSync(electron))throw Error('Native tray is not installed; rerun setup');
const directory=path.dirname(configFile),logFile=path.join(directory,'desktop.log');
let previousOwner;
try{const record=JSON.parse(fs.readFileSync(path.join(directory,'desktop.v1.json'),'utf8'));if(record.suiteConfig===configFile&&Number.isSafeInteger(record.pid))previousOwner=record.pid;}catch{}
if(fs.existsSync(logFile)&&fs.statSync(logFile).size>4*1024*1024){fs.rmSync(logFile+'.previous',{force:true});fs.renameSync(logFile,logFile+'.previous');}
const log=fs.openSync(logFile,'a',0o600),env={...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:'true'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[fileURLToPath(new URL('../apps/desktop/main.mjs',import.meta.url)),'--suite-config',configFile,'--background',...args.slice(2)],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,windowsHide:true,detached:true,shell:false,stdio:['ignore',log,log,'ipc']});
fs.closeSync(log);
let settled=false,existing=false,stopAcknowledged=false;
const timer=setTimeout(()=>finish(Error('Native tray did not become ready; see '+logFile)),180000);
function finish(error,message){
  if(settled)return;settled=true;clearTimeout(timer);
  if(error){if(child.connected)child.send('snowball.stop');else child.kill();console.error(error.message);process.exitCode=1;}
  else console.log(message);
  if(child.connected)child.disconnect();child.unref();
}
child.on('error',error=>finish(error));
child.on('exit',code=>{if(!settled&&!existing){if(stopAcknowledged&&code===0)finish(null,'Snowball background runtime stopped.');else finish(Error('Native tray exited ('+code+'); see '+logFile));}});
child.on('message',async message=>{
  if(message?.kind==='desktop-ready'&&message.origin===`http://127.0.0.1:${config.port}`)finish(null,`Snowball is running in the background. Use its tray icon. Web UI: ${message.origin}/`);
  else if(message?.kind==='desktop-stopped'&&args.includes('--stop'))stopAcknowledged=true;
  else if(message?.kind==='desktop-failed')finish(Error('Snowball tray startup failed; see '+logFile));
  else if(message?.kind==='desktop-already-running'){
    existing=true;
    const marker=path.join(directory,'desktop.v1.json'),deadline=Date.now()+20000;
    while(!settled&&Date.now()<deadline){
      try{
        if(args.includes('--stop')){
          if(!fs.existsSync(marker)&&previousOwner){let alive=true;try{process.kill(previousOwner,0);}catch{alive=false;}if(!alive){finish(null,'Snowball background runtime stopped.');return;}}
        }else{
          const record=JSON.parse(fs.readFileSync(marker,'utf8'));
          if(record.suiteConfig===configFile&&record.origin===`http://127.0.0.1:${config.port}`&&Number.isSafeInteger(record.pid)){
            process.kill(record.pid,0);
            const response=await fetch(record.origin+'/v1/snapshot',{headers:{Origin:record.origin},signal:AbortSignal.timeout(2000)});
            if(response.ok){finish(null,'Snowball is already running in the background. Use its tray icon.');return;}
          }
        }
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    finish(Error('Existing Snowball tray did not confirm its runtime; see '+logFile));
  }
});
