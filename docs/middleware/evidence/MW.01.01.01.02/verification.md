# Separate repository verification

2026-09-17, Windows x64, Node 20.19.6.

- Destination: `E:/developments/projects/Snowball_Middleware`, distinct Git root, branch `codex/local-control-core`.
- 346 exported source/test/config SHA-256 values matched both original source and destination before implementation. Original host source unchanged.
- `npm install --ignore-scripts --no-audit --no-fund`: pinned TypeScript 5.9.3, @types/node 20.19.43; lockfile generated.
- `npm run test:reference`: 44 passed, 0 failed, 0 skipped. Loopback/mock sockets only; no physical device/provider sends.
- `npm run test:reference:speech`: 2 passed using the original machine's existing `Snowball_Control/host/.venv-whisper/Scripts` on PATH, existing cached model and temporary prerecorded English fixture. None of these runtime dependencies or audio assets were exported. This is optional environmental verification, not a clean-machine speech packaging claim.
- Subsequent `npm ci --ignore-scripts --no-audit --no-fund` and build/test succeed using only the new repository dependencies for production packages.
- Production packages do not import `reference/legacy-host`. No application entrypoint/installer/tray exists yet.
- Root redistribution license is absent; public release is blocked on provenance/license review, not on local development.

Initial export script resolved one directory too high and failed before copying. Root resolution was corrected; successful inventory/export and post-copy hashes are the evidence. On Windows Node 20 the shell did not expand the test glob; the new suite uses `node --test tests` instead. No source data was lost in either failed attempt.
