import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Mk20LanPresence } from '../apps/supervisor/mk20-lan.mjs';

test('manual MK20 locator binds the selected NIC, survives restart and never scans off-link', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-mk20-lan-'));
  t.after(() => { assert.ok(directory.startsWith(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const calls = [];
  const interfaces = () => [{ name: 'Wi-Fi', address: '192.168.1.197', netmask: '255.255.255.0' }];
  const connect = options => {
    calls.push(options);
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
  const presence = new Mk20LanPresence(directory, { interfaces, connect });
  assert.equal(await presence.probe(), null);
  assert.throws(() => presence.configure({ targetAddress: '192.168.2.248', interfaceName: 'Wi-Fi' }), /invalid_mk20_endpoint/);
  assert.throws(() => presence.configure({ targetAddress: '192.168.1.248', interfaceName: 'Ethernet' }), /invalid_mk20_endpoint/);
  presence.configure({ targetAddress: '192.168.1.248', interfaceName: 'Wi-Fi' });
  const restored = new Mk20LanPresence(directory, { interfaces, connect });
  assert.deepEqual(await restored.probe(), { targetAddress: '192.168.1.248', interfaceName: 'Wi-Fi' });
  assert.deepEqual(calls, [{ host: '192.168.1.248', port: 5555, localAddress: '192.168.1.197' }]);
  restored.remove();
  assert.equal(await restored.probe(), null);
  fs.writeFileSync(path.join(directory, 'mk20-lan-lab.v1.json'), '{broken');
  assert.equal(restored.describe().error, 'invalid_config');
  restored.remove();
  assert.equal(restored.describe().error, undefined);
});
