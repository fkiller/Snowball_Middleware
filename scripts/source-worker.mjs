// Native filesystem/CLI observations run outside the API/device event loop.
import {parentPort} from 'node:worker_threads';
import {scanCodexCatalog,scanAntigravityCatalog,scanOpenCodeCatalog,scanAllHarnessCatalogs} from './harness-catalog-scanner.mjs';
import {scanAllHarnessSessions} from './harness-session-scanner.mjs';
import {scanHarnessProjects} from './harness-project-scanner.mjs';
import {installedHarnessVersions} from './harness-runtime.mjs';
const catalogs={'snowball.codex':scanCodexCatalog,'snowball.antigravity':scanAntigravityCatalog,'snowball.opencode':scanOpenCodeCatalog};
parentPort.on('message',({id,kind,pluginId})=>{
  try {
    let value;
    if(kind==='catalog'){if(!catalogs[pluginId])throw Error('unknown_harness');value=catalogs[pluginId]();}
    else if(kind==='catalogs')value=scanAllHarnessCatalogs();
    else if(kind==='sessions')value=scanAllHarnessSessions();
    else if(kind==='projects')value=scanHarnessProjects();
    else if(kind==='installations')value=installedHarnessVersions();
    else throw Error('unknown_observation');
    parentPort.postMessage({id,value});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
