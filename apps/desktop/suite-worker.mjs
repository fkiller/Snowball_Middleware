import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let child,started=false,stopping=false;
const send=value=>process.parentPort.postMessage(value);
process.parentPort.on('message',({data})=>{
  if(data?.kind==='stop'){
    stopping=true;if(child?.connected)child.send('snowball.stop');else if(child)child.kill();else process.exit(0);return;
  }
  if(data?.kind==='native-result'){if(child?.connected)child.send(data);return;}
  if(['m5-usb-control','device-usb-control'].includes(data?.kind)){if(child?.connected)child.send(data);return;}
  if(data?.kind!=='start'||started||stopping)return;started=true;
  try{
    if(!path.isAbsolute(data.suiteConfig))throw Error('Absolute suite configuration required');
    const config=JSON.parse(fs.readFileSync(data.suiteConfig,'utf8'));
    if(!path.isAbsolute(config.nodeExecutable)||!fs.existsSync(config.nodeExecutable))throw Error('Installed Node executable is unavailable; rerun setup');
    const script=fileURLToPath(new URL('../../scripts/start-suite.mjs',import.meta.url));
    child=spawn(config.nodeExecutable,[script,'--config',data.suiteConfig],{cwd:fileURLToPath(new URL('../..',import.meta.url)),windowsHide:true,shell:false,env:{...process.env,SNOWBALL_DESKTOP:'1',AGY_CLI_DISABLE_AUTO_UPDATE:'true'},stdio:['ignore','pipe','pipe','ipc']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>process.stdout.write(bytes));
    child.on('message',message=>{
      if(message?.kind==='suite-ready')send({kind:'ready',origin:message.origin});
      else if(message?.kind==='native')send(message);
      else if(message?.kind==='device-observed')send(message);
      else if(['m5-usb-result','device-usb-result'].includes(message?.kind))send(message);
    });
    child.on('error',()=>{send({kind:'failed',code:'suite_process_failed'});process.exitCode=1;});
    child.on('exit',code=>{if(!stopping)send({kind:'failed',code:'suite_exited'});process.exit(stopping?0:code||1);});
  }catch(error){send({kind:'failed',code:'suite_start_failed',detail:error.message});process.exitCode=1;}
});
