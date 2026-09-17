import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceDraft } from '../dist/audio/draft.js';

const destination = () => ({ machineId: 'a', harnessId: 'codex', projectId: 'p', sessionId: 'original', owner: 'desktop' });
function ready(draft) {
  const capture = draft.begin(destination());
  draft.transcribing(capture.id); draft.complete(capture.id, '한글 README edit');
  return capture;
}
test('selection changes cannot redirect the captured destination', async () => {
  const draft = new VoiceDraft(), selected = destination();
  const capture = draft.begin(selected);
  selected.sessionId = 'different'; selected.machineId = 'b';
  draft.transcribing(capture.id); draft.complete(capture.id, 'prompt');
  await draft.submit(async (target, text) => {
    assert.equal(target.sessionId, 'original'); assert.equal(target.machineId, 'a'); assert.equal(text, 'prompt');
  });
  assert.equal(draft.snapshot.phase, 'sent');
});
test('cancel invalidates late transcript, including after a new capture starts', () => {
  const draft = new VoiceDraft(); const old = draft.begin(destination());
  draft.transcribing(old.id); assert.equal(draft.cancel(), true); assert.equal(old.signal.aborted, true);
  const next = draft.begin(destination()); draft.transcribing(next.id);
  assert.equal(draft.complete(old.id, 'late'), false);
  assert.equal(draft.complete(next.id, 'new'), true); assert.equal(draft.snapshot.text, 'new');
});
test('empty recognition and whitespace edits cannot be submitted', async () => {
  const draft = new VoiceDraft(), capture = draft.begin(destination());
  draft.transcribing(capture.id); draft.complete(capture.id, '  ');
  assert.equal(draft.snapshot.phase, 'empty');
  await assert.rejects(draft.submit(async () => assert.fail('must not send')));
  ready(draft); draft.edit(' ');
  await assert.rejects(draft.submit(async () => assert.fail('must not send')));
});
test('in-flight submission preserves text and rejects double Send or replacement', async () => {
  const draft = new VoiceDraft(); ready(draft);
  let release; let calls = 0;
  const pending = draft.submit(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  assert.equal(draft.snapshot.text, '한글 README edit'); assert.equal(draft.cancel(), false);
  assert.throws(() => draft.begin(destination()));
  await assert.rejects(draft.submit(async () => calls++));
  release(); await pending; assert.equal(calls, 1); assert.equal(draft.snapshot.text, '');
});
test('ambiguous delivery preserves draft and forbids alternate-owner retry', async () => {
  const draft = new VoiceDraft(); ready(draft);
  await assert.rejects(draft.submit(async () => { throw new Error('connection lost after dispatch'); }));
  assert.equal(draft.snapshot.phase, 'unknown'); assert.equal(draft.snapshot.text, '한글 README edit');
  await assert.rejects(draft.submit(async () => assert.fail('must not replay')));
  assert.equal(draft.cancel(), false); assert.throws(() => draft.begin(destination()));
});
test('capture failure rejects late completion', () => {
  const draft = new VoiceDraft(), capture = draft.begin(destination());
  assert.equal(draft.fail(capture.id), true); assert.equal(capture.signal.aborted, true);
  assert.equal(draft.complete(capture.id, 'late'), false);
});
test('MVP Talk-replace: review draft is discarded and a new capture starts clean', () => {
  const draft = new VoiceDraft();
  const old = ready(draft);
  assert.equal(draft.snapshot.phase, 'review');
  // K20 with draft on screen: discard, then begin a fresh capture.
  assert.equal(draft.cancel(), true);
  assert.equal(draft.snapshot.phase, 'cancelled');
  const next = draft.begin(destination());
  draft.transcribing(next.id);
  assert.equal(draft.complete(old.id, 'stale transcript'), false);
  assert.equal(draft.complete(next.id, 'fresh prompt'), true);
  assert.equal(draft.snapshot.text, 'fresh prompt');
});
