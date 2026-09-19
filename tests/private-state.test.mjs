import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';
import { chooseNativeWorkspace } from '../apps/supervisor/native-picker.mjs';

test('state directory is current-user private, reopens, and rejects a broadened file ACL/mode', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-private-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'private [한글]');
  assert.equal(ensurePrivateStateDirectory(directory), fs.realpathSync(directory));
  const file = path.join(directory, 'host.v1.json'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  assert.equal(ensurePrivateStateDirectory(directory), fs.realpathSync(directory));
  if (process.platform === 'win32') {
    const icacls = path.join(process.env.SystemRoot, 'System32', 'icacls.exe');
    execFileSync(icacls, [file, '/grant', '*S-1-1-0:(R)'], { windowsHide: true, stdio: 'pipe' });
  } else fs.chmodSync(file, 0o644);
  assert.throws(() => ensurePrivateStateDirectory(directory));
});
test('pre-cancelled folder selection never opens a dialog', async () => {
  await assert.rejects(chooseNativeWorkspace(AbortSignal.abort()), /cancelled/);
});
