import { CodexAdapter } from './codex/adapter.js';
import { LocalWhisperProvider } from './audio/local-whisper.js';
import { UdpTransport } from './transport/udp.js';
import { MvpController } from './state/mvp-controller.js';
import path from 'node:path';

const udp = new UdpTransport();
const controller = new MvpController(new CodexAdapter(), new LocalWhisperProvider(), () => {
  udp.sendSync({ getDeviceState: () => controller.state() });
}, path.resolve('host/.state/draft.json'));
await udp.start();
udp.on('device_input', packet => { void controller.input(packet); });
const heartbeat = setInterval(() => controller.paint(), 2000);
async function close() { clearInterval(heartbeat); await controller.close(); await udp.stop(); }
process.on('SIGINT', () => { void close().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void close().then(() => process.exit(0)); });
await controller.connect();
