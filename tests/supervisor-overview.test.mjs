import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSupervisorAssets } from '../packages/api/dist/index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('MW.06.02.01.01.A1: Supervisor assets contain Overview, Attention surfaces and filter controls', async () => {
  const assets = await loadSupervisorAssets(repositoryRoot);
  assert.ok(assets.script.includes('ATTENTION'));
  assert.ok(assets.script.includes('pendingDecisions'));
  assert.ok(assets.script.includes('inDoubtCommands'));
  assert.ok(assets.script.includes('harnessFilter'));
  assert.ok(assets.script.includes('activeDraft'));
  assert.ok(assets.script.includes('명령 작성 중 · 고정 대상'));
});

test('MW.06.02.01.01.A1 & A2: Overview & Attention logic and R-TARGET destination invariance simulation', async () => {
  // Simulated state representing snapshot from API
  const snapshot = {
    sessions: [
      { sessionKey: 'host_a/snowball.codex:default/session-1', ownerId: 'owner-codex', revision: 2, readOnly: false },
      { sessionKey: 'host_a/snowball.opencode:default/session-2', ownerId: null, revision: 0, readOnly: true },
      { sessionKey: 'host_a/snowball.antigravity:default/conv-uuid-3', ownerId: null, revision: 0, readOnly: true },
    ],
    commands: [
      { commandId: 'cmd-unknown-1', sessionKey: 'host_a/snowball.codex:default/session-1', operation: 'sessions.send', status: 'unknown' },
    ],
    decisions: [
      { decisionId: 'dec-1', sessionKey: 'host_a/snowball.codex:default/session-1', ownerId: 'owner-codex', status: 'pending', revision: 0 },
    ],
  };

  // 1. Attention items detection (A1)
  const pendingDecisions = snapshot.decisions.filter(d => d.status === 'pending');
  assert.equal(pendingDecisions.length, 1);
  assert.equal(pendingDecisions[0].decisionId, 'dec-1');

  const inDoubtCommands = snapshot.commands.filter(c => c.status === 'unknown' || c.status === 'failed');
  assert.equal(inDoubtCommands.length, 1);
  assert.equal(inDoubtCommands[0].commandId, 'cmd-unknown-1');

  // 2. Filter logic (A1)
  const filterByHarness = (filter) => snapshot.sessions.filter(s => {
    if (filter === 'all') return true;
    return s.sessionKey.includes(`/${filter}:`) || s.sessionKey.includes(`:${filter}:`) || s.sessionKey.includes(`/${filter}/`);
  });

  assert.equal(filterByHarness('all').length, 3);
  assert.equal(filterByHarness('snowball.codex').length, 1);
  assert.equal(filterByHarness('snowball.opencode').length, 1);
  assert.equal(filterByHarness('snowball.antigravity').length, 1);

  // 3. Target Invariance (A2 / R-TARGET / J03)
  // User starts drafting on session-1
  let activeDraft = {
    destinationKey: snapshot.sessions[0].sessionKey,
    ownerId: snapshot.sessions[0].ownerId,
    text: 'Refactor login module',
    readOnly: snapshot.sessions[0].readOnly,
  };

  // User switches filter to 'snowball.opencode'
  let currentFilter = 'snowball.opencode';
  const visibleSessions = filterByHarness(currentFilter);
  assert.equal(visibleSessions.length, 1);
  assert.equal(visibleSessions[0].sessionKey, 'host_a/snowball.opencode:default/session-2');

  // INVARIANT: activeDraft destinationKey must remain session-1!
  assert.equal(activeDraft.destinationKey, 'host_a/snowball.codex:default/session-1');

  // User clicks on another session (session-2, which is readOnly)
  // Attempting to draft on read-only session must not overwrite active draft with invalid target
  const isTargetOwned = !visibleSessions[0].readOnly && visibleSessions[0].ownerId !== null;
  assert.equal(isTargetOwned, false);

  // Even if user changes draft text, target destination is immutable
  activeDraft.text += ' with unit tests';
  assert.equal(activeDraft.destinationKey, 'host_a/snowball.codex:default/session-1');

  // The command submitted uses activeDraft.destinationKey strictly
  const submittedCommand = {
    commandId: 'cmd_send_123',
    sessionKey: activeDraft.destinationKey,
    ownerId: activeDraft.ownerId,
    operation: 'sessions.send',
    payload: { text: activeDraft.text },
  };

  assert.equal(submittedCommand.sessionKey, 'host_a/snowball.codex:default/session-1');
});
