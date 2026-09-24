import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexOwnedAdapter } from '../packages/harness-codex/dist/index.js';
import { CommandJournal, SessionService, formatSessionKey } from '../packages/core/dist/index.js';
const hostId = `host_${'a'.repeat(32)}`, actorId = `ctl_${'b'.repeat(16)}`;
class Port extends EventEmitter {
  calls = []; count = 0; auth = true; earlyComplete = false; home;
  constructor(home) { super(); this.home = home; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'initialize') return { userAgent: 'codex_cli_rs/0.153.4 (fixture)', codexHome: this.home };
    if (method === 'account/read') return { requiresOpenaiAuth: true, account: this.auth ? { type: 'chatgpt', email: 'do not expose' } : null };
    if (method === 'model/list') return { data: [{model:'fixture-model',displayName:'Fixture model',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low'}],nextCursor:null };
    if (method === 'thread/resume') return { thread: {id:params.threadId} };
    if (method === 'thread/start') return { thread: { id: `owned-${++this.count}` } };
    if (method === 'thread/list') return { data: [{ id: 'desktop-existing', cwd: this.home }, { id: 'owned-1', cwd: this.home }] };
    if (method === 'thread/read') return { thread: { id: params.threadId } };
    if (method === 'turn/start') {
      this.emit('notification', { method: 'turn/started', params: { threadId: params.threadId, turn: { id: 'turn-1' } } });
      if (this.earlyComplete) this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'turn-1' } } });
      return { turn: { id: 'turn-1' } };
    }
    if (method === 'turn/interrupt') return {};
    throw new Error('unexpected method');
  }
  notify(method) { this.calls.push({ method }); }
  respond(id, result) { this.calls.push({ id, result }); queueMicrotask(() => this.emit('notification', { method: 'serverRequest/resolved', params: { threadId: 'owned-1', requestId: id } })); }
  async stop() { this.emit('fault', {}); }
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'snowball-codex-')); const cleanup = [];
  const port = new Port(directory); const adapter = new CodexOwnedAdapter(port, { hostId, instanceId: 'one', codexHome: directory });
  await adapter.initialize(); t.after(async () => { for (const fn of cleanup) await fn(); await adapter.stop(); await rm(directory, { recursive: true, force: true }); });
  return { directory, port, adapter, cleanup };
}
const envelope = (adapter, sessionKey, operation, payload) => ({ command: { input: { commandId: 'test-command', actorId, ownerId: adapter.ownerId, sessionKey, operation, payload, expectedRevision: 0 } } });

for (const completion of [false, true]) test(`native ${completion ? 'turn completion' : 'request clearing'} closes the approval but never fabricates answer acceptance`, async t => {
  const { adapter, port, directory, cleanup } = await fixture(t);
  const journal = new CommandJournal({ directory: path.join(directory, 'journal'), hostId }); cleanup.push(() => journal.close());
  const service = new SessionService({ hostId, journal }); service.registerAdapter('snowball.codex', adapter);
  const { sessionKey } = await service.createSession('snowball.codex', directory);
  await service.sendPrompt(actorId, sessionKey, 'fixture'); await service.dispatchNext(sessionKey);
  port.emit('request', { id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'owned-1', turnId: 'turn-1', itemId: 'item-1', availableDecisions: ['decline'] } });
  const decision = journal.listDecisions()[0]; assert.equal(decision.status, 'pending');
  if (completion) port.respond = () => queueMicrotask(() => port.emit('notification', { method: 'turn/completed', params: { threadId: 'owned-1', turn: { id: 'turn-1', status: 'interrupted' } } }));
  const answered = await service.resolveDecision(actorId, decision.decisionId, 'decline');
  assert.equal(journal.decision(decision.decisionId).status, 'resolved');
  assert.equal(journal.command(answered.commandId).status, 'unknown');
  await assert.rejects(service.resolveDecision(actorId, decision.decisionId, 'decline'));
});
test('explicit handshake preserves credential source; unauthenticated state never creates a session', async t => {
  const { port, adapter, directory } = await fixture(t); assert.ok(!JSON.stringify(adapter.status()).includes('do not expose'));
  port.auth = false; await adapter.refreshAuth(); assert.equal(adapter.status().auth, 'needs_auth');
  await assert.rejects(adapter.createSession(directory), /needs_auth/); assert.ok(!port.calls.some(c => c.method === 'thread/start'));
  assert.ok(port.calls.filter(c => c.method === 'account/read').every(c => c.params.refreshToken === false));
});
test('only created sessions receive commands; historical Desktop reads never resume or acquire ownership', async t => {
  const { port, adapter, directory } = await fixture(t); const created = await adapter.createSession(directory);
  const listed = await adapter.listSessions(); assert.equal(listed[0].readOnly, true); assert.equal(listed[0].ownerId, null); assert.equal(listed[1].readOnly, false);
  assert.equal((await adapter.readSession('desktop-existing')).readOnly, true);
  const foreign = formatSessionKey({ hostId, harness: { pluginId: 'snowball.codex', instanceId: 'one' }, nativeSessionId: 'desktop-existing' });
  assert.equal((await adapter.execute(envelope(adapter, foreign, 'sessions.send', { text: 'must not send' }), new AbortController().signal)).status, 'not_sent');
  const sent = await adapter.execute(envelope(adapter, created.sessionKey, 'sessions.send', { text: 'fixture' }), new AbortController().signal); assert.equal(sent.correlationId, 'turn-1');
  assert.ok(!port.calls.some(c => ['thread/resume', 'thread/fork', 'account/login/start'].includes(c.method)));
  assert.equal(port.calls.find(c => c.method === 'thread/start').params.sandbox, 'read-only');
});
test('stale owner/turn and target overrides fail before dispatch; early completion does not resurrect active turn', async t => {
  const { adapter, port, directory } = await fixture(t); const { sessionKey } = await adapter.createSession(directory); const signal = new AbortController().signal;
  const wrong = envelope(adapter, sessionKey, 'sessions.send', { text: 'x' }); wrong.command.input.ownerId = 'other'; assert.equal((await adapter.execute(wrong, signal)).reason, 'owner_mismatch');
  assert.equal((await adapter.execute(envelope(adapter, sessionKey, 'sessions.send', { text: 'x', threadId: 'other' }), signal)).status, 'not_sent');
  port.earlyComplete = true; await adapter.execute(envelope(adapter, sessionKey, 'sessions.send', { text: 'x' }), signal);
  assert.equal((await adapter.execute(envelope(adapter, sessionKey, 'sessions.interrupt', { turnId: 'turn-1' }), signal)).reason, 'stale_turn');
  assert.ok(!port.calls.some(c => c.method === 'turn/interrupt'));
});
test('real durable journal + adapter deduplicates send, pins owner and preserves uncertain decision delivery', async t => {
  const { adapter, port, directory, cleanup } = await fixture(t); const { sessionKey } = await adapter.createSession(directory);
  const journal = new CommandJournal({ directory: path.join(directory, 'journal'), hostId }); cleanup.push(() => journal.close()); journal.registerSession(sessionKey, adapter.ownerId);
  const input = { commandId: 'send-1', actorId, sessionKey, ownerId: adapter.ownerId, expectedRevision: journal.session(sessionKey).revision, operation: 'sessions.send', payload: { text: 'fixture' } };
  journal.enqueue(input); assert.equal((await journal.dispatchNext(sessionKey, adapter)).status, 'acknowledged'); assert.equal(journal.enqueue(input).replayed, true);
  assert.equal(port.calls.filter(c => c.method === 'turn/start').length, 1);
  let native; adapter.once('decision', value => { native = value; });
  port.emit('request', { id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'owned-1', turnId: 'turn-1', itemId: 'item-1', availableDecisions: ['accept', 'decline'] } });
  assert.equal(native.nativeRequestId, 0); journal.registerDecision({ ...native, decisionId: 'decision-0' });
  journal.enqueue({ commandId: 'answer-0', actorId, sessionKey, ownerId: adapter.ownerId, expectedRevision: journal.session(sessionKey).revision, operation: 'decisions.resolve', payload: { answer: 'decline' }, decision: { decisionId: 'decision-0', expectedRevision: journal.decision('decision-0').revision } });
  assert.equal((await journal.dispatchNext(sessionKey, adapter)).status, 'unknown'); assert.equal(port.calls.at(-1).id, 0);
  assert.equal(journal.command('answer-0').status, 'unknown');
});
test('foreign events/requests are not attributed to owned tasks; disconnect drops all ownership', async t => {
  const { adapter, port, directory } = await fixture(t); const { sessionKey } = await adapter.createSession(directory); const events = []; const decisions = [];
  adapter.on('event', e => events.push(e)); adapter.on('decision', e => decisions.push(e));
  port.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'desktop-existing', delta: 'private' } });
  port.emit('request', { id: '0', method: 'item/commandExecution/requestApproval', params: { threadId: 'desktop-existing', turnId: 'turn-x', itemId: 'item-x' } });
  assert.equal(events.length, 0); assert.equal(decisions.length, 0); await adapter.stop();
  assert.equal((await adapter.execute(envelope(adapter, sessionKey, 'sessions.send', { text: 'x' }), new AbortController().signal)).status, 'not_sent'); assert.equal(adapter.status().ownedSessionCount, 0);
});
test('an unexpected native turn revokes local ownership instead of steering another client', async t => {
  const { adapter, port, directory } = await fixture(t); const { sessionKey } = await adapter.createSession(directory);
  let lost; adapter.once('ownerLost', value => { lost = value; });
  port.emit('notification', { method: 'turn/started', params: { threadId: 'owned-1', turn: { id: 'other-client-turn' } } });
  assert.equal(lost.sessionKey, sessionKey);
  assert.equal((await adapter.execute(envelope(adapter, sessionKey, 'sessions.send', { text: 'must not steer' }), new AbortController().signal)).reason, 'owner_mismatch');
});

test('selected existing Codex session accepts commands with actual catalog model/effort while unrelated sessions stay outside scope',async t=>{
 const {adapter,port}=await fixture(t);
 const models=await adapter.listModels();assert.deepEqual(models[0].efforts,['low','high']);
 const attached=await adapter.attachSession('desktop-existing');
 const signal=new AbortController().signal;
 const receipt=await adapter.execute(envelope(adapter,attached.sessionKey,'sessions.send',{text:'fixture command',model:'fixture-model',effort:'high'}),signal);
 assert.equal(receipt.status,'acknowledged');
 const sent=port.calls.find(c=>c.method==='turn/start');assert.equal(sent.params.threadId,'desktop-existing');assert.equal(sent.params.model,'fixture-model');assert.equal(sent.params.effort,'high');
 assert.deepEqual(port.calls.find(c=>c.method==='thread/resume').params,{threadId:'desktop-existing',excludeTurns:true});
 port.emit('notification',{method:'turn/completed',params:{threadId:'desktop-existing',turn:{id:'turn-1'}}});
 const invalid=await adapter.execute(envelope(adapter,attached.sessionKey,'sessions.send',{text:'never send',model:'fixture-model',effort:'invented'}),signal);
 assert.equal(invalid.reason,'unsupported_execution_settings');assert.equal(port.calls.filter(c=>c.method==='turn/start').length,1);
 port.emit('notification',{method:'turn/started',params:{threadId:'desktop-existing',turn:{id:'external-turn'}}});
 assert.equal((await adapter.readSession('desktop-existing')).readOnly,false);
 const stopped=await adapter.execute(envelope(adapter,attached.sessionKey,'sessions.interrupt',{turnId:'external-turn'}),signal);assert.equal(stopped.status,'acknowledged');
});

test('large native text becomes an explicitly truncated bounded worker event',async t=>{
 const {adapter,port,directory}=await fixture(t);const created=await adapter.createSession(directory);let event;
 adapter.on('event',value=>{event=value;});
 port.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'owned-1',turnId:'large-turn',delta:'한'.repeat(70000)}});
 assert.equal(event.sessionKey,created.sessionKey);assert.equal(event.text.length,4096);assert.equal(event.truncated,true);
 assert.ok(Buffer.byteLength(JSON.stringify(event))<65536);
});
