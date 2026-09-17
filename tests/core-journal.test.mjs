import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CommandJournal, recoverAbandonedJournalLock, formatSessionKey } from '../packages/core/dist/index.js';

const hostId = `host_${'a'.repeat(32)}`;
const actorId = `ctl_${'b'.repeat(16)}`;
const key = formatSessionKey({ hostId, harness: { pluginId: 'snowball.test', instanceId: 'one' }, nativeSessionId: 'native/0' });
const other = formatSessionKey({ hostId, harness: { pluginId: 'snowball.test', instanceId: 'two' }, nativeSessionId: 'native/0' });
const ownerId = 'owner-1';
const fault = code => error => error.code === code;
function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-journal-'));
  const journals = [];
  const open = (extra = {}) => { const j = new CommandJournal({ directory, hostId, ...options, ...extra }); journals.push(j); return j; };
  t.after(() => { for (const j of journals) j.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, open };
}
const input = (j, commandId, extra = {}) => ({ commandId, actorId, sessionKey: key, ownerId, expectedRevision: j.session(extra.sessionKey ?? key).revision, operation: 'sessions.send', payload: { text: 'hello' }, ...extra });
const decision = (extra = {}) => ({ decisionId: 'decision-1', sessionKey: key, ownerId, nativeRequestId: 0, nativeRevision: 'v1', allowedAnswers: ['allow', 'deny'], ...extra });
const resolve = (j, commandId, extra = {}) => input(j, commandId, { operation: 'decisions.resolve', payload: { answer: 'allow' }, decision: { decisionId: 'decision-1', expectedRevision: j.decision('decision-1').revision }, ...extra });
const port = (execute, owner = ownerId) => ({ ownerId: owner, execute });
const proof = (extra = {}) => ({ commandId: 'c1', sessionKey: key, ownerId, correlationId: 'receipt-1', outcome: 'completed', ...extra });

test('host-local idempotency preserves exact intent, stale revisions and detached reads', t => {
  const j = setup(t).open(); j.registerSession(key, ownerId);
  const request = input(j, 'c1', { payload: { z: 1, a: { b: 2 } } });
  j.enqueue(request);
  assert.equal(j.enqueue({ ...request, payload: { a: { b: 2 }, z: 1 } }).replayed, true);
  for (const change of [{ payload: {} }, { actorId: `ctl_${'c'.repeat(16)}` }, { sessionKey: other }, { expectedRevision: 1 }]) {
    assert.throws(() => j.enqueue({ ...request, ...change }), fault('idempotency_conflict'));
  }
  assert.throws(() => j.enqueue({ ...request, commandId: 'c2' }), fault('stale_revision'));
  const detached = j.command('c1'); detached.input.payload.z = 8;
  assert.equal(j.command('c1').input.payload.z, 1);
  assert.equal(j.listCommands().length, 1);
});

test('two controllers cannot claim a native decision twice; native zero remains numeric', async t => {
  const j = setup(t).open(); j.registerSession(key, ownerId); j.registerDecision(decision());
  assert.throws(() => j.registerDecision(decision({ decisionId: 'alias' })), fault('conflict'));
  j.enqueue(resolve(j, 'c1'));
  assert.throws(() => j.enqueue(resolve(j, 'c2', { actorId: `ctl_${'c'.repeat(16)}` })), fault('stale_decision'));
  let calls = 0;
  const result = await j.dispatchNext(key, port(async envelope => {
    calls++; assert.equal(envelope.decision.nativeRequestId, 0);
    assert.equal(envelope.command.input.sessionKey, key);
    return { status: 'acknowledged', correlationId: 'receipt-1' };
  }));
  assert.equal(result.status, 'acknowledged'); assert.equal(calls, 1);
  assert.equal(j.decision('decision-1').status, 'resolved');
});

test('write-ahead boundary, per-session backpressure, ACK releases ordered delivery', async t => {
  const { open, directory } = setup(t, { maxSessionPending: 2, maxTotalPending: 3 });
  const j = open(); j.registerSession(key, ownerId); j.registerSession(other, ownerId);
  j.enqueue(input(j, 'c1')); j.enqueue(input(j, 'c2'));
  assert.throws(() => j.enqueue(input(j, 'overflow')), fault('capacity'));
  j.enqueue(input(j, 'c3', { sessionKey: other }));
  assert.throws(() => j.enqueue(input(j, 'global-overflow', { sessionKey: other })), fault('capacity'));
  const delivered = [];
  const p = port(async ({ command }) => {
    const lines = fs.readFileSync(path.join(directory, 'commands.v1.jsonl'), 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1));
    assert.equal(last.body.commands[0].status, 'dispatched');
    assert.equal(last.body.commands[0].input.commandId, command.input.commandId);
    delivered.push(command.input.commandId);
    return { status: 'acknowledged', correlationId: `receipt-${command.input.commandId}` };
  });
  await j.dispatchNext(key, p); await j.dispatchNext(key, p); await j.dispatchNext(other, p);
  assert.deepEqual(delivered, ['c1', 'c2', 'c3']);
  assert.equal(await j.dispatchNext(key, p), undefined);
});

test('timeout and late success remain unknown, block only that session, require exact read proof', async t => {
  const j = setup(t, { dispatchTimeoutMs: 15 }).open();
  j.registerSession(key, ownerId); j.registerSession(other, ownerId);
  const request = input(j, 'c1'); j.enqueue(request); j.enqueue(input(j, 'c2'));
  let late; let signal; let calls = 0;
  const result = await j.dispatchNext(key, port((_, s) => { calls++; signal = s; return new Promise(r => { late = r; }); }));
  assert.equal(result.status, 'unknown'); assert.equal(signal.aborted, true);
  late({ status: 'completed', correlationId: 'receipt-1' }); await new Promise(r => setImmediate(r));
  assert.equal(j.command('c1').status, 'unknown'); assert.equal(j.enqueue(request).replayed, true);
  await assert.rejects(j.dispatchNext(key, port(async () => { calls++; })), fault('delivery_barrier'));
  j.enqueue(input(j, 'other', { sessionKey: other }));
  await j.dispatchNext(other, port(async () => ({ status: 'completed', correlationId: 'other' })));
  assert.throws(() => j.reconcileCommand(proof({ ownerId: 'imposter' })), fault('proof_mismatch'));
  j.reconcileCommand(proof()); assert.equal(j.command('c1').status, 'completed'); assert.equal(calls, 1);
  await j.dispatchNext(key, port(async () => ({ status: 'completed', correlationId: 'receipt-2' })));
});

test('restart cancels queued work, preserves unknown receipts and requires owner observation', async t => {
  const { open } = setup(t); let j = open(); j.registerSession(key, ownerId);
  const first = input(j, 'c1'); j.enqueue(first);
  await j.dispatchNext(key, port(async () => ({ status: 'acknowledged', correlationId: 'receipt-1' })));
  j.enqueue(input(j, 'c2')); j.close(); j = open();
  assert.equal(j.command('c1').status, 'unknown'); assert.equal(j.command('c2').status, 'cancelled');
  assert.equal(j.enqueue(first).replayed, true);
  assert.throws(() => j.enqueue(input(j, 'c3')), fault('owner_unavailable'));
  j.registerSession(key, ownerId);
  assert.throws(() => j.reconcileCommand(proof({ outcome: 'not_delivered' })), fault('proof_mismatch'));
  j.reconcileCommand(proof()); j.enqueue(input(j, 'c3'));
});

test('restored approvals require exact native proof; uncertain claims cannot be released by pending observation', async t => {
  const { open } = setup(t, { dispatchTimeoutMs: 10 }); let j = open();
  j.registerSession(key, ownerId); j.registerDecision(decision()); j.close(); j = open();
  assert.equal(j.decision('decision-1').status, 'needs_review'); j.registerSession(key, ownerId);
  assert.throws(() => j.enqueue(resolve(j, 'c1')), fault('stale_decision'));
  const read = () => ({ ...decision(), expectedRevision: j.decision('decision-1').revision, outcome: 'pending' });
  assert.throws(() => j.revalidateDecision({ ...read(), nativeRequestId: '0' }), fault('proof_mismatch'));
  j.revalidateDecision(read()); j.enqueue(resolve(j, 'c1'));
  await j.dispatchNext(key, port(() => new Promise(() => {})));
  assert.equal(j.decision('decision-1').status, 'unknown');
  assert.throws(() => j.revalidateDecision(read()), fault('conflict'));
  j.close(); j = open(); j.registerSession(key, ownerId);
  assert.equal(j.decision('decision-1').claimCommandId, 'c1');
  assert.throws(() => j.enqueue(resolve(j, 'c2')), fault('stale_decision'));
  j.reconcileCommand(proof({ outcome: 'not_delivered' }));
  assert.equal(j.decision('decision-1').status, 'needs_review');
  j.revalidateDecision(read()); j.enqueue(resolve(j, 'c2'));
});

test('expiry and external resolution cancel before adapter entry; owner change cannot retarget', async t => {
  let now = 100; const j = setup(t, { now: () => now }).open(); j.registerSession(key, ownerId);
  j.registerDecision(decision({ expiresAt: 110 })); j.enqueue(resolve(j, 'c1'));
  let calls = 0; const p = port(async () => { calls++; return { status: 'completed', correlationId: 'receipt' }; });
  now = 110; assert.equal((await j.dispatchNext(key, p)).status, 'cancelled'); assert.equal(calls, 0);
  j.registerDecision(decision({ decisionId: 'decision-2', nativeRequestId: 1 }));
  j.enqueue(input(j, 'c2', { operation: 'decisions.resolve', payload: { answer: 'deny' }, decision: { decisionId: 'decision-2', expectedRevision: 0 } }));
  j.revalidateDecision({ ...decision({ decisionId: 'decision-2', nativeRequestId: 1 }), expectedRevision: 1, outcome: 'resolved' });
  assert.equal(j.command('c2').status, 'cancelled');
  j.enqueue(input(j, 'c3')); const inFlight = j.dispatchNext(key, p);
  j.registerSession(key, 'owner-2'); await inFlight;
  assert.equal(calls, 0); assert.equal(j.command('c3').status, 'unknown');
  await assert.rejects(j.dispatchNext(key, port(async () => { calls++; }, 'owner-2')), fault('delivery_barrier'));
});

test('single writer and capacity fail closed without losing accepted state', async t => {
  const { open, directory } = setup(t); const j = open(); j.registerSession(key, ownerId);
  assert.throws(() => open(), fault('locked'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'commands.lock')));
  assert.throws(() => recoverAbandonedJournalLock(directory, lock.token), fault('locked'));
  j.enqueue(input(j, 'c1')); j.close();
  const size = fs.statSync(path.join(directory, 'commands.v1.jsonl')).size;
  // Recovery itself needs a durable cancellation record. No room means no successful open.
  assert.throws(() => open({ maxJournalBytes: size }), fault('capacity'));
  const recovered = open(); assert.equal(recovered.command('c1').status, 'cancelled');
  recovered.close();
  const limited = open({ maxJournalBytes: fs.statSync(path.join(directory, 'commands.v1.jsonl')).size + 1 });
  limited.registerSession(key, ownerId);
  assert.throws(() => limited.enqueue(input(limited, 'c2')), fault('capacity'));
  assert.equal(limited.command('c2'), undefined);
  await assert.rejects(limited.dispatchNext(key, port(async () => assert.fail('must not send'))), fault('unavailable'));
});

test('maximum payload queues recover and change owners using bounded transactions', t => {
  const { open } = setup(t); let j = open(); j.registerSession(key, ownerId);
  for (let i = 0; i < 20; i++) j.enqueue(input(j, `c${i}`, { payload: 'x'.repeat(60 * 1024) }));
  j.close(); j = open(); assert.equal(j.listCommands().filter(c => c.status === 'cancelled').length, 20);
  j.registerSession(key, ownerId);
  for (let i = 20; i < 40; i++) j.enqueue(input(j, `c${i}`, { payload: 'x'.repeat(60 * 1024) }));
  j.registerSession(key, 'owner-2'); assert.equal(j.listCommands().filter(c => c.status === 'cancelled').length, 40);
});

test('wrong host, checksum damage, blank record and torn tail preserve evidence and fail closed', t => {
  const { open, directory } = setup(t); const j = open(); j.close();
  const file = path.join(directory, 'commands.v1.jsonl'); const original = fs.readFileSync(file);
  assert.throws(() => open({ hostId: `host_${'d'.repeat(32)}` }), fault('schema'));
  for (const data of [Buffer.concat([original, Buffer.from('{')]), Buffer.concat([original, Buffer.from('\n')]), Buffer.from(original.toString().replace('"schema":1', '"schema":9'))]) {
    fs.writeFileSync(file, data); assert.throws(() => open(), fault('corrupt')); assert.deepEqual(fs.readFileSync(file), data);
  }
  fs.writeFileSync(file, original); open();
});

for (const stage of ['queued', 'before-effect', 'after-effect']) test(`real process death at ${stage} never replays a command`, async t => {
  const { directory, open } = setup(t);
  const child = spawn(process.execPath, ['tests/fixtures/journal-crash.mjs', directory, stage], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const [code, signal] = await once(child, 'exit');
  assert.ok(code !== 0 || signal, stderr);
  const lockPath = path.join(directory, 'commands.lock');
  assert.ok(fs.existsSync(lockPath), stderr);
  assert.throws(() => open(), fault('locked'));
  const lock = JSON.parse(fs.readFileSync(lockPath)); recoverAbandonedJournalLock(directory, lock.token);
  const j = open(); const command = j.command('c1');
  assert.equal(command.status, stage === 'queued' ? 'cancelled' : 'unknown');
  assert.equal(j.enqueue(command.input).replayed, true);
  const effect = path.join(directory, 'external-effect.txt');
  assert.equal(fs.existsSync(effect), stage === 'after-effect');
  if (fs.existsSync(effect)) assert.equal(fs.readFileSync(effect, 'utf8'), 'one execution');
});
