import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {tailscaleCandidates, inspectApprovedTailscale, describeTailscaleInspection} from '../apps/desktop/tailscale-onboarding.mjs';

test('suggests existing executables without executing them and ignores relative PATH entries', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-tailscale-candidates-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const executable=path.join(root,process.platform==='win32'?'tailscale.exe':'tailscale');
  fs.writeFileSync(executable,'not executed');
  fs.chmodSync(executable,0o700);
  const result=tailscaleCandidates({platform:process.platform,env:{PATH:`relative${path.delimiter}${root}${path.delimiter}${root}`}});
  assert.ok(result.includes(fs.realpathSync(executable)));
  assert.equal(result.filter(item=>item===fs.realpathSync(executable)).length,1);
  assert.ok(result.every(path.isAbsolute));
});

test('approved status uses fixed arguments, bounded asynchronous invocation and returns only the self hostname', async () => {
  let called=false;
  const run=(binary,args,options,callback)=>{
    called=true;
    assert.equal(binary,fs.realpathSync(process.execPath));
    assert.deepEqual(args,['status','--json','--peers=false']);
    assert.equal(options.shell,false);
    assert.equal(options.timeout,5000);
    assert.equal(options.maxBuffer,256*1024);
    assert.equal(options.env.SECRET,undefined);
    assert.equal(options.env.TAILSCALE_BE_CLI,'1');
    setImmediate(()=>callback(null,JSON.stringify({BackendState:'Running',Self:{Online:true,DNSName:'my-pc.example.ts.net.'},Peer:{private:'not returned'}})));
  };
  let completed=false;
  const operation=inspectApprovedTailscale(process.execPath,{run,env:{HOME:os.tmpdir(),SECRET:'not forwarded'}}).then(value=>{completed=true;return value;});
  assert.equal(called,true);
  assert.equal(completed,false);
  assert.deepEqual(await operation,{kind:'ready',host:'my-pc.example.ts.net'});
});

test('status failures distinguish actionable local setup without displaying raw program output', async () => {
  const inspect=value=>inspectApprovedTailscale(process.execPath,{run:(_file,_args,_options,callback)=>setImmediate(()=>callback(null,JSON.stringify(value))),env:{}});
  assert.deepEqual(await inspect({BackendState:'NeedsLogin',raw:'private'}),{kind:'needs_login'});
  assert.deepEqual(await inspect({BackendState:'NeedsMachineAuth'}),{kind:'needs_approval'});
  assert.deepEqual(await inspect({BackendState:'Stopped'}),{kind:'not_running'});
  assert.deepEqual(await inspect({BackendState:'Running',Self:{Online:false}}),{kind:'offline'});
  assert.deepEqual(await inspect({BackendState:'Running',Self:{Online:true,DNSName:'attacker.example'}}),{kind:'no_hostname'});
  assert.deepEqual(await inspectApprovedTailscale('relative/path'),{kind:'invalid_executable'});
  const timeout=await inspectApprovedTailscale(process.execPath,{run:(_file,_args,_options,callback)=>setImmediate(()=>callback(Error('private failure details'))),env:{}});
  assert.deepEqual(timeout,{kind:'unavailable'});
  const text=describeTailscaleInspection({kind:'needs_login'});
  assert.match(text.detail,/로그인/);
  assert.doesNotMatch(JSON.stringify(text),/private failure details/);
  assert.match(describeTailscaleInspection({kind:'ready',host:'my-pc.example.ts.net'}).detail,/연결과 휴대폰 페어링은 아직 활성화되지 않았습니다/);
});
