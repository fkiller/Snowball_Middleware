// Read-only native UI verification: real OS enumeration, no install/migrate.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DeviceSetupHub} from '../apps/desktop/device-setup-hub.mjs';
const [deviceRoot,python,output]=process.argv.slice(2);
if(![deviceRoot,python,output].every(value=>value&&path.isAbsolute(value)))throw Error('Supply absolute device root, Python, and output directory');
void app.whenReady().then(async()=>{let setup,window;
try{
  setup=new DeviceSetupHub({adapters:[{profile:'m5stack',device:{deviceRoot,python}}],backupDirectory:output});
  await setup.scan();
  const view=()=>({...setup.view(),language:'ko'});
  ipcMain.handle('device-setup-snapshot',()=>view());
  ipcMain.handle('device-setup-action',async(_event,request)=>{if(request.action!=='wifi')throw Error('Read-only verification');await setup.action(request);return view();});
  window=new BrowserWindow({width:1000,height:1100,show:false,webPreferences:{preload:fileURLToPath(new URL('../apps/desktop/device-setup-preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await window.loadFile(fileURLToPath(new URL('../apps/desktop/device-setup.html',import.meta.url)));
  await new Promise(resolve=>setTimeout(resolve,1200));
  fs.mkdirSync(output,{recursive:true});
  for(const language of ['ko','en']){
    await window.webContents.executeJavaScript(`document.getElementById('language').value='${language}';document.getElementById('language').dispatchEvent(new Event('change'));`);
    await new Promise(resolve=>setTimeout(resolve,150));
    const text=await window.webContents.executeJavaScript('document.body.innerText');
    if(!text.includes(setup.setups.get('m5stack').release.version)||!text.includes(language==='ko'?'기기에서 직접 설정하기':'Set up on the device'))throw Error('Setup UI did not render');
    fs.writeFileSync(path.join(output,language+'.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.scrollTo(0,document.body.scrollHeight)');
    await new Promise(resolve=>setTimeout(resolve,150));
    fs.writeFileSync(path.join(output,language+'-guide.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.scrollTo(0,0)');
  }
  console.log(JSON.stringify({test:'m5stack-native-setup',firmware:setup.setups.get('m5stack').release.version,actualUsbCandidates:setup.setups.get('m5stack').records.size,languages:['ko','en'],flashed:false,secretRead:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await setup?.close();window?.destroy();app.exit(process.exitCode??0);}
});
