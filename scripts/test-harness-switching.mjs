import assert from 'node:assert/strict';
import { ContextManager } from './context-manager.mjs';
import { scanAllHarnessSessions } from './harness-session-scanner.mjs';

console.log('Testing genuine harness session scanning and context manager switching...');

const { sessionsByHarness, turnsStore } = scanAllHarnessSessions();

// Verify real sessions are found
assert.ok(sessionsByHarness['snowball.codex'], 'Codex sessions present');
assert.ok(sessionsByHarness['snowball.antigravity'], 'Antigravity sessions present');
assert.ok(sessionsByHarness['snowball.opencode'], 'OpenCode sessions present');

const agSnowball = sessionsByHarness['snowball.antigravity']['Snowball_Control'];
assert.ok(agSnowball && agSnowball.length > 0, 'Antigravity Snowball_Control sessions found');
console.log(`  ✓ Antigravity Snowball_Control sessions: ${agSnowball.length}`);

const ocSnowball = sessionsByHarness['snowball.opencode']['Snowball_Control'];
assert.ok(ocSnowball && ocSnowball.length > 0, 'OpenCode Snowball_Control sessions found');
console.log(`  ✓ OpenCode Snowball_Control sessions: ${ocSnowball.length}`);

import { scanAllHarnessCatalogs } from './harness-catalog-scanner.mjs';

// Setup ContextManager
const context = new ContextManager();
const catalogs = scanAllHarnessCatalogs();
for (const [pluginId, cat] of Object.entries(catalogs)) {
  context.setModelCatalog(cat, `dev-pc/${pluginId}`);
}
context.accessLevels = ['on-request', 'auto-approve', 'read-only'];

// Populate scopes
for (const h of context.harnesses) {
  const harnessData = sessionsByHarness[h.id] || {};
  const scopeKey = `dev-pc/${h.id}`;
  const projs = [];
  const projEntries = Object.entries(harnessData);
  projEntries.sort(([a], [b]) => {
    if (a === 'Snowball_Control') return -1;
    if (b === 'Snowball_Control') return 1;
    return a.localeCompare(b);
  });
  for (const [projName, sessList] of projEntries) {
    projs.push({ id: projName, name: projName, path: process.cwd() });
    context.sessionsByScope[`${scopeKey}/${projName}`] = sessList.map(s => ({
      id: s.id,
      sessionKey: s.sessionKey,
      title: s.title,
      preview: s.preview,
      createdAt: s.createdAt || 0,
      model: s.model,
      effort: s.effort,
      access: s.access || 'on-request'
    }));
  }
  context.projectsByScope[scopeKey] = projs;
}

// Initial resolution: Codex
context.resolveProjectAndSession();
let state = context.getDeviceState();
let k18 = state.keys.find(k => k.keyId === 18);
let k14 = state.keys.find(k => k.keyId === 14);
let k10 = state.keys.find(k => k.keyId === 10);
console.log(`  ✓ Codex active: model=${k18.labelMain}, effort=${k14.labelMain}, access=${k10.labelMain}`);

// 1. Cycle to Antigravity
context.cycleHarness();
assert.equal(context.getCurrentHarness().name, 'Antigrav');
state = context.getDeviceState();
k18 = state.keys.find(k => k.keyId === 18);
k14 = state.keys.find(k => k.keyId === 14);
k10 = state.keys.find(k => k.keyId === 10);
const expectedAgModel = (context.getCurrentSession().model || 'Default').slice(0, 15);
assert.equal(k18.labelMain, expectedAgModel, `Antigravity session model matches ${expectedAgModel}`);
const curAgModelObj = catalogs['snowball.antigravity'].find(m => m.model === agSnowball[0].model);
const expectedAgEffort = context.efforts[context.selectedEffortIdx] || 'Default';
assert.equal(k14.labelMain, expectedAgEffort, `Antigravity session effort matches ${expectedAgEffort}`);
assert.equal(k10.labelMain, 'on-request', 'Antigravity default access is on-request');
console.log(`  ✓ Antigrav active session 0 (${agSnowball[0].title}): model=${k18.labelMain}, effort=${k14.labelMain}, access=${k10.labelMain}`);

// 2. Cycle to OpenCode
context.cycleHarness();
assert.equal(context.getCurrentHarness().name, 'OpenCode');
state = context.getDeviceState();
k18 = state.keys.find(k => k.keyId === 18);
k14 = state.keys.find(k => k.keyId === 14);
k10 = state.keys.find(k => k.keyId === 10);
const ocCatalog = catalogs['snowball.opencode'];
const ocModelObj = ocCatalog?.find(m => m.model === ocSnowball[0].model || (m.model.includes('/') && ocSnowball[0].model.includes('/') && m.model.split('/')[1] === ocSnowball[0].model.split('/')[1]));
const expectedOcModel = (ocCatalog.length ? (ocModelObj?.displayName || context.models[context.selectedModelIdx]) : 'Default').slice(0, 15);
assert.equal(k18.labelMain.trim(), expectedOcModel.trim(), `OpenCode session model matches ${expectedOcModel}`);
assert.equal(k14.labelMain, context.efforts[context.selectedEffortIdx] || 'Default', 'Only discovered OpenCode variants are displayed');
assert.equal(k10.labelMain, 'on-request', 'OpenCode default access is on-request');
console.log(`  ✓ OpenCode active session 0 (${ocSnowball[0].title}): model=${k18.labelMain}, effort=${k14.labelMain}, access=${k10.labelMain}`);

// 3. Test Model editor in OpenCode
context.openEditor('model');
assert.equal(context.activeEditor, 'model');
state = context.getDeviceState();
const choices = [19, 15, 11, 7, 3].map(kid => state.keys.find(k => k.keyId === kid)?.labelMain).filter(Boolean);
console.log(`  ✓ OpenCode Model Editor choices: ${JSON.stringify(choices)}`);
if (ocCatalog.length) {
  assert.ok(choices.length > 0, 'Discovered OpenCode choices are displayed');
} else {
  assert.deepEqual(context.models, [], 'Missing OpenCode CLI cannot produce a fabricated model catalog');
  assert.deepEqual(context.efforts, [], 'Missing model metadata cannot produce fabricated variants');
}

console.log('Harness switching and available catalogs verified. Unavailable catalogs remain empty; this does not certify native dispatch.');
