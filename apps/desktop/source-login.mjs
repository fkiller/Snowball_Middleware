import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Source installs need their arguments on macOS; Electron login items launch
// only a signed app bundle there, not the selected source suite.
export function sourceLogin(app,config,identity){
  if(process.platform==='win32'){
    const selected={...config,name:'Snowball Middleware '+createHash('sha256').update(identity).digest('hex').slice(0,12),args:config.args.map(x=>/\s/.test(x)?'"'+x+'"':x)};
    // openAtLogin refers to the app's default key. Source suites have their own
    // named entry; Windows' launchItems lists positional arguments separately.
    const positional=config.args.filter(x=>!x.startsWith('--'));
    const get=()=>app.getLoginItemSettings({path:config.path}).launchItems.some(item=>item.name===selected.name&&item.scope==='user'&&item.enabled&&path.resolve(item.path).toLowerCase()===path.resolve(config.path).toLowerCase()&&JSON.stringify(item.args)===JSON.stringify(positional));
    return {get,set:value=>{app.setLoginItemSettings({...selected,openAtLogin:value});if(get()!==value)throw Error('Login registration was not applied');}};
  }
  if(process.platform!=='darwin')throw Error('Unsupported source login platform');
  const label='local.snowball.middleware.'+createHash('sha256').update(identity).digest('hex').slice(0,12),domain='gui/'+process.getuid();
  const file=path.join(os.homedir(),'Library/LaunchAgents',label+'.plist');
  const xml=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const payload='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>'+label+'</string><key>ProgramArguments</key><array>'+[config.path,...config.args].map(x=>'<string>'+xml(x)+'</string>').join('')+'</array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string></dict></plist>\n';
  const run=args=>spawnSync('/bin/launchctl',args,{encoding:'utf8',timeout:10000,stdio:'pipe'});
  const get=()=>fs.existsSync(file)&&fs.readFileSync(file,'utf8')===payload&&run(['print',domain+'/'+label]).status===0;
  return {get,set(value){
    if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==payload)throw Error('Existing login agent differs; registration refused');
    if(value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,payload,{mode:0o600});if(!get()&&run(['bootstrap',domain,file]).status!==0)throw Error('Login agent bootstrap failed');}
    else {if(get()&&run(['bootout',domain+'/'+label]).status!==0)throw Error('Login agent removal failed');if(fs.existsSync(file))fs.unlinkSync(file);}
    if(get()!==value)throw Error('Login agent state was not confirmed');
  }};
}
