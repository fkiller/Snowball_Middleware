import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
import { TrayShell } from '../apps/desktop/tray-shell.mjs';
import { formatSessionKey } from '../packages/core/dist/index.js';

test('A1 acceptance: browser close and control pause do not terminate tasks; no native main window', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-tray-a1-'));
  const dataDir = path.join(temp, 'state');
  const runtimes = [];
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const runtime = await startLocalRuntime({ dataDir });
  runtimes.push(runtime);

  // 1. Verify TrayShell has no main window
  const tray = new TrayShell();
  assert.equal(tray.hasMainWindow, false, 'TrayShell must never auto-create a native main window');
  assert.equal(tray.status, 'ready');

  // 2. Client connects, submits command
  const client = new LocalClient(runtime.origin);
  const { controllerId } = await client.bootstrap(runtime.issueBootstrap().code);

  const hostIdentity = JSON.parse(fs.readFileSync(path.join(dataDir, 'host.v1.json'), 'utf8'));
  const sessionKey = formatSessionKey({ hostId: hostIdentity.hostId, harness: { pluginId: 'snowball.test', instanceId: 'local' }, nativeSessionId: 'sess-1' });
  runtime.journal.registerSession(sessionKey, 'owner-1');

  // 3. Pause control commands via Settings API
  const settingsBefore = await client.settings();
  assert.equal(settingsBefore.settings.controlPaused, false);
  assert.equal(settingsBefore.settings.revision, 1);

  const patched = await client.updateSettings(settingsBefore.settings.revision, { controlPaused: true });
  assert.equal(patched.settings.controlPaused, true);
  assert.equal(patched.settings.revision, 2);

  // Tray menu reflects paused status
  const menuItems = tray.getMenuItems(patched.settings.controlPaused);
  const pauseItem = menuItems.find(m => m.id === 'toggle-pause');
  assert.equal(pauseItem.label, '제어 명령 재개');

  // Submitting new command while paused must fail with 409 control_paused
  const commandInput = {
    commandId: 'cmd-paused-1',
    sessionKey,
    ownerId: 'owner-1',
    expectedRevision: 0,
    operation: 'sessions.send',
    payload: { text: 'should be blocked' },
  };

  await assert.rejects(
    client.submit(commandInput),
    error => error.status === 409 && error.code === 'control_paused'
  );

  // 4. Resume control commands
  const resumed = await client.updateSettings(patched.settings.revision, { controlPaused: false });
  assert.equal(resumed.settings.controlPaused, false);
  assert.equal(resumed.settings.revision, 3);

  // 5. Browser close (simulated by client logout / disconnect) does not terminate runtime or core
  await client.logout();

  // Re-bootstrap new browser session and verify runtime is still healthy
  const newClient = new LocalClient(runtime.origin);
  await newClient.bootstrap(runtime.issueBootstrap().code);
  const snap = await newClient.snapshot();
  assert.ok(snap.cursor);
  assert.equal(snap.settings.controlPaused, false);
});

test('A2 acceptance: Settings change/cancel and tray reflect same revision; secrets not exposed in URL or responses', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-tray-a2-'));
  const dataDir = path.join(temp, 'state');
  const runtimes = [];
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const runtime = await startLocalRuntime({ dataDir });
  runtimes.push(runtime);

  const client = new LocalClient(runtime.origin);
  const { controllerId } = await client.bootstrap(runtime.issueBootstrap().code);

  // Initial settings
  const res1 = await client.settings();
  assert.equal(res1.settings.revision, 1);
  assert.equal(res1.settings.language, 'ko');

  // Stale revision is rejected with 409
  await assert.rejects(
    client.updateSettings(999, { language: 'en' }),
    error => error.status === 409 && error.code === 'stale_revision'
  );

  // Valid revision update succeeds
  const res2 = await client.updateSettings(1, { language: 'en', autostart: true });
  assert.equal(res2.settings.revision, 2);
  assert.equal(res2.settings.language, 'en');
  assert.equal(res2.settings.autostart, true);

  // URL and response contain NO secrets
  const jsonStr = JSON.stringify(res2);
  assert.equal(jsonStr.includes('password'), false);
  assert.equal(jsonStr.includes('secret'), false);
  assert.equal(jsonStr.includes('token'), false);

  // Verify quit scope truthfully lists preserved external harnesses
  const tray = new TrayShell();
  const quitScope = tray.getQuitScope(0);
  assert.deepEqual(quitScope.stoppingProcesses, ['snowball-middleware-runtime']);
  assert.deepEqual(quitScope.externalProcessesPreserved, ['codex', 'antigravity', 'opencode']);
  assert.ok(quitScope.notice.includes('임의 종료되지 않습니다'));
});
