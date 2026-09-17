import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerContext, formatSessionKey, createInitialState, parseState, normalizeRoot } from '../packages/core/dist/index.js';
const hostId = `host_${'a'.repeat(32)}`;
const key = formatSessionKey({ hostId, harness: { pluginId: 'snowball.codex', instanceId: 'cli' }, nativeSessionId: 's' });
const id = `ctl_${'b'.repeat(16)}`;
test('unsubmitted review survives restore; only sending becomes unknown', () => {
  for (const [phase, expected] of [['review', 'review'], ['sending', 'unknown']]) {
    const c = new ControllerContext(id);
    c.restore({ controllerId: id, selection: {}, draft: { draftId: 'd', destinationKey: key, phase, updatedAt: new Date(0).toISOString() } });
    assert.equal(c.getDraft().phase, expected);
  }
});
test('scope parent changes clear stale session while immutable draft remains pinned', () => {
  const c = new ControllerContext(id);
  c.selectScope({ sessionKey: key }); c.beginDraft('d', key);
  c.selectScope({ harnessPluginId: 'snowball.opencode' });
  assert.equal(c.getSelection().sessionKey, undefined);
  assert.equal(c.getSelection().harnessInstanceId, undefined);
  assert.equal(c.getDraft().destinationKey, key);
  assert.throws(() => c.selectScope({ harnessPluginId: 'snowball.opencode', sessionKey: key }), /disagree/);
});
test('root normalization removes traversal before containment; preserves POSIX case', () => {
  assert.equal(normalizeRoot('E:\\work\\root\\..\\else', 'win32'), 'E:\\work\\else');
  assert.equal(normalizeRoot('/work/root/../else', 'darwin'), '/work/else');
  // parseState runs on current OS. POSIX root case is checked on POSIX hosts.
  if (process.platform !== 'win32') {
    const state = createInitialState(hostId);
    state.workspaces = ['Work', 'work'].map((name, i) => ({ workspaceId: `ws_${String(i).repeat(16)}`, root: `/${name}`, displayName: name }));
    assert.equal(parseState(JSON.stringify(state)).workspaces.length, 2);
  }
});
