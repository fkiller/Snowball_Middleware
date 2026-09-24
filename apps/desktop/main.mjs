import { app, Tray, Menu, nativeImage, shell, dialog, utilityProcess, BrowserWindow, Notification } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalClient } from '../../packages/client-sdk/dist/index.js';
import { resolveUserDataDir } from '../../packages/core/dist/index.js';
import { ensurePrivateStateDirectory } from '../supervisor/private-state.mjs';
import { inspectCodexSelection } from './codex-connections.mjs';

import { labels, AttentionNotifications } from './presentation.mjs';

const args=process.argv.slice(app.isPackaged?1:2);const smoke=args.includes('--smoke-test');
const argument=name=>{const i=args.indexOf(name);if(i<0)return;const value=args[i+1];if(!value||!path.isAbsolute(value))throw new Error('Absolute '+name+' path required');return value;};
const temporary=smoke?fs.mkdtempSync(path.join(os.tmpdir(),'snowball-tray-smoke-')):undefined;
const dataDir=temporary?path.join(temporary,'state'):argument('--data-dir')??resolveUserDataDir();
ensurePrivateStateDirectory(dataDir);fs.mkdirSync(path.join(dataDir,'desktop'),{recursive:true});
app.setName('Snowball Middleware');app.setPath('userData',path.join(dataDir,'desktop'));
if(process.platform==='win32')app.setAppUserModelId('local.snowball.middleware');
const lock=app.requestSingleInstanceLock();
if(!lock){app.quit();}else{
let tray,worker,client,state,origin,stopping=false,stopPromise,poll,notification,enrollmentBusy=false,savedConnectionWarning=false;
const attentionNotifications=new AttentionNotifications();
const launchArgs=[...(app.isPackaged?[]:[fileURLToPath(import.meta.url)]),...args.filter(a=>a!=='--smoke-test')];
const loginConfig={path:process.execPath,args:launchArgs};
const getAutostart=()=>app.getLoginItemSettings(loginConfig).openAtLogin;
const open=async(settings=false)=>{if(origin)await shell.openExternal(origin+(settings?'#settings':''));};
function drawIcon(){
  const pixels=Buffer.alloc(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if((x-16)**2+(y-16)**2<169){const i=(y*32+x)*4;pixels[i]=process.platform==='darwin'?0:173;pixels[i+1]=process.platform==='darwin'?0:225;pixels[i+2]=process.platform==='darwin'?0:114;pixels[i+3]=255;}
  const image=nativeImage.createFromBitmap(pixels,{width:32,height:32,scaleFactor:2});if(process.platform==='darwin')image.setTemplateImage(true);return image;
}
function updateMenu(){
  if(!tray)return;const paused=state?.settings?.controlPaused;const waiting=state?.decisions?.filter(d=>d.status==='pending').length??0;
  const l=labels(state?.settings?.language);
  const status=!client||savedConnectionWarning?l.degraded:paused?l.paused:waiting?l.attention:l.connected;
  tray.setToolTip('Snowball · '+status);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Snowball · '+status,enabled:false},{type:'separator'},
    {label:l.open,enabled:!!client,click:()=>void open()},
    {label:l.connectCodex,enabled:!!client&&!smoke&&!enrollmentBusy&&!argument('--codex-control-config'),click:()=>{enrollmentBusy=true;updateMenu();worker?.postMessage({kind:'enroll-codex'});}},
    {label:paused?l.resume:l.pause,enabled:!!client,click:async()=>{try{await client.updateSettings(state.settings.revision,{controlPaused:!paused});await refresh();}catch{await refresh();}}},
    {label:l.autostart,type:'checkbox',checked:getAutostart(),enabled:!!client&&!smoke,click:async item=>{try{await client.updateSettings(state.settings.revision,{autostart:item.checked});}catch{}await refresh();}},
    {type:'separator'},{label:l.settings,enabled:!!client,click:()=>void open(true)},
    {label:l.diagnostics,click:()=>void dialog.showMessageBox({type:'info',title:'Snowball',message:l.state,detail:JSON.stringify({origin:origin??null,connectedHarnesses:state?.connectedHarnesses??[],savedConnectionWarning,devices:state?.devices?.length??0,mainWindows:BrowserWindow.getAllWindows().length},null,2)})},
    {type:'separator'},{label:l.quit,click:()=>void stop()}
  ]));
}
async function refresh(){if(!client)return;try{state=await client.snapshot();updateMenu();if(attentionNotifications.update(state)&&!smoke&&Notification.isSupported()){notification?.close();const l=labels(state.settings.language);notification=new Notification({title:'Snowball · '+l.attention,body:l.notification});notification.on('click',()=>void open());notification.show();}}catch{client=undefined;updateMenu();}}
async function chooseCodex(){
  const binary=await dialog.showOpenDialog({title:'Codex CLI executable',properties:['openFile']});
  if(binary.canceled)return null;
  const home=await dialog.showOpenDialog({title:'Existing Codex home (default login)',defaultPath:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),properties:['openDirectory']});
  if(home.canceled)return null;
  const project=await dialog.showOpenDialog({title:'Codex working directory',properties:['openDirectory']});
  if(project.canceled)return null;
  const launch=await inspectCodexSelection({executable:binary.filePaths[0],codexHome:home.filePaths[0],workingDirectory:project.filePaths[0]});
  const review=await dialog.showMessageBox({type:'question',title:'Review Codex CLI connection',message:'Connect this Codex CLI using its existing login?',detail:`Executable: ${launch.executable}\nVersion: ${launch.version}\nSHA-256: ${launch.sha256}\nCodex home: ${launch.codexHome}\nWorking directory: ${launch.workingDirectory}\n\nExisting tasks remain read-only until explicitly attached.`,buttons:['Connect','Cancel'],defaultId:1,cancelId:1,noLink:true});
  return review.response===0?launch:null;
}
async function stop(){
  if(stopPromise)return stopPromise;stopping=true;clearInterval(poll);
  stopPromise=(async()=>{
    if(worker){const current=worker;await new Promise(resolve=>{const timer=setTimeout(()=>{current.kill();resolve();},7000);current.once('exit',()=>{clearTimeout(timer);resolve();});current.postMessage({kind:'stop'});});worker=undefined;}
    notification?.close();tray?.destroy();tray=undefined;
    if(temporary)try{fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}
    app.exit(process.exitCode ?? 0);
  })();return stopPromise;
}
app.on('before-quit',event=>{if(!stopping){event.preventDefault();void stop();}});
app.on('window-all-closed',()=>{});app.on('second-instance',()=>void open());
void app.whenReady().then(async () => {
app.dock?.hide();tray=new Tray(drawIcon());tray.on('double-click',()=>void open());updateMenu();
worker=utilityProcess.fork(fileURLToPath(new URL('./core-worker.mjs',import.meta.url)),[],{serviceName:'Snowball local core',stdio:'pipe'});
worker.stdout?.resume();worker.stderr?.resume();
worker.on('message',async message=>{
  if(message?.kind==='native'){
    try{
      let value;
      if(message.action==='get-autostart')value=getAutostart();
      else if(message.action==='set-autostart'&&typeof message.value==='boolean'&&!smoke){app.setLoginItemSettings({...loginConfig,openAtLogin:message.value});value=getAutostart();if(value!==message.value)throw new Error('Autostart not applied');}
      else if(message.action==='choose-workspace'&&!smoke){const result=await dialog.showOpenDialog({properties:['openDirectory']});value=result.canceled?null:{root:result.filePaths[0],displayName:path.basename(result.filePaths[0])};}
      else if(message.action==='select-codex'&&!smoke)value=await chooseCodex();
      else if(message.action==='confirm-disconnect-codex'&&!smoke){const choice=await dialog.showMessageBox({type:'warning',title:'Disconnect Codex CLI',message:`Disconnect ${message.value}?`,detail:'This middleware-owned connection will stop. Previously observed tasks remain read-only; commands with unknown delivery are not retried.',buttons:['Disconnect','Cancel'],defaultId:1,cancelId:1,noLink:true});value=choice.response===0;}
      else if(message.action==='confirm-reset-codex'&&!smoke){const choice=await dialog.showMessageBox({type:'warning',title:'Reset Codex CLI connections',message:'Remove all saved Codex CLI connections?',detail:'Middleware-owned plugin processes will stop. Task history and the Codex login home are not deleted. Unknown commands are never replayed.',buttons:['Remove connections','Cancel'],defaultId:1,cancelId:1,noLink:true});value=choice.response===0;}
      else throw new Error('Unsupported native action');
      worker?.postMessage({kind:'native-result',id:message.id,ok:true,value});
    }catch{worker?.postMessage({kind:'native-result',id:message.id,ok:false});}
  }else if(message?.kind==='connection-warning'){
    savedConnectionWarning=message.value===true;updateMenu();
  }else if(message?.kind==='enrollment'){
    enrollmentBusy=false;await refresh();
    if(!stopping)void dialog.showMessageBox({type:message.ok?'info':'warning',title:'Snowball',message:message.ok?labels(state?.settings?.language).connectSuccess:message.code==='selection_cancelled'?'Codex selection cancelled':labels(state?.settings?.language).connectFailed});
  }else if(message?.kind==='ready'){
    try{
      const url=new URL(message.origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==message.origin)throw new Error('Invalid runtime origin');
      origin=message.origin;savedConnectionWarning=message.savedConnectionWarning===true;client=new LocalClient(origin);await refresh();poll=setInterval(()=>void refresh(),2000);
      if(smoke){
        if(!client||state.accessMode!=='local-no-auth'||BrowserWindow.getAllWindows().length!==0||!state.desktopCapabilities?.tray)throw new Error('Tray smoke failed');
        await client.updateSettings(state.settings.revision,{controlPaused:true});await refresh();if(!state.settings.controlPaused)throw new Error('Pause failed');
        await client.updateSettings(state.settings.revision,{controlPaused:false});await refresh();
        console.log(JSON.stringify({test:'native-tray',platform:process.platform,trayCreated:!tray.isDestroyed(),mainWindows:BrowserWindow.getAllWindows().length,loopbackNoPin:true,pauseRoundtrip:true,corePid:worker.pid,autostartChanged:false}));await stop();
      }
    }catch{console.error('Native tray/runtime verification failed');process.exitCode=1;await stop();}
  }else if(message?.kind==='failed'){console.error(message.code,smoke?message.detail??'':'');process.exitCode=1;await stop();}
});
worker.on('exit',()=>{client=undefined;enrollmentBusy=false;clearInterval(poll);updateMenu();if(!stopping){console.error('Local core exited; no commands retried');if(smoke){process.exitCode=1;void stop();}}});
worker.postMessage({kind:'start',dataDir,codexConfig:argument('--codex-control-config'),opencodeConfig:argument('--opencode-observer-config'),smoke});
if(smoke)setTimeout(()=>{if(!stopping){console.error('Native tray smoke deadline');process.exitCode=1;void stop();}},30000).unref();
}).catch(async () => { console.error('Native tray startup failed'); process.exitCode=1; await stop(); });
}
