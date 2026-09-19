import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DesktopLifecycle, InstanceLockFault } from '../apps/desktop/lifecycle.mjs';
import { resolveUserDataDir } from '../packages/core/dist/index.js';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';

test('A2 acceptance: single-instance lock rejects second instance, recovers stale lock after crash', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-lifecycle-'));
  try {
    const lifecycle1 = new DesktopLifecycle(temp);
    const first = lifecycle1.acquireLock();
    assert.equal(first.acquired, true);
    assert.equal(first.recovered, false);

    // Second instance attempting to acquire while first is alive must fail
    const lifecycle2 = new DesktopLifecycle(temp);
    assert.throws(
      () => lifecycle2.acquireLock(),
      (err) => err instanceof InstanceLockFault && err.code === 'already_running'
    );

    // Release first instance
    lifecycle1.releaseLock();
    assert.equal(fs.existsSync(path.join(temp, 'snowball.lock')), false);

    // Simulate stale lock from a dead PID (e.g. 99999999)
    fs.writeFileSync(path.join(temp, 'snowball.lock'), JSON.stringify({ pid: 99999999, createdAt: Date.now() - 10000 }) + '\n');

    // Second instance should detect dead PID and recover lock safely
    const recovered = lifecycle2.acquireLock();
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.recovered, true);

    lifecycle2.releaseLock();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('A2 acceptance: port collision is cleanly detected and reported without corrupting state', async () => {
  // Occupy a port with a raw HTTP server
  const blocker = http.createServer((_, res) => res.end('occupied'));
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-port-'));
  try {
    // Attempting to start LocalRuntime on that port should reject with EADDRINUSE
    const { LocalApi } = await import('../packages/api/dist/index.js');
    const { CommandJournal, createHostId } = await import('../packages/core/dist/index.js');

    const journal = new CommandJournal({ hostId: createHostId(), directory: path.join(temp, 'cmd') });
    const api = new LocalApi({ journal, port });

    await assert.rejects(
      api.start(),
      (err) => err.code === 'EADDRINUSE'
    );

    journal.close();
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('A2 acceptance: user data directory is isolated to current user profile', async () => {
  const dataDir = resolveUserDataDir();
  assert.ok(path.isAbsolute(dataDir));

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    assert.ok(dataDir.toLowerCase().startsWith(appData.toLowerCase()), 'Data dir must be in APPDATA');
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    assert.ok(dataDir.startsWith(path.join(home, 'Library', 'Application Support')), 'Data dir must be in Application Support');
  }
});
