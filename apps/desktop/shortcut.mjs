import fs from 'node:fs';
import path from 'node:path';
export function writeSuiteShortcut(shell,file,{executable,config,icon,cwd}){
  if(![file,executable,config,icon,cwd].every(path.isAbsolute))throw Error('Absolute shortcut paths required');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(!shell.writeShortcutLink(file,'create',{target:executable,cwd,args:'--suite-config "'+config+'"',icon,iconIndex:0,description:'Snowball Middleware',appUserModelId:'local.snowball.middleware'}))throw Error('Snowball shortcut registration failed');
  const saved=shell.readShortcutLink(file);
  if(saved.target!==executable||saved.icon!==icon||saved.appUserModelId!=='local.snowball.middleware')throw Error('Snowball shortcut identity was not applied');
}
