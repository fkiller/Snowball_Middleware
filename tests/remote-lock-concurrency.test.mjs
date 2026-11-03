import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';

function message(child, kind) {
  return new Promise((resolve, reject) => {
    const timer=setTimeout(()=>finish(Error(`child ${kind} timed out`)),15000);
    const onMessage=value=>{if(value?.kind===kind)finish(null,value);};
    const onExit=(code,signal)=>finish(Error(`child exited before ${kind}: ${code ?? signal}`));
    function finish(error,value){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);error?reject(error):resolve(value);}
    child.on('message',onMessage);child.once('exit',onExit);
  });
}

test('competing recovery processes cannot remove a new writer\'s live lock', {timeout:60000,skip:process.platform==='win32'?'Windows ACL/process concurrency needs native validation':false}, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-remote-race-'));
  const directory=path.join(root,'private');
  const children=[];
  t.after(()=>{for(const child of children)if(child.exitCode===null)child.kill();fs.rmSync(root,{recursive:true,force:true});});
  const makeStale=`import {PersistentRemoteCredentials} from './packages/api/dist/index.js';import {ensurePrivateStateDirectory} from './apps/supervisor/private-state.mjs';new PersistentRemoteCredentials({directory:process.argv[1],verifyPrivateDirectory:ensurePrivateStateDirectory});`;
  const setup=spawnSync(process.execPath,['--input-type=module','-e',makeStale,directory],{cwd:process.cwd(),encoding:'utf8',timeout:30000});
  assert.equal(setup.status,0,setup.stderr);
  const stale=JSON.parse(fs.readFileSync(path.join(directory,'remote-credentials.lock'),'utf8'));
  const runner=`
    import {PersistentRemoteCredentials,recoverAbandonedRemoteCredentialLock} from './packages/api/dist/index.js';
    import {ensurePrivateStateDirectory} from './apps/supervisor/private-state.mjs';
    const [directory,token,role]=process.argv.slice(1);
    process.send({kind:'ready'});
    process.on('message',async message=>{
      if(message==='go' && role==='recover'){
        for(let attempt=0;attempt<100;attempt++){
          try{recoverAbandonedRemoteCredentialLock({directory,expectedToken:token,verifyPrivateDirectory:ensurePrivateStateDirectory});process.send({kind:'done',ok:true});return;}
          catch(error){if(error.code!=='EEXIST'){process.send({kind:'done',ok:false});return;}await new Promise(resolve=>setTimeout(resolve,5));}
        }
        process.send({kind:'done',ok:false});
      }
      if(message==='go' && role==='writer'){
        for(let attempt=0;attempt<300;attempt++){
          try{globalThis.store=new PersistentRemoteCredentials({directory,verifyPrivateDirectory:ensurePrivateStateDirectory});process.send({kind:'owned',pid:process.pid});return;}
          catch{await new Promise(resolve=>setTimeout(resolve,10));}
        }
        process.send({kind:'failed'});
      }
      if(message==='close' && globalThis.store){globalThis.store.close();process.send({kind:'closed'});}
      if(message==='quit')process.disconnect();
    });`;
  for(const role of ['recover','recover','recover','recover','writer']) {
    const child=spawn(process.execPath,['--input-type=module','-e',runner,directory,stale.token,role],{cwd:process.cwd(),stdio:['ignore','ignore','ignore','ipc']});
    children.push(child);
  }
  await Promise.all(children.map(child=>message(child,'ready')));
  const recovered=children.slice(0,4).map(child=>message(child,'done'));
  const owned=message(children[4],'owned');
  for(const child of children)child.send('go');
  const [results,writer]=await Promise.all([Promise.all(recovered),owned]);
  assert.equal(results.filter(value=>value.ok).length,1);
  const live=JSON.parse(fs.readFileSync(path.join(directory,'remote-credentials.lock'),'utf8'));
  assert.equal(live.pid,writer.pid);
  const closed=message(children[4],'closed');children[4].send('close');await closed;
  assert.equal(fs.existsSync(path.join(directory,'remote-credentials.lock')),false);
  await Promise.all(children.map(child=>new Promise(resolve=>{child.once('exit',resolve);child.send('quit');})));
});
