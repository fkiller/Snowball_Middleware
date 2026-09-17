import { createInterface } from 'node:readline';
let initialized = false;
let sequence = 0;
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'plugin.cancel') return;
  if (request.method === 'plugin.initialize') {
    initialized = true;
    send({ jsonrpc: '2.0', id: request.id, result: { apiVersion: '1.0.0', pluginId: 'snowball.virtual-device' } });
  } else if (initialized && request.method === 'devices.list') {
    send({ jsonrpc: '2.0', id: request.id, result: [{ deviceId: 'virtual-1', transport: 'virtual', capabilities: ['button', 'display'] }] });
  } else if (initialized && request.method === 'devices.identify') {
    send({ jsonrpc: '2.0', id: request.id, result: { accepted: true } });
    send({ jsonrpc: '2.0', method: 'plugin.event', params: { sequence: ++sequence, event: 'device.identified', data: { deviceId: 'virtual-1' } } });
  } else send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported method' } });
});
