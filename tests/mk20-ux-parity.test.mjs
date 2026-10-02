import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ContextManager, sliceLineIntoChunks, wrapText, wrapWithPrefix } from '../scripts/context-manager.mjs';
// Hardware-source integration is opt-in; pure ContextManager tests remain portable.
const encodeLegacyPreview = process.env.SNOWBALL_TEST_MK20 === '1' ? (await import('../../Snowball_Control/plugins/device-mk20/src/index.mjs')).encodeLegacyPreview : undefined;

test('MK20 UX Parity: text wrapping and line chunking match hardware HUD metrics', () => {
  // 50 ASCII characters wrap cleanly at 50 chars
  const asciiLine = 'a'.repeat(60);
  const wrappedAscii = wrapText(asciiLine, 50);
  assert.equal(wrappedAscii.length, 2);
  assert.equal(wrappedAscii[0].length, 50);
  assert.equal(wrappedAscii[1].length, 10);

  // Korean characters (advance 2) wrap at 25 Korean characters
  const koreanLine = '한'.repeat(30);
  const wrappedKorean = wrapText(koreanLine, 50);
  assert.equal(wrappedKorean.length, 2);
  assert.equal(wrappedKorean[0].length, 25);
  assert.equal(wrappedKorean[1].length, 5);

  // sliceLineIntoChunks produces 4 chunks of 12 chars when specified
  const sampleDiffLine = '+ export const MK20_KEY_FLAG_LINES = 32; // Syntax colored';
  const chunks = sliceLineIntoChunks(sampleDiffLine, 4, 12);
  assert.equal(chunks.length, 4);
  assert.ok(chunks[0].length <= 12);
  assert.ok(chunks[1].length <= 12);
  assert.ok(chunks[2].length <= 12);

  // Default chunkWidth is 15, cleanly spanning up to 60 char lines across 4 keys (120px on 128px LCDs)
  const chunks15 = sliceLineIntoChunks('const result = await context.readWorkspaceFiles();', 4);
  assert.equal(chunks15.length, 4);
  assert.equal(chunks15[0].length, 15);
  assert.equal(chunks15[1].length, 15);
  assert.equal(chunks15[2].length, 15);
  assert.equal(chunks15[3].length, 5); // remaining 5 chars cleanly positioned on Key 1
});

test('MK20 UX Parity: Changes modal 24-line dense diff canvas with syntax coloring', () => {
  const context = new ContextManager();
  const mockFiles = [
    { name: 'context.ts', path: 'src/context.ts', status: 'M' },
    { name: 'hud.c', path: 'hardware/hud.c', status: 'M' },
  ];
  const mockDiff = [
    '--- a/src/context.ts',
    '+++ b/src/context.ts',
    '@@ -1,5 +1,10 @@',
    '+ // Added line with cyan color',
    '- // Removed line with rose color',
    '  // Unchanged context line with white color and syntax',
    '+ const newline = true;',
    '- const oldline = false;',
  ];

  context.openChangesView(mockFiles);
  context.selectChangesFile(0, mockDiff);

  const state = context.getDeviceState();
  const preview = context.toPreviewPayload();

  // K17 must have modal origin fill and file scrollbar attributes
  const k17 = state.keys.find(k => k.keyId === 17);
  assert.ok(k17, 'K17 must exist');
  assert.equal(k17.isFilled, true, 'K17 must be filled in Changes modal');
  assert.equal(k17.scrollTotal, 2, 'K17 must record total changed files');
  assert.equal(k17.activeItem, 0, 'K17 must record active changed file index');

  const previewK17 = preview.keys.find(k => k.id === 17);
  assert.ok(previewK17);
  assert.equal(previewK17.flags & 1, 1, 'K17 must have bit 0 (filled) set in wire format');
  assert.equal(previewK17.total, 2);
  assert.equal(previewK17.activeItem, 0);

  // Check 16 diff keys across (2,1)-(5,4)
  const diffKeyIds = [13, 9, 5, 1, 14, 10, 6, 2, 15, 11, 7, 3, 16, 12, 8, 4];
  for (const kid of [13, 9, 5, 1]) {
    const k = state.keys.find(key => key.keyId === kid);
    assert.ok(k, `Key ${kid} must exist in diff view`);
    assert.equal(k.isLinesMode, true, `Key ${kid} must have isLinesMode enabled`);
    assert.ok(Array.isArray(k.items), `Key ${kid} must have multi-line items`);
    assert.ok(Array.isArray(k.itemColors), `Key ${kid} must have itemColors`);

    const wireKey = preview.keys.find(key => key.id === kid);
    assert.ok(wireKey);
    assert.equal(wireKey.flags & 32, 32, `Key ${kid} must have bit 5 (KEY_FLAG_LINES) set in wire format`);
    assert.ok(Array.isArray(wireKey.items));
    assert.ok(Array.isArray(wireKey.colors));
  }

  // Left knob navigation: diff scroll vs file browse toggle
  assert.equal(context.isChangesFileSelected, true);
  context.onLeftKnob(1);
  assert.equal(context.readerScrollLine, 1, 'Left knob should scroll diff lines when file is selected');

  // Knob click toggles file selection mode
  context.onLeftKnobClick();
  assert.equal(context.isChangesFileSelected, false, 'Knob click should deselect file to enter file browsing mode');

  context.onLeftKnob(1);
  assert.equal(context.selectedChangedFileIdx, 1, 'Left knob should scroll file list when file is deselected');

  context.onLeftKnobClick();
  assert.equal(context.isChangesFileSelected, true, 'Knob click should re-select file to enter diff scroll mode');
});

test('MK20 UX Parity: Workspace dual-mode (Full File Browser & 24-line File Viewer)', async () => {
  const context = new ContextManager();
  context.workspaceFiles = [
    { name: '..', isDir: true },
    { name: 'src', isDir: true },
    { name: 'docs', isDir: true },
    { name: 'README.md', isDir: false, size: '4.2KB' },
    { name: 'package.json', isDir: false, size: '1.2KB' },
  ];
  context.viewMode = 'workspace';
  context.isWorkspaceViewerActive = false;

  // Mode 1: Full File Browser Mode
  let state = context.getDeviceState();
  let preview = context.toPreviewPayload();

  const k17 = state.keys.find(k => k.keyId === 17);
  assert.ok(k17);
  assert.equal(k17.isFilled, true, 'K17 must be filled in Full File Browser mode');

  // Cursor at 0
  const cursorKey = state.keys.find(k => k.keyId === 13); // grid [0][0] = key 13
  assert.ok(cursorKey);
  assert.equal(cursorKey.isFocused, true, 'Current cursor item must be focused (cyan outline)');
  assert.equal(cursorKey.isFilled, false, 'Cursor item must NOT be filled (outline only)');

  // Move cursor with left knob
  context.onLeftKnob(1);
  assert.equal(context.workspaceCursorIdx, 1);

  // Transition to Mode 2: File Viewer Mode
  context.isWorkspaceViewerActive = true;
  context.workspaceSelectedFileIdx = 3; // README.md
  context.workspaceFileContentLines = [
    '# Snowball Middleware',
    '',
    '// Developer workstation terminal',
    'export const config = { active: true };',
    '// Line 5: first line on key row 0',
    'const x = 10;',
    'const y = 20;',
    'function run() {',
    '  return x + y;',
    '}',
  ];
  context.readerScrollLine = 0;

  state = context.getDeviceState();
  preview = context.toPreviewPayload();

  const viewerK17 = state.keys.find(k => k.keyId === 17);
  assert.equal(viewerK17.isFilled, true, 'K17 must be filled in File Viewer mode');
  assert.equal(viewerK17.scrollTotal, 5, 'K17 must show total file count');
  assert.equal(viewerK17.activeItem, 3, 'K17 must show active file index');

  const viewerDiffKey = state.keys.find(k => k.keyId === 13);
  assert.equal(viewerDiffKey.isLinesMode, true, 'File viewer keys must use isLinesMode');
  assert.ok(Array.isArray(viewerDiffKey.items));
  assert.ok(Array.isArray(viewerDiffKey.itemColors));

  const wireViewerKey = preview.keys.find(k => k.id === 13);
  assert.equal(wireViewerKey.flags & 32, 32, 'Wire format must have bit 5 (KEY_FLAG_LINES) set');

  // Left knob click in File Viewer Mode exits back to Full File Browser Mode
  await context.onLeftKnobClick();
  assert.equal(context.isWorkspaceViewerActive, false, 'Left knob click must exit viewer mode back to file browser');
});

test('MK20 UX Parity: Workspace directory navigation and datagram capacity', { skip: !encodeLegacyPreview }, async () => {
  const context = new ContextManager();
  context.projectsByScope[context.getScopeKey()] = [{ id: 'test-repo', name: 'Test repository', path: fileURLToPath(new URL('..', import.meta.url)) }];
  await context.readWorkspaceFiles();
  const rootPath = context.filePath;

  // Find 'tests' directory
  const testsIdx = context.workspaceFiles.findIndex(f => f.name === 'tests' && f.isDir);
  assert.ok(testsIdx >= 0, 'tests directory must exist in workspace');

  context.workspaceCursorIdx = testsIdx;
  await context.onLeftKnobClick();

  // Must have navigated into 'tests'
  assert.ok(context.filePath.endsWith('tests'), 'Must navigate into tests folder');
  assert.ok(context.workspaceFiles.length > 20, 'tests directory contains many files');
  assert.equal(context.workspaceFiles[0].name, '..', 'First item in subdirectory must be ..');
  assert.equal(context.workspaceCursorIdx, 0, 'Cursor must reset to 0 upon entering folder');
  assert.equal(context.workspaceScrollRow, 0, 'Scroll row must reset to 0 upon entering folder');

  // Preview payload must encode without throwing datagram_capacity
  const payload = context.toPreviewPayload();
  assert.equal(payload.mode, 'workspace');
  const encoded = encodeLegacyPreview(payload, 1);
  assert.ok(encoded.length > 1400, 'Subdirectory payload exceeds 1400 bytes');
  assert.ok(encoded.length <= 4096, 'Subdirectory payload must be under 4096 bytes');

  // Click on '..' to navigate back up to root
  context.workspaceCursorIdx = 0;
  await context.onLeftKnobClick();
  assert.equal(context.filePath, rootPath, 'Must navigate back to root when clicking ..');
});


test('MK20 UX Parity: Modal origin button is filled across all modals', () => {
  const context = new ContextManager();

  context.viewMode = 'changes';
  let k17 = context.getDeviceState().keys.find(k => k.keyId === 17);
  assert.equal(k17.isFilled, true, 'K17 must be filled in changes modal');

  context.viewMode = 'workspace';
  context.isWorkspaceViewerActive = false;
  k17 = context.getDeviceState().keys.find(k => k.keyId === 17);
  assert.equal(k17.isFilled, true, 'K17 must be filled in workspace browser');

  context.isWorkspaceViewerActive = true;
  k17 = context.getDeviceState().keys.find(k => k.keyId === 17);
  assert.equal(k17.isFilled, true, 'K17 must be filled in workspace viewer');

  context.viewMode = 'settings';
  k17 = context.getDeviceState().keys.find(k => k.keyId === 17);
  assert.equal(k17.isFilled, true, 'K17 must be filled in settings modal');
});

test('MK20 UX Parity: Voice Draft review, send, discard, and recovery keys', () => {
  const context = new ContextManager();
  context.viewMode = 'session';

  // 1. Idle state
  let state = context.getDeviceState();
  let k20 = state.keys.find(k => k.keyId === 20);
  let k16 = state.keys.find(k => k.keyId === 16);
  let k4 = state.keys.find(k => k.keyId === 4);
  assert.equal(k20.labelMain, 'Talk');
  assert.equal(k16.labelMain, 'Send');
  assert.equal(k4.labelMain, 'Stop');

  // 2. Recording state
  context.isRecordingVoice = true;
  state = context.getDeviceState();
  k20 = state.keys.find(k => k.keyId === 20);
  k16 = state.keys.find(k => k.keyId === 16);
  k4 = state.keys.find(k => k.keyId === 4);
  assert.equal(k20.labelTop, 'MIC ON');
  assert.equal(k20.labelMain, 'Done');
  assert.equal(k20.isFilled, true);
  assert.equal(k16.labelTop, 'FINISH');
  assert.equal(k16.labelMain, 'Done');
  assert.equal(k16.isFocused, true);
  assert.equal(k4.labelTop, 'ABORT');
  assert.equal(k4.labelMain, 'Cancel');

  // 3. Transcribing state
  context.isRecordingVoice = false;
  context.isTranscribingVoice = true;
  state = context.getDeviceState();
  k20 = state.keys.find(k => k.keyId === 20);
  k16 = state.keys.find(k => k.keyId === 16);
  assert.equal(k20.isDisabled, true);
  assert.equal(k16.isDisabled, true);

  // 4. Review state
  context.isTranscribingVoice = false;
  context.voiceDraftText = 'Hello world prompt';
  state = context.getDeviceState();
  k20 = state.keys.find(k => k.keyId === 20);
  k16 = state.keys.find(k => k.keyId === 16);
  k4 = state.keys.find(k => k.keyId === 4);
  assert.equal(k20.labelTop, 'RE-RECORD');
  assert.equal(k20.labelMain, 'Talk');
  assert.equal(k16.labelTop, 'CONFIRM');
  assert.equal(k16.labelMain, 'Send');
  assert.equal(k16.isFilled, true);
  assert.equal(k16.isFocused, true);
  assert.equal(k4.labelTop, 'DISCARD');
  assert.equal(k4.labelMain, 'Cancel');

  // 5. Unknown delivery state (Recovery)
  context.voiceSubmission = 'unknown';
  state = context.getDeviceState();
  k16 = state.keys.find(k => k.keyId === 16);
  k4 = state.keys.find(k => k.keyId === 4);
  assert.equal(k16.labelTop, 'DELIVERY');
  assert.equal(k16.labelMain, 'Check task');
  assert.equal(k4.labelTop, 'RECOVERY');
  assert.equal(k4.labelMain, 'Discard');
  assert.equal(k4.isDisabled, false);
});

test('MK20 UX Parity: Pattern 3 KEY_FLAG_LIST (bit 4) and scrollbar position in wire format', () => {
  const context = new ContextManager();
  context.viewMode = 'session';
  context.readerScrollLine = 7;

  const preview = context.toPreviewPayload();

  // Scrollbar position must match readerScrollLine
  assert.equal(preview.scroll, 7, 'Wire format scroll must match context.readerScrollLine');

  // Machine (K17) and Harness (K13) must have KEY_FLAG_LIST (bit 4 = 16) set
  const k17 = preview.keys.find(k => k.id === 17);
  assert.ok(k17, 'K17 must exist in preview');
  assert.equal(k17.flags & 16, 16, 'K17 must have bit 4 (KEY_FLAG_LIST = 16) set for Pattern 3 menu');
  assert.ok(Array.isArray(k17.items), 'K17 must carry items array');
  assert.equal(typeof k17.activeItem, 'number', 'K17 must carry activeItem index');

  const k13 = preview.keys.find(k => k.id === 13);
  assert.ok(k13, 'K13 must exist in preview');
  assert.equal(k13.flags & 16, 16, 'K13 must have bit 4 (KEY_FLAG_LIST = 16) set for Pattern 3 menu');
  assert.ok(Array.isArray(k13.items), 'K13 must carry items array');
  assert.equal(typeof k13.activeItem, 'number', 'K13 must carry activeItem index');
});

test('MK20 UX Parity: Question view mode spanning options and actions', () => {
  const context = new ContextManager();
  context.viewMode = 'question';
  context.activeQuestion = {
    id: 'q-1',
    question: 'Choose deployment strategy',
    options: [
      { id: 'opt-1', label: 'Local Development Server', isSelected: true },
      { id: 'opt-2', label: 'Production Mesh Node', isSelected: false },
      { id: 'opt-3', label: 'Dry Run Only', isSelected: false },
    ]
  };

  const state = context.getDeviceState();
  assert.equal(state.viewMode, 'question');

  // Row 0 (K17..K1): Option 1 spanning
  const k17 = state.keys.find(k => k.keyId === 17);
  assert.equal(k17.labelTop, 'OPT 1');
  assert.equal(k17.labelMain, '[X]');
  assert.equal(k17.isFilled, true);

  // Row 1 (K18..K2): Option 2 spanning
  const k18 = state.keys.find(k => k.keyId === 18);
  assert.equal(k18.labelTop, 'OPT 2');
  assert.equal(k18.labelMain, '[ ]');
  assert.equal(k18.isFilled, false);

  // Row 3: Other, Submit, Speak, Later, Stop
  assert.equal(state.keys.find(k => k.keyId === 20).labelMain, 'Other');
  assert.equal(state.keys.find(k => k.keyId === 16).labelMain, 'Submit');
  assert.equal(state.keys.find(k => k.keyId === 8).labelMain, 'Later');
  assert.equal(state.keys.find(k => k.keyId === 4).labelMain, 'Stop');
});

test('MK20 UX Parity: New task empty session displays [NEW TASK READY] prompt', () => {
  const context = new ContextManager();
  context.viewMode = 'session';
  context.sessionsByScope[context.getFullScopeKey()] = [
    { id: 's-new-123', title: 'New task', preview: 'Start fresh conversation', createdAt: Date.now(), turnCount: 0 }
  ];
  context.selectSession(0);
  context.setSessionTurns([]);

  const state = context.getDeviceState();
  assert.ok(state.lines.some(l => l.includes('[NEW TASK READY]')), 'Top display must prompt [NEW TASK READY]');
  assert.ok(state.lines.some(l => l.includes('Press [Talk] (K20)')), 'Top display must guide user to press Talk');
});

test('MK20 UX Parity: Viewer scrolling emits KEY_FLAG_DISABLED (flags: 8) for empty keys', async () => {
  const context = new ContextManager();
  context.viewMode = 'workspace';
  context.isWorkspaceViewerActive = true;
  context.workspaceSelectedFileIdx = 0;
  // File with only 6 lines: first 4 on top screen, lines 4..5 on Row 0 (key 13)
  context.workspaceFileContentLines = [
    'Line 0: header',
    'Line 1: info',
    'Line 2: setup',
    'Line 3: start',
    'Line 4: code row 0',
    'Line 5: code row 0 end'
  ];
  context.readerScrollLine = 0;

  const payload = context.toPreviewPayload();

  // Must have exactly 20 keys accounted for
  assert.equal(payload.keys.length, 20, 'Wire payload must include all 20 keys to prevent stale hardware frames');

  // Key 13 must have KEY_FLAG_LINES (32)
  const k13 = payload.keys.find(k => k.id === 13);
  assert.ok(k13);
  assert.equal(k13.flags & 32, 32, 'Key 13 must have lines mode active');

  // Rows 1, 2, 3 (e.g. keys 14, 15, 16) have no lines and must be KEY_FLAG_DISABLED (8)
  for (const kid of [14, 15, 16]) {
    const k = payload.keys.find(k => k.id === kid);
    assert.ok(k, `Key ${kid} must be present in preview payload`);
    assert.equal(k.flags, 8, `Key ${kid} must have KEY_FLAG_DISABLED (8) to turn off backlight / blank display`);
    assert.equal(k.main, '', `Key ${kid} must have empty main text`);
  }

  // When scrolling past all lines, all 16 viewer keys must have KEY_FLAG_DISABLED (8)
  context.readerScrollLine = 100;
  const scrolledPayload = context.toPreviewPayload();
  const viewerKeys = [13, 9, 5, 1, 14, 10, 6, 2, 15, 11, 7, 3, 16, 12, 8, 4];
  for (const kid of viewerKeys) {
    const k = scrolledPayload.keys.find(k => k.id === kid);
    assert.ok(k);
    assert.equal(k.flags, 8, `Scrolled past key ${kid} must be disabled (flags 8)`);
  }
});

test('MK20 UX Parity: Model, Effort, and Access selections reflect active session defaults and update per session', () => {
  const context = new ContextManager();
  context.accessLevels = ['on-request', 'auto-approve', 'read-only'];
  const codexCatalog = [
    { model: 'gpt-6-astra', displayName: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'], defaultEffort: 'low', isDefault: true },
    { model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'ultra'], defaultEffort: 'low', isDefault: false },
  ];
  context.setModelCatalog(codexCatalog, 'dev-pc/snowball.codex');

  // Session 1: configured with gpt-5.6-sol, ultra effort, never access
  // Session 2: configured with gpt-6-astra, medium effort, on-request access
  const scopeKey = context.getFullScopeKey();
  context.sessionsByScope[scopeKey] = [
    { id: 'sess-1', title: 'Task 1', model: 'gpt-5.6-sol', effort: 'ultra', access: 'read-only' },
    { id: 'sess-2', title: 'Task 2', model: 'gpt-6-astra', effort: 'medium', access: 'on-request' }
  ];

  // Select session 0 (Task 1)
  context.selectSession(0);
  let state = context.getDeviceState();
  let k18 = state.keys.find(k => k.keyId === 18);
  let k14 = state.keys.find(k => k.keyId === 14);
  let k10 = state.keys.find(k => k.keyId === 10);

  assert.equal(k18.labelMain, 'gpt-5.6-sol', 'Session 1 model must be gpt-5.6-sol');
  assert.equal(k14.labelMain, 'ultra', 'Session 1 effort must be ultra');
  assert.equal(k10.labelMain, 'read-only', 'Session 1 access must be read-only');

  // Select session 1 (Task 2)
  context.selectSession(1);
  state = context.getDeviceState();
  k18 = state.keys.find(k => k.keyId === 18);
  k14 = state.keys.find(k => k.keyId === 14);
  k10 = state.keys.find(k => k.keyId === 10);

  assert.equal(k18.labelMain, 'gpt-6-astra', 'Session 2 model must be gpt-6-astra');
  assert.equal(k14.labelMain, 'medium', 'Session 2 effort must be medium');
  assert.equal(k10.labelMain, 'on-request', 'Session 2 access must be on-request');

  // Open model editor on Session 2, choose gpt-5.6-sol (index 1)
  context.openEditor('model');
  assert.equal(context.activeEditor, 'model');
  context.commitActiveEditorChoice(1);
  assert.equal(context.activeEditor, 'none');

  state = context.getDeviceState();
  k18 = state.keys.find(k => k.keyId === 18);
  assert.equal(k18.labelMain, 'gpt-5.6-sol');
  assert.equal(context.getCurrentSession().model, 'gpt-5.6-sol', 'Committed model must persist on current session object');

  // Open effort editor, choose high (index 2)
  context.openEditor('effort');
  assert.equal(context.activeEditor, 'effort');
  context.commitActiveEditorChoice(2);
  state = context.getDeviceState();
  k14 = state.keys.find(k => k.keyId === 14);
  assert.equal(k14.labelMain, 'high');
  assert.equal(context.getCurrentSession().effort, 'high', 'Committed effort must persist on current session object');

  // Open access editor, choose auto-approve (index 1)
  context.openEditor('access');
  assert.equal(context.activeEditor, 'access');
  context.commitActiveEditorChoice(1);
  state = context.getDeviceState();
  k10 = state.keys.find(k => k.keyId === 10);
  assert.equal(k10.labelMain, 'auto-approve');
  assert.equal(context.getCurrentSession().access, 'auto-approve', 'Committed access must persist on current session object');
});

