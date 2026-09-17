# Codex desktop dictation: static verification

## Windows PoC follow-up

A runnable [native dictation pad](../host/poc/native-dictation/README.md) now exists. Windows Settings exposes global dictation; configured Ctrl+Alt+Shift+F9 via ordinary UI, previously Off. PoC builds and launches, and focuses its own text editor before invoking this shortcut. During a user-driven Start/Stop test, Korean-English test text appeared in the external pad; its Stop-to-text-change display showed 1.7s. This is one observed UI run, not a provider latency/accuracy benchmark; direct MK20 PCM ingestion remains unverified. This is a normal app UX bridge, not a new public PCM endpoint or credential-based protocol client.


2026-09-07. **Found a separate native dictation route. External MK20 ingestion has NOT passed a live round-trip.** This corrects the previous conclusion that CLI Realtime API-key rejection forces external STT.

## Evidence and scope

Read the installed application archive only: `C:\Program Files\WindowsApps\OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0\app\resources\app.asar`. No account secrets, browser cookies or authentication files were read. No upstream request, app modification, new recording or prompt was made. The archive is an installed client implementation, not a public extension API contract.

Reproducible static inventory: `host/probes/inspect-desktop-dictation.py`; machine-readable result: [codex-dictation-static.json](codex-dictation-static.json). It stores module hashes and symbol offsets, not bundled application code or credentials. Initial broad inspection hit a Windows stdout encoding error; UTF-8 and targeted module inspection resolved it.

## What the installed code establishes

| Component | Observed behavior | Meaning for Snowball |
|---|---|---|
| Main module `main-DpnWwRdP.js` | Special internal `/codex/dictation-stream-connect-info` handler obtains a token from the app connection and requires ChatGPT sign-in; constructs a WebSocket URL ending `/dictation/stream` | First-party dictation has an app-managed authentication path distinct from the failed CLI API-key Realtime probe. Does not prove subscription entitlement or external reuse. |
| Same handler | Uses `chatgpt-dictation`, an `openai-bearer.` protocol prefix and `codex-desktop` | Keep credentials with the app; never log protocols from a live connection. Do not implement bearer copying as enrollment. |
| `app-initial-f87238153a19.js`, `pRs` | `session.start`: PCM16, mono, negotiated sample rate; segment or final-only delivery, server VAD | Native input really is audio, not only text submission. |
| Same module, `appendPCM16` | `audio.append` carries encoded PCM bytes; startup audio is buffered | A PCM stream adapter is technically plausible, but external authenticated entry point remains unproven. |
| Same module, `finish` | Sends `session.close`, waits with a bounded closing timeout | Stop-recording and completed transcript are separate states. |
| Same module, transcript reducer | Utterance IDs, revisions, segment and final events; final replaces partial | Preserve revisions and final ordering; do not append every event blindly. |
| `dictation-audio-worklet-1eeea41db57c.js` | Collects first-channel Float32 samples in 2048-sample blocks, flushes on stop | Existing native capture is microphone/AudioWorklet based; source is converted to PCM16 by the stream client. |
| `app-primary-428a0a65766f.js`, `_pr` | Separate `onDictationTranscriptInsert` and `onDictationTranscriptSend`; hold-release path uses insert | Snowball must choose draft insertion, never the transcribe-and-send action. |

Observed client configuration includes 4MiB buffer, 30s maximum utterance, 5min session TTL, 10s startup and 8s closing timeout. These are version-specific client settings, not measured service limits or an external API SLA. Ordinary microphone preference and global dictation shortcut definitions also exist. Actual feature availability can be gated.

## Classification and next experiment

- **Verified statically:** dedicated native audio protocol, app authentication ownership, transcript revision handling and insert/send separation.
- **Previously verified separately:** one CLI `thread/realtime/start` route rejected the tested auth configuration. That does not characterize desktop dictation.
- **Needs live verification:** authorized external entry, virtual-input capture, bilingual recognition, transcript extraction/edit preservation, app focus/account correlation, Remote browser availability, stream cancellation/reconnect and long utterances.
- **New implementation needed:** MK20 live PCM transport, speech-provider capability/selection, draft state machine, shared worker enrollment and setup, fallback routing.

Next run a disposable-draft probe through an available app-owned interface; if no such interface is exposed, route a known recording through a virtual microphone and ordinary composer dictation. Stop in insert mode, compare draft with fixture, edit a token, verify no turn started, and send only in the designated disposable task. Do not probe a private upstream endpoint by extracting a login token. The current private `codex-browser-use-*` tool pipe is not established as an audio API.

Official documentation independently distinguishes conversational Voice from dictation-before-send. [OpenAI voice documentation](https://learn.chatgpt.com/docs/features/voice). Codex Micro's default microphone control also produces a ready prompt followed by a separate Send action, but uses the PC microphone rather than onboard audio. [Codex Micro](https://learn.chatgpt.com/docs/features/codex-micro). These corroborate UX, not a public Snowball integration interface.

User acceptance: the user explicitly confirmed the Windows native-dictation PoC works after the observed Korean-English run (2026-09-07). External-app dictation via the normal global shortcut is now user-verified; direct MK20 PCM and broader robustness remain separate gates.
