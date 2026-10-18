// Read-only local report: no prompts, transcript bodies, credentials or native writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {installedHarnessVersions} from './harness-runtime.mjs';
import {nativeNavigation} from './native-navigation.mjs';

process.env.AGY_CLI_DISABLE_AUTO_UPDATE='true';
const repository=fileURLToPath(new URL('../',import.meta.url));
let suite={};
try{suite=JSON.parse(fs.readFileSync(path.resolve(repository,'../.snowball/suite.json'),'utf8'));}catch{}
const bundledPython=path.join(repository,process.platform==='win32'?'.venv-whisper/Scripts/python.exe':'.venv-whisper/bin/python');
const python=fs.existsSync(bundledPython)?bundledPython:'python';
const source=JSON.parse(execFileSync(python,[path.join(repository,'scripts/harness-db-scanner.py'),'--projects-only'],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:20*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}}));
const catalog=nativeNavigation({'snowball.antigravity':source.antigravity},{'snowball.antigravity':source.antigravityProjects});
const sessions=Object.values(source.antigravity||{}).flat();
const report={host:os.hostname(),installedCommits:suite.commits||null,
  control:installedHarnessVersions().antigravity,
  observedSessions:sessions.length,duplicateNativeIds:sessions.length-new Set(sessions.map(s=>s.id)).size,
  nativeProjects:(catalog['snowball.antigravity']||[]).map(p=>({name:p.displayName,sessions:p.sessions.length})),
};
try {
  const snapshot=await (await fetch(`http://127.0.0.1:${suite.port||8765}/v1/snapshot`,{signal:AbortSignal.timeout(5000)})).json();
  report.runningControl=(snapshot.connectedHarnesses||[]).find(h=>h.pluginId==='snowball.antigravity');
  report.runningProjects=(snapshot.navigationCatalog?.['snowball.antigravity']||[]).map(p=>({name:p.displayName,sessions:p.sessions.length}));
}catch{report.runningApi='unavailable';}
console.log(JSON.stringify(report,null,2));
