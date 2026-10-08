import path from 'node:path';
import {chooseLanAddress} from './setup-profile.mjs';

// Profile chooses what setup prepares; installed adapters accumulate on the
// same host. Older single-profile suite files remain readable.
export function suiteDevices(config) {
  const profiles = config.deviceProfiles ?? (config.profile === 'web' ? [] : [config.profile]);
  if (!Array.isArray(profiles) || profiles.some(p => !['mk20', 'm5stack'].includes(p)) || new Set(profiles).size !== profiles.length) throw Error('Invalid installed device profiles');
  return profiles;
}

export function planDevices(profile, previous) {
  if (!['web','mk20','m5stack'].includes(profile)) throw Error('Invalid setup profile');
  return [...new Set([...(previous ? suiteDevices(previous) : []), ...(profile === 'web' ? [] : [profile])])];
}

export function deviceConfig(config, profile) {
  if (!suiteDevices(config).includes(profile)) return undefined;
  return config.devices?.[profile] ?? (config.profile === profile ? config : undefined);
}

export function suiteRuntime(config, interfaces) {
  const profiles = suiteDevices(config), mk20 = deviceConfig(config,'mk20'), m5 = deviceConfig(config,'m5stack');
  if (profiles.includes('mk20') && (!mk20?.controlRoot || !mk20?.python)) throw Error('MK20 adapter configuration is incomplete');
  if (profiles.includes('m5stack') && (!m5?.deviceRoot || !m5?.python)) throw Error('M5Stack adapter configuration is incomplete');
  const env = {SNOWBALL_PROFILE: mk20 ? 'mk20' : m5 ? 'm5stack' : 'web'};
  if (mk20) Object.assign(env,{SNOWBALL_CONTROL_ROOT:mk20.controlRoot, SNOWBALL_BIND:mk20.bindExplicit === false ? '' : mk20.bind, PYTHON_BIN:mk20.python});
  let gateway;
  if (m5) {
    const bind=chooseLanAddress(interfaces,m5.bindExplicit === false ? undefined : m5.bind,m5.device);
    gateway={script:path.join(m5.deviceRoot,'scripts/gateway.mjs'),cwd:m5.deviceRoot,args:[...(m5.serial ? ['--serial',m5.serial] : []),'--python',m5.python,'--bind',bind,'--backend',`http://127.0.0.1:${config.port}`,...(m5.device ? ['--device',m5.device] : [])]};
  }
  return {profiles,env,gateway};
}
