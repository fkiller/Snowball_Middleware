# Codex capability and verification plan

**Windows PoC follow-up:** [Native dictation pad](../host/poc/native-dictation/README.md) builds/runs. During user Start/Stop testing, a Korean-English transcript appeared in this separate app through native global dictation (1.7s UI Stop-to-change in one run). This validates a practical normal-UI reuse route to the observed extent; it does not validate direct external PCM, MK20 audio routing, or a public dictation API.


## Current correction and implementation order (2026-09-07)

Read [external progress review](REVIEW_2026-09-07.md), [native dictation evidence](CODEX_DICTATION_2026-09-07.md), and [voice implementation design](VOICE_ARCHITECTURE.md) first. Installed desktop 26.901.6511.0 contains a ChatGPT-authenticated PCM dictation stream with separate draft-insert/send paths. The CLI Realtime API-key rejection does not rule this out. External access is still unverified. Current named-pipe tool calls do not prove desktop-owner pub/sub or an audio API. Preserve version-specific same-owner results below.

Priority now: repair destination/owner, acknowledgement and cancellation defects → native dictation fixture through app-owned interface or virtual microphone/UI → authenticated direct pairing and separate speech-host routing → one selected GPU worker, optional CPU fallback → bilingual and five-host acceptance. Do not silently choose Whisper/API cloud based on an environment key. Do not replay an uncertain desktop send through an independent CLI runtime. Model/Effort/Access, focus, approvals and live desktop events still need owner-specific verification.

## Latest verified baseline: 0.153.4

[Upgraded verification](CODEX_VERIFICATION_01534.md) supersedes the older update below. Default-model completion and SAME-OWNER two-client deltas/cancellation now pass. Bare PATH still resolves to 0.71.0; register an explicit tested binary. Legacy addConversationListener is removed; use the new schema and verified owner-rejoin path, handling the observed empty-rollout creation race. Existing desktop-owner attachment remains unverified. Native thread realtime/audio and Remote Control methods are present in generated schema, so test native audio/owner connection before choosing external STT or desktop UI automation. Updated order: binary/schema migration → shared owner transport → actual desktop-owner gate → reconnect/decisions/settings → native audio spike.

## Verified update (2026-09-06)

See [actual results](CODEX_VERIFICATION.md) and JSON evidence. 0.71.0 passed handshake/model catalog/new thread/own listener registration. Another process could list the started test thread but could not subscribe (conversation not found); thread/read is unsupported. Model calls were accepted then failed: configured default requires newer CLI, first advertised model is unsupported for this account. No successful assistant stream or approval/cancel loop is claimed. Read-only metadata tables and the test's persisted rollout were inspected successfully. Host build passed.

Updated exact order: (1) qualify an executable/schema/model combination, including separately inventorying desktop binary; (2) fix native codec and error handling; (3) repeat P1–P4 with a successful turn; (4) implement metadata/history fallback; (5) settings/focus and voice. Existing UI-bridge alternatives remain conditional. Do not treat remote pub/sub as universally impossible based on the old CLI result. Detailed unverified cases and reproduction commands are in CODEX_VERIFICATION.md.

2026-09-06. Overrides the earlier decision to make a desktop UI bridge the primary existing-session connection. First combine Remote's proven product behavior, native CLI/app-server capabilities, and read-only local metadata. Adopt UI automation only for gaps left after native verification.

## Evidence levels

- **Product confirmed:** user confirms Remote offers machine/project/session navigation, voice, Files/Git, Model/Effort and Access. This is our functional reference, not a claim that Snowball has connected to its transport.
- **Interface confirmed:** official protocol or locally generated types contain a mechanism. This does not mean cross-process behavior or current adapter implementation has passed a live test.
- **Integration verified:** a recorded end-to-end test passes on a named version and owner topology. No new live provider test was run for this plan. Do not promote schema presence to this level.

## Capability classification

| Feature | Already established | Verification needed | Snowball implementation |
|---|---|---|---|
| Machines/projects | Remote product behavior; local Codex state directory exists | Desktop saved project registry versus CLI cwd-derived projects; remote host identity mapping | Host registry + versioned metadata reader; keep saved projects distinct from inferred cwd entries |
| Session enumeration | Local ClientRequest includes thread/list | Pagination, archived state, worktrees, desktop-created sessions, version mismatch | Native list first, local index reconciliation second |
| Historical content | Local sessions, archived_sessions, session_index.jsonl and SQLite stores exist; current docs offer thread/read | Actual schema, completeness, current version support, concurrent writes | Read-only HistoryReader with coverage and freshness; never resume just to view |
| New session/text prompt | Local generated thread/start and turn/start types | Round-trip, errors, exact selected project, duplicate suppression | Repair existing adapter and preserve returned session/turn IDs |
| Live output of our runtime | Protocol notifications exist | Delta order, tool events, reconnect, final state | Native EventReducer + snapshot reconciliation |
| Live output of another runtime | Remote demonstrates product capability; local legacy addConversationListener exists | Whether listener attaches across processes, only loaded conversations, or shared owner; pending decision delivery | Cross-owner experiments below before selecting transport |
| Control another active session | Remote demonstrates product capability | Send/steer/interrupt authorization, owner routing and concurrent clients | Same-owner bridge if proven; no silent second-runtime resume |
| Model/Effort | Local model/list and turn overrides are typed | Effective versus requested value; per-session timing; desktop synchronization | Capability-driven selector, apply next turn when required |
| Access/approval | Generated approval/sandbox types and server approval requests exist | Round-trip, native enforcement, external session request ownership | Native decision response; separate approval policy from sandbox |
| Files/Git | User-confirmed Remote/CLI capability; local filesystem/Git are available | Root/worktree mapping, cloud/local distinction, file revision | Host filesystem reader and argument-array Git commands; no model call for basic navigation |
| Desktop-selected session | Remote has a selected session UI | Whether metadata/protocol exposes actual foreground selection | FocusProvider; never derive focus from activity or latest transcript |
| Voice input | User confirms Remote voice works | Reusable supported audio interface, host/device capture path | Audio pipeline below; Remote's microphone UI is not automatically a PCM endpoint |
| Speak/volume/mute | Required product behavior | MK20 speaker/capture, backend latency and echo | Host TTS + device-local playback/volume/mute |

The official app-server distinguishes reading stored history from loading/subscribing a runtime. Treat that separation as fundamental. [Protocol reference](https://learn.chatgpt.com/docs/app-server). Remote is the behavioral reference for connected-host operation. [Remote documentation](https://learn.chatgpt.com/docs/remote-connections).

## Read-only ~/.codex integration

Honor each instance's CODEX_HOME; do not assume every binary uses the default folder. Local inventory confirmed sessions, archived_sessions, config.toml, session_index.jsonl, models_cache.json, .codex-global-state.json, state_5.sqlite and thread_history_1.sqlite. Presence was checked; schemas and meanings have not yet been verified. Do not treat filenames/version suffixes as a stable API.

Build a versioned MetadataReader returning source, observedAt, schema fingerprint, and coverage. Prefer native results; local records fill history/index gaps rather than override authoritative live state. Parse only allowlisted fields. Exclude auth.json, credential values, cookies and transcription history from enumeration or logging. Cached model/config values are hints, not proof of the session's effective settings.

JSONL reader: retain file identity and byte offset, hold incomplete trailing lines, deduplicate native IDs, detect truncation/rotation, then rescan. Watch notifications are hints; periodically reconcile. SQLite: open read-only with a short consistent transaction and WAL-aware SQLite access; do not copy only a live database file or use immutable mode against a changing WAL database. Never mutate Codex databases, queues, writer locks or config to inject a command. Local files are an observation channel, not a control bus.

Persist Snowball's own cursors and remembered selections in its separate store. Test field availability with redacted schema/record-shape fixtures; do not copy users' transcripts into this repository. A rollout tail may provide delayed text observation, not complete approvals, subscriptions or exactly-once events.

## Highest-priority experiment: another session's pub/sub

Use disposable sessions and a harmless deterministic turn. Do not use the current user conversation as the experiment. Record binary path/version, owner PID, CODEX_HOME, native thread/turn ID, connection ID and timestamps. Do not modify existing installed versions as part of discovery.

| Case | Producer and observer | What it distinguishes |
|---|---|---|
| P1 | Snowball-owned app-server, its original client | Baseline event codec and approval round-trip |
| P2 | Two clients attached to the SAME server, if supported by that version | Shared-owner subscriptions and response arbitration |
| P3 | Two independent app-server processes with the same home; A runs, B observes | Cross-process subscription versus merely shared disk history |
| P4 | Existing desktop owns session; observer uses its supported local endpoint if discoverable | Actual desktop attachment, not a duplicate runtime |
| P5 | Desktop or CLI owns session; read-only rollout/index watcher observes | Fallback coverage and latency without native pub/sub |
| P6 | Native Remote client and desktop show the same session | Product reference: selection, live events, approval resolution and timing |

For each case observe text deltas, tool lifecycle, pending approvals/questions, completion and cancellation. Then disconnect/reconnect the observer and change the producer's selected UI session. Confirm producer PID/turn continues unchanged and no second execution started. Separately test writes only after observation succeeds: prompt/steer, native approval response, exact-turn stop. Assert that a decision resolved by one client disappears or is rejected on another.

Important probe: local generated ClientRequest includes addConversationListener(conversationId, experimentalRawEvents). Test its actual process scope; its name does not prove cross-process access. Likewise do not call thread/resume during an observation-only test. Current documentation methods absent from the old installed schema need their own version gate.

Pass criteria: stable IDs, no unintended resume/fork/second execution, correct event ownership, measured event coverage/latency, and no replayed command after reconnect. Classify separately as historyRead, liveText, liveTools, pendingDecisions, send, steer, interrupt and selectedUiSession. A single boolean 'attached' conceals essential gaps.

Decision after experiments: supported owner endpoint first; shared runtime only where clients can explicitly attach; read-only local watcher for observation gaps; OS accessibility for selected UI/remaining visible actions only if required. Remote transport reuse is an investigation of supported extension/endpoint options, not cookie extraction or assumed public API. If no verified owner route exists, retain view-only external sessions rather than pretending history resume is attachment.

## Voice: reuse text control, implement the missing audio path

First investigate whether the chosen installed Codex interface exposes a supported transcription/audio input that accepts external audio and returns a reviewable transcript. Presence of audio-related files or Remote dictation does not establish that interface. Avoid using full conversational voice mode if it bypasses explicit transcript review and Send.

Baseline implementation independent of that outcome:

```text
MK20 mic -> authenticated audio stream -> host SpeechInput
        -> partial/final transcript -> destination-bound draft
        -> user Send -> existing Codex text operation
assistant text -> host SpeechOutput -> MK20 playback
```

Define SpeechInput.start/append/finish/cancel and SpeechOutput.speak/stop. Choose the concrete STT backend with a measured bakeoff: supported Codex transcription when available, otherwise a separate local engine or explicitly configured cloud speech service. Separate cloud credentials/billing from the Codex subscription; do not assume it covers API audio. Use push-to-talk initially, no automatic turn submission. Preserve draft destination across context changes. Question dictation resolves that question rather than creating a normal prompt.

Hardware gate: record/play a short clip, verify actual sample format, packet loss, mic gain, volume/mute and echo behavior. Compare Korean/English mixed coding phrases, file paths and identifier transcription; measure capture-to-partial, release-to-final, first playback and local stop. Keep control traffic ahead of audio. These are new Snowball integration responsibilities even though Remote already has voice.

## Work packages and deliverables

1. **Evidence inventory:** executable versions (PATH and desktop separately), homes and safe schemas; produce a capability report with provenance, not account contents.
2. **Native baseline:** repair handshake/RPC dispatch/approval/turn-ID issues documented in HARNESS_CONNECTIONS.md; fixture tests plus a disposable-session round-trip. Do not label existing scripts as successful solely on a response ID.
3. **Pub/sub matrix P1–P6:** highest architectural priority. Publish evidence per operation and choose owner connection route. This precedes committing to a full desktop UI automation implementation.
4. **MetadataReader + Files/Git:** enumerate and read while another process writes; verify rename/rotation/WAL, pagination, root mapping and archive behavior. File list/read and git status/diff use bounded host operations, not shell text composed from user input.
5. **Settings and focus:** test model/effort/access in owned and external sessions independently. Confirm native effective values and distinguish UI selection from runtime activity.
6. **SpeechInput/SpeechOutput:** backend spike and MK20 audio loop with transcript review, explicit send, context changes and disconnect tests.
7. **Multi-device integration:** authenticated registrations, controller lease, late approval, duplicate sends, restart reconciliation; then hardware acceptance.

Implement modules under the existing host project: codex capability probe/codec, codex metadata reader, session event reducer, focus provider, workspace service and speech providers. Keep endpoint choices replaceable behind an instance contract. This planning pass changed documentation only; it did not establish new live integration results.
