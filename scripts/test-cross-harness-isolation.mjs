import assert from 'node:assert/strict';
import { ContextManager } from './context-manager.mjs';

console.log('Testing cross-harness input & background task isolation...');

const context = new ContextManager();

// Pre-populate genuine sessions like start-all.mjs does
const mId = context.getCurrentMachine().id;
const pId = 'Snowball_Control';

const codexSess = {
  id: '01a0-codex-initial',
  title: 'Codex Initial Session',
  preview: 'Hello Codex',
  createdAt: Date.now(),
  model: 'gpt-5.6-sol',
  effort: 'medium',
  access: 'on-request',
  turns: [],
  turnCount: 0
};
context.sessionsByScope[`${mId}/snowball.codex/${pId}`] = [codexSess];

const agSess = {
  id: 'ag-initial',
  title: 'Antigrav Initial Session',
  preview: 'Hello AG',
  createdAt: Date.now(),
  model: 'claude-opus-4-6',
  effort: 'Default',
  access: 'on-request',
  turns: [],
  turnCount: 0
};
context.sessionsByScope[`${mId}/snowball.antigravity/${pId}`] = [agSess];

const ocSess = {
  id: 'oc-initial',
  title: 'OpenCode Initial Session',
  preview: 'Hello OpenCode',
  createdAt: Date.now(),
  model: 'Muse Spark 1.3',
  effort: 'xhigh',
  access: 'on-request',
  turns: [],
  turnCount: 0
};
context.sessionsByScope[`${mId}/snowball.opencode/${pId}`] = [ocSess];

context.resolveProjectAndSession();
context.syncSessionSettings();

// 1. Initial harness is Codex
const h1 = context.getCurrentHarness();
assert.equal(h1.id, 'snowball.codex', 'Initial harness should be Codex');
const sessCodex = context.getCurrentSession();
assert.equal(sessCodex.id, '01a0-codex-initial', 'Codex should have active session');

// 2. Start recording voice on Codex
sessCodex.isRecordingVoice = true;
context.isRecordingVoice = true;
context.voiceDestinationLabel = sessCodex.title;

// Save state on Codex
context.saveActiveSessionState();
assert.equal(sessCodex.isRecordingVoice, true, 'Codex session should record voice');

// 3. Immediately switch harness to Antigravity (Key 13)
context.cycleHarness();
const h2 = context.getCurrentHarness();
assert.equal(h2.id, 'snowball.antigravity', 'Second harness should be Antigravity');
const sessAntigrav = context.getCurrentSession();
assert.ok(sessAntigrav, 'Antigravity should have an active session');

// Antigravity MUST NOT inherit recording state from Codex
assert.equal(context.isRecordingVoice, false, 'Antigravity context must not be recording');
assert.equal(Boolean(sessAntigrav.isRecordingVoice), false, 'Antigravity session must not be recording');
assert.equal(context.voiceDraftText, '', 'Antigravity draft must be empty');

// 4. Create new task on Antigravity (Key 1)
const newAntigravId = `s-${Date.now().toString(36)}`;
const newAntigravSess = {
  id: newAntigravId,
  title: 'New task',
  preview: 'Start fresh conversation',
  createdAt: Date.now(),
  model: context.models[context.selectedModelIdx],
  effort: context.efforts[context.selectedEffortIdx],
  access: 'on-request',
  turnCount: 0,
  turns: [],
  voiceDraftText: '',
  voiceSubmission: 'idle',
  lastDispatchError: null
};
const agScopeKey = context.getFullScopeKey();
if (!context.sessionsByScope[agScopeKey]) context.sessionsByScope[agScopeKey] = [];
context.saveActiveSessionState();
context.sessionsByScope[agScopeKey].unshift(newAntigravSess);
context.memorySessionPerProject.set(agScopeKey, newAntigravId);
context.selectSession(0);

assert.equal(context.getCurrentSession().id, newAntigravId, 'Antigravity should be on new session');

// 5. Meanwhile, Codex's background transcription finishes!
sessCodex.isRecordingVoice = false;
sessCodex.isTranscribingVoice = false;
sessCodex.voiceDraftText = '안녕하세요 하이';

// Verify Antigravity is still completely clean
assert.equal(context.voiceDraftText, '', 'Antigravity draft must remain empty');
assert.equal(context.getCurrentSession().id, newAntigravId);

// 6. User speaks on Antigravity and dispatches (Key 16)
// On Key 16, voiceDraftText is consumed and cleared to ''
newAntigravSess.voiceDraftText = '';
context.voiceDraftText = '';
context.voiceSubmission = 'sending';
newAntigravSess.voiceSubmission = 'sending';

// 7. User switches back to Codex (Key 13 twice: Antigrav -> OpenCode -> Codex)
context.cycleHarness(); // -> OpenCode
assert.equal(context.getCurrentHarness().id, 'snowball.opencode');

context.cycleHarness(); // -> Codex
assert.equal(context.getCurrentHarness().id, 'snowball.codex');

// Codex MUST have restored its own draft prompt verification!
assert.equal(context.voiceDraftText, '안녕하세요 하이', 'Codex voice draft must be restored');
assert.equal(context.voiceSubmission, 'idle', 'Codex submission state must be restored');
assert.equal(context.readerTitle, 'Voice Prompt Draft', 'Reader must show draft verification for Codex');
assert.ok(context.readerLines.some(l => l.includes('안녕하세요 하이')), 'Draft lines must show transcribed text');

// 8. Now user sends on Codex (Key 16)
context.voiceDraftText = '';
sessCodex.voiceDraftText = '';
sessCodex.voiceSubmission = 'sending';
context.voiceSubmission = 'sending';

// Simulate Codex background turn completion
const completedCodexTurns = [
  { role: 'user', userPrompt: '안녕하세요 하이', text: '안녕하세요 하이', time: '방금' },
  { role: 'agent', agentResponse: '안녕하세요! 반갑습니다.', text: '안녕하세요! 반갑습니다.', time: '방금', processDetails: [] }
];
sessCodex.id = '01a0-codex-real-id';
sessCodex.turns = completedCodexTurns;
sessCodex.turnCount = 2;
sessCodex.voiceSubmission = 'idle';

// User is currently viewing Codex -> reader updates immediately
context.voiceSubmission = 'idle';
context.setSessionTurns(completedCodexTurns);
assert.equal(context.currentTurns.length, 2);
assert.ok(context.readerLines.some(l => l.includes('안녕하세요! 반갑습니다.')), 'Codex conversation must be rendered');

// 9. User switches back to Antigravity (Key 13)
context.cycleHarness();
assert.equal(context.getCurrentHarness().id, 'snowball.antigravity');

// Antigravity's session was in 'sending' state
assert.equal(context.getCurrentSession().id, newAntigravId, 'Should remember the new Antigravity session');
assert.equal(context.voiceSubmission, 'sending', 'Antigravity should restore sending state');
assert.equal(context.readerTitle, 'Dispatching Prompt', 'Reader should show dispatching prompt for Antigravity');

// Simulate Antigravity background turn completion
const completedAgTurns = [
  { role: 'user', userPrompt: 'Antigravity prompt', text: 'Antigravity prompt', time: '방금' },
  { role: 'agent', agentResponse: 'Antigravity response', text: 'Antigravity response', time: '방금', processDetails: [] }
];
newAntigravSess.id = 'ag-conv-uuid-1234';
newAntigravSess.turns = completedAgTurns;
newAntigravSess.turnCount = 2;
newAntigravSess.voiceSubmission = 'idle';
context.voiceSubmission = 'idle';
context.setSessionTurns(completedAgTurns);

assert.equal(context.currentTurns.length, 2);
assert.ok(context.readerLines.some(l => l.includes('Antigravity response')), 'Antigravity conversation must be rendered');

console.log('✓ All cross-harness isolation tests PASSED 100%!');
