// Read-only, owned OpenCode server schema inspection. No task is created or commanded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { OpenCodeOwnedAdapter } from '../packages/harness-opencode/dist/index.js';

const executable=process.argv[2];
if(!executable||!path.isAbsolute(executable))throw new Error('Absolute selected OpenCode executable required');
const binary=fs.realpathSync(executable);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-opencode-schema-'));
const probe=net.createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const password=randomBytes(32).toString('base64url');
const origin=`http://127.0.0.1:${port}`;
const child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:directory,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,OPENCODE_SERVER_PASSWORD:password,OPENCODE_SERVER_USERNAME:'snowball-verification'}});
child.stdout.resume();child.stderr.resume();
const authorization='Basic '+Buffer.from('snowball-verification:'+password).toString('base64');
try {
  let healthy;
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw new Error('Owned OpenCode server exited during startup');
    try { const response=await fetch(origin+'/global/health',{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(500)});if(response.ok){healthy=await response.json();break;} }
    catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(healthy?.healthy!==true||typeof healthy.version!=='string')throw new Error('OpenCode health probe failed');
  const response=await fetch(origin+'/doc',{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('OpenCode schema unavailable');
  const spec=await response.json();
  const observer=new OpenCodeOwnedAdapter({hostId:`host_${'a'.repeat(32)}`,instanceId:'verification',baseUrl:origin,authUsername:'snowball-verification',authPassword:password});
  await observer.initialize();const observed=await observer.listSessions();
  if(observer.status().readOnly!==true||observer.status().connected!==true||observed.some(session=>!session.readOnly||session.ownerId))throw new Error('OpenCode observer claimed control');
  await observer.stop();
  const wanted=['/session','/session/{sessionID}','/session/{sessionID}/message','/session/{sessionID}/prompt_async','/session/{sessionID}/abort','/session/{sessionID}/permissions/{permissionID}','/config/providers','/global/event'];
  const routes=Object.fromEntries(wanted.map(route=>[route,Object.keys(spec.paths?.[route]??{})]));
  const contract=Object.fromEntries(wanted.map(route=>[route,Object.fromEntries(Object.entries(spec.paths?.[route]??{}).filter(([method])=>['get','post','patch'].includes(method)).map(([method,operation])=>[method,{operationId:operation.operationId,request:operation.requestBody?.content?.['application/json']?.schema,response:operation.responses?.['200']?.content?.['application/json']?.schema??operation.responses?.['204']?.description??null}]))]));
  console.log(JSON.stringify({platform:process.platform,version:healthy.version,openapi:spec.openapi,routes,contract,readOnlyObserverConnected:true,observedSessions:observed.length,existingTaskCommanded:false}));
} finally {
  child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
