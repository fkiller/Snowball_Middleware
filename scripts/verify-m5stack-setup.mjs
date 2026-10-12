// Read-only native UI verification: real OS enumeration, no install/migrate.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
const [deviceRoot,python,output,mk20Root,mk20Python,mk20Adb]=process.argv.slice(2);
if(![deviceRoot,python,output].every(value=>value&&path.isAbsolute(value)))throw Error('Supply absolute device root, Python, and output directory');
void app.whenReady().then(async()=>{let setup,window;
try{
  fs.mkdirSync(output,{recursive:true});
  const adapters=[{profile:'m5stack',device:{deviceRoot,python}},...(mk20Root&&mk20Python?[{profile:'mk20',device:{deviceRoot:mk20Root,python:mk20Python,...(mk20Adb?{adb:mk20Adb,adbSha256:createHash('sha256').update(fs.readFileSync(mk20Adb)).digest('hex')}:{})}}]:[])];
  setup=new DeviceSetupHub({adapters,backupDirectory:output});
  await setup.scan();
  const view=()=>({...setup.view(),language:'ko'});
  ipcMain.handle('device-setup-snapshot',()=>view());
  let overlappedRefresh=false;
  ipcMain.handle('device-setup-action',async(_event,request)=>{if(!['wifi','refresh'].includes(request.action))throw Error('Read-only verification');if(request.action==='refresh')overlappedRefresh=setup.view().checking;await setup.action(request);return view();});
  window=new BrowserWindow({width:1000,height:1100,show:false,icon:fileURLToPath(new URL('../assets/icon.ico',import.meta.url)),webPreferences:{preload:fileURLToPath(new URL('../apps/desktop/device-setup-preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  await window.loadFile(fileURLToPath(new URL('../apps/desktop/device-setup.html',import.meta.url)));
  await new Promise(resolve=>setTimeout(resolve,1200));
  if(!await window.webContents.executeJavaScript(`(()=>{const icon=document.querySelector('.brand-heading img');return icon.complete&&icon.naturalWidth===256;})()`))throw Error('Snowball setup branding did not load');
  setup.on('change',()=>window.webContents.send('device-setup-state',view()));
  // A real read-only IPC rejection must follow subsequent language changes.
  await window.webContents.executeJavaScript(`action({action:'invalid-localization-check'})`);
  const notice=()=>window.webContents.executeJavaScript(`document.getElementById('notice').textContent`);
  const koreanNotice=await notice();
  if(!koreanNotice.includes('요청을 완료하지 못했습니다'))throw Error('Read-only IPC rejection was not shown in Korean');
  await window.webContents.executeJavaScript(`document.getElementById('language').value='en';document.getElementById('language').dispatchEvent(new Event('change'));`);
  if(!(await notice()).includes('The request failed.'))throw Error('Existing IPC rejection did not switch to English');
  await window.webContents.executeJavaScript(`document.getElementById('language').value='ko';document.getElementById('language').dispatchEvent(new Event('change'));`);
  if(await notice()!==koreanNotice)throw Error('Existing IPC rejection did not switch back to Korean');
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
      if(mk20Adb){
        if(![...setup.setups.get('mk20').records.values()].some(r=>r.transport==='maintenance'&&r.writable))throw Error('Actual MK20 maintenance connection missing');
        if(!await window.webContents.executeJavaScript(`(()=>{const card=[...document.querySelectorAll('article.device')].find(c=>c.textContent.includes('LAN maintenance'));if(!card)return false;const check=card.querySelector('.check input'),button=[...card.querySelectorAll('button')].find(b=>b.textContent.includes('${language==='ko'?'런타임 업데이트':'update runtime'}'));if(!check||!button||!button.disabled)return false;check.checked=true;check.dispatchEvent(new Event('change'));const enabled=!button.disabled;check.checked=false;check.dispatchEvent(new Event('change'));return enabled&&button.disabled;})()`))throw Error('Real maintenance update review button missing');
      }
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
  console.log(JSON.stringify({test:'m5stack-native-setup',firmware:setup.setups.get('m5stack').release.version,actualUsbCandidates:setup.setups.get('m5stack').records.size,refreshDuringDiscovery:'passed',existingNoticeLanguageSwitch:'passed',languages:['ko','en'],flashed:false,secretRead:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await setup?.close();window?.destroy();app.exit(process.exitCode??0);}
});
