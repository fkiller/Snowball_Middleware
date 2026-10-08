import path from 'node:path';
import os from 'node:os';

export const harnessRepositories = {
  codex: 'Snowball_Harness_Codex',
  antigravity: 'Snowball_Harness_Antigravity',
  opencode: 'Snowball_Harness_OpenCode',
};

export function parseSetupOptions(args) {
  const options = { profile: 'web', port: 8765 };
  const values = new Set(['profile', 'root', 'serial', 'bind', 'device', 'mk20-address', 'adb', 'python', 'npm', 'port', 'data-dir']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (['no-start', 'no-flash', 'no-shortcut', 'update'].includes(key) && args[i].startsWith('--')) options[key] = true;
    else if (args[i].startsWith('--') && values.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i];
    else throw Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (!['web', 'mk20', 'm5stack'].includes(options.profile)) throw Error('Choose web, mk20 or m5stack');
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw Error('Invalid port');
  return options;
}

export function privateIpv4(address) {
  if (typeof address !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const n = address.split('.').map(Number);
  return n.every(v => v >= 0 && v <= 255) && (n[0] === 10 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 || n[0] === 192 && n[1] === 168);
}

export function chooseLanAddress(interfaces = os.networkInterfaces(), explicit, target) {
  if (explicit) { if (!privateIpv4(explicit)) throw Error('A private LAN IPv4 address is required'); return explicit; }
  const addresses = Object.values(interfaces).flat().filter(a => a && a.family === 'IPv4' && !a.internal && privateIpv4(a.address));
  if (target) {
    const n = target.split('.').map(Number);
    const matching = addresses.filter(a => a.netmask && a.address.split('.').every((v, i) => (Number(v) & Number(a.netmask.split('.')[i])) === (n[i] & Number(a.netmask.split('.')[i]))));
    if (matching.length === 1) return matching[0].address;
  }
  const wifi = Object.entries(interfaces).filter(([name]) => /wi-?fi|wlan/i.test(name)).flatMap(([, a]) => a).filter(a => addresses.includes(a));
  if (wifi.length === 1) return wifi[0].address;
  if (addresses.length === 1) return addresses[0].address;
  throw Error('Cannot choose a LAN adapter unambiguously. Supply --bind YOUR_PRIVATE_PC_IP');
}

export function repositoriesFor(profile) {
  if (!['web', 'mk20', 'm5stack'].includes(profile)) throw Error('Unknown profile');
  return ['Snowball_Middleware', ...Object.values(harnessRepositories), ...(profile === 'mk20' ? ['Snowball_Control'] : profile === 'm5stack' ? ['Snowball_Device_M5Stack'] : [])];
}

export const pythonInVenv = directory => path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
