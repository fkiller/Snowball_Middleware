import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('startup recovers only stopped-owner private journal locks and refuses a live owner', async t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-crash-recover-'));
  const dataDir=path.join(temp,'state');
  let recovered;
  t.after(async()=>{await recovered?.close();fs.rmSync(temp,{recursive:true,force:true});});
  const first=await startLocalRuntime({dataDir}); await first.close();
  const departed=spawn(process.execPath,['-e',''],{windowsHide:true,stdio:'ignore'});
  const stoppedPid=departed.pid; await once(departed,'exit');
  for(const name of ['commands','workspaces','session-metadata','session-creates'])
    fs.writeFileSync(path.join(dataDir,name,'commands.lock'),JSON.stringify({pid:stoppedPid,token:`stopped-${name}`}));
  recovered=await startLocalRuntime({dataDir});
  assert.equal((await new LocalClient(recovered.origin).snapshot()).accessMode,'local-no-auth');
  await assert.rejects(startLocalRuntime({dataDir}),error=>error.code==='locked');
  await recovered.close();
  for(const name of ['commands','workspaces','session-metadata','session-creates'])
    assert.equal(fs.existsSync(path.join(dataDir,name,'commands.lock')),false);
});

test('read-only MK20 USB presence is visible without claiming pairing or control', async t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-device-presence-'));
  const runtime=await startLocalRuntime({dataDir:path.join(temp,'state'),devicePresence:async()=>true});
  t.after(async()=>{await runtime.close();fs.rmSync(temp,{recursive:true,force:true});});
  const snapshot=await new LocalClient(runtime.origin).snapshot();
  assert.equal(snapshot.devices.length,0);
  assert.equal(snapshot.deviceCandidates.length,1);
  assert.equal(snapshot.deviceCandidates[0].supported,false);
  assert.equal(snapshot.deviceCandidates[0].transport,'hid');
});

test('QMK HID and product CDC observations remain separate unsupported candidates', async t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-device-functions-'));
  const runtime=await startLocalRuntime({dataDir:path.join(temp,'state'),devicePresence:async()=>({qmkHidObserved:true,productCdcObserved:true})});
  t.after(async()=>{await runtime.close();fs.rmSync(temp,{recursive:true,force:true});});
  const snapshot=await new LocalClient(runtime.origin).snapshot();
  assert.equal(snapshot.devices.length,0);
  assert.deepEqual(snapshot.deviceCandidates.map(c=>c.transport).sort(),['hid','serial']);
  assert.ok(snapshot.deviceCandidates.every(c=>c.supported===false));
});

test('native enrollment adds an instance without restarting the loopback core or granting a discovered session ownership', async t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-enroll-'));
  const runtime=await startLocalRuntime({dataDir:path.join(temp,'state'),chooseWorkspace:async()=>({root:temp,displayName:'Fixture project'})});
  t.after(async()=>{await runtime.close();fs.rmSync(temp,{recursive:true,force:true});});
  const client=new LocalClient(runtime.origin), before=await client.snapshot();
  const adapter=new EventEmitter();adapter.ownerId='owner-native';
  adapter.status=()=>({instanceId:'chosen',connected:true,auth:'ready'});
  adapter.listSessions=async()=>[{nativeId:'observed',cwd:temp,preview:'Observed only'}];
  let stops=0;adapter.stop=async()=>{stops++;};
  await runtime.addHarnessAdapter('snowball.codex',adapter);
  await runtime.sessions.listSessions('snowball.codex');
  const registered=await client.selectWorkspace();
  const after=await client.snapshot();
  assert.equal(runtime.origin,client.origin);
  assert.notEqual(after.cursor,before.cursor);
  assert.equal(after.connectedHarnesses[0].instanceId,'chosen');
  assert.equal(after.sessionDetails[0].readOnly,true);
  assert.equal(after.sessionDetails[0].ownerId,null);
  assert.equal(after.sessionDetails[0].workspaceId,registered.workspaceId);
  assert.equal(after.workspaceDetails[0].root,undefined);
  await assert.rejects(runtime.addHarnessAdapter('snowball.codex',adapter),/already registered/);
  await runtime.close();assert.equal(stops,1);
});

test('local composition restores durable registration on a new listener without replaying folder selection', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-runtime-'));
  const root = path.join(temp, 'project'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'hello.txt'), 'offline local');
  const dataDir = path.join(temp, 'private-state'); const runtimes = [];
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  let choices = 0;
  const start = async () => { const runtime = await startLocalRuntime({ dataDir, chooseWorkspace: async () => { choices++; return { root, displayName: 'Project' }; } }); runtimes.push(runtime); return runtime; };
  const first = await start(); const client = new LocalClient(first.origin); assert.equal((await client.snapshot()).accessMode, 'local-no-auth');
  const schema = JSON.parse(fs.readFileSync(new URL('../packages/api/openapi.v1.json',import.meta.url),'utf8'));
  for (const key of Object.keys(await client.snapshot())) assert.ok(schema.components.schemas.Snapshot.properties[key], `Snapshot contract missing ${key}`);
  assert.deepEqual((await client.snapshot()).workspaces, []);
  assert.equal((await fetch(first.origin)).status, 200);
  const selected = await client.selectWorkspace(); assert.equal(choices, 1);
  const before = await client.settings(); await client.updateSettings(before.settings.revision,{controlPaused:true,notifications:false});
  await first.close(); const second = await start(); const restored = new LocalClient(second.origin); assert.equal((await restored.snapshot()).accessMode, 'local-no-auth');
  assert.equal((await restored.snapshot()).workspaces[0].workspaceId, selected.workspaceId);
  assert.equal((await restored.snapshot()).workspaceDetails[0].status, 'ready');
  assert.equal((await restored.settings()).settings.controlPaused,true); assert.equal((await restored.settings()).settings.notifications,false);
  assert.equal(choices, 1);
  assert.deepEqual(await restored.readFile(selected.workspaceId, 'hello.txt'), { text: 'offline local' });
  assert.equal((await restored.snapshot()).harness, null);
});

test('PINless runtime connects an existing session and dispatches selected native model/effort exactly once', async t => {
  const { EventEmitter } = await import('node:events');
  const { CodexOwnedAdapter } = await import('../packages/harness-codex/dist/index.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-live-control-'));
  const calls = []; let port; let binding;
  const runtime = await startLocalRuntime({ dataDir: path.join(temp, 'state'), chooseWorkspace: async () => ({root: temp, displayName: 'Fixture workspace'}), createHarnessAdapters: async ({ hostId }) => {
    port = new EventEmitter(); port.notify = () => {}; port.stop = async () => {};
    port.request = async (method, params) => {
      calls.push({ method, params });
      if (method === 'initialize') return { userAgent: 'codex_cli_rs/0.153.4 (fixture)', codexHome: temp };
      if (method === 'account/read') return { requiresOpenaiAuth: false, account: null };
      if (method === 'thread/list') return { data: [{ id: 'existing', cwd: temp, preview: 'Actual fixture session' }] };
      if (method === 'model/list') return { data: [{ model: 'catalog-only', displayName: 'Catalog only', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high' }] };
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      if (method === 'thread/start') return { thread: { id: 'new-native-thread' } };
      if (method === 'turn/start') return { turn: { id: 'native-turn' } };
      throw new Error('Unexpected native request: ' + method);
    };
    const adapter = new CodexOwnedAdapter(port, { hostId, instanceId: 'runtime', codexHome: temp });
    await adapter.initialize(); binding = { pluginId: 'snowball.codex', adapter }; return [binding];
  }});
  t.after(async () => { await runtime.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const client = new LocalClient(runtime.origin);
  let snapshot = await client.snapshot(); assert.equal(snapshot.accessMode, 'local-no-auth');
  const key = snapshot.sessionDetails[0].sessionKey; assert.equal(snapshot.sessionDetails[0].readOnly, true);
  assert.deepEqual((await client.models('snowball.codex', 'runtime')).models[0].efforts, ['high']);
  await assert.rejects(client.models('snowball.codex', 'other'), e => e.code === 'instance_mismatch');
  snapshot = await client.attachSession(key); assert.equal(snapshot.sessionDetails[0].readOnly, false);
  const session = snapshot.sessions.find(s => s.sessionKey === key);
  const command = { commandId: 'runtime-real-send', sessionKey: key, ownerId: session.ownerId, expectedRevision: session.revision, operation: 'sessions.send', payload: { text: 'fixture only', model: 'catalog-only', effort: 'high' } };
  await client.submit(command);
  let result;
  for (let i = 0; i < 50; i++) { result = await client.command(command.commandId); if (result.status !== 'queued' && result.status !== 'dispatched') break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(result.status, 'acknowledged');
  assert.equal((await client.submit(command)).replayed, true);
  const sends = calls.filter(c => c.method === 'turn/start'); assert.equal(sends.length, 1);
  assert.equal(sends[0].params.threadId, 'existing'); assert.equal(sends[0].params.model, 'catalog-only'); assert.equal(sends[0].params.effort, 'high');
  binding.adapter.emit('event', { sessionKey: key.replace('runtime', 'another-instance'), kind: 'turn/started', turnId: 'forged' });
  assert.equal(runtime.sessions.getSession(key).status, 'idle');
  port.emit('notification', {method:'item/agentMessage/delta',params:{threadId:'existing',turnId:'native-turn',delta:'Actual native event'}});
  snapshot = await client.snapshot(); assert.equal(snapshot.sessionMessages[key][0].text, 'Actual native event');
  port.emit('notification', {method:'item/agentMessage/delta',params:{threadId:'unrelated',turnId:'native-turn',delta:'must not display'}});
  assert.equal((await client.snapshot()).sessionMessages[key][0].text, 'Actual native event');
  const hostile = await fetch(runtime.origin + '/v1/sessions/create', {method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json'},body:JSON.stringify({pluginId:'snowball.codex',instanceId:'runtime',workspaceId:'none',root:temp})});
  assert.equal(hostile.status,400); assert.equal(calls.filter(c => c.method === 'thread/start').length,0);
  const workspace = await client.selectWorkspace();
  const created = await client.createSession({requestId:'11111111-1111-4111-8111-111111111111',pluginId:'snowball.codex',instanceId:'runtime',workspaceId:workspace.workspaceId,title:'Real created fixture task',model:'catalog-only'});
  assert.equal(created.snapshot.sessionDetails.find(s => s.sessionKey === created.sessionKey).title,'Real created fixture task');
  const started = calls.find(c => c.method === 'thread/start'); assert.equal(started.params.cwd,fs.realpathSync(temp)); assert.equal(started.params.model,'catalog-only');
  await assert.rejects(client.createSession({requestId:'22222222-2222-4222-8222-222222222222',pluginId:'snowball.codex',instanceId:'wrong',workspaceId:workspace.workspaceId}), e=>e.code==='create_unavailable');
  assert.equal(calls.filter(c => c.method === 'thread/start').length,1);
});
