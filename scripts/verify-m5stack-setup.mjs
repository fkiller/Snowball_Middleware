// Read-only native UI verification: real OS enumeration, no install/migrate.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
const [deviceRoot,python,output,mk20Root,mk20Python]=process.argv.slice(2);
if(![deviceRoot,python,output].every(value=>value&&path.isAbsolute(value)))throw Error('Supply absolute device root, Python, and output directory');
void app.whenReady().then(async()=>{let setup,window;
try{
  fs.mkdirSync(output,{recursive:true});
  const adapters=[{profile:'m5stack',device:{deviceRoot,python}},...(mk20Root&&mk20Python?[{profile:'mk20',device:{deviceRoot:mk20Root,python:mk20Python}}]:[])];
  setup=new DeviceSetupHub({adapters,backupDirectory:output});
  await setup.scan();
  const view=()=>({...setup.view(),language:'ko'});
  ipcMain.handle('device-setup-snapshot',()=>view());
  let overlappedRefresh=false;
  ipcMain.handle('device-setup-action',async(_event,request)=>{if(!['wifi','refresh'].includes(request.action))throw Error('Read-only verification');if(request.action==='refresh')overlappedRefresh=setup.view().checking;await setup.action(request);return view();});
  window=new BrowserWindow({width:1000,height:1100,show:false,webPreferences:{preload:fileURLToPath(new URL('../apps/desktop/device-setup-preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await window.loadFile(fileURLToPath(new URL('../apps/desktop/device-setup.html',import.meta.url)));
  await new Promise(resolve=>setTimeout(resolve,1200));
  setup.on('change',()=>window.webContents.send('device-setup-state',view()));
  // Exercise actual OS enumeration through the sandbox/preload while discovery owns USB.
  const background=setup.scan();
  if(!setup.view().checking)throw Error('Real discovery did not acquire the scan lease');
  await window.webContents.executeJavaScript(`document.getElementById('refresh').click();`);
  await background;
  const waitUntil=Date.now()+60000;
  while(await window.webContents.executeJavaScript(`document.getElementById('refresh').disabled`)){
    if(Date.now()>waitUntil)throw Error('Manual refresh did not finish');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(await window.webContents.executeJavaScript(`document.getElementById('notice').textContent`))throw Error('Manual refresh reported an error after real enumeration');
  if(!overlappedRefresh)throw Error('Manual refresh did not overlap real discovery');
  if(!await window.webContents.executeJavaScript(`actionFailure(new Error('USB: usb_device_disconnected')).includes('연결')&&!actionFailure(new Error('unexpected')).includes('진행 중')`))throw Error('Action errors were masked as busy');
  fs.mkdirSync(output,{recursive:true});
  for(const language of ['ko','en']){
    await window.webContents.executeJavaScript(`document.getElementById('language').value='${language}';document.getElementById('language').dispatchEvent(new Event('change'));`);
    await new Promise(resolve=>setTimeout(resolve,150));
    const text=await window.webContents.executeJavaScript('document.body.innerText');
    if(!text.includes(setup.setups.get('m5stack').release.version)||!text.includes(language==='ko'?'기기 조작 따라하기':'Follow the physical controls'))throw Error('Setup UI did not render');
    fs.writeFileSync(path.join(output,language+'.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.scrollTo(0,document.body.scrollHeight)');
    const m5=await window.webContents.executeJavaScript(`({keys:document.querySelectorAll('.m5-buttons button').length,faces:!!document.querySelector('.faces-keyboard'),steps:document.querySelectorAll('.guide-step').length})`);
    if(m5.keys!==3||!m5.faces||m5.steps!==6)throw Error('M5Stack physical walkthrough missing');
    await window.webContents.executeJavaScript(`document.querySelector('.guide-step').click();document.querySelector('[data-control=select]:not(:disabled)').click();`);
    if(!await window.webContents.executeJavaScript(`!!document.querySelector('[data-control=down]:not(:disabled)')`))throw Error('M5Stack guide did not advance');
    await new Promise(resolve=>setTimeout(resolve,150));
    fs.writeFileSync(path.join(output,language+'-guide.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.scrollTo(0,0)');
  }
  if(mk20Root){
    for(const language of ['ko','en']){
      await window.webContents.executeJavaScript(`document.getElementById('profile').value='mk20';document.getElementById('profile').dispatchEvent(new Event('change'));document.getElementById('language').value='${language}';document.getElementById('language').dispatchEvent(new Event('change'));`);
      await new Promise(resolve=>setTimeout(resolve,800));
      const text=await window.webContents.executeJavaScript('document.body.innerText');
      if(!text.includes('MK20')||!text.includes(setup.setups.get('mk20').release.version)||!text.includes('QMK'))throw Error('MK20 setup UI did not render');
      fs.writeFileSync(path.join(output,'mk20-'+language+'.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript('window.scrollTo(0,document.body.scrollHeight)');
      const mk20=await window.webContents.executeJavaScript(`({keys:[...document.querySelectorAll('.display-key')].map(k=>k.firstChild.textContent),knobs:document.querySelectorAll('.knob').length,steps:document.querySelectorAll('.guide-step').length})`);
      if(mk20.keys.join(',')!=='K17,K13,K9,K5,K1,K18,K14,K10,K6,K2,K19,K15,K11,K7,K3,K20,K16,K12,K8,K4'||mk20.knobs!==2||mk20.steps!==5)throw Error('MK20 physical layout mismatch');
      await window.webContents.executeJavaScript(`document.querySelectorAll('.guide-step')[1].click();document.querySelector('[data-control=machine-key]').click();`);
      if(!await window.webContents.executeJavaScript(`!!document.querySelector('[data-control=left-turn]:not(:disabled)')`))throw Error('MK20 guide did not open machine navigation');
      fs.writeFileSync(path.join(output,'mk20-'+language+'-guide.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('[data-control=left-turn]').click();document.querySelector('[data-control=left-press]').click();`);
      if(!await window.webContents.executeJavaScript(`document.getElementById('guide-position').textContent==='5 / 5'`))throw Error('MK20 walkthrough did not reach physical verification');
      await window.webContents.executeJavaScript('window.scrollTo(0,0)');
    }
  }
  console.log(JSON.stringify({test:'m5stack-native-setup',firmware:setup.setups.get('m5stack').release.version,actualUsbCandidates:setup.setups.get('m5stack').records.size,refreshDuringDiscovery:'passed',languages:['ko','en'],flashed:false,secretRead:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await setup?.close();window?.destroy();app.exit(process.exitCode??0);}
});
