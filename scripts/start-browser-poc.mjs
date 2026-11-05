// Explicit local development launcher. It never configures Tailscale and does
// not adopt the user's existing suite or state. Key provisioning is separate.
import fs from 'node:fs';import path from 'node:path';import {createHash,X509Certificate} from 'node:crypto';
import {startLocalRuntime} from '../apps/supervisor/runtime.mjs';
import {RemoteBrowserGateway} from '../apps/supervisor/remote-browser.mjs';
import {ensurePrivateStateDirectory} from '../apps/supervisor/private-state.mjs';

try{
 const args=process.argv.slice(2), values={};
 for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--host','--server-ca','--server-cert','--server-key','--client-ca','--device-cert','--state'].includes(flag)||values[flag]||!value||value.startsWith('--'))throw Error('Invalid options');values[flag]=value;}
 if(Object.keys(values).length!==7||Object.entries(values).some(([flag,value])=>flag!=='--host'&&!path.isAbsolute(value))||fs.existsSync(values['--state']))throw Error('Expected host, certificate files and a new absolute state directory');
 const keyPath=values['--server-key'];ensurePrivateStateDirectory(path.dirname(keyPath),[path.basename(keyPath)]);
 for(const flag of ['--server-ca','--server-cert','--server-key','--client-ca','--device-cert']){const s=fs.lstatSync(values[flag]);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw Error('Invalid certificate file');}
 const cert=fs.readFileSync(values['--server-cert']),key=fs.readFileSync(keyPath),serverCA=fs.readFileSync(values['--server-ca']),clientCA=fs.readFileSync(values['--client-ca']);
 const fingerprint=createHash('sha256').update(new X509Certificate(fs.readFileSync(values['--device-cert'])).raw).digest('hex');
 const runtime=await startLocalRuntime({dataDir:values['--state']});let gateway;
 try{
  gateway=new RemoteBrowserGateway({host:values['--host'],cert,key,serverCA,clientCA:[clientCA],clientFingerprints:[fingerprint],sessionService:runtime.sessions});
  const origin=await gateway.start();console.log('Read-only mTLS browser gateway listening on '+origin+'. No Tailscale settings changed.');
  const stop=()=>void Promise.allSettled([gateway.close(),runtime.close()]).then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }catch(error){await runtime.close();throw error;}
}catch{console.error('Browser gateway did not start. Verify the private certificate files and new state directory.');process.exitCode=1;}
