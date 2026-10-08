import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadSuitePlugins } from './suite-plugins.mjs';
import {suiteRuntime} from './suite-devices.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--config') throw Error('Usage: start-suite.mjs --config PATH');
const configFile = path.resolve(args[1]);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (config.version !== 1 || !['web', 'mk20', 'm5stack'].includes(config.profile) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('Invalid installed suite');
const middleware = fileURLToPath(new URL('..', import.meta.url));
const origin = `http://127.0.0.1:${config.port}`;
const adapters=suiteRuntime(config);
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
  if (process.connected) process.disconnect();
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('message', message => { if (message === 'snowball.stop') void stop(); });
process.on('disconnect', () => void stop());
function launch(script, args, cwd, env = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['pipe', 'inherit', 'inherit', 'ipc'] });
  children.push(child);
  child.on('message',message=>{if(message?.kind==='native'&&process.connected)process.send(message);});
  child.once('error', error => { console.error(error.message); void stop(1); });
  child.once('exit', code => { if (!stopping) { console.error(`Snowball process exited (${code})`); void stop(code || 1); } });
  return child;
}
try {
  // Never take over an unrelated service already bound to the selected port.
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(config.port, '127.0.0.1', () => server.close(resolve)); });
  const env = { ...adapters.env, SNOWBALL_PORT: String(config.port), SNOWBALL_SUITE_CONFIG: configFile, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  if (config.dataDir) env.SNOWBALL_DATA_DIR = config.dataDir;
  const runtime=launch(path.join(middleware, 'scripts/start-all.mjs'), [], middleware, env);
  process.on('message',message=>{if(message?.kind==='native-result'&&runtime.connected)runtime.send(message);});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>done(Error('Middleware startup timed out before its owned runtime reported readiness')),180000);
    const onMessage=message=>{if(message?.kind==='runtime-ready'&&message.origin===origin)done();};
    const onExit=code=>done(Error('Middleware exited before readiness ('+code+')'));
    function done(error){clearTimeout(timer);runtime.off('message',onMessage);runtime.off('exit',onExit);error?reject(error):resolve();}
    runtime.on('message',onMessage);runtime.once('exit',onExit);
  });
  const response=await fetch(origin+'/v1/snapshot',{headers:{Origin:origin},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Owned middleware snapshot failed (HTTP '+response.status+')');
  if (adapters.gateway) {
    const g=adapters.gateway, gateway=launch(g.script,g.args,g.cwd);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(Error('M5Stack gateway did not report readiness')),15000);
      const onMessage=message=>{if(message?.kind==='gateway-ready')done();};
      const onExit=code=>done(Error('M5Stack gateway exited before readiness ('+code+')'));
      function done(error){clearTimeout(timer);gateway.off('message',onMessage);gateway.off('exit',onExit);error?reject(error):resolve();}
      gateway.on('message',onMessage);gateway.once('exit',onExit);
    });
  }
  console.log(`Snowball is responding at ${origin}/ — ${adapters.profiles.join(' + ') || 'web'} + Codex + Antigravity + OpenCode plugins`);
  if(process.connected)process.send({kind:'suite-ready',origin});
  console.log('Press Ctrl+C to stop. The launcher starts the installed suite again without downloads.');
  if (config.openBrowser !== false && process.env.SNOWBALL_DESKTOP !== '1') {
    if (process.platform === 'win32') spawn('explorer.exe', [origin + '/'], { windowsHide: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [origin + '/'], { stdio: 'ignore' }).unref();
  }
} catch (error) { console.error(error.message); await stop(1); }
