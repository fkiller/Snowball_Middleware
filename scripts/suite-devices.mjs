import path from 'node:path';
import {chooseLanAddress,pythonInVenv} from './setup-profile.mjs';

// Normal installation includes every supported adapter. Explicit subset
// profiles are for development; older single-profile files remain readable.
export function suiteDevices(config) {
  const profiles = config.deviceProfiles ?? (config.profile === 'all' ? ['mk20','m5stack'] : config.profile === 'web' ? [] : [config.profile]);
  if (!Array.isArray(profiles) || profiles.some(p => !['mk20', 'm5stack'].includes(p)) || new Set(profiles).size !== profiles.length) throw Error('Invalid installed device profiles');
  return profiles;
}

export function planDevices(profile, previous) {
  if (!['all','web','mk20','m5stack'].includes(profile)) throw Error('Invalid setup profile');
  return [...new Set([...(previous ? suiteDevices(previous) : []), ...(profile === 'all' ? ['mk20','m5stack'] : profile === 'web' ? [] : [profile])])];
}

export function planDeviceConfigs(options,previous,root) {
  return Object.fromEntries(planDevices(options.profile,previous).map(profile=>{
    const retained=previous ? deviceConfig(previous,profile) : undefined;
    const config=Object.fromEntries(['bind','bindExplicit','python','serial','device','deviceRoot','controlRoot'].filter(k=>retained?.[k]!==undefined).map(k=>[k,retained[k]]));
    if (options.bind) {config.bind=chooseLanAddress({},options.bind);config.bindExplicit=true;}
    else config.bindExplicit=retained?.bindExplicit ?? Boolean(retained?.bind);
    if(profile==='mk20') {
      config.controlRoot ??= path.join(root,'Snowball_Control');
      config.python ??= pythonInVenv(path.join(root,'Snowball_Middleware','.venv-whisper'));
    } else {
      config.deviceRoot ??= path.join(root,'Snowball_Device_M5Stack');
      config.python ??= pythonInVenv(path.join(config.deviceRoot,'.venv'));
      if(options.device)config.device=options.device;
    }
    return [profile,config];
  }));
}

export function deviceConfig(config, profile) {
  if (!suiteDevices(config).includes(profile)) return undefined;
  return config.devices?.[profile] ?? (config.profile === profile ? config : undefined);
}

export function suiteRuntime(config, interfaces, {allowUnavailableLan=false}={}) {
  const profiles = suiteDevices(config), mk20 = deviceConfig(config,'mk20'), m5 = deviceConfig(config,'m5stack');
  if (profiles.includes('mk20') && (!mk20?.controlRoot || !mk20?.python)) throw Error('MK20 adapter configuration is incomplete');
  if (profiles.includes('m5stack') && (!m5?.deviceRoot || !m5?.python)) throw Error('M5Stack adapter configuration is incomplete');
  const env = {SNOWBALL_PROFILE: mk20 ? 'mk20' : m5 ? 'm5stack' : 'web'};
  if(config.profile==='all')env.SNOWBALL_DEVICE_LAN_OPTIONAL='1';
  if (mk20) Object.assign(env,{SNOWBALL_CONTROL_ROOT:mk20.controlRoot, SNOWBALL_BIND:mk20.bindExplicit === false ? '' : mk20.bind, PYTHON_BIN:mk20.python});
  let gateway,gatewayPending=false;
  if (m5) {
    let bind;
    try {bind=chooseLanAddress(interfaces,m5.bindExplicit === false ? undefined : m5.bind,m5.device);}
    catch(error) {if(!allowUnavailableLan || m5.bindExplicit)throw error;gatewayPending=true;}
    if(bind)
    gateway={script:path.join(m5.deviceRoot,'scripts/gateway.mjs'),cwd:m5.deviceRoot,args:[...(m5.serial ? ['--serial',m5.serial] : []),'--python',m5.python,'--bind',bind,'--backend',`http://127.0.0.1:${config.port}`,...(m5.device ? ['--device',m5.device] : [])]};
  }
  return {profiles,env,gateway,gatewayPending};
}
