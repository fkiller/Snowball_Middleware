import { createInterface } from 'node:readline';
let initialized = false;
let sequence = 0;
const screens = new Map<string, unknown>();
const deviceIds = ['virtual-1', 'virtual-2'];
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'plugin.cancel') return;
  if (request.method === 'plugin.initialize') {
    initialized = true;
    send({ jsonrpc: '2.0', id: request.id, result: { apiVersion: '1.0.0', pluginId: 'snowball.virtual-device' } });
  } else if (initialized && request.method === 'devices.list') {
    send({ jsonrpc: '2.0', id: request.id, result: deviceIds.map(deviceId => ({ deviceId, nativeDeviceId: deviceId, label: deviceId, supported: true, verifiedIdentity: deviceId, transport: 'virtual', capabilities: ['button', 'select-session', 'display'] })) });
  } else if (initialized && request.method === 'devices.identify') {
    send({ jsonrpc: '2.0', id: request.id, result: { accepted: true } });
    send({ jsonrpc: '2.0', method: 'plugin.event', params: { sequence: ++sequence, event: 'device.identified', data: { deviceId: 'virtual-1' } } });
  } else if (initialized && request.method === 'devices.simulateInput' && deviceIds.includes(request.params?.deviceId)) {
    send({ jsonrpc: '2.0', id: request.id, result: { accepted: true } });
    send({ jsonrpc: '2.0', method: 'plugin.event', params: { sequence: ++sequence, event: 'device.input', data: { deviceId: request.params.deviceId, input: request.params.input } } });
  } else if (initialized && request.method === 'devices.render' && deviceIds.includes(request.params?.deviceId)) {
    screens.set(request.params.deviceId, request.params.frame);
    send({ jsonrpc: '2.0', id: request.id, result: { deviceId: request.params.deviceId, frame: screens.get(request.params.deviceId) } });
  } else send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported method' } });
});
