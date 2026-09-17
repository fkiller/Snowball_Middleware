# Codex verification results — 2026-09-06

**Historical 0.71.0 results.** See [0.153.4 re-verification](CODEX_VERIFICATION_01534.md): normal completion and shared-owner multi-client streaming/cancellation now pass. Do not apply the old model/listener failures to the new binary.

Scope: actual local CLI protocol/metadata checks, then implementation-plan update and handoff. Binary: `C:/nvm4w/nodejs/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe`, codex-cli 0.71.0. No upgrade, desktop UI automation, firmware deployment or user-session resume was performed.

## Results

| Test | Actual result | Meaning |
|---|---|---|
| Host `npm run build` | PASS | Existing TypeScript compiles; not live feature completion |
| Two app-server initialization handshakes | PASS | stdio transport and native handshake usable |
| model/list | PASS: 5 entries with effort metadata | Catalog readable, not proof of account/model compatibility |
| thread/start | PASS | Native ID and thread/started received |
| Own addConversationListener | PASS | Subscription registration accepted for own loaded conversation; assistant streaming not proved |
| Other process, same home, listener | REJECTED: conversation not found | This 0.71.0 path does not attach to the other process's new session |
| Other process thread/list after turn start | PASS: target ID present | Shared history visibility is different from live subscription |
| thread/read | UNSUPPORTED: unknown variant | Implement a version gate; do not call current-doc methods blindly |
| turn/start default model | Accepted, then FAILED | gpt-6-astra requires newer CLI |
| turn/start first catalog model | Accepted, then FAILED | gpt-5.1-codex-max unsupported for this ChatGPT account |
| Read-only metadata | PASS, shape inspection | Project keys, project/thread tables, history tables exist |
| Own test rollout reader | PASS: 6 records, four record types | Disk history fallback viable for these records; streaming coverage not proved |

No successful assistant-text completion occurred. Native lifecycle/error notifications were received, but no agent-message delta was observed. Cross-process rejection was reproduced before any model turn and after turn/start acceptance; because the model failed quickly, this does NOT prove behavior throughout a sustained successful turn or for every desktop/binary version. P3 has concrete negative evidence for the tested topology. P2 shared transport, P4 actual desktop owner endpoint, P6 native Remote, approval round-trip, model/effort changes, cancellation, and audio remain unverified. P5 proves readable persisted probe records, not complete live tailing/replay.

The isolated-home list returned no thread before model turn; do not generalize this to all persisted sessions. The live thread/list query returned many records despite a cwd parameter, so the filter cannot be assumed supported in 0.71.0; enforce scope locally or via supported schema fields. Only count/membership were logged, not other users' session contents.

## Evidence and reproduction

- `codex-scope-result.json`: initial isolated-home, no-model run.
- `codex-scope-live-result.json`: existing login/default-model run with native final failure recorded.
- `codex-scope-catalog-live-result.json`: first catalog model run and final failure.
- `codex-metadata-result.json`: key names/table names/own rollout record types only.
- `../host/probes/codex-scope.cjs`: bounded probe, separate disposable workspace each run, no resume/fork of existing conversations.

From repo root, pass the actual verified absolute executable path:

```powershell
node host/probes/codex-scope.cjs <codex.exe>
node host/probes/codex-scope.cjs <codex.exe> --live
node host/probes/codex-scope.cjs <codex.exe> --live --catalog-model
```

`--live` uses the current account/home and requests one no-tools paragraph in a new disposable session. It can consume usage if the selected model works. Three live requests were made in this pass (one repeated to capture terminal failure); none completed successfully. Report files preserve the last run per mode. Probe status `pass` means that individual RPC was accepted, not successful model execution; inspect `terminal.status`. Exit zero means the probe finished collecting observations, not that all capabilities passed.

Probe-created `.probe-codex-*` folders and new test sessions are retained; no existing sessions were deleted. All spawned probe processes were closed. Original hardware/host application sources were preserved. Running the build writes host/dist. No commits made.

Sandbox initially prevented Node/npm runtime-path access and CodexBar auth discovery. Approved elevated retries ran the probe/build and metadata shape read. This was an execution-environment issue, not evidence that the account was logged out. No credentials were printed or copied. No automatic approval rejection remains unresolved.

## Implementation decisions

1. Add executable/version/schema/working-model qualification before declaring the adapter ready. Inspect the desktop's bundled binary separately; do not auto-upgrade or silently switch runtime owners. Test a supported current binary in isolation before replacing any installed CLI.
2. Keep current 0.71.0 as a limited compatibility profile: history enumeration and own-runtime lifecycle; thread/read unavailable, external listener unavailable in tested cases. Do not advertise full control from thread/list success.
3. Implement read-only metadata/history fallback with versioned schemas; map stable project/thread IDs, not display names. Do not use Remote enrollment/queue tables as a command API.
4. Repair existing adapter handshake, v2 event decoding, RPC response/request discrimination, pending-request deadlines and exact native errors. Keep requested, accepted and completed states separate.
5. Once a working model/runtime pair is established, repeat successful own-stream baseline, same-owner versus cross-owner subscription, approval and cancellation. Only then choose native owner bridge versus narrow UI fallback.
6. Leave audio as its separate capture/transcribe/review/send and TTS work package. Nothing in these tests validates external PCM input to Codex Remote.
