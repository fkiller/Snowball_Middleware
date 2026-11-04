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
import {preparationNeedsReview} from './device-setup.mjs';
import {tailscaleCandidates, inspectApprovedTailscale, describeTailscaleInspection} from './tailscale-onboarding.mjs';

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
let remoteState,remoteBusy=false,remoteSequence=0;const remotePending=new Map();
async function checkTailscale(){
  if(remoteBusy||stopping)return;
  remoteBusy=true;updateMenu();
  const en=state?.settings?.language==='en';
  try {
    const suggestions=tailscaleCandidates();
    let selected=suggestions[0];
    if(selected){
      const choice=await dialog.showMessageBox({icon:appIcon,type:'question',title:'Snowball · Tailscale',
        message:en?'Check Tailscale on this PC?':'이 PC의 Tailscale 상태를 확인할까요?',
        detail:en?`The selected local program will run with your account permissions:\n${selected}\n\nRun it only if you trust this Tailscale installation. This will not change Tailscale settings or enable a remote connection.`:`아래 로컬 프로그램이 현재 계정의 권한으로 실행됩니다.\n${selected}\n\n신뢰하는 Tailscale 설치본인 경우에만 실행하세요. 이 검사는 설정을 바꾸거나 원격 연결을 활성화하지 않습니다.`,
        buttons:en?['Check','Choose another…','Cancel']:['확인','다른 파일 선택…','취소'],defaultId:2,cancelId:2,noLink:true});
      if(choice.response===2)return;
      if(choice.response===1)selected=undefined;
    }
    if(!selected){
      if(!suggestions.length){
        const choice=await dialog.showMessageBox({icon:appIcon,type:'info',title:'Snowball · Tailscale',
          message:en?'Tailscale was not found in the usual locations.':'일반적인 위치에서 Tailscale을 찾지 못했습니다.',
          detail:en?'Install Tailscale on this PC, or select its command-line executable if it is already installed. No settings will be changed.':'이 PC에 Tailscale을 설치하거나 이미 설치했다면 명령줄 실행 파일을 선택하세요. 설정은 변경되지 않습니다.',
          buttons:en?['Choose file…','Cancel']:['파일 선택…','취소'],defaultId:1,cancelId:1,noLink:true});
        if(choice.response!==0)return;
      }
      const file=await dialog.showOpenDialog({title:en?'Choose Tailscale command-line executable':'Tailscale 명령줄 실행 파일 선택',properties:['openFile']});
      if(file.canceled||!file.filePaths[0])return;
      selected=file.filePaths[0];
      const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Tailscale',
        message:en?'Run the selected program?':'선택한 프로그램을 실행할까요?',
        detail:en?`${selected}\n\nThis program runs with your account permissions. Continue only if this is your trusted Tailscale installation.`:`${selected}\n\n이 프로그램은 현재 계정의 권한으로 실행됩니다. 신뢰하는 Tailscale 설치본인 경우에만 계속하세요.`,
        buttons:en?['Run','Cancel']:['실행','취소'],defaultId:1,cancelId:1,noLink:true});
      if(choice.response!==0)return;
    }
    const result=await inspectApprovedTailscale(selected);
    const text=describeTailscaleInspection(result,en?'en':'ko');
    if(!stopping)await dialog.showMessageBox({icon:appIcon,type:result.kind==='ready'?'info':'warning',title:'Snowball · Tailscale',...text});
  } catch {
    if(!stopping)await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Tailscale',
      message:en?'Could not check Tailscale.':'Tailscale을 확인하지 못했습니다.',
      detail:en?'Open Tailscale on this PC and try again. Existing local control remains available.':'이 PC에서 Tailscale을 확인하고 다시 시도하세요. 기존 로컬 제어는 계속 사용할 수 있습니다.'});
  } finally {remoteBusy=false;updateMenu();}
}
function remoteRequest(action,deviceId){
  if(!worker||stopping)return Promise.reject(Error('Remote control unavailable'));
  const id=++remoteSequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{remotePending.delete(id);reject(Error('Remote control timed out'));},15000);
    remotePending.set(id,{resolve,reject,timer});
    worker.postMessage({kind:'remote-control',id,action,...(deviceId?{deviceId}:{})});
  });
}
async function remoteAction(action,deviceId){
  if(remoteBusy||stopping)return;
  remoteBusy=true;updateMenu();
  const en=state?.settings?.language==='en';
  try {
  if(action==='enable'){
    const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Experimental remote',
      message:en?'Enable the experimental local gateway?':'실험용 로컬 게이트웨이를 켜시겠습니까?',
      detail:en?'This opens a separate loopback listener only. TLS, verified pairing, host identity verification, and Tailscale setup are not provided. Previously issued unexpired credentials remain valid when re-enabled. Do not expose this gateway to the Internet.':'별도 루프백 리스너만 엽니다. TLS, 검증된 페어링, 호스트 신원 확인과 Tailscale 설정은 제공하지 않습니다. 다시 켜면 만료되지 않은 기존 자격증명이 유효합니다. 이 게이트웨이를 인터넷에 노출하지 마세요.',
      buttons:en?['Enable','Cancel']:['켜기','취소'],defaultId:1,cancelId:1,noLink:true});
    if(choice.response!==0)return;
  }
  if(action==='issue'){
    const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Experimental remote',
      message:en?'Issue a temporary read credential?':'임시 읽기 자격증명을 발급하시겠습니까?',
      detail:en?'This is not verified device pairing. Anyone with the credential can read sensitive session metadata while the listener is reachable. It expires after 8 hours; revoke it if disclosed.':'검증된 기기 페어링이 아닙니다. 연결 가능한 상태에서 이 자격증명을 가진 사람은 민감한 세션 메타데이터를 읽을 수 있습니다. 8시간 후 만료되며 유출 시 철회하세요.',
      buttons:en?['Issue','Cancel']:['발급','취소'],defaultId:1,cancelId:1,noLink:true});
    if(choice.response!==0)return;
  }
  if(action==='revoke'){
    const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Experimental remote',message:en?'Revoke this credential?':'이 자격증명을 철회하시겠습니까?',buttons:en?['Revoke','Cancel']:['철회','취소'],defaultId:1,cancelId:1,noLink:true});
    if(choice.response!==0)return;
  }
  if(action==='recoverLock'){
    const choice=await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Experimental remote',
      message:en?'Recover an abandoned credential lock?':'남겨진 자격 저장소 잠금을 복구하시겠습니까?',
      detail:en?'Only a current-version lock whose owner is confirmed stopped can be removed. Stop older Snowball processes first; older locks cannot be recovered here. The local listener must be off. Credentials are not deleted. If the owner or recovery guard cannot be verified, recovery will stop.':'현재 버전이 만든 잠금 중 소유 프로세스가 종료된 것으로 확인된 것만 제거합니다. 다른 구버전 Snowball 프로세스를 먼저 종료하세요. 구버전 잠금은 여기서 복구할 수 없습니다. 로컬 리스너는 꺼져 있어야 하며 자격증명은 삭제하지 않습니다. 소유자나 복구 가드를 확인할 수 없으면 복구를 중단합니다.',
      buttons:en?['Recover','Cancel']:['복구','취소'],defaultId:1,cancelId:1,noLink:true});
    if(choice.response!==0)return;
  }
    const value=await remoteRequest(action,deviceId);
    if(action==='issue') {
      // Native local dialog only: never write the bearer to logs, URLs, browser UI or clipboard.
      await dialog.showMessageBox({icon:appIcon,type:'info',title:'Snowball · Experimental remote',
        message:en?'Temporary credential — shown once':'임시 자격증명 — 한 번만 표시',
        detail:`${value.token}\n\n${en?'Treat this as a password. Device pairing and HTTPS are not configured by Snowball.':'비밀번호처럼 보호하세요. Snowball은 기기 페어링이나 HTTPS를 설정하지 않습니다.'}`,buttons:['OK'],noLink:true});
      remoteState=await remoteRequest('list');
    } else remoteState=value;
  }catch{
    remoteState=undefined;
    if(!stopping)await dialog.showMessageBox({icon:appIcon,type:'warning',title:'Snowball · Experimental remote',message:action==='recoverLock'?(en?'Credential lock was not recovered.':'자격 저장소 잠금을 복구하지 못했습니다.'):(en?'Remote status could not be confirmed.':'원격 상태를 확인하지 못했습니다.'),detail:action==='recoverLock'?(en?'The lock may be in use, missing, damaged, or blocked by an unverified recovery guard. No lock is removed unless its owner is confirmed stopped.':'잠금이 사용 중이거나 없거나 손상됐거나 확인할 수 없는 복구 가드가 있을 수 있습니다. 소유자가 종료된 것을 확인하지 못하면 잠금을 제거하지 않습니다.'):(en?'Check the local runtime and retry. The local control interface remains separate.':'로컬 런타임을 확인한 뒤 다시 시도하세요. 로컬 제어 화면은 별도로 유지됩니다.')});
  }finally{remoteBusy=false;updateMenu();}
}
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
    deviceSetup.on('review',({profile,record})=>{
      const setup=deviceSetup.setups.get(profile);
      const needsReview=preparationNeedsReview(record,setup.release);
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
const legacyLogin={path:path.join(sourceRoot,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron'),args:[fileURLToPath(import.meta.url),...args.filter(a=>!['--smoke-test','--register-autostart','--stop'].includes(a))]};
const predecessors=[legacyLogin];
try{
  const prior=JSON.parse(fs.readFileSync(path.join(sourceRoot,'.state/desktop-runtime.json'),'utf8')).previousExecutable;
  const relative=prior&&path.relative(path.join(sourceRoot,'.state/desktop-runtimes'),prior);
  if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))predecessors.push({path:prior,args:launchArgs});
}catch{}
const login=suiteConfig||process.platform==='linux'?sourceLogin(app,loginConfig,suiteConfig??dataDir,predecessors):{get:()=>app.getLoginItemSettings(loginConfig).openAtLogin,set:value=>{app.setLoginItemSettings({...loginConfig,openAtLogin:value});if(app.getLoginItemSettings(loginConfig).openAtLogin!==value)throw Error('Autostart not applied');}};
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
    {label:state?.settings?.language==='en'?'Experimental remote':'실험용 원격',enabled:!!client&&!smoke&&!remoteBusy,submenu:[
      {label:state?.settings?.language==='en'?'Check Tailscale on this PC…':'이 PC의 Tailscale 확인…',click:()=>void checkTailscale()},
      {label:remoteState?(remoteState.enabled?(state?.settings?.language==='en'?'Local listener: on':'로컬 리스너: 켜짐'):(state?.settings?.language==='en'?'Local listener: off':'로컬 리스너: 꺼짐')):(state?.settings?.language==='en'?'Status unknown':'상태 확인 안 됨'),enabled:false},
      ...(remoteState?.enabled?[{label:`${remoteState.origin} (loopback)`,enabled:false}]:[]),
      {label:remoteState?.enabled?(state?.settings?.language==='en'?'Disable':'끄기'):(state?.settings?.language==='en'?'Enable…':'켜기…'),enabled:!!remoteState,click:()=>void remoteAction(remoteState.enabled?'disable':'enable')},
      {label:state?.settings?.language==='en'?'Refresh status':'상태 다시 확인',click:()=>void remoteAction('status')},
      ...(!remoteState?[{label:state?.settings?.language==='en'?'Disable even if status is unknown':'상태를 몰라도 끄기',click:()=>void remoteAction('disable')}]:[]),
      {label:state?.settings?.language==='en'?'Issue read credential…':'읽기 자격증명 발급…',enabled:!!remoteState?.enabled,click:()=>void remoteAction('issue')},
      {label:state?.settings?.language==='en'?'Load credentials':'자격증명 목록 불러오기',click:()=>void remoteAction('list')},
      {label:state?.settings?.language==='en'?'Recover abandoned credential lock…':'남겨진 자격 저장소 잠금 복구…',click:()=>void remoteAction('recoverLock')},
      ...(remoteState?.credentials??[]).map(item=>({label:`${item.label} · ${item.deviceId.slice(-8)} · ${new Date(item.expiresAt).toLocaleString()} ${state?.settings?.language==='en'?'— revoke…':'— 철회…'}`,click:()=>void remoteAction('revoke',item.deviceId)})),
      {label:state?.settings?.language==='en'?'TLS, pairing and Tailscale setup are not provided':'TLS·페어링·Tailscale 설정 미제공',enabled:false},
    ]},
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
  if(message?.kind==='remote-result'){
    const call=remotePending.get(message.id);if(call){remotePending.delete(message.id);clearTimeout(call.timer);message.ok?call.resolve(message.value):call.reject(Error('Remote control unavailable'));}
  }else if(message?.kind==='device-observed'){
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
      if(!smoke){try{remoteState=await remoteRequest('status');}catch{remoteState=undefined;}updateMenu();}
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
  }else if(message?.kind==='failed'){console.error(message.code,smoke?message.detail??'':'');startupFailed=true;client=undefined;updateMenu();if(!origin){process.send?.({kind:'desktop-failed',code:message.code});process.exitCode=1;await stop();}}
});
worker.on('exit',()=>{client=undefined;remoteState=undefined;for(const call of remotePending.values()){clearTimeout(call.timer);call.reject(Error('Remote control unavailable'));}remotePending.clear();startupFailed=true;enrollmentBusy=false;clearInterval(poll);updateMenu();if(!stopping){console.error('Local core exited; no commands retried');if(smoke){process.exitCode=1;void stop();}}});
worker.postMessage({kind:'start',dataDir,suiteConfig,codexConfig:argument('--codex-control-config'),opencodeConfig:argument('--opencode-observer-config'),smoke});
if(smoke)setTimeout(()=>{if(!stopping){console.error('Native tray smoke deadline');process.exitCode=1;void stop();}},30000).unref();
}).catch(async error => { console.error('Native tray startup failed:',error.message);process.send?.({kind:'desktop-failed'});process.exitCode=1; await stop(); });
}

} catch(error) {console.error('Native tray bootstrap failed:',error.message);process.send?.({kind:'desktop-failed'});app.exit(1);}
