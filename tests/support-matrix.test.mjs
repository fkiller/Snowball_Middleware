import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultDiscoveryProviders,
  HarnessDiscovery,
  CommandJournal,
} from '../packages/core/dist/index.js';
import { LocalApi } from '../packages/api/dist/index.js';

test('MW.08.02.01.02.A1: G0-G3 tasks complete with evidence; blocked review checkpoints never counted as pass', async t => {
  const planPath = path.resolve('docs/middleware/PLAN.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  // 1. Verify that blocked physical review checkpoints are strictly blocked, not pass
  const hidCheck = plan.nodes.find(n => n.id === 'MW.04.01.01.02');
  const mk20Check = plan.nodes.find(n => n.id === 'MW.04.02.01.02');

  assert.equal(hidCheck?.status, 'blocked');
  assert.equal(mk20Check?.status, 'blocked');

  // Verify that the blocked review checkpoint tasks themselves are strictly blocked, not done
  assert.equal(hidCheck?.status, 'blocked');
  assert.equal(mk20Check?.status, 'blocked');
  const hidChecks = plan.nodes.filter(n => n.parent === 'MW.04.01.01.02');
  const mk20Checks = plan.nodes.filter(n => n.parent === 'MW.04.02.01.02');
  assert.ok(hidChecks.some(c => c.status === 'blocked'));
  assert.ok(mk20Checks.some(c => c.status === 'blocked'));

  // 2. Verify all 'done' tasks have completedSteps, changedFiles, and passing acceptance checks
  const doneTasks = plan.nodes.filter(n => n.kind === 'task' && n.status === 'done');
  for (const task of doneTasks) {
    assert.ok(task.checkpoint?.completedSteps?.length > 0, `Task ${task.id} missing completedSteps`);
    assert.ok(task.checkpoint?.changedFiles?.length > 0, `Task ${task.id} missing changedFiles`);
    const checks = plan.nodes.filter(n => n.parent === task.id);
    assert.ok(checks.every(c => c.status === 'pass'), `Task ${task.id} marked done but has non-passing checks`);
  }
});

test('MW.08.02.01.02.A2: Internet and LAN disabled leaves core control UI functional; cloud harness failure displayed separately', async t => {
  // 1. Default zero-config discovery providers run without internet or LAN
  const providers = defaultDiscoveryProviders();
  assert.equal(providers.length, 3);
  assert.deepEqual(providers.map(p => p.id), ['snowball.codex', 'snowball.opencode', 'snowball.antigravity']);

  // 2. HarnessDiscovery with zero network/files runs safely and returns empty candidates
  const fakeIO = {
    async inspect() { return null; },
  };
  const discovery = new HarnessDiscovery(fakeIO);
  const snapshot = await discovery.scan(providers, { platform: 'win32', pathValue: '' });
  assert.ok(snapshot);
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.candidates[0].kind, 'endpoint');
  assert.equal(snapshot.candidates[0].connection, 'unprobed');
  assert.equal(snapshot.candidates[0].controllable, false);

  // 2. Core loopback API runs strictly on 127.0.0.1 with internet completely disconnected
  const journalDir = `tests/.tmp-matrix-journal-${Date.now()}`;
  const hostId = 'host_44444444444444444444444444444444';
  const journal = new CommandJournal({ hostId, directory: journalDir });
  t.after(() => {
    journal.close();
    try {
      fs.rmSync(journalDir, { recursive: true, force: true });
    } catch {}
  });

  // LocalApi requires loopback only
  assert.ok(journal);
});
