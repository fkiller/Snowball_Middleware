import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deviceConfig,suiteDevices} from './suite-devices.mjs';

process.env.AGY_CLI_DISABLE_AUTO_UPDATE='true';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help') {
  console.log('Usage: prepare-installed-m5stack.mjs --config PATH [--serial COMx] [--flash]\nUses installed tools only. Default: verify existing firmware without flashing. --flash backs up the full flash before upload.');
} else {
  const options={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--flash')options.flash=true;
    else if(['--config','--serial'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))options[args[i].slice(2)]=args[++i];
    else throw Error('Unknown or incomplete device preparation option');
  }
  if(!options.config)throw Error('Supply --config for the existing installation');
  if(options.serial&&!/^(?:COM[1-9][0-9]*|\/dev\/[a-zA-Z0-9._/-]+)$/.test(options.serial))throw Error('Invalid USB port');
  const configFile=path.resolve(options.config),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const device=deviceConfig(config,'m5stack');
  if(config.version!==1||!device?.deviceRoot||!fs.existsSync(device.python??''))throw Error('M5Stack support is missing; update this installation first');
  const launcher=fileURLToPath(new URL('./start-installed.mjs',import.meta.url));
  const node=config.nodeExecutable??process.execPath;
  const output=path.join(path.dirname(configFile),'m5stack-device.json');
  const running=fs.existsSync(path.join(path.dirname(configFile),'desktop.v1.json'));
  const run=(exe,argv)=>{const r=spawnSync(exe,argv,{windowsHide:true,shell:false,env:process.env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('Device preparation failed; existing registration and configuration are retained');};
  if(running)run(node,[launcher,'--config',configFile,'--stop']);
  try {
    run(device.python,[path.join(device.deviceRoot,'scripts/install_device.py'),'--output',output,...(options.serial?['--port',options.serial]:[]),...(options.flash?[]:['--no-flash'])]);
    const {port}=JSON.parse(fs.readFileSync(output,'utf8'));
    if(typeof port!=='string'||!/^(?:COM[1-9][0-9]*|\/dev\/[a-zA-Z0-9._/-]+)$/.test(port))throw Error('Device verification returned an invalid USB port');
    config.deviceProfiles=suiteDevices(config);
    const settings=Object.fromEntries(['bind','bindExplicit','python','serial','device','deviceRoot'].filter(k=>device[k]!==undefined).map(k=>[k,device[k]]));
    config.devices={...config.devices,m5stack:{...settings,serial:port}};
    const temporary=configFile+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,configFile);
    console.log('USB firmware/FACES verified. The gateway will enroll this PC on the next device hello. Select this PC on the device after enrollment.');
  } finally {
    if(running)run(node,[launcher,'--config',configFile]);
  }
}
