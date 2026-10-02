import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { inScope, localInterfaces } from '../../packages/device-lan/dist/index.js';

const FILE = 'mk20-lan-lab.v1.json';

/** A saved address is a locator, never a paired device identity. */
export class Mk20LanPresence {
  constructor(dataDir, { interfaces = localInterfaces, connect = net.createConnection } = {}) {
    this.file = path.join(dataDir, FILE);
    this.interfaces = interfaces;
    this.connect = connect;
  }
  read() {
    const stat = fs.lstatSync(this.file, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isFile() || stat.size > 512) throw new Error('Invalid MK20 LAN configuration');
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!value || value.version !== 1 || Object.keys(value).sort().join(',') !== 'interfaceName,targetAddress,version'
      || typeof value.interfaceName !== 'string' || typeof value.targetAddress !== 'string') throw new Error('Invalid MK20 LAN configuration');
    return value;
  }
  describe() {
    let selected = null, error;
    try { selected = this.read(); } catch { error = 'invalid_config'; }
    return { selected, interfaces: this.interfaces().map(({ name, address }) => ({ name, address })), ...(error ? { error } : {}) };
  }
  configure({ targetAddress, interfaceName }) {
    if (typeof targetAddress !== 'string' || typeof interfaceName !== 'string') throw new Error('invalid_mk20_endpoint');
    const iface = this.interfaces().find(item => item.name === interfaceName && inScope(targetAddress, item) && targetAddress !== item.address);
    if (!iface) throw new Error('invalid_mk20_endpoint');
    const existing = fs.lstatSync(this.file, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) throw new Error('device_config_failed');
    const value = { version: 1, targetAddress, interfaceName };
    fs.writeFileSync(this.file, JSON.stringify(value) + '\n', { mode: 0o600 });
    return this.describe();
  }
  remove() {
    if (fs.lstatSync(this.file, { throwIfNoEntry: false })) fs.unlinkSync(this.file);
    return this.describe();
  }
  async probe() {
    const selected = this.read();
    if (!selected) return null;
    const iface = this.interfaces().find(item => item.name === selected.interfaceName && inScope(selected.targetAddress, item));
    if (!iface) return null;
    const reachable = await new Promise(resolve => {
      let done = false;
      const socket = this.connect({ host: selected.targetAddress, port: 5555, localAddress: iface.address });
      const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
      socket.setTimeout(1500);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
    return reachable ? { targetAddress: selected.targetAddress, interfaceName: selected.interfaceName } : null;
  }
}
