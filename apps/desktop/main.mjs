import { app, Tray, Menu, nativeImage, shell, dialog, utilityProcess, BrowserWindow, Notification, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalClient } from '../../packages/client-sdk/dist/index.js';
import { resolveUserDataDir } from '../../packages/core/dist/index.js';
import { ensurePrivateStateDirectory } from '../supervisor/private-state.mjs';
import { inspectCodexSelection } from './codex-connections.mjs';

import { labels, AttentionNotifications } from './presentation.mjs';
import {sourceLogin} from './source-login.mjs';
import {installedDevicePreparations} from '../../scripts/device-preparation.mjs';
import {DeviceSetupHub} from './device-setup-hub.mjs';
import {firmwareRelation} from './device-setup.mjs';

try {
const args=process.argv.slice(app.isPackaged?1:2);const smoke=args.includes('--smoke-test');
const argument=name=>{const i=args.indexOf(name);if(i<0)return;const value=args[i+1];if(!value||!path.isAbsolute(value))throw new Error('Absolute '+name+' path required');return value;};
const temporary=smoke?fs.mkdtempSync(path.join(os.tmpdir(),'snowball-tray-smoke-')):undefined;
const suiteConfig=argument('--suite-config');
const installed=suiteConfig?JSON.parse(fs.readFileSync(suiteConfig,'utf8')):null;
const dataDir=temporary?path.join(temporary,'state'):argument('--data-dir')??installed?.dataDir??resolveUserDataDir();
const marker=suiteConfig?path.join(path.dirname(suiteConfig),'desktop.v1.json'):null;
ensurePrivateStateDirectory(dataDir);fs.mkdirSync(path.join(dataDir,'desktop'),{recursive:true});
const desktopData=suiteConfig?path.join(path.dirname(suiteConfig),'desktop'):path.join(dataDir,'desktop');fs.mkdirSync(desktopData,{recursive:true});
app.setName('Snowball Middleware');app.setPath('userData',desktopData);
if(process.platform==='win32')app.setAppUserModelId('local.snowball.middleware');
const lock=app.requestSingleInstanceLock();
if(!lock){process.send?.({kind:'desktop-already-running'});app.quit();}else{
if(marker){fs.writeFileSync(marker+'.tmp',JSON.stringify({version:1,pid:process.pid,origin:`http://127.0.0.1:${installed.port}`,suiteConfig,status:'starting'})+'\n',{mode:0o600});fs.renameSync(marker+'.tmp',marker);}
let tray,worker,client,state,origin,stopping=false,startupFailed=false,stopPromise,poll,notification,enrollmentBusy=false,savedConnectionWarning=false,appIcon;
const iconPath=fileURLToPath(new URL('../../assets/'+(process.platform==='win32'?'icon.ico':'icon-256.png'),import.meta.url));
let deviceSetup,setupWindow,activeSetupProfile,setupSequence=0;const setupPending=new Map();
const setupUrl=pathToFileURL(fileURLToPath(new URL('./device-setup.html',import.meta.url))).href;
function setupState(){return {...deviceSetup.view(),selectedProfile:activeSetupProfile,language:state?.settings?.language??'ko'};}
function setupSender(event){return setupWindow&&!setupWindow.isDestroyed()&&event.sender===setupWindow.webContents&&event.senderFrame===setupWindow.webContents.mainFrame&&event.senderFrame.url===setupUrl;}
ipcMain.handle('device-setup-snapshot',event=>{if(!deviceSetup||!setupSender(event))throw Error('USB setup unavailable');return setupState();});
ipcMain.handle('device-setup-action',async(event,request)=>{if(!deviceSetup||!setupSender(event))throw Error('USB setup unavailable');return await deviceSetup.action(request);});
async function openDeviceSetup(profile,automatic=false){
  if(profile&&deviceSetup?.setups.has(profile)&&(!automatic||!setupWindow||setupWindow.isDestroyed()||!setupWindow.isVisible()))activeSetupProfile=profile;
  if(!deviceSetup||stopping)return;
  if(setupWindow&&!setupWindow.isDestroyed()){setupWindow.webContents.send('device-setup-state',setupState());if(!automatic||!setupWindow.isVisible()){setupWindow.show();setupWindow.focus();}return;}
  setupWindow=new BrowserWindow({width:1000,height:880,minWidth:760,minHeight:650,show:false,title:'Snowball · Device setup',icon:iconPath,backgroundColor:'#10141b',autoHideMenuBar:true,
    webPreferences:{preload:fileURLToPath(new URL('./device-setup-preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  setupWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  setupWindow.webContents.on('will-navigate',(event,url)=>{if(url!==setupUrl)event.preventDefault();});
  setupWindow.once('closed',()=>{setupWindow=undefined;});
  await setupWindow.loadURL(setupUrl);setupWindow.show();
}
function maintainUart(profile,action,port){
  return new Promise((resolve,reject)=>{
    const id=++setupSequence,timer=setTimeout(()=>{setupPending.delete(id);reject(Error('usb_release_unconfirmed'));},10000);
    setupPending.set(id,{resolve,reject,timer});worker?.postMessage({kind:'device-usb-control',id,profile,action,port});
  });
}
function startDeviceSetup(){
  if(!suiteConfig||smoke||deviceSetup)return;
  try{
    const adapters=installedDevicePreparations(installed);if(!adapters.length)return;
    const backupDirectory=ensurePrivateStateDirectory(path.join(dataDir,'firmware-backups'));
    deviceSetup=new DeviceSetupHub({adapters,backupDirectory,uart:maintainUart});
    deviceSetup.on('change',()=>{if(setupWindow&&!setupWindow.isDestroyed())setupWindow.webContents.send('device-setup-state',setupState());updateMenu();});
    deviceSetup.on('attached',({profile,record})=>{
      const setup=deviceSetup.setups.get(profile);
      const needsReview=setup.descriptor.version===2?!record.currentVersion||record.pending||record.imageMatch===false||firmwareRelation(record.currentVersion,setup.release.components[record.component]?.version)==='older'||record.wifiConfigured===false:!record.hello||firmwareRelation(record.hello.firmware,setup.release.version)==='older'||record.hello.wifiConfigured===false;
      console.log(`Device preparation observed: ${profile} / ${record.transport??'usb/storage'} / version=${record.hello?.firmware??record.currentVersion??'unknown'} / review=${needsReview}`);
      if(needsReview)void openDeviceSetup(profile,true).then(()=>console.log(`Device preparation window ready: ${profile}`)).catch(()=>console.warn(`Device preparation window unavailable: ${profile}`));
    });
    deviceSetup.start();updateMenu();
  }catch{console.warn('Device USB setup unavailable; update the installed device support. LAN control continues.');}
}
const attentionNotifications=new AttentionNotifications();
const launchArgs=[...(app.isPackaged?[]:[fileURLToPath(import.meta.url)]),...args.filter(a=>!['--smoke-test','--register-autostart','--stop'].includes(a))];
const loginConfig={path:process.execPath,args:launchArgs};
const sourceRoot=installed?.middleware??fileURLToPath(new URL('../..',import.meta.url));
const legacyLogin={path:path.join(sourceRoot,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'Electron.app/Contents/MacOS/Electron'),args:[fileURLToPath(import.meta.url),...args.filter(a=>!['--smoke-test','--register-autostart','--stop'].includes(a))]};
const predecessors=[legacyLogin];
try{
  const prior=JSON.parse(fs.readFileSync(path.join(sourceRoot,'.state/desktop-runtime.json'),'utf8')).previousExecutable;
  const relative=prior&&path.relative(path.join(sourceRoot,'.state/desktop-runtimes'),prior);
  if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))predecessors.push({path:prior,args:launchArgs});
}catch{}
const login=suiteConfig?sourceLogin(app,loginConfig,suiteConfig,predecessors):{get:()=>app.getLoginItemSettings(loginConfig).openAtLogin,set:value=>{app.setLoginItemSettings({...loginConfig,openAtLogin:value});if(app.getLoginItemSettings(loginConfig).openAtLogin!==value)throw Error('Autostart not applied');}};
const getAutostart=()=>login.get();
const open=async(settings=false)=>{if(origin)await shell.openExternal(origin+(settings?'#settings':''));};
function drawIcon(){
  const image=nativeImage.createFromPath(fileURLToPath(new URL('../../assets/icon-32.png',import.meta.url)));
  if(image.isEmpty())throw Error('Snowball tray icon is missing');
  return process.platform==='darwin'?image.resize({width:18,height:18,quality:'best'}):image;
}
function updateMenu(){
  if(!tray)return;const paused=state?.settings?.controlPaused;const waiting=state?.decisions?.filter(d=>d.status==='pending').length??0;
  const l=labels(state?.settings?.language);
  const status=!origin&&!startupFailed?l.starting:!client||savedConnectionWarning?l.degraded:paused?l.paused:waiting?l.attention:l.connected;
  tray.setToolTip('Snowball · '+status);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Snowball · '+status,enabled:false},{type:'separator'},
    {label:l.open,enabled:!!client,click:()=>void open()},
    ...(suiteConfig?[{label:state?.settings?.language==='en'?'Device setup…':'기기 설정…',enabled:!!deviceSetup,click:()=>void openDeviceSetup()}]:[]),
    ...(!suiteConfig?[{label:l.connectCodex,enabled:!!client&&!smoke&&!enrollmentBusy&&!argument('--codex-control-config'),click:()=>{enrollmentBusy=true;updateMenu();worker?.postMessage({kind:'enroll-codex'});}}]:[]),
    {label:paused?l.resume:l.pause,enabled:!!client,click:async()=>{try{await client.updateSettings(state.settings.revision,{controlPaused:!paused});await refresh();}catch{await refresh();}}},
    {label:l.autostart,type:'checkbox',checked:getAutostart(),enabled:!!client&&!smoke,click:async item=>{try{await client.updateSettings(state.settings.revision,{autostart:item.checked});}catch{}await refresh();}},
    {type:'separator'},{label:l.settings,enabled:!!client,click:()=>void open(true)},
    {label:l.diagnostics,click:()=>void dialog.showMessageBox({icon:appIcon,type:'info',title:'Snowball',message:l.state,detail:JSON.stringify({origin:origin??null,connectedHarnesses:state?.connectedHarnesses??[],savedConnectionWarning,devices:state?.devices?.length??0,mainWindows:BrowserWindow.getAllWindows().length},null,2)})},
    {label:state?.settings?.language==='en'?'Restart middleware':'미들웨어 재시작',enabled:!stopping&&!deviceSetup?.job,click:async()=>{app.relaunch({args:process.argv.slice(1).filter(x=>!['--register-autostart','--stop'].includes(x))});await stop();}},
    {type:'separator'},{label:l.quit,click:()=>void stop()}
  ]));
}
async function refresh(){if(!client)return;try{state=await client.snapshot();updateMenu();if(attentionNotifications.update(state)&&!smoke&&Notification.isSupported()){notification?.close();const l=labels(state.settings.language);notification=new Notification({icon:appIcon,title:'Snowball · '+l.attention,body:l.notification});notification.on('click',()=>void open());notification.show();}}catch{client=undefined;updateMenu();}}
async function chooseCodex(){
  const binary=await dialog.showOpenDialog({title:'Codex CLI executable',properties:['openFile']});
  if(binary.canceled)return null;
  const home=await dialog.showOpenDialog({title:'Existing Codex home (default login)',defaultPath:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),properties:['openDirectory']});
  if(home.canceled)return null;
  const project=await dialog.showOpenDialog({title:'Codex working directory',properties:['openDirectory']});
  if(project.canceled)return null;
  const launch=await inspectCodexSelection({executable:binary.filePaths[0],codexHome:home.filePaths[0],workingDirectory:project.filePaths[0]});
  const review=await dialog.showMessageBox({icon:appIcon,type:'question',title:'Review Codex CLI connection',message:'Connect this Codex CLI using its existing login?',detail:`Executable: ${launch.executable}\nVersion: ${launch.version}\nSHA-256: ${launch.sha256}\nCodex home: ${launch.codexHome}\nWorking directory: ${launch.workingDirectory}\n\nExisting tasks remain read-only until explicitly attached.`,buttons:['Connect','Cancel'],defaultId:1,cancelId:1,noLink:true});
  return review.response===0?launch:null;
}
async function stop(){
  if(deviceSetup?.job&&!stopping){await dialog.showMessageBox({icon:appIcon,type:'info',title:'Snowball · Device setup',message:state?.settings?.language==='en'?'Wait for the device operation to finish before quitting.':'기기 작업이 끝난 뒤 미들웨어를 종료할 수 있습니다.'});return;}
  if(stopPromise)return stopPromise;stopping=true;clearInterval(poll);
  stopPromise=(async()=>{
    await deviceSetup?.close();setupWindow?.destroy();
    if(worker){const current=worker;await new Promise(resolve=>{const timer=setTimeout(()=>{current.kill();resolve();},7000);current.once('exit',()=>{clearTimeout(timer);resolve();});current.postMessage({kind:'stop'});});worker=undefined;}
    notification?.close();tray?.destroy();tray=undefined;
    if(temporary)try{fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}
    if(marker){try{const record=JSON.parse(fs.readFileSync(marker,'utf8'));if(record.pid===process.pid)fs.unlinkSync(marker);}catch{}}
    app.exit(process.exitCode ?? 0);
  })();return stopPromise;
}
app.on('before-quit',event=>{if(!stopping){event.preventDefault();void stop();}});
process.on('message',message=>{if(message==='snowball.stop')void stop();});
app.on('window-all-closed',()=>{});app.on('second-instance',(_event,argv)=>{if(argv.includes('--stop'))void stop();else if(!argv.includes('--background'))void open();});
void app.whenReady().then(async () => {
if(args.includes('--stop')){process.send?.({kind:'desktop-stopped'});await stop();return;}
if(!smoke)login.migrate?.();
if(args.includes('--register-autostart')&&!smoke)login.set(true);
appIcon=nativeImage.createFromPath(iconPath);if(appIcon.isEmpty())throw Error('Snowball application icon is missing');
app.setAboutPanelOptions({applicationName:'Snowball Middleware',applicationVersion:app.getVersion(),iconPath});
Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{label:'Snowball Middleware',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{role:'editMenu'}]):null);
app.dock?.setIcon(appIcon);app.dock?.hide();tray=new Tray(drawIcon());tray.on('double-click',()=>void open());updateMenu();
worker=utilityProcess.fork(fileURLToPath(new URL(suiteConfig?'./suite-worker.mjs':'./core-worker.mjs',import.meta.url)),[],{serviceName:'Snowball local core',stdio:'pipe'});
if(suiteConfig){for(const stream of [worker.stdout,worker.stderr])stream?.on('data',bytes=>process.stdout.write(bytes));}else{worker.stdout?.resume();worker.stderr?.resume();}
worker.on('message',async message=>{
  if(message?.kind==='device-observed'){
    deviceSetup?.observe(message);
  }else if(message?.kind==='device-usb-result'){
    const call=setupPending.get(message.id);if(call){setupPending.delete(message.id);clearTimeout(call.timer);message.ok?call.resolve():call.reject(Error('usb_release_unconfirmed'));}
  }else if(message?.kind==='native'){
    try{
      let value;
      if(message.action==='get-autostart')value=getAutostart();
      else if(message.action==='set-autostart'&&typeof message.value==='boolean'&&!smoke){login.set(message.value);value=getAutostart();if(value!==message.value)throw new Error('Autostart not applied');}
      else if(message.action==='choose-workspace'&&!smoke){const result=await dialog.showOpenDialog({properties:['openDirectory']});value=result.canceled?null:{root:result.filePaths[0],displayName:path.basename(result.filePaths[0])};}
      else if(message.action==='select-codex'&&!smoke)value=await chooseCodex();
      else if(message.action==='confirm-disconnect-codex'&&!smoke){const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Disconnect Codex CLI',message:`Disconnect ${message.value}?`,detail:'This middleware-owned connection will stop. Previously observed tasks remain read-only; commands with unknown delivery are not retried.',buttons:['Disconnect','Cancel'],defaultId:1,cancelId:1,noLink:true});value=choice.response===0;}
      else if(message.action==='confirm-reset-codex'&&!smoke){const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Reset Codex CLI connections',message:'Remove all saved Codex CLI connections?',detail:'Middleware-owned plugin processes will stop. Task history and the Codex login home are not deleted. Unknown commands are never replayed.',buttons:['Remove connections','Cancel'],defaultId:1,cancelId:1,noLink:true});value=choice.response===0;}
      else throw new Error('Unsupported native action');
      worker?.postMessage({kind:'native-result',id:message.id,ok:true,value});
    }catch{worker?.postMessage({kind:'native-result',id:message.id,ok:false});}
  }else if(message?.kind==='connection-warning'){
    savedConnectionWarning=message.value===true;updateMenu();
  }else if(message?.kind==='enrollment'){
    enrollmentBusy=false;await refresh();
    if(!stopping)void dialog.showMessageBox({icon:appIcon,type:message.ok?'info':'warning',title:'Snowball',message:message.ok?labels(state?.settings?.language).connectSuccess:message.code==='selection_cancelled'?'Codex selection cancelled':labels(state?.settings?.language).connectFailed});
  }else if(message?.kind==='ready'){
    try{
      const url=new URL(message.origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==message.origin)throw new Error('Invalid runtime origin');
      origin=message.origin;savedConnectionWarning=message.savedConnectionWarning===true;client=new LocalClient(origin);await refresh();poll=setInterval(()=>void refresh(),2000);
      if(!client)throw Error('Native runtime snapshot unavailable');
      if(marker){fs.writeFileSync(marker+'.tmp',JSON.stringify({version:1,pid:process.pid,origin,suiteConfig})+'\n',{mode:0o600});fs.renameSync(marker+'.tmp',marker);}
      process.send?.({kind:'desktop-ready',origin});
      startDeviceSetup();
      if(smoke){
        if(!client||state.accessMode!=='local-no-auth'||BrowserWindow.getAllWindows().length!==0||!state.desktopCapabilities?.tray)throw new Error('Tray smoke failed');
        await client.updateSettings(state.settings.revision,{controlPaused:true});await refresh();if(!state.settings.controlPaused)throw new Error('Pause failed');
        await client.updateSettings(state.settings.revision,{controlPaused:false});await refresh();
        console.log(JSON.stringify({test:'native-tray',platform:process.platform,trayCreated:!tray.isDestroyed(),mainWindows:BrowserWindow.getAllWindows().length,loopbackNoPin:true,pauseRoundtrip:true,corePid:worker.pid,autostartChanged:false}));await stop();
      }
    }catch{console.error('Native tray/runtime verification failed');process.exitCode=1;await stop();}
  }else if(message?.kind==='failed'){console.error(message.code,smoke?message.detail??'':'');startupFailed=true;client=undefined;updateMenu();if(!origin){process.send?.({kind:'desktop-failed'});process.exitCode=1;await stop();}}
});
worker.on('exit',()=>{client=undefined;startupFailed=true;enrollmentBusy=false;clearInterval(poll);updateMenu();if(!stopping){console.error('Local core exited; no commands retried');if(smoke){process.exitCode=1;void stop();}}});
worker.postMessage({kind:'start',dataDir,suiteConfig,codexConfig:argument('--codex-control-config'),opencodeConfig:argument('--opencode-observer-config'),smoke});
if(smoke)setTimeout(()=>{if(!stopping){console.error('Native tray smoke deadline');process.exitCode=1;void stop();}},30000).unref();
}).catch(async error => { console.error('Native tray startup failed:',error.message);process.send?.({kind:'desktop-failed'});process.exitCode=1; await stop(); });
}

} catch(error) {console.error('Native tray bootstrap failed:',error.message);process.send?.({kind:'desktop-failed'});app.exit(1);}
