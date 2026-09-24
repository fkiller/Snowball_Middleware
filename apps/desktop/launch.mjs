import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [fileURLToPath(new URL('./main.mjs', import.meta.url)), ...process.argv.slice(2)], {env, stdio:'inherit', windowsHide:true, shell:false});
child.on('error', () => { console.error('Electron could not start. Run npm run install:desktop with Node 22.12 or later.'); process.exitCode=1; });
child.on('exit', code => {process.exitCode=code ?? 1;});
