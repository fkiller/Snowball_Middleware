import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CommandJournal,
  SessionService,
  VoiceCoordinator,
  VoiceDraftManager,
  AudioSourceRegistry,
  SpeechRegistry,
  AudioFault,
  formatSessionKey,
} from '../packages/core/dist/index.js';

const hostId = `host_${'e'.repeat(32)}`;
const actorId = `ctl_${'f'.repeat(16)}`;

class MockAudioSource extends EventEmitter {
  info = {
    id: 'mock_mic',
    kind: 'host_mic',
    label: 'Mock Microphone',
    permission: 'granted',
    state: 'idle',
    format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'pcm' },
  };
  captures = [];

  async start(captureId) {
    this.info.state = 'recording';
    this.captures.push({ captureId, status: 'started' });
    return { captureId, format: this.info.format };
  }

  async stop(captureId) {
    this.info.state = 'idle';
    return {
      captureId,
      audioData: Buffer.from('mock-pcm-audio-data'),
      format: this.info.format,
      durationMs: 2500,
    };
  }

  async cancel(captureId) {
    this.info.state = 'idle';
    this.captures.push({ captureId, status: 'cancelled' });
  }
}

class MockSpeechProvider extends EventEmitter {
  info = {
    id: 'mock_whisper',
    kind: 'local_whisper',
    label: 'Mock Local Whisper',
    status: 'ready',
    models: [{ id: 'base', name: 'Whisper Base', sizeBytes: 140000000, language: 'multilingual', isInstalled: true }],
  };
  shouldFail = false;

  async listModels() { return this.info.models; }
  async installModel() {}
  async deleteModel() {}

  async transcribe(audio, options) {
    if (this.shouldFail) {
      throw new AudioFault('transcription_failed', 'Speech recognition failed on noise');
    }
    return {
      text: 'Create a new database migration for users',
      language: 'en',
      durationMs: 2500,
    };
  }

  async cancel() {}
}

class MockHarnessAdapter extends EventEmitter {
  status(){return {instanceId:'voice-test',connected:true};}
  ownerId = 'mock-owner-voice';
  calls = [];

  async createSession(root) {
    const sessionKey = formatSessionKey({
      hostId,
      harness: { pluginId: 'mock.harness', instanceId: 'voice-test' },
      nativeSessionId: 'sess-voice-1',
    });
    return { sessionKey, ownerId: this.ownerId };
  }

  async execute(envelope) {
    this.calls.push(envelope.command.input);
    return { status: 'acknowledged', correlationId: 'corr-1' };
  }
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'snowball-voice-draft-test-'));
  const journal = new CommandJournal({ directory: path.join(dir, 'journal'), hostId });
  const sessionService = new SessionService({ hostId, journal });

  const adapter = new MockHarnessAdapter();
  sessionService.registerAdapter('mock.harness', adapter);

  const sources = new AudioSourceRegistry();
  const source = new MockAudioSource();
  sources.register(source);

  const speech = new SpeechRegistry();
  const provider = new MockSpeechProvider();
  speech.register(provider);

  const coordinator = new VoiceCoordinator(sources, speech);
  const manager = new VoiceDraftManager({ coordinator, sessionService });

  t.after(async () => {
    journal.close();
    await rm(dir, { recursive: true, force: true });
  });

  return { dir, journal, sessionService, adapter, source, provider, coordinator, manager };
}

test('MW.07.02.01.01.A1: voice start -> transcribe -> review -> edit -> undo -> explicit Send lifecycle with immutable destination (R-TARGET / J07)', async t => {
  const { sessionService, manager, adapter } = await fixture(t);

  // 1. Create target session
  const { sessionKey } = await sessionService.createSession('mock.harness', '/workspace/voice');

  // 2. Start voice draft (phase: recording)
  const draft = await manager.startVoiceDraft(actorId, sessionKey);
  assert.equal(draft.destinationKey, sessionKey);
  assert.equal(draft.phase, 'recording');
  assert.equal(draft.text, '');

  // 3. Finish recording & transcribe (phase: recording -> transcribing -> review)
  const reviewed = await manager.finishRecording(actorId);
  assert.equal(reviewed.phase, 'review');
  assert.equal(reviewed.destinationKey, sessionKey);
  assert.equal(reviewed.text, 'Create a new database migration for users');

  // 4. Edit draft text
  const edited = manager.editDraft(actorId, 'Create a new database migration for accounts');
  assert.equal(edited.text, 'Create a new database migration for accounts');
  assert.equal(edited.destinationKey, sessionKey);

  // 5. Undo edit
  const undone = manager.undoEdit(actorId);
  assert.equal(undone.text, 'Create a new database migration for users');

  // Re-apply edit
  manager.editDraft(actorId, 'Create a new database migration for users and profiles');

  // 6. Switch controller selection while draft is in review (R-TARGET invariant test)
  const controller = sessionService.getControllerContext(actorId);
  const otherSessionKey = formatSessionKey({
    hostId,
    harness: { pluginId: 'mock.other', instanceId: 'other' },
    nativeSessionId: 'sess-other-2',
  });
  controller.selectScope({ sessionKey: otherSessionKey });

  // Pinned destination of the draft MUST remain unchanged!
  assert.equal(manager.getDraft(actorId)?.destinationKey, sessionKey);

  // 7. Explicit Send (never automatic)
  const sendResult = await manager.explicitSend(actorId);
  assert.ok(sendResult.commandId);

  // Verify command was dispatched strictly to sessionKey
  const dispatched = await sessionService.dispatchNext(sessionKey);
  assert.ok(dispatched);
  assert.equal(dispatched.input.sessionKey, sessionKey);
  assert.equal(dispatched.input.payload.text, 'Create a new database migration for users and profiles');

  // Draft phase should be sent
  const finalDraft = manager.getDraft(actorId);
  assert.equal(finalDraft?.phase, 'sent');
});

test('MW.07.02.01.01.A2: safe cancellation during recording cleanly releases audio source without sending', async t => {
  const { sessionService, manager, source, adapter } = await fixture(t);
  const { sessionKey } = await sessionService.createSession('mock.harness', '/workspace/cancel');

  await manager.startVoiceDraft(actorId, sessionKey);
  assert.equal(source.info.state, 'recording');

  // Cancel draft
  await manager.cancelVoiceDraft(actorId);
  assert.equal(source.info.state, 'idle');
  assert.equal(manager.getDraft(actorId), undefined);

  // Verify zero commands were dispatched
  assert.equal(adapter.calls.length, 0);
});

test('MW.07.02.01.01.A2: STT failure preserves error state and never sends automatically or corrupts destination', async t => {
  const { sessionService, manager, provider, adapter } = await fixture(t);
  const { sessionKey } = await sessionService.createSession('mock.harness', '/workspace/fail');

  provider.shouldFail = true;

  await manager.startVoiceDraft(actorId, sessionKey);

  // Finish recording triggers transcription failure
  await assert.rejects(
    manager.finishRecording(actorId),
    /Speech recognition failed on noise/
  );

  const draft = manager.getDraft(actorId);
  assert.ok(draft);
  assert.equal(draft.phase, 'failed');
  assert.equal(draft.destinationKey, sessionKey);
  assert.ok(draft.error?.includes('Speech recognition failed on noise'));

  // Verify zero commands were sent
  assert.equal(adapter.calls.length, 0);

  // Cannot explicitSend a failed draft
  await assert.rejects(
    manager.explicitSend(actorId),
    /Draft must be in review phase before explicit Send/
  );
});
