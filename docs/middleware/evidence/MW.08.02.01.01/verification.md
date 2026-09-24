> **2026-09-21 review:** historical evidence below does not establish current task completion. Current status: blocked. See [the integrity audit](../../AUDIT.md) and PLAN.json for reopened checks, fixture limits and next actions.

# MW.08.02.01.01 — 서명·업데이트·rollback·uninstall 검증

- **Date**: 2026-09-19
- **Environment**: Windows x64, Node 20.19.6
- **Task ID**: MW.08.02.01.01
- **Scenarios**: J04, J05, J06

## 1. Implemented Components

1. **`apps/desktop/updater.mjs` (`DesktopUpdater` & `DesktopUninstaller`)**:
   - `DesktopUpdater`:
     - `verifyArtifact(artifactBuffer, expectedSha256)`: verifies SHA-256 digest before any file mutation.
     - `applyUpdate({ artifactBuffer, expectedSha256, version })`: backs up current installation before applying update; on any error, automatically triggers rollback.
     - `rollback()`: restores previous working installation from backup.
   - `DesktopUninstaller`:
     - `uninstall('keep_data')`: removes application binaries while keeping user data, secrets (`host.v1.json`, `settings.json`), and durable commands journal intact.
     - `uninstall('remove_all')`: securely zeroes out sensitive files before purging user data and deleting application directories completely.

## 2. Acceptance Verification

### MW.08.02.01.01.A1 (PASS)
- **Title**: 서명 위조/hash 불일치 artifact는 실행·설치되지 않고 이전 정상 버전으로 안전하게 유지된다.
- **Procedure**: `node --test tests/updater.test.mjs`
- **Result**:
  - Tampered/mismatched artifact rejected with `integrity_mismatch`.
  - Current installed version (v1.0.0) remains untouched and fully functional.
  - Valid update (v1.1.0) applies cleanly.
  - Rollback restores v1.0.0 from backup accurately.

### MW.08.02.01.01.A2 (PASS)
- **Title**: uninstall/clean 시 secret과 durable journal의 선택적 보존/삭제 동작을 검증한다.
- **Procedure**: `node --test tests/updater.test.mjs`
- **Result**:
  - `uninstall('keep_data')` removes binaries while preserving user secrets (`host.v1.json`) and journal log.
  - `uninstall('remove_all')` zeroes out secrets and deletes both binary and user data directories completely.
