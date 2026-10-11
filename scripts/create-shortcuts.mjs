// Installer-only native shell integration; no runtime, network or front window.
import {app,shell} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopRuntime} from './desktop-runtime.mjs';
import {writeSuiteShortcut} from '../apps/desktop/shortcut.mjs';
const [config,desktop]=process.argv.slice(2);
void app.whenReady().then(()=>{
  try{
    const suite=JSON.parse(fs.readFileSync(config,'utf8'));
    const details={executable:desktopRuntime().executable,config,icon:fileURLToPath(new URL('../assets/icon.ico',import.meta.url)),cwd:suite.root};
    if(fs.existsSync(desktop))writeSuiteShortcut(shell,path.join(desktop,'Snowball.lnk'),details);
    writeSuiteShortcut(shell,path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','Snowball','Snowball Middleware.lnk'),details);
    app.exit(0);
  }catch(error){console.error(error.message);app.exit(1);}
});
