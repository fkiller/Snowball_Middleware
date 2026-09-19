# MW.07.01.01.01 — AudioSource와 선택형 SpeechProvider 분리 (completed)

Task status: DONE; A1 and A2 PASS.

## Implemented

- **AudioSource Contract & Registry (`packages/core/src/audio.ts`):**
  - Defines `AudioFormat` (sampleRate, channels, bitDepth, encoding: pcm/wav).
  - Defines `AudioSourceKind` (`mk20` | `host_mic` | `browser`).
  - Separates permission (`granted` | `denied` | `prompt` | `unavailable`) from source state (`idle` | `recording` | `busy` | `unavailable`).
  - `AudioSource` interface with `start(captureId)`, `stop(captureId)`, and `cancel(captureId)`.
  - `AudioSourceRegistry` for registering, listing, and switching active audio sources.

- **SpeechProvider Contract & Registry (`packages/core/src/audio.ts`):**
  - Defines `SpeechProviderKind` (`local_whisper` | `remote_worker` | `mock`).
  - Defines `SpeechProviderStatus` (`not_installed` | `ready` | `transcribing` | `error`).
  - Model lifecycle: `VoiceModelSpec` with `id`, `name`, `sizeBytes`, `language`, `isInstalled`, `path`.
  - `SpeechProvider` interface with `listModels()`, `installModel(id)`, `deleteModel(id)`, `transcribe(audio, options)`, and `cancel(captureId)`.
  - `SpeechRegistry` for registering, listing, and switching active speech providers.

- **VoiceCoordinator & AudioFault (`packages/core/src/audio.ts`):**
  - `VoiceCoordinator` orchestrates capture from active audio source and transcription via active speech provider.
  - Exposes distinct, actionable error codes:
    - `audio_source_unavailable`: No microphone/source configured or device disconnected.
    - `audio_source_permission_denied`: OS microphone permission denied (with recovery hint).
    - `audio_source_busy`: Source currently recording another capture.
    - `speech_engine_not_installed`: STT engine (e.g. faster-whisper) not installed (with recovery hint).
    - `speech_model_not_installed`: Selected voice model not installed.
    - `speech_provider_unavailable`: No speech provider configured.
    - `transcription_failed`: Speech recognition error during processing.
    - `capture_cancelled`: User cancelled voice capture.

## Evidence

Windows x64, Node 20.19.6.

- Focused `tests/audio-speech.test.mjs`: **2/2 pass**
  - `A1 acceptance`: Clean environment without Python, models, or microphone runs core safely.
  - `A2 acceptance`: Source permission denied, source busy, STT uninstalled, model install/delete lifecycle, transcription failure, and cancellation each return distinct codes and recovery hints.
- Full `npm test`: **131/131 pass** (was 129/129).
- Plan validation: 132 nodes, 28 tasks, 56 checks. **13/28 tasks done, 27/56 checks passed**.
