import { EventEmitter } from 'node:events';

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  encoding: 'pcm' | 'wav';
}

export type AudioSourceKind = 'mk20' | 'host_mic' | 'browser';
export type AudioSourceState = 'idle' | 'recording' | 'busy' | 'unavailable';
export type AudioSourcePermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface AudioSourceInfo {
  id: string;
  kind: AudioSourceKind;
  label: string;
  permission: AudioSourcePermission;
  state: AudioSourceState;
  format: AudioFormat;
  reasonCode?: string;
  recoveryHint?: string;
}

export interface AudioCaptureResult {
  captureId: string;
  audioData: Buffer;
  format: AudioFormat;
  durationMs: number;
}

export interface AudioSource extends EventEmitter {
  readonly info: AudioSourceInfo;
  start(captureId: string): Promise<{ captureId: string; format: AudioFormat }>;
  stop(captureId: string): Promise<AudioCaptureResult>;
  cancel(captureId: string): Promise<void>;
}

export interface VoiceModelSpec {
  id: string;
  name: string;
  sizeBytes: number;
  language: string;
  isInstalled: boolean;
  path?: string;
}

export type SpeechProviderKind = 'local_whisper' | 'remote_worker' | 'mock';
export type SpeechProviderStatus = 'not_installed' | 'ready' | 'transcribing' | 'error';

export interface SpeechProviderInfo {
  id: string;
  kind: SpeechProviderKind;
  label: string;
  status: SpeechProviderStatus;
  models: VoiceModelSpec[];
  activeModelId?: string;
  reasonCode?: string;
  recoveryHint?: string;
}

export interface TranscribeOptions {
  language?: string;
  modelId?: string;
}

export interface TranscribeResult {
  text: string;
  language: string;
  durationMs: number;
}

export interface SpeechProvider extends EventEmitter {
  readonly info: SpeechProviderInfo;
  listModels(): Promise<VoiceModelSpec[]>;
  installModel(modelId: string): Promise<void>;
  deleteModel(modelId: string): Promise<void>;
  transcribe(audio: AudioCaptureResult, options?: TranscribeOptions): Promise<TranscribeResult>;
  cancel(captureId: string): Promise<void>;
}

export class AudioFault extends Error {
  constructor(
    public readonly code:
      | 'audio_source_permission_denied'
      | 'audio_source_unavailable'
      | 'audio_source_busy'
      | 'speech_engine_not_installed'
      | 'speech_model_not_installed'
      | 'speech_provider_unavailable'
      | 'transcription_failed'
      | 'capture_cancelled'
      | 'invalid_capture_request',
    message: string,
    public readonly recoveryHint?: string
  ) {
    super(message);
    this.name = 'AudioFault';
  }
}

export class AudioSourceRegistry extends EventEmitter {
  private sources = new Map<string, AudioSource>();
  private activeSourceId?: string;

  register(source: AudioSource): void {
    this.sources.set(source.info.id, source);
    if (!this.activeSourceId) this.activeSourceId = source.info.id;
    this.emit('changed');
  }

  unregister(id: string): void {
    this.sources.delete(id);
    if (this.activeSourceId === id) {
      this.activeSourceId = this.sources.keys().next().value;
    }
    this.emit('changed');
  }

  list(): AudioSourceInfo[] {
    return Array.from(this.sources.values()).map(s => structuredClone(s.info));
  }

  get(id: string): AudioSource | undefined {
    return this.sources.get(id);
  }

  getActive(): AudioSource | undefined {
    return this.activeSourceId ? this.sources.get(this.activeSourceId) : undefined;
  }

  setActive(id: string): void {
    if (!this.sources.has(id)) throw new AudioFault('audio_source_unavailable', `Audio source ${id} not found`);
    this.activeSourceId = id;
    this.emit('changed');
  }
}

export class SpeechRegistry extends EventEmitter {
  private providers = new Map<string, SpeechProvider>();
  private activeProviderId?: string;

  register(provider: SpeechProvider): void {
    this.providers.set(provider.info.id, provider);
    if (!this.activeProviderId) this.activeProviderId = provider.info.id;
    this.emit('changed');
  }

  unregister(id: string): void {
    this.providers.delete(id);
    if (this.activeProviderId === id) {
      this.activeProviderId = this.providers.keys().next().value;
    }
    this.emit('changed');
  }

  list(): SpeechProviderInfo[] {
    return Array.from(this.providers.values()).map(p => structuredClone(p.info));
  }

  get(id: string): SpeechProvider | undefined {
    return this.providers.get(id);
  }

  getActive(): SpeechProvider | undefined {
    return this.activeProviderId ? this.providers.get(this.activeProviderId) : undefined;
  }

  setActive(id: string): void {
    if (!this.providers.has(id)) throw new AudioFault('speech_provider_unavailable', `Speech provider ${id} not found`);
    this.activeProviderId = id;
    this.emit('changed');
  }
}

export class VoiceCoordinator extends EventEmitter {
  constructor(
    readonly sources: AudioSourceRegistry = new AudioSourceRegistry(),
    readonly speech: SpeechRegistry = new SpeechRegistry()
  ) {
    super();
  }

  async startCapture(captureId: string, sourceId?: string): Promise<{ captureId: string; format: AudioFormat }> {
    const source = sourceId ? this.sources.get(sourceId) : this.sources.getActive();
    if (!source) {
      throw new AudioFault(
        'audio_source_unavailable',
        'No audio source available',
        'Connect a microphone or select an available audio source in Settings'
      );
    }
    if (source.info.permission === 'denied') {
      throw new AudioFault(
        'audio_source_permission_denied',
        'Microphone permission denied',
        'Allow microphone access in OS privacy settings and restart the app'
      );
    }
    if (source.info.state === 'busy') {
      throw new AudioFault(
        'audio_source_busy',
        'Audio capture is already in progress',
        'Wait for current recording to finish or cancel it'
      );
    }
    return source.start(captureId);
  }

  async finishCaptureAndTranscribe(
    captureId: string,
    options?: { sourceId?: string; providerId?: string; language?: string; modelId?: string }
  ): Promise<TranscribeResult> {
    const source = options?.sourceId ? this.sources.get(options.sourceId) : this.sources.getActive();
    if (!source) throw new AudioFault('audio_source_unavailable', 'No audio source available');

    const provider = options?.providerId ? this.speech.get(options.providerId) : this.speech.getActive();
    if (!provider) {
      throw new AudioFault(
        'speech_provider_unavailable',
        'No speech provider configured',
        'Install or configure a speech provider (e.g. Local Whisper) in Settings'
      );
    }
    if (provider.info.status === 'not_installed') {
      throw new AudioFault(
        'speech_engine_not_installed',
        provider.info.label + ' engine is not installed',
        provider.info.recoveryHint || 'Install the speech engine via Settings > Voice'
      );
    }

    const audio = await source.stop(captureId);
    return provider.transcribe(audio, { language: options?.language, modelId: options?.modelId });
  }

  async cancel(captureId: string, options?: { sourceId?: string; providerId?: string }): Promise<void> {
    const source = options?.sourceId ? this.sources.get(options.sourceId) : this.sources.getActive();
    const provider = options?.providerId ? this.speech.get(options.providerId) : this.speech.getActive();
    await Promise.allSettled([
      source?.cancel(captureId),
      provider?.cancel(captureId),
    ]);
  }
}
