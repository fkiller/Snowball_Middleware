# Voice input and shared speech services

## Current decision — 2026-09-13

The user discontinued the Codex-app audio route. The active MVP is **MK20 microphone → local Whisper → reviewed text draft → explicit Send → Codex integration**. Whisper is STT, not TTS. Codex-app dictation qualification, virtual microphone installation and app-owned audio bridging below are historical research, not next actions. TTS is outside the current MVP; the inactive Speak button is disabled.

`host/src/index.ts` already uses `LocalWhisperProvider`; its default is Whisper `base` with a resident CPU/int8 worker. This is an implementation baseline, not a claim of best Korean recognition. Do not install new models as part of this decision. Preserve explicit Send, destination binding, cancellation generations, and no automatic replay of uncertain submissions. The current Talk-replace flow discards the review draft; undo/editing remains a planned improvement.

The authoritative delivery sequence and implementation gaps are in [Codex MVP state audit and plan](CODEX_MVP_PLAN_2026-09-13.md). Shared GPU speech routing, authenticated pairing and other harness expansion follow the single-host Codex MVP. Existing UDP/ADB and mesh code are development infrastructure, not completed secure pairing. The rest of this document preserves the older design for reference; its native-first priority and acceptance ordering are superseded.

Decision/specification, 2026-09-07. This overrides generic STT choices in earlier plans. Implementation is not complete. Read [review](REVIEW_2026-09-07.md) and [native evidence](CODEX_DICTATION_2026-09-07.md).

## Product contract

The primary experience is **MK20 microphone → Codex's own dictation → editable draft → explicit Send**. Conversational Realtime voice is a different feature. Do not send automatically when speech ends, a transcript arrives, a connection returns, or a fallback succeeds. A question answer draft is bound to its question ID, not dispatched as a new prompt.

Separate three identities: capture device, transcription service host, and execution destination `{hostId, harnessId, projectId, sessionId, ownerId}`. The transcription host needs audio, language hints and optional user-approved vocabulary; it does not need repository access, Codex credentials or command authority. Changing the selected machine must never redirect an existing draft.

Five machines all run the small middleware; **zero models are bundled by default**. One chosen GPU machine may run the shared speech worker for all five. A second, explicitly selected CPU host can provide offline fallback. No five-way model installation, mandatory coordinator, or inference on MK20.

## Native route: qualification order

1. **App-owned dictation bridge**: seek an authenticated, supported extension/IPC interface accepting an audio source and returning a draft. Installed app code proves a separate PCM dictation protocol exists, not that an external interface is supported. Keep credentials and upstream connection in the app. Test availability in the installed version, including feature flags; no assumption of a public endpoint from a string in a bundle.
2. **Native microphone bridge**: stream MK20 PCM to a host virtual microphone, select that input through ordinary app settings, trigger composer dictation through the configured shortcut/UI, stop in INSERT mode, read the resulting composer through accessibility or an authenticated browser surface. Mirror it into MK20. This reuses the user's actual app login and recognizer without copying tokens. Validate Windows and macOS separately. A virtual audio driver is an explicit setup dependency, not secretly installed. Restore the previous input when disconnecting. Do not use loudspeaker-to-microphone acoustic loopback.
3. **Authenticated web dictation bridge**: if the selected browser surface actually exposes dictation, use its ordinary microphone permission and the same virtual input. An isolated test browser with a prerecorded microphone fixture can test capture deterministically. Merely injecting a MediaStream into a test page does not prove ChatGPT compatibility. A page without dictation is unsupported; no universal web/Remote feature assumption. Read the draft without Send, confirm account and destination before Send.
4. **Private protocol feasibility experiment**: the observed desktop protocol is useful to characterize PCM and transcript revisions, but is not a shipping dependency yet. No credential extraction, bearer replay from auth.json, manufactured internal tool contexts, patched app bundle, or global browser monkey-patch. Promote a direct adapter only after a legitimate app-owned authorization and compatibility mechanism is established. Otherwise choose the microphone bridge or shared local worker.

Codex Micro demonstrates separate dictation and Send controls, but uses the computer's microphone; it is not evidence of an external PCM ingestion API. Do not impersonate its device identity. [Official behavior](https://learn.chatgpt.com/docs/features/codex-micro).

Native availability is per service host/account/app version. An open, authenticated desktop may provide native dictation for a task on a different execution machine, if draft/destination correlation passes. Headless CLI hosts must not advertise native dictation just because Codex is installed.

## Discovery, enrollment and routing: direct pairing, no peer mesh

Choose **MK20 pairs once with each host**. Five enrollments are reasonable and have a clear trust boundary. Each host advertises `_snowball._tcp` with instance ID, protocol version and enrollment availability. mDNS is a location hint, never authorization. Also provide manual address/QR and existing VPN address; discovery does not cross subnets automatically.

First enrollment: host user selects Add device and MK20 selects the discovered host; compare a short code derived from the ephemeral key exchange on both screens and confirm locally. Use an audited PAKE/enrollment implementation or physically authenticated USB exchange, not a homegrown cipher or transmitted PIN. Enrollment pins device and host public keys. Normal traffic uses TLS 1.3 mutual authentication; persist private keys in protected OS storage and device storage, scoped pairing grants separately. Validate MK20 TLS/RNG/storage before claiming this gate complete. Revoking a device closes its connections and invalidates its speech grants.

The MK20 owns its paired-host roster. It keeps a control connection to the execution host and, while recording, a separate audio connection **directly to the chosen speech host**. Hosts need not discover, trust or relay through each other. This eliminates a coordinator failure and unnecessary execution-host → GPU-host forwarding. Advertise candidates via mDNS, then fetch actual capabilities only after authenticated pairing. Keep two connections initially; probe other paired hosts on demand with a short timeout instead of opening a permanent connection to every host.

Speech metadata: `hostId, providerId, backendVersion, languages, modelsInstalled, readiness, estimatedStartMs, freeMemory, maxDurationMs, capacity, observedAt`. Filter by enrollment permission and provider policy before latency. Selected execution host is not automatically the speech host. Store preferred speech host/provider on MK20; save installation settings only on the machine that owns the worker. mDNS records cannot claim entitlement or trigger model installation.

LAN MVP first; remote access uses the user's existing VPN/tunnel and enrolled identity. No public unauthenticated audio endpoint. If later relay is necessary, add a short-lived single-job delegated grant binding device, audio hash/job, speech host, expiry and permitted operation; do not add transitive trust now.

## Smooth setup and fallback journeys

| Journey | Expected behavior |
|---|---|
| First machine paired | Machine appears with harness/project/session defaults; Speech setup offers native dictation qualification first. No model download to complete pairing. |
| Five machines paired, one 8GB GPU | Settings → Voice lists eligible hosts and recommends the GPU host based on measured free memory, driver support and availability. User chooses “Install shared speech on Workstation”; show download size, disk/RAM/VRAM separately. Other four machines stay model-free. |
| Install on chosen host | Host downloads pinned worker/model manifests with checksums, verifies runtime support, warms model, runs a short microphone test and advertises ready. Restart, retry and uninstall are host-local. Do not require WSL/Docker on every PC. |
| User selects a weak execution machine | The same preferred transcription host processes audio; only reviewed text goes to the selected task. Small status label shows “Voice: Workstation”. |
| GPU host sleeps or is busy | Try another previously enabled native/local service according to configured policy; then an installed CPU fallback. Show the change once. Never automatically install or switch to paid cloud. |
| No fallback installed | Keep the recording/draft and offer “Set up offline fallback on this computer” in companion settings, or retry later. Do not display an error sentence as sendable transcript. |
| All services absent | Offer available OS dictation on an interactive companion or typed draft input. Availability, microphone routing and Korean support must pass platform checks. Otherwise show unavailable and retain explicit control. |
| Second MK20 records concurrently | Worker reserves capacity by job; bounded queue or busy response, no shared file/PID. Agent Stop remains responsive. |

Default priority: qualified native dictation → preferred shared GPU worker → other user-enabled local service → installed CPU worker → qualified OS dictation. Paid API is a separate opt-in provider, never inferred from an environment variable. User may pin a provider or choose local-only. Retrying a failed native cloud route on local processing is allowed only under the configured fallback policy.

## Model selection: benchmark before claiming best recognition

GPU baseline candidate: **faster-whisper with Whisper large-v3**, batch 1, test int8_float16 and FP16 with memory headroom. Compare **large-v3-turbo** for latency and **Qwen3-ASR-1.7B** for mixed-language accuracy. Do not promise all fit with other GPU applications: measure peak VRAM at the supported utterance length. A resident Python/CTranslate2 worker is suitable for the Windows NVIDIA baseline; supervisor is still TypeScript. Mac option: whisper.cpp with Metal, separately qualified; do not require CUDA on Mac.

CPU fallback candidate: **Whisper small multilingual, quantized**, whisper.cpp on Windows/macOS or faster-whisper int8 where packaging is qualified. Target total worker RSS around 2GB; file size is not runtime memory. Never silently select an English-only `.en` model or the first alphabetically named model file. If measured RSS exceeds the budget, evaluate multilingual base with a visibly lower-quality label. OS legacy SAPI is not equivalent to modern Windows dictation and is not a proven bilingual engine.

Published faster-whisper measurements include large-v2 FP16 at 4525MB VRAM and small CPU int8 at 1477MB RAM; these justify testing, not a large-v3 or Korean quality guarantee. [Maintainer benchmarks](https://github.com/SYSTRAN/faster-whisper). [whisper.cpp platforms/quantization](https://github.com/ggml-org/whisper.cpp). [Turbo model](https://huggingface.co/openai/whisper-large-v3-turbo). Qwen lists Korean and English, with streaming support; memory and Korean-English coding accuracy on our hardware remain unmeasured. [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR).

Benchmark a consented set of at least 60 short/long MK20 recordings: Korean, English, intra-sentence switching, filenames, camelCase, CLI flags, numbers, negations, noise and silence. Preserve language rather than translate. Report Korean CER, English WER, exact technical-token/number/negation accuracy, user corrections, hallucinations on silence, cold/warm stop-to-final p50/p95, real-time factor, peak RAM/VRAM and install size. Test 8GB under competing GPU load and CPU fallback. Choose accuracy first among feasible candidates, then latency; do not infer the best model from English benchmark speed. Target warm stop-to-draft p95 ≤2s for a 10s utterance as a design goal, not a current measurement.

## Middleware modules and contracts

Implement under existing `host/src/` conventions; paths below are proposed modules, not files already delivered:

- `pairing/registry.ts`, `transport/secure.ts`: enrollment, pinned identities, revocation, authenticated control/audio channels. Preserve UDP/ADB only as explicit development transports.
- `audio/capture.ts`: recordingId-owned capture, PCM framing, bounded buffer, start/stop acknowledgement, maximum duration, no global killall. Parse WAV chunks for legacy capture; do not patch fixed offsets blindly.
- `audio/providers/native-dictation.ts`: start/stop-insert/cancel/draft callbacks, account and composer checks, capability unavailable when the app bridge cannot operate.
- `audio/service.ts`, `audio/router.ts`: capability query, provider reservation, health/deadline, policy and per-recording provider pinning. Runs on the device-connected host only for companion operations; MK20 initiates direct speech routing using the same policy/manifest semantics.
- `audio/providers/worker.ts`: supervised, optional inference process; pinned model manifest, crash recovery, memory budget, bounded queue; worker communicates over loopback/private pipe, never an unauthenticated public model port.
- `audio/draft.ts`: destination snapshot, draft revision, editing/undo, cancellation generation, submission/outcome tracking. UI reducer mirrors this state instead of scattered booleans.
- `setup/speech.ts`: probe capabilities without installing, explicit per-host install, verification/warmup, versioned capabilities and uninstall.

Proposed product protocol (version separately from current UDP lab wire format):

1. `speech.reserve {recordingId, providerPolicy, pcmFormat, maxDurationMs}` → service accepts provider/version and expiry before capture.
2. Separate audio channel: `{recordingId, sequence, sampleOffset}` plus binary PCM16LE mono; initial 16kHz MK20 format, negotiate/resample once if native path requires another rate. Start with 40ms frames and bounded backpressure; tune by measurement. Keep control/Stop independent of audio.
3. `speech.finish {recordingId, lastSequence}` drains acknowledged audio; `speech.cancel` invalidates job generation. Return `partial/final/error {recordingId, utteranceId, revision, providerId}`. Deduplicate sequence/revisions. Session-close is not necessarily transcript-final.
4. `draft.update {draftId, expectedRevision, edit}`; `draft.submit {commandId, draftId, expectedRevision, destination}` only after explicit press. Preserve until owner acknowledgement. On ambiguous send, mark unknown and reconcile; never replay through a different CLI owner.

Pin provider for an utterance. Keep one bounded audio buffer for retry with user-configured retention; replay the entire utterance on failover, replace tentative transcript rather than concatenate different engines. Ignore late results from cancelled/old generations. Retry transcription cannot retry agent submission. Set provisional capture limit 120s, buffer ≈3.84MB at 16kHz mono PCM16; test MK20 memory and native segmentation. Native bundle's 30s utterance and 5min session values are observations, not Snowball guarantees. Long captures need deliberate segmentation and final ordering tests.

Draft UX: top display shows destination, scrollable text, provider/error status. Bottom row remains Talk/Re-record, Edit, Cancel, Send as applicable; Send disabled until nonempty final/editable text. Left knob scrolls transcript or edit targets, right knob remains volume/mute. Edit opens a modal for select segment → replace by dictation, delete, undo; companion keyboard provides full text editing. Re-record creates an undoable replacement, not immediate draft loss. Focus following pauses while a draft is active. Allow browsing elsewhere but keep destination badge and require explicit draft move before any target change. Workspace/Settings preserve the draft and their established full-screen modal behavior.

## Ordered acceptance gates

1. Repair owner/destination identity, false send/stop success and draft races listed in review before another live prompt test.
2. Qualify native dictation in a disposable task using a known Korean-English audio fixture. Prove capture → final draft, no agent turn before Send, edits preserved, correct host/session, cancel/timeout/retry, and no token exposure. Test app-owned interface first; if unavailable, virtual microphone + ordinary UI. Record app version and actual runtime evidence.
3. Implement two-host authenticated enrollment and direct audio service discovery; then exercise five-host roster and revocation.
4. Compare candidate models on the selected 8GB host; install only there. Qualify an optional CPU host and package separately.
5. Five-host journey: task on A, speech on D, D disappears before/mid capture, fallback to E, late D result ignored, draft reviewed/edited, one acknowledged submission to A. Repeat with two MK20 devices and Stop during audio transfer.

This review adds the design and static evidence. It does not install drivers/models, record a new utterance, qualify native audio round-trip, or claim middleware deployment complete.
