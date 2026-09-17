import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ControllerContext,
  ControllerStore,
  createControllerId,
  createHostId,
  createInitialState,
  createProject,
  createWorkspace,
  formatSessionKey,
  migrateLegacySessionKey,
  parseLegacyScopeKey,
  parseSessionKey,
  parseState,
  resolveUserDataDir,
  serializeState,
  sessionKeyEquals,
  stateFilePath,
} from '../packages/core/dist/index.js';

const deterministic = (size) => Buffer.alloc(size, 7);

// A1: the same native session id on another host or instance is another key.
test('MW.02.01.01.01.A1: native id collision across host/instance is impossible', () => {
  const hostA = createHostId(deterministic);
  const hostB = `host_${'8'.repeat(32)}`;
  assert.notEqual(hostA, hostB);
  const keyA = formatSessionKey({
    hostId: hostA,
    harness: { pluginId: 'snowball.codex', instanceId: 'owner-a' },
    nativeSessionId: '01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6',
  });
  const keyOtherHost = formatSessionKey({
    hostId: hostB,
    harness: { pluginId: 'snowball.codex', instanceId: 'owner-a' },
    nativeSessionId: '01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6',
  });
  const keyOtherInstance = formatSessionKey({
    hostId: hostA,
    harness: { pluginId: 'snowball.codex', instanceId: 'owner-b' },
    nativeSessionId: '01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6',
  });
  assert.notEqual(keyA, keyOtherHost);
  assert.notEqual(keyA, keyOtherInstance);
  assert.equal(sessionKeyEquals(keyA, keyA), true);
  assert.equal(sessionKeyEquals(keyA, keyOtherHost), false);
  assert.deepEqual(parseSessionKey(keyA).nativeSessionId, '01a09c0e-20dd-7d11-9dbd-8e6e8b69d2a6');
});

// Native ids containing separators round-trip without merging scopes.
test('session keys with slashes and percent signs stay in one scope segment', () => {
  const host = createHostId(deterministic);
  const key = formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'a/b%c',
  });
  assert.equal(key.split('/').length, 4);
  assert.equal(parseSessionKey(key).nativeSessionId, 'a/b%c');
  assert.throws(() => parseSessionKey(`${host}/snowball.codex/cli/a/b`), /Invalid session key/);
  assert.throws(() => parseSessionKey('host_zzz/snowball.codex/cli/x'), /Invalid host id/);
  assert.throws(() => formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: '   ',
  }), /Invalid native session id/);
});

// A2 + J03: two controllers keep independent scope, draft and approval targets.
test('MW.02.01.01.01.A2: controller scope, draft and approval bindings are independent', () => {
  const host = createHostId(deterministic);
  const store = new ControllerStore();
  const first = store.create(`ctl_${'1'.repeat(16)}`);
  const second = store.create(`ctl_${'2'.repeat(16)}`);
  const keyX = formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'session-x',
  });
  const keyY = formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'session-y',
  });

  first.selectScope({ sessionKey: keyX });
  first.beginDraft('draft-1', keyX);
  first.beginApproval('approval-1', keyX, 3);

  // J03: switching scope on either controller never retargets a bound draft.
  second.selectScope({ sessionKey: keyY });
  first.selectScope({ sessionKey: keyY });
  assert.equal(first.getDraft()?.destinationKey, keyX);
  assert.equal(first.getApproval()?.destinationKey, keyX);
  assert.equal(second.getSelection().sessionKey, keyY);
  assert.equal(second.getDraft(), undefined);

  // D17: the same approval revision applies once; the peer only observes.
  assert.equal(first.resolveApproval('approval-1', 3), 'applied');
  assert.equal(first.resolveApproval('approval-1', 3), 'stale');
  assert.equal(first.resolveApproval('approval-1', 4), 'stale');
  second.beginApproval('approval-1', keyY, 3);
  assert.equal(second.notePeerApprovalResolved('approval-1', 3), true);
  assert.equal(second.getApproval()?.status, 'resolved');
  assert.equal(second.resolveApproval('approval-1', 3), 'stale');
});

// R-RECOVER: terminal drafts never return to pending; unknown resolves explicitly.
test('terminal drafts never resume and unknown resolves only to sent or failed', () => {
  const controller = new ControllerContext(`ctl_${'3'.repeat(16)}`);
  const host = createHostId(deterministic);
  const key = formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'session-r',
  });
  controller.beginDraft('draft-r', key);
  controller.updateDraftPhase('unknown');
  assert.throws(() => controller.updateDraftPhase('review'), /Unknown delivery/);
  controller.updateDraftPhase('sent');
  assert.throws(() => controller.updateDraftPhase('recording'), /Terminal draft/);
  controller.clearDraft();
  controller.beginDraft('draft-r2', key);
  assert.equal(controller.getDraft()?.destinationKey, key);
});

// Workspace containment and user data isolation (J06).
test('project roots stay inside their workspace and state is per-user', () => {
  const workspace = { ...createWorkspace('E:\\work\\root', 'Work'), workspaceId: `ws_${'a'.repeat(16)}` };
  assert.equal(workspace.root, 'E:\\work\\root');
  const project = createProject(workspace, 'E:\\work\\root\\app', 'App');
  assert.equal(project.workspaceId, workspace.workspaceId);
  assert.throws(() => createProject(workspace, 'E:\\other\\app', 'Escape'), /escapes/);
  assert.throws(() => createWorkspace('relative/path', 'Relative'), /absolute/);

  const windowsDir = resolveUserDataDir({ APPDATA: 'C:\\Users\\wondo\\AppData\\Roaming' }, 'win32', 'C:\\Users\\wondo');
  const macDir = resolveUserDataDir({ HOME: '/Users/wondo' }, 'darwin', '/Users/wondo');
  const linuxDir = resolveUserDataDir({ HOME: '/home/wondo' }, 'linux', '/home/wondo');
  assert.ok(windowsDir.includes('Snowball'));
  assert.ok(macDir.includes('Snowball'));
  assert.ok(linuxDir.includes('snowball-middleware'));
  assert.notEqual(windowsDir, macDir);
  assert.ok(stateFilePath(windowsDir).endsWith('controller-state.v1.json'));
});

// Persistence: round-trip, cross-host rejection, version fail-closed.
test('persisted state round-trips and rejects foreign hosts and versions', () => {
  const host = createHostId(deterministic);
  const state = createInitialState(host);
  const workRoot = process.platform === 'win32' ? 'E:\\srv\\work' : '/srv/work';
  const appRoot = process.platform === 'win32' ? 'E:\\srv\\work\\app' : '/srv/work/app';
  const workspace = { ...createWorkspace(workRoot, 'Work'), workspaceId: `ws_${'b'.repeat(16)}` };
  state.workspaces.push(workspace);
  state.projects.push({
    projectId: `prj_${'c'.repeat(16)}`,
    workspaceId: workspace.workspaceId,
    root: appRoot,
    displayName: 'App',
  });
  const controllerId = createControllerId(deterministic);
  const key = formatSessionKey({
    hostId: host,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'persist-1',
  });
  state.controllers.push({
    controllerId,
    selection: { sessionKey: key, projectId: state.projects[0].projectId },
    draft: { draftId: 'd1', destinationKey: key, phase: 'review', updatedAt: new Date(0).toISOString() },
    approval: { approvalId: 'a1', destinationKey: key, revision: 1, status: 'pending', updatedAt: new Date(0).toISOString() },
  });
  const restored = parseState(serializeState(state));
  assert.equal(restored.hostId, host);
  assert.equal(restored.controllers[0].draft?.destinationKey, key);

  const foreign = createHostId((size) => Buffer.alloc(size, 9));
  const foreignKey = formatSessionKey({
    hostId: foreign,
    harness: { pluginId: 'snowball.codex', instanceId: 'cli' },
    nativeSessionId: 'persist-1',
  });
  const tampered = { ...state, controllers: [{ controllerId, selection: { sessionKey: foreignKey } }] };
  assert.throws(() => parseState(JSON.stringify(tampered)), /another host/);
  assert.throws(() => parseState(JSON.stringify({ ...state, version: 2 })), /Unsupported core state version/);
  assert.throws(() => parseState('{invalid'), /valid JSON/);
});

// Migration keeps legacy labels out of identity and never merges scopes.
test('legacy scope labels migrate to explicit opaque bindings', () => {
  const host = createHostId(deterministic);
  assert.deepEqual(parseLegacyScopeKey('dev-pc/codex'), { machineLabel: 'dev-pc', harnessLabel: 'codex' });
  assert.deepEqual(parseLegacyScopeKey('dev-pc/codex/snowball').projectLabel, 'snowball');
  assert.throws(() => parseLegacyScopeKey('dev-pc'), /Invalid legacy scope/);
  const migrated = migrateLegacySessionKey({
    hostId: host,
    harnessPluginId: 'snowball.codex',
    harnessInstanceId: 'cli',
    projectId: `prj_${'d'.repeat(16)}`,
    nativeSessionId: 's-01',
  });
  assert.equal(parseSessionKey(migrated).hostId, host);
  assert.ok(!migrated.includes('dev-pc'));
});
