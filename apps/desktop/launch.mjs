import { spawn } from 'node:child_process';
import {desktopRuntime} from '../../scripts/desktop-runtime.mjs';
const runtime=desktopRuntime();
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(runtime.executable, [...runtime.args,...process.argv.slice(2)], {env, stdio:'inherit', windowsHide:true, shell:false});
child.on('error', () => { console.error('Snowball Middleware could not start. Run npm run install:desktop with Node 22.12 or later.'); process.exitCode=1; });
child.on('exit', code => {process.exitCode=code ?? 1;});
