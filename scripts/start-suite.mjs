import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadSuitePlugins } from './suite-plugins.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--config') throw Error('Usage: start-suite.mjs --config PATH');
const configFile = path.resolve(args[1]);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (config.version !== 1 || !['web', 'mk20', 'm5stack'].includes(config.profile) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('Invalid installed suite');
const middleware = fileURLToPath(new URL('..', import.meta.url));
const origin = `http://127.0.0.1:${config.port}`;
const children = [], plugins = await loadSuitePlugins(config);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) {
    if (child.connected) child.send('snowball.stop');
    else child.kill('SIGTERM');
  }
  await plugins.close();
  // The IPC stop message allows state/checkpoint flush on Windows as well.
  await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref(); })));
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
function launch(script, args, cwd, env = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['pipe', 'inherit', 'inherit', 'ipc'] });
  children.push(child);
  child.once('error', error => { console.error(error.message); void stop(1); });
  child.once('exit', code => { if (!stopping) { console.error(`Snowball process exited (${code})`); void stop(code || 1); } });
  return child;
}
try {
  // Never take over an unrelated service already bound to the selected port.
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(config.port, '127.0.0.1', () => server.close(resolve)); });
  const env = { SNOWBALL_PROFILE: config.profile, SNOWBALL_PORT: String(config.port), SNOWBALL_SUITE_CONFIG: configFile };
  if (config.dataDir) env.SNOWBALL_DATA_DIR = config.dataDir;
  if (config.profile === 'mk20') Object.assign(env, { SNOWBALL_CONTROL_ROOT: config.controlRoot, SNOWBALL_MK20_ADDRESS: config.mk20Address, SNOWBALL_MK20_ADB_DEVICE: config.mk20AdbDevice, MK20_ADB: config.adb, ADB_PATH: config.adb, SNOWBALL_BIND: config.bind, PYTHON_BIN: config.python });
  launch(path.join(middleware, 'scripts/start-all.mjs'), [], middleware, env);
  const deadline = Date.now() + 180000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try { const response = await fetch(origin + '/v1/snapshot', { headers: { Origin: origin }, signal: AbortSignal.timeout(3000) }); ready = response.ok; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error('Middleware API did not become ready. See runtime errors above.');
  if (config.profile === 'm5stack') launch(path.join(config.deviceRoot, 'scripts/gateway.mjs'), ['--serial', config.serial, '--python', config.python, '--bind', config.bind, '--backend', origin, ...(config.device ? ['--device', config.device] : [])], config.deviceRoot);
  console.log(`Snowball is responding at ${origin}/ — ${config.profile} + Codex + Antigravity + OpenCode plugins`);
  console.log('Press Ctrl+C to stop. The launcher starts the installed suite again without downloads.');
  if (process.platform === 'win32') spawn('explorer.exe', [origin + '/'], { windowsHide: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [origin + '/'], { stdio: 'ignore' }).unref();
} catch (error) { console.error(error.message); await stop(1); }
