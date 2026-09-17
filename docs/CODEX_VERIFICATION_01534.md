# Codex 0.153.4 re-verification — 2026-09-06 local date

Supersedes the 0.71.0 compatibility conclusions where explicitly tested. UTC evidence timestamps are 2026-09-07. User upgraded Codex and requested re-verification; no installation or configuration change was made here.

## Executable resolution

Bare `codex` STILL resolves through `C:/nvm4w/nodejs/codex.ps1` to 0.71.0. The upgraded binary is `C:/Users/wondo/AppData/Local/OpenAI/Codex/bin/27d6a192e9c98618/codex.exe`, verified as 0.153.4. All new live probes invoked that exact executable. Product registration must store the resolved executable and verify its version, rather than spawn a bare command or hardcode this installation-specific path.

## Actual results

| Capability | Result |
|---|---|
| Initialization, model/list | PASS; six current models and reasoning-effort metadata |
| Default model gpt-6-astra | PASS; text deltas and native completed status |
| thread/read from another process | PASS in first run; creation-time read can race empty rollout persistence |
| Legacy addConversationListener | Removed/unknown method; failure is expected compatibility evidence, not proof that pub/sub is absent |
| Independent-process immediate thread/resume | Empty-rollout error; insufficient evidence for general cross-owner support or impossibility |
| Two WebSocket clients, one NEW loopback app-server | Both connected and initialized successfully |
| Immediate same-owner resume | Empty-rollout error before first turn persisted |
| Same-owner resume after first turn completed | PASS, returned identical thread ID |
| Next turn observed by both clients | PASS, 7 agent-message deltas received by each before cancellation |
| Observer-issued turn/interrupt | PASS, both clients received native interrupted terminal status |
| Initial filtered thread/list | Returned zero while creation/history persistence was in flight; do not equate with inaccessible thread |

The decisive result is SAME OWNER, TWO CLIENTS. Client A created the test thread and produced both turns. Client B rejoined after the first completed turn and observed the second, then interrupted that exact turn. No second turn/start was issued by B. This proves shared-owner native observation and cancellation for this topology; it does not prove attaching to an arbitrary running desktop app or an unrelated app-server process.

Evidence:
- `codex-scope-0.153.4-live-result.json`: native baseline, separate processes.
- `codex-scope-0.153.4-rejoin-live-result.json`: immediate independent-process resume race.
- `codex-scope-0.153.4-shared-early-result.json`: initial shared-server race.
- `codex-scope-0.153.4-shared-live-result.json`: successful post-persistence rejoin, shared deltas and cancellation (`sharedSecondTurn`).

Four runs requested five small no-tools turns total; four completed and the final turn was intentionally interrupted after shared deltas. No existing user session was resumed. All test clients and loopback servers were stopped by the probe. Test sessions/directories are retained. No transcript output or credentials were logged; method names/counts, test IDs and errors were recorded.

## Native capabilities discovered, NOT yet live-tested

Generated experimental TypeScript schema is retained in `.probe-schema-01534/`; existing production generated types were NOT replaced.

- `thread/realtime/start`, `appendAudio`, `appendText`, `appendSpeech`, `stop`, `listVoices` exist. Audio input has data, sampleRate, numChannels, samplesPerChannel and itemId fields. This materially changes the voice investigation: try native thread realtime before selecting external STT. Codec/encoding, transcription timing, access entitlement and explicit Send semantics still need validation. Do not infer audio format from field names.
- `remoteControl/status/read`, enable/disable, pairing start/status, client list/revoke exist. These are capability evidence, not a tested MK20 client transport. No pairing was enabled or revoked.
- `thread/settings/update`, native pending-input/approval schemas and history pagination exist. Settings, approvals and reconnect replay were not exercised in this pass.
- CLI supports `app-server proxy --sock` and managed daemon commands. Their presence makes owner connection discovery a concrete next task; no existing daemon was restarted, stopped or reconfigured.

## Updated implementation sequence

1. **Executable registration + new protocol codec.** Pin a tested binary/schema combination; remove legacy listener use for 0.153.4. Generate new production bindings only as an explicit adapter migration. Keep status accepted/completed/interrupted/error distinct.
2. **Shared owner transport.** Implement connection to an existing authorized owner endpoint rather than launching one independent app-server per console. Snowball multiplexes its devices onto that owner. Use thread/resume to join only after confirming owner identity and native thread identity. Handle the observed initial persistence race with bounded retry while owner remains unchanged; no unbounded retries, silent fork, or cross-owner resume fallback.
3. **Actual desktop-owner gate.** Discover the desktop's supported control socket/daemon registration without scraping credentials. Prove the endpoint owns the selected desktop thread before attempting native attach. The shared test server is not the desktop server. If no supported endpoint exists, document that narrow gap before implementing UI fallback.
4. **Reconnect + decisions/settings.** Rejoin, reconcile history and pending requests, then test second-client approval and exact current model/effort/access behavior. Cross-device arbitration is still required even though native multiple-client control works.
5. **Native audio spike first.** Test realtime input with a known short audio fixture in a disposable thread; prove transcript review and prevention of automatic prompt handoff. Use external STT only if native audio cannot satisfy this contract. Hardware mic/speaker test follows.

## Reproduction and limits

```powershell
node host/probes/codex-scope.cjs <verified-0.153.4-codex.exe> --live
node host/probes/codex-scope.cjs <verified-0.153.4-codex.exe> --live --rejoin
node host/probes/codex-scope.cjs <verified-0.153.4-codex.exe> --live --shared
```

`--shared` creates one loopback-only server and two clients using `host/probes/ws-stdio.ps1` (.NET ClientWebSocket, no dependency installation). It intentionally probes removed legacy methods to preserve version-comparison evidence. The second turn is cancelled by B after B receives a delta. Inspect the JSON report, not process exit zero or an individual accepted RPC. The bridge is a bounded test utility, not production transport code.

Node syntax and documentation whitespace checked. Existing application code was unchanged, so the previously passing host build was not rerun. Sandbox access to the installed runtime required approved elevated execution. No unresolved approval rejection. Generated schema and disposable workspaces remain uncommitted, along with existing concurrent project changes.
