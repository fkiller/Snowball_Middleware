import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenCodeOwnedAdapter, opencodeManifest } from '../packages/harness-opencode/dist/index.js';
const binding = { hostId: 'host_' + 'b'.repeat(32), instanceId: 'test' };
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  return 'http://127.0.0.1:' + server.address().port;
}
test('OpenCode uses documented Basic auth and health schema; existing sessions stay read-only', async t => {
  let mutations = 0;
  const baseUrl = await fixture(t, (req,res) => {
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('opencode:secret').toString('base64'));
    if (req.method !== 'GET') mutations++;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url === '/global/health' ? { healthy:true, version:'1.18.31' } : [{ id:'existing',directory:'/project' }]));
  });
  const adapter = new OpenCodeOwnedAdapter({...binding,baseUrl,authPassword:'secret'});
  t.after(() => adapter.stop()); await adapter.initialize();
  assert.equal(adapter.status().connected,true);
  assert.equal(adapter.status().readOnly,true);
  assert.equal((await adapter.listSessions())[0].readOnly,true);
  await assert.rejects(adapter.createSession('/project'),{code:'owner_protocol_unverified'});
  for (const operation of ['sessions.send','sessions.interrupt','decisions.resolve']) {
    const receipt = await adapter.execute({command:{input:{operation}}},new AbortController().signal);
    assert.equal(receipt.status,'not_sent');
  }
  assert.equal(mutations,0);
  const manifest = await opencodeManifest();
  assert.ok(!manifest.capabilities.some(c=>['harness.create','harness.execute'].includes(c.operation)));
});
test('OpenCode 401 is not connected and an unrelated HTTP 200 is not healthy',async t=>{
  for (const [status,body] of [[401,{}],[200,{status:'ok'}]]) {
    const baseUrl=await fixture(t,(_req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
    const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl});
    try { await adapter.initialize(); } catch {}
    assert.equal(adapter.status().connected,false);
    await assert.rejects(adapter.listSessions(),{code:'not_connected'});
  }
});
test('unreviewed OpenCode server versions cannot appear connected',async t=>{
  const baseUrl=await fixture(t,(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({healthy:true,version:'1.18.32'}));});
  const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl});
  await assert.rejects(adapter.initialize(),{code:'unsupported_version'});
  assert.equal(adapter.status().connected,false);
  await assert.rejects(adapter.listSessions(),{code:'not_connected'});
});
test('OpenCode rejects remote endpoints, embedded credentials and redirects without forwarding secrets', async t=>{
  for (const baseUrl of ['http://192.168.1.1:4096','https://127.0.0.1','http://u:p@127.0.0.1','http://127.0.0.1/path']) assert.throws(()=>new OpenCodeOwnedAdapter({...binding,baseUrl}),{code:'local_endpoint_required'});
  let contacted=0;
  const target=await fixture(t,(_req,res)=>{contacted++;res.end('{}');});
  const baseUrl=await fixture(t,(_req,res)=>{res.writeHead(302,{Location:target});res.end();});
  const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl,authPassword:'secret'});
  await assert.rejects(adapter.initialize()); assert.equal(contacted,0);
});

test('OpenCode health alone cannot claim connection; redirected or oversized session lists fail closed', async t=>{
  let targetCalls=0;
  const target=await fixture(t,(_req,res)=>{targetCalls++;res.end('[]');});
  for(const kind of ['redirect','oversized','duplicate']){
    const baseUrl=await fixture(t,(req,res)=>{
      if(req.url==='/global/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({healthy:true,version:'1.18.31'}));return;}
      if(kind==='redirect'){res.writeHead(302,{Location:target});res.end();return;}
      res.setHeader('Content-Type','application/json');
      res.end(kind==='oversized'?' '.repeat(1024*1024+1):JSON.stringify([{id:'same'},{id:'same'}]));
    });
    const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl,authPassword:'secret'});
    await assert.rejects(adapter.initialize());
    assert.equal(adapter.status().connected,false);
    await assert.rejects(adapter.listSessions(),{code:'not_connected'});
  }
  assert.equal(targetCalls,0);
});

test('OpenCode read rejects redirects and mismatched identities; later 401 revokes ready state',async t=>{
  let targetCalls=0;
  const target=await fixture(t,(_req,res)=>{targetCalls++;res.end('{}');});
  let mode='redirect';
  const baseUrl=await fixture(t,(req,res)=>{
    if(req.url==='/global/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({healthy:true,version:'1.18.31'}));return;}
    if(req.url==='/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{id:'existing'}]));return;}
    if(mode==='redirect'){res.writeHead(302,{Location:target});res.end();return;}
    if(mode==='mismatch'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'different'}));return;}
    res.writeHead(401);res.end();
  });
  const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl,authPassword:'secret'});
  t.after(()=>adapter.stop());await adapter.initialize();
  await assert.rejects(adapter.readSession('existing'));
  assert.equal(targetCalls,0);
  mode='mismatch';await assert.rejects(adapter.readSession('existing'),{code:'invalid_session'});
  mode='expired';await assert.rejects(adapter.readSession('existing'),{code:'needs_auth'});
  assert.equal(adapter.status().connected,false);assert.equal(adapter.status().auth,'needs_auth');
});

test('OpenCode model catalog comes from the native provider endpoint without invented effort values',async t=>{
  const baseUrl=await fixture(t,(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/global/health')res.end(JSON.stringify({healthy:true,version:'1.18.31'}));
    else if(req.url==='/session')res.end('[]');
    else if(req.url==='/config/providers')res.end(JSON.stringify({providers:[{id:'provider',models:{'model-v1':{id:'model-v1',providerID:'provider',name:'Real model',variants:{high:{}}}}}],default:{}}));
    else{res.writeHead(404);res.end('{}');}
  });
  const adapter=new OpenCodeOwnedAdapter({...binding,baseUrl});
  t.after(()=>adapter.stop());await adapter.initialize();
  assert.deepEqual(await adapter.listModels(),[{model:'provider/model-v1',displayName:'Real model',efforts:[],defaultEffort:null}]);
  const manifest=await opencodeManifest();
  assert.ok(manifest.capabilities.some(c=>c.operation==='harness.models'&&c.access==='observe'));
});
