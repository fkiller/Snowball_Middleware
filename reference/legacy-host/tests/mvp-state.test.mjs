import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ContextManager } from '../dist/state/context.js';
import { CodexHarness } from '../dist/harness/codex.js';

const key = (ctx, id) => ctx.getDeviceState().keys.find(k => k.keyId === id);

test('settings is a closed modal and preserves the voice draft on return', () => {
  const ctx = new ContextManager();
  ctx.voiceDraftText = '수정할 초안';
  ctx.viewMode = 'settings';
  ctx.updateReaderForCurrentSession();
  assert.equal(ctx.readerTitle, 'Settings');
  assert.match(ctx.readerSubtitle, /Whisper/);
  assert.deepEqual(ctx.getDeviceState().keys.filter(k => !k.isDisabled).map(k => k.keyId), [17]);
  ctx.viewMode = 'session';
  ctx.updateReaderForCurrentSession();
  assert.equal(ctx.voiceDraftText, '수정할 초안');
  assert.equal(ctx.readerTitle, 'Voice Prompt Draft');
});

test('recording, transcription, review and uncertain delivery expose matching actions', () => {
  const ctx = new ContextManager();
  assert.equal(key(ctx, 16).isDisabled, true);
  assert.equal(key(ctx, 12).isDisabled, true);
  ctx.isRecordingVoice = true;
  assert.equal(key(ctx, 16).labelMain, 'Done');
  assert.notEqual(key(ctx, 16).isDisabled, true);
  ctx.isRecordingVoice = false;
  ctx.isTranscribingVoice = true;
  assert.equal(key(ctx, 16).isDisabled, true);
  assert.notEqual(key(ctx, 4).isDisabled, true);
  ctx.isTranscribingVoice = false;
  ctx.voiceDraftText = 'Keep my original draft';
  assert.notEqual(key(ctx, 16).isDisabled, true);
  for (const phase of ['sending', 'unknown']) {
    ctx.voiceSubmission = phase;
    ctx.updateReaderForCurrentSession();
    for (const id of [20, 16, 4]) assert.equal(key(ctx, id).isDisabled, true);
    assert.ok(ctx.readerLines.includes('Keep my original draft'));
    assert.ok(!ctx.readerLines.some(l => l.includes('Press [Send]')));
  }
});

test('all view modes render exactly 20 unique keys; diff close is not labelled Stop', () => {
  const ctx = new ContextManager();
  for (const mode of ['session', 'editor', 'workspace', 'settings', 'question', 'changes']) {
    ctx.viewMode = mode;
    const keys = ctx.getDeviceState().keys;
    assert.equal(keys.length, 20);
    assert.equal(new Set(keys.map(k => k.keyId)).size, 20);
  }
  assert.equal(key(ctx, 17).labelSub, 'Close');
});

test('unsupported question actions are disabled and approval needs a selection', () => {
  const ctx = new ContextManager();
  ctx.viewMode = 'question';
  ctx.activeQuestion = { id: 'q', prompt: 'Proceed?', isPermission: true, hasOther: false,
    isMultiSelect: false, options: [{ id: 'allow', label: 'Allow', isSelected: false }] };
  for (const id of [20, 12, 16]) assert.equal(key(ctx, id).isDisabled, true);
  ctx.activeQuestion.options[0].isSelected = true;
  assert.equal(key(ctx, 16).isDisabled, false);
  ctx.activeQuestion.isPermission = false;
  assert.equal(key(ctx, 16).isDisabled, true);
});

function fixture() {
  const adapter = new EventEmitter();
  const root = path.resolve('mvp-project');
  adapter.request = async () => ({ data: [{ id: 'p', name: 'MVP', roots: [{ path: root }] }] });
  adapter.listThreads = async () => [
    { id: 'inside', cwd: root, createdAt: 0 },
    { id: 'nested', cwd: path.join(root, 'src'), createdAt: 0 },
    { id: 'sibling', cwd: root + '-other', createdAt: 0 },
  ];
  return { adapter, root, harness: new CodexHarness(adapter) };
}

test('Codex project scope excludes similarly named sibling directories', async () => {
  const { harness } = fixture();
  await harness.listProjects();
  assert.deepEqual((await harness.listSessions('p')).map(s => s.id), ['inside', 'nested']);
});

test('Codex New uses the selected project and rejects a missing project', async () => {
  const { adapter, root, harness } = fixture();
  let received;
  adapter.startThread = async cwd => { received = cwd; return 'new'; };
  await harness.listProjects();
  await harness.createSession('p');
  assert.equal(received, root);
  await assert.rejects(harness.createSession('missing'), /unavailable/);
});

test('Codex streaming retains the event thread identity', () => {
  const { adapter, harness } = fixture();
  let event;
  harness.on('delta', value => { event = value; });
  adapter.emit('delta', { threadId: 'original', content: 'Hello' });
  assert.equal(event.sessionId, 'original');
});
