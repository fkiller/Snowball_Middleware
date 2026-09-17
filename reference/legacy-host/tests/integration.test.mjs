import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { ContextManager } from '../dist/state/context.js';
import { VoiceDraft } from '../dist/audio/draft.js';
import { LocalWhisperProvider } from '../dist/audio/local-whisper.js';

test('integration: end-to-end headless flow (capture -> transcribe -> review -> talk-replace -> send)', async () => {
  // Configure mock capture mode for headless testing
  process.env.SNOWBALL_MOCK_CAPTURE = '1';
  const fixturePath = path.join(os.tmpdir(), 'snowball_fixture_en.wav');
  if (fs.existsSync(fixturePath)) {
    process.env.SNOWBALL_MOCK_FIXTURE = fixturePath;
  }

  const context = new ContextManager();
  const voiceDraft = new VoiceDraft();
  const provider = new LocalWhisperProvider('base');

  try {
    const destination = {
      machineId: 'dev-pc',
      harnessId: 'codex',
      projectId: 'snowball',
      sessionId: 'test-session-1',
      owner: 'cli',
    };

    // 1. User presses K20 (Talk) to start recording
    const capture = voiceDraft.begin(destination);
    assert.equal(voiceDraft.snapshot.phase, 'recording');
    await provider.start(capture.id);

    // 2. User presses K20 again to finish recording and transcribe
    assert.equal(voiceDraft.transcribing(capture.id), true);
    assert.equal(voiceDraft.snapshot.phase, 'transcribing');

    const transcribedText = await provider.finish(capture.id);
    assert.equal(typeof transcribedText, 'string');

    const completed = voiceDraft.complete(capture.id, transcribedText || 'Fallback transcribed prompt');
    assert.equal(completed, true);
    assert.equal(voiceDraft.snapshot.phase, 'review');

    // 3. Mirror draft to ContextManager and verify MK20 screen state
    context.voiceDraftText = voiceDraft.snapshot.text;
    context.updateReaderForCurrentSession();

    assert.equal(context.readerTitle, 'Voice Prompt Draft');
    assert.ok(context.readerLines.some(l => l.includes('[DRAFT PROMPT VERIFICATION]')));

    // 4. Verify Talk-replace: pressing Talk while draft is in review discards prior draft
    assert.equal(voiceDraft.cancel(), true);
    context.voiceDraftText = '';
    const newCapture = voiceDraft.begin(destination);
    assert.equal(voiceDraft.snapshot.phase, 'recording');
    assert.equal(voiceDraft.snapshot.id, newCapture.id);

    // Cancel in-flight recording (K4)
    assert.equal(voiceDraft.cancel(), true);
    await provider.cancel(newCapture.id);

    // 5. Verify explicit Send (K16) workflow
    const sendCapture = voiceDraft.begin(destination);
    voiceDraft.transcribing(sendCapture.id);
    voiceDraft.complete(sendCapture.id, 'Optimized sample rate conversion');
    context.voiceDraftText = voiceDraft.snapshot.text;

    let submittedTarget = null;
    let submittedText = null;
    await voiceDraft.submit(async (target, text) => {
      submittedTarget = target;
      submittedText = text;
    });

    assert.equal(submittedTarget.sessionId, 'test-session-1');
    assert.equal(submittedText, 'Optimized sample rate conversion');
    assert.equal(voiceDraft.snapshot.phase, 'sent');
  } finally {
    provider.close();
    delete process.env.SNOWBALL_MOCK_CAPTURE;
    delete process.env.SNOWBALL_MOCK_FIXTURE;
  }
});
