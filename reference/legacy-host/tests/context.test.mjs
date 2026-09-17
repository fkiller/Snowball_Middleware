import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from '../dist/state/context.js';

test('ContextManager: machine and harness cycling updates scope and retains memory', () => {
  const ctx = new ContextManager();
  assert.equal(ctx.getCurrentMachine().id, 'dev-pc');
  assert.equal(ctx.getCurrentHarness().id, 'codex');

  // Add peer machine dynamically
  ctx.machines.push({ id: 'studio-peer', name: 'STUDIO', isOnline: true });

  ctx.cycleMachine();
  assert.equal(ctx.getCurrentMachine().id, 'studio-peer');

  ctx.cycleHarness();
  assert.equal(ctx.getCurrentHarness().id, 'antigravity');

  // Cycle back to dev-pc
  ctx.cycleMachine();
  assert.equal(ctx.getCurrentMachine().id, 'dev-pc');
});

test('ContextManager: project and session selection updates active destination', () => {
  const ctx = new ContextManager();
  const projs = ctx.getProjectsForCurrentScope();
  assert.ok(projs.length > 0);

  ctx.selectProject(0);
  assert.equal(ctx.getCurrentProject().id, projs[0].id);

  const sess = ctx.getSessionsForCurrentScope();
  assert.ok(sess.length > 0);

  ctx.selectSession(0);
  assert.equal(ctx.getCurrentSession().id, sess[0].id);
});

test('ContextManager: Left Knob scrolls reader lines and choice list', () => {
  const ctx = new ContextManager();
  ctx.readerLines = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6', 'Line 7', 'Line 8', 'Line 9'];
  ctx.readerScrollLine = 0;

  // Scroll down
  ctx.onLeftKnob(1);
  assert.equal(ctx.readerScrollLine, 1);

  // Scroll down more (maxScroll is 9 - 5 = 4)
  ctx.onLeftKnob(2);
  assert.equal(ctx.readerScrollLine, 3);

  // Scroll up
  ctx.onLeftKnob(-1);
  assert.equal(ctx.readerScrollLine, 2);

  // Scroll past 0 cannot go negative
  ctx.onLeftKnob(-10);
  assert.equal(ctx.readerScrollLine, 0);

  // Editor choices navigation starts at currently selected item
  ctx.selectedModelIdx = 1;
  ctx.openEditor('model');
  assert.equal(ctx.activeEditor, 'model');
  assert.equal(ctx.editorFocusIdx, 1); // starts at selected item!

  ctx.onLeftKnob(1);
  assert.equal(ctx.editorFocusIdx, 2);

  ctx.onLeftKnobClick();
  assert.equal(ctx.selectedModelIdx, 2);
  assert.equal(ctx.activeEditor, 'none');

  // Reader scroll line persists across same-session refresh
  ctx.readerScrollLine = 2;
  ctx.updateReaderForCurrentSession();
  assert.equal(ctx.readerScrollLine, 2);
});


test('ContextManager: Right Knob manages dedicated volume and mute toggle', () => {
  const ctx = new ContextManager();
  ctx.volume = 50;
  ctx.isMuted = false;

  // Volume increment
  ctx.onRightKnob(1);
  assert.equal(ctx.volume, 55);

  // Volume bounds (0..100)
  ctx.onRightKnob(20);
  assert.equal(ctx.volume, 100);

  ctx.onRightKnob(-30);
  assert.equal(ctx.volume, 0);

  // Mute toggle
  ctx.onRightKnobClick();
  assert.equal(ctx.isMuted, true);
  ctx.onRightKnobClick();
  assert.equal(ctx.isMuted, false);
});

test('ContextManager: Voice Draft auto-wraps long text across multiple lines', () => {
  const ctx = new ContextManager();
  ctx.voiceDraftText = 'This is a longer speech transcription test that needs to be cleanly wrapped into multiple lines on the MK20 screen.';
  ctx.updateReaderForCurrentSession();

  assert.equal(ctx.readerTitle, 'Voice Prompt Draft');
  assert.equal(ctx.readerLines[0], '[DRAFT PROMPT VERIFICATION]');
  // Verification that lines are wrapped
  const quoteLines = ctx.readerLines.filter(l => l.startsWith('"') && l.endsWith('"'));
  assert.ok(quoteLines.length >= 2, `Expected multi-line wrapping, got ${quoteLines.length}`);

  // Action instructions present
  assert.ok(ctx.readerLines.some(l => l.includes('[Send] (K16)')));
  assert.ok(ctx.readerLines.some(l => l.includes('[Talk] (K20)')));
  assert.ok(ctx.readerLines.some(l => l.includes('[Cancel] (K4)')));
});

test('ContextManager: Question view renders multi-choice options', () => {
  const ctx = new ContextManager();
  ctx.viewMode = 'question';
  ctx.activeQuestion = {
    id: 'call-1',
    prompt: 'Execute command: git status?',
    isMultiSelect: false,
    hasOther: false,
    isPermission: true,
    options: [
      { id: 'approve', label: 'Approve', isSelected: true },
      { id: 'deny', label: 'Deny', isSelected: false },
    ],
  };

  const sync = ctx.getDeviceState();
  assert.equal(sync.viewMode, 'question');
  assert.ok(sync.keys.length === 20);
});

test('ContextManager: Session turns formatting, detail toggle, and prompt navigation', () => {
  const ctx = new ContextManager();
  ctx.setSessionTurns([
    {
      id: 't-1',
      userPrompt: 'What is the current git status?',
      agentResponse: 'All working tree clean.',
      processDetails: ['Ran git status', 'Exit code 0'],
    },
    {
      id: 't-2',
      userPrompt: 'Add a new feature.',
      agentResponse: 'Feature implemented.',
      processDetails: ['Edited file A', 'Ran build'],
    },
  ]);

  // Default: processDetails hidden
  assert.equal(ctx.showDetails, false);
  assert.ok(ctx.readerLines.some(l => l.startsWith('[USER] What is')));
  assert.ok(ctx.readerLines.some(l => l.startsWith('[AGENT] All working')));
  assert.ok(!ctx.readerLines.some(l => l.startsWith('[PROCESS]')));

  // Toggle detail: processDetails visible
  ctx.toggleDetails();
  assert.equal(ctx.showDetails, true);
  assert.ok(ctx.readerLines.some(l => l.startsWith('[PROCESS] Ran git status')));

  // Test Prompt Jump (K19 / K15)
  assert.ok(ctx.userPromptLineIndices.length === 2);
  const prompt0 = ctx.userPromptLineIndices[0];
  const prompt1 = ctx.userPromptLineIndices[1];
  assert.equal(prompt0, 0);

  ctx.readerScrollLine = 0;
  ctx.jumpNextPrompt();
  assert.equal(ctx.readerScrollLine, prompt1);

  ctx.jumpPrevPrompt();
  assert.equal(ctx.readerScrollLine, prompt0);
});

test('ContextManager: Changes diff modal and key matrix layout', () => {
  const ctx = new ContextManager();
  const changed = [
    { path: 'host/src/state/context.ts', name: 'context.ts', status: 'M', additions: 10, deletions: 2 },
    { path: 'host/src/index.ts', name: 'index.ts', status: 'M', additions: 20, deletions: 5 },
    { path: 'hardware/mk20/hud/v2_render.c', name: 'v2_render.c', status: 'M', additions: 15, deletions: 1 },
    { path: 'README.md', name: 'README.md', status: 'M', additions: 5, deletions: 0 },
  ];

  ctx.openChangesView(changed);
  assert.equal(ctx.viewMode, 'changes');
  assert.equal(ctx.changedFiles.length, 4);
  assert.equal(ctx.selectedChangedFileIdx, 0);

  // Select file and feed diff (10 lines to verify 5 lines on top screen + 3 lines on key matrix)
  const diffLines = [
    '@@ -10,6 +10,8 @@',
    '+import { GitProvider } from "./vcs/git.js";',
    '-import { OldProvider } from "./old.js";',
    ' public class ContextManager {',
    '   private viewMode: string = "session";',
    '+  private changesLines: string[] = []; // line 6 chunked across row 2',
    '-  private oldField: boolean = false; // line 7 chunked across row 3',
    '   public constructor() { // line 8 chunked across row 4',
    '     this.init(); // line 9',
    '   }',
  ];
  ctx.selectChangesFile(0, diffLines);

  const state = ctx.getDeviceState();
  assert.equal(state.viewMode, 'changes');
  assert.equal(state.keys.length, 20);

  // (1,1) Close control (Modal origin button has selected background & file scrollbar)
  const k17 = state.keys.find(k => k.keyId === 17);
  assert.equal(k17?.labelMain, 'Changes');
  assert.equal(k17?.labelSub, 'Close');
  assert.equal(k17?.isFilled, true);
  assert.equal(k17?.scrollTotal, 4);
  assert.equal(k17?.activeItem, 0);

  // Col 0 files (K18, K19, K20) - File 0 is initially selected
  const k18 = state.keys.find(k => k.keyId === 18);
  assert.equal(k18?.labelMain, 'context.');
  assert.equal(k18?.isFilled, true);

  // Top screen has all lines in topBodyLines, starting at scroll 0
  assert.equal(state.topBodyLines.length, 10);
  assert.equal(state.topScrollLine, 0);

  // Area (2,1)-(5,4) displays dense multi-line content (up to 6 lines per key) immediately below Top Display:
  // Top Display shows lines 0..3 (4 lines).
  // Row 1 (2,1)-(5,1) -> keys [13, 9, 5, 1] packs diff lines 4..9 (6 lines) into items with colors
  const k13 = state.keys.find(k => k.keyId === 13);
  const k9 = state.keys.find(k => k.keyId === 9);
  assert.equal(k13?.isFilled, false); // view-only canvas, no selection background
  assert.equal(k13?.isLinesMode, true);
  assert.equal(k13?.items?.length, 6);
  assert.equal(k13?.itemColors?.[0], 0); // context (white)
  assert.equal(k13?.itemColors?.[1], 1); // cyan (+)
  assert.equal(k13?.itemColors?.[2], 2); // rose (-)
  assert.ok((k13?.items?.[0]?.length || 0) > 0);
  assert.equal(k9?.isLinesMode, true);
  assert.equal(k9?.items?.length, 6);
  assert.ok((k9?.items?.[0]?.length || 0) > 0);

  // Row 2..4 have no lines beyond line 10, so they are disabled
  const k14 = state.keys.find(k => k.keyId === 14);
  assert.equal(k14?.isDisabled, true);

  // Left knob scroll in diff mode moves line-by-line (delta = +1)
  ctx.onLeftKnob(1);
  assert.equal(ctx.readerScrollLine, 1);
  const scrolledState = ctx.getDeviceState();
  const k13Scrolled = scrolledState.keys.find(k => k.keyId === 13);
  assert.equal(k13Scrolled?.isLinesMode, true);
  assert.equal(k13Scrolled?.items?.length, 5); // lines 5..9
  assert.equal(k13Scrolled?.itemColors?.[0], 1); // shifted: line 5 is now first line in Row 1 (cyan +)

  // Toggle file selection via Left Knob Click (or pressing the selected file key again)
  ctx.onLeftKnobClick();
  assert.equal(ctx.isChangesFileSelected, false);
  const deselectedState = ctx.getDeviceState();
  const k18Deselected = deselectedState.keys.find(k => k.keyId === 18);
  assert.equal(k18Deselected?.isFilled, false); // deselected!
  assert.equal(k18Deselected?.isFocused, true); // focused cursor outline!

  // In file browsing mode, Left Knob scrolls through changed files list
  ctx.onLeftKnob(1);
  assert.equal(ctx.selectedChangedFileIdx, 1);
  const scrolledFileState = ctx.getDeviceState();
  const k19Focused = scrolledFileState.keys.find(k => k.keyId === 19);
  assert.equal(k19Focused?.isFocused, true);
  assert.equal(k19Focused?.isFilled, false);

  // Left Knob Click selects the focused file and returns to diff scroll mode
  ctx.onLeftKnobClick();
  assert.equal(ctx.isChangesFileSelected, true);
  const reselectedState = ctx.getDeviceState();
  const k19Reselected = reselectedState.keys.find(k => k.keyId === 19);
  assert.equal(k19Reselected?.isFilled, true); // selected background restored!
});

test('ContextManager: Files Dual-Mode browser grid and content viewer', () => {
  const ctx = new ContextManager();
  ctx.viewMode = 'workspace';
  ctx.workspaceFiles = [
    { name: 'file0.txt', isDir: false, size: '1KB' },
    { name: 'file1.txt', isDir: false, size: '2KB' },
    { name: 'file2.txt', isDir: false, size: '3KB' },
    { name: 'file3.txt', isDir: false, size: '4KB' },
    { name: 'file4.txt', isDir: false, size: '5KB' },
    { name: 'file5.txt', isDir: false, size: '6KB' },
    { name: 'file6.txt', isDir: false, size: '7KB' },
    { name: 'file7.txt', isDir: false, size: '8KB' },
    { name: 'file8.txt', isDir: false, size: '9KB' },
    { name: 'file9.txt', isDir: false, size: '10KB' },
    { name: 'file10.txt', isDir: false, size: '11KB' },
    { name: 'file11.txt', isDir: false, size: '12KB' },
    { name: 'file12.txt', isDir: false, size: '13KB' },
    { name: 'file13.txt', isDir: false, size: '14KB' },
    { name: 'file14.txt', isDir: false, size: '15KB' },
    { name: 'file15.txt', isDir: false, size: '16KB' },
    { name: 'file16.txt', isDir: false, size: '17KB' },
    { name: 'file17.txt', isDir: false, size: '18KB' },
  ];

  // 1. Initial Full Browser Mode:
  const state = ctx.getDeviceState();
  assert.equal(state.viewMode, 'workspace');
  assert.equal(state.keys.length, 20);

  // K17 is Close with selected background fill
  const k17 = state.keys.find(k => k.keyId === 17);
  assert.equal(k17?.labelMain, 'Files');
  assert.equal(k17?.labelSub, 'Close');
  assert.equal(k17?.isFilled, true);

  // K18 is Up, K19 is Root, K20 is Item count
  assert.equal(state.keys.find(k => k.keyId === 18)?.labelMain, 'Up');
  assert.equal(state.keys.find(k => k.keyId === 19)?.labelMain, 'Home');
  assert.equal(state.keys.find(k => k.keyId === 20)?.labelMain, '1/18');

  // Item 0 is at (2,1) = K13. It should be pre-selected: isFocused = true, isFilled = false
  const k13 = state.keys.find(k => k.keyId === 13);
  assert.equal(k13?.labelMain, 'file0.txt');
  assert.equal(k13?.isFocused, true);
  assert.equal(k13?.isFilled, false);

  // Item 1 is at (3,1) = K9. It should NOT be focused
  const k9 = state.keys.find(k => k.keyId === 9);
  assert.equal(k9?.labelMain, 'file1.txt');
  assert.equal(k9?.isFocused, false);

  // Move knob delta = +1 -> cursor moves to item 1 (K9)
  ctx.onLeftKnob(1);
  assert.equal(ctx.workspaceCursorIdx, 1);
  const state2 = ctx.getDeviceState();
  assert.equal(state2.keys.find(k => k.keyId === 13)?.isFocused, false);
  assert.equal(state2.keys.find(k => k.keyId === 9)?.isFocused, true);

  // Move knob to item 16 (past 4x4 grid bounds -> should auto-scroll by 1 row = 4 items)
  ctx.onLeftKnob(15);
  assert.equal(ctx.workspaceCursorIdx, 16);
  assert.equal(ctx.workspaceScrollRow, 1); // Row scrolled from 0 to 1!

  // 2. Open File Viewer Mode for file 1
  const contentLines = [
    'line 0: header',
    'line 1: import modules',
    'line 2: setup config',
    'line 3: init service',
    'line 4: run app',
    'line 5: listen port',
    'line 6: handle req',
    'line 7: process data',
    'line 8: send resp',
    'line 9: cleanup',
  ];
  ctx.openWorkspaceViewer(1, contentLines);
  assert.equal(ctx.isWorkspaceViewerActive, true);

  const viewerState = ctx.getDeviceState();
  // K17 has file scrollbar
  const v17 = viewerState.keys.find(k => k.keyId === 17);
  assert.equal(v17?.scrollTotal, 18);
  assert.equal(v17?.activeItem, 1);

  // Col 1 shows files, file 1 (K19) has selected background
  const v19 = viewerState.keys.find(k => k.keyId === 19);
  assert.equal(v19?.labelMain, 'file1.tx');
  assert.equal(v19?.isFilled, true);

  // (2,1)-(5,4) is in isLinesMode
  const v13 = viewerState.keys.find(k => k.keyId === 13);
  assert.equal(v13?.isLinesMode, true);

  // Left knob rotation in viewer mode scrolls content line-by-line
  ctx.onLeftKnob(1);
  assert.equal(ctx.readerScrollLine, 1);

  // Left knob click exits back to Full File Browser Mode with cursor preserved!
  ctx.onLeftKnobClick();
  assert.equal(ctx.isWorkspaceViewerActive, false);
  assert.equal(ctx.workspaceCursorIdx, 1);
});



