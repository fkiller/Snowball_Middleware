import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  AudioSourceRegistry,
  SpeechRegistry,
  VoiceCoordinator,
  AudioFault,
} from '../packages/core/dist/index.js';

class MockAudioSource extends EventEmitter {
  constructor(info) {
    super();
    this.info = info;
    this.started = [];
    this.stopped = [];
    this.cancelled = [];
  }
  async start(captureId) {
    this.started.push(captureId);
    return { captureId, format: this.info.format };
  }
  async stop(captureId) {
    this.stopped.push(captureId);
    return {
      captureId,
      audioData: Buffer.from('mock-audio-pcm'),
      format: this.info.format,
      durationMs: 1500,
    };
  }
  async cancel(captureId) {
    this.cancelled.push(captureId);
  }
}

class MockSpeechProvider extends EventEmitter {
  constructor(info) {
    super();
    this.info = info;
    this.transcribed = [];
    this.cancelled = [];
  }
  async listModels() {
    return this.info.models;
  }
  async installModel(modelId) {
    const model = this.info.models.find(m => m.id === modelId);
    if (!model) throw new AudioFault('speech_model_not_installed', `Model ${modelId} not found`);
    model.isInstalled = true;
  }
  async deleteModel(modelId) {
    const model = this.info.models.find(m => m.id === modelId);
    if (model) model.isInstalled = false;
  }
  async transcribe(audio, options) {
    if (this.info.status === 'error') {
      throw new AudioFault('transcription_failed', 'Speech recognition engine failed', 'Check audio input quality or retry');
    }
    this.transcribed.push({ audio, options });
    return { text: 'Transcribed voice prompt', language: options?.language || 'en', durationMs: audio.durationMs };
  }
  async cancel(captureId) {
    this.cancelled.push(captureId);
  }
}

test('A1 acceptance: clean environment without Python, models, or microphone runs core safely', async () => {
  const sources = new AudioSourceRegistry();
  const speech = new SpeechRegistry();
  const coordinator = new VoiceCoordinator(sources, speech);

  // Registries report empty without throwing
  assert.equal(sources.list().length, 0);
  assert.equal(speech.list().length, 0);
  assert.equal(sources.getActive(), undefined);
  assert.equal(speech.getActive(), undefined);

  // Attempting startCapture without an audio source throws actionable AudioFault
  await assert.rejects(
    coordinator.startCapture('cap-1'),
    (error) =>
      error instanceof AudioFault &&
      error.code === 'audio_source_unavailable' &&
      typeof error.recoveryHint === 'string'
  );

  // Attempting transcription without a speech provider throws actionable AudioFault
  await assert.rejects(
    coordinator.finishCaptureAndTranscribe('cap-1'),
    (error) =>
      error instanceof AudioFault &&
      error.code === 'audio_source_unavailable'
  );
});

test('A2 acceptance: source permission denied, STT uninstalled, failure, and cancel have distinct codes and recovery', async () => {
  const sources = new AudioSourceRegistry();
  const speech = new SpeechRegistry();
  const coordinator = new VoiceCoordinator(sources, speech);

  // 1. Source permission denied
  const deniedMic = new MockAudioSource({
    id: 'host-mic-denied',
    kind: 'host_mic',
    label: 'Host Microphone (Denied)',
    permission: 'denied',
    state: 'idle',
    format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'pcm' },
  });
  sources.register(deniedMic);

  await assert.rejects(
    coordinator.startCapture('cap-denied', 'host-mic-denied'),
    (error) =>
      error instanceof AudioFault &&
      error.code === 'audio_source_permission_denied' &&
      error.recoveryHint?.includes('OS privacy settings')
  );

  // 2. Source busy
  const busyMic = new MockAudioSource({
    id: 'host-mic-busy',
    kind: 'host_mic',
    label: 'Host Microphone (Busy)',
    permission: 'granted',
    state: 'busy',
    format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'pcm' },
  });
  sources.register(busyMic);

  await assert.rejects(
    coordinator.startCapture('cap-busy', 'host-mic-busy'),
    (error) => error instanceof AudioFault && error.code === 'audio_source_busy'
  );

  // 3. STT not installed
  const readyMic = new MockAudioSource({
    id: 'mk20-mic',
    kind: 'mk20',
    label: 'MK20 Hardware Microphone',
    permission: 'granted',
    state: 'idle',
    format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'pcm' },
  });
  sources.register(readyMic);
  sources.setActive('mk20-mic');

  const uninstalledWhisper = new MockSpeechProvider({
    id: 'local-whisper',
    kind: 'local_whisper',
    label: 'Local Whisper',
    status: 'not_installed',
    models: [
      { id: 'whisper-base', name: 'Base', sizeBytes: 145_000_000, language: 'multilingual', isInstalled: false },
      { id: 'whisper-small', name: 'Small', sizeBytes: 460_000_000, language: 'multilingual', isInstalled: false },
    ],
    recoveryHint: 'Install faster-whisper via Settings > Voice to enable on-device dictation',
  });
  speech.register(uninstalledWhisper);
  speech.setActive('local-whisper');

  await coordinator.startCapture('cap-uninstalled');
  await assert.rejects(
    coordinator.finishCaptureAndTranscribe('cap-uninstalled'),
    (error) =>
      error instanceof AudioFault &&
      error.code === 'speech_engine_not_installed' &&
      error.recoveryHint?.includes('faster-whisper')
  );

  // 4. Model lifecycle: install and delete models
  const models = await uninstalledWhisper.listModels();
  assert.equal(models.length, 2);
  assert.equal(models[0].isInstalled, false);

  await uninstalledWhisper.installModel('whisper-base');
  assert.equal(models[0].isInstalled, true);

  await uninstalledWhisper.deleteModel('whisper-base');
  assert.equal(models[0].isInstalled, false);

  // 5. Successful capture and transcription with clean separation
  uninstalledWhisper.info.status = 'ready';
  await coordinator.startCapture('cap-ok');
  assert.deepEqual(readyMic.started, ['cap-uninstalled', 'cap-ok']);

  const result = await coordinator.finishCaptureAndTranscribe('cap-ok', { language: 'ko' });
  assert.equal(result.text, 'Transcribed voice prompt');
  assert.equal(result.language, 'ko');
  assert.deepEqual(readyMic.stopped, ['cap-ok']);
  assert.equal(uninstalledWhisper.transcribed.length, 1);

  // 6. Cancellation propagation
  await coordinator.cancel('cap-cancel');
  assert.deepEqual(readyMic.cancelled, ['cap-cancel']);
  assert.deepEqual(uninstalledWhisper.cancelled, ['cap-cancel']);

  // 7. Transcription failure
  uninstalledWhisper.info.status = 'error';
  await coordinator.startCapture('cap-fail');
  await assert.rejects(
    coordinator.finishCaptureAndTranscribe('cap-fail'),
    (error) => error instanceof AudioFault && error.code === 'transcription_failed'
  );
});
