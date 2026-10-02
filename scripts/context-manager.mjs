import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';
import * as cp from 'node:child_process';

export function stringDisplayWidth(str) {
  let w = 0;
  for (const char of String(str || '')) {
    w += char.codePointAt(0) < 128 ? 1 : 2;
  }
  return w;
}

export function safeText(str, maxBytes) {
  if (!str) return '';
  let out = '';
  for (const ch of String(str)) {
    if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
    out += ch;
  }
  return out;
}

export function wrapText(text, maxLen = 50) {
  if (!text) return [''];
  const lines = [];
  for (const raw of String(text).split('\n')) {
    let line = '', width = 0;
    for (const char of raw.replace(/\t/g, '    ').replace(/\r/g, '')) {
      const advance = char.codePointAt(0) < 128 ? 1 : 2;
      if (width + advance > maxLen) {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += char;
      width += advance;
    }
    lines.push(line);
  }
  return lines;
}

export function wrapWithPrefix(text, firstPrefix, contPrefix, maxLen = 50) {
  if (!text) return [];
  const trimmed = String(text).trim().replace(/\n{3,}/g, '\n\n');
  if (!trimmed) return [];
  const lines = [];
  const firstPWidth = stringDisplayWidth(firstPrefix);
  const contPWidth = stringDisplayWidth(contPrefix);
  const firstMax = Math.max(1, maxLen - firstPWidth);
  const contMax = Math.max(1, maxLen - contPWidth);

  let isFirst = true;
  for (const raw of trimmed.split('\n')) {
    if (raw.trim() === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }
    let line = '', width = 0;
    for (const char of raw.replace(/\t/g, '    ').replace(/\r/g, '')) {
      const advance = char.codePointAt(0) < 128 ? 1 : 2;
      const curMax = isFirst ? firstMax : contMax;
      if (width + advance > curMax) {
        lines.push((isFirst ? firstPrefix : contPrefix) + line);
        isFirst = false;
        line = '';
        width = 0;
      }
      line += char;
      width += advance;
    }
    if (line) {
      lines.push((isFirst ? firstPrefix : contPrefix) + line);
      isFirst = false;
    }
  }
  return lines;
}

export function sliceLineIntoChunks(line, chunkCount = 4, chunkWidth = 15) {
  const chunks = [];
  let currentChunk = '';
  let currentWidth = 0;
  let chunkIdx = 0;

  for (const char of String(line || '').replace(/\t/g, '  ').replace(/\r/g, '')) {
    const advance = char.codePointAt(0) < 128 ? 1 : 2;
    if (currentWidth + advance > chunkWidth) {
      if (chunkIdx < chunkCount - 1) {
        chunks.push(currentChunk);
        currentChunk = '';
        currentWidth = 0;
        chunkIdx++;
      } else {
        break;
      }
    }
    currentChunk += char;
    currentWidth += advance;
  }
  chunks.push(currentChunk);
  while (chunks.length < chunkCount) {
    chunks.push('');
  }
  return chunks;
}

export class GitProvider {
  static async getChangedFiles(cwd = process.cwd()) {
    return new Promise(resolve => {
      cp.execFile('git', ['status', '--porcelain=v1', '-z', '-uall'],
        { cwd, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        const entries = stdout.split('\0');
        const files = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.length < 4) continue;
          const status = entry.slice(0, 2);
          const filePath = entry.slice(3);
          if (/[RC]/.test(status)) i++; // -z emits destination then source.
          files.push({ path: filePath, name: path.basename(filePath), status: status.trim(), additions: 0, deletions: 0 });
        }
        resolve(files);
      });
    });
  }

  static async getFileDiff(filePath, cwd = process.cwd()) {
    const root = path.resolve(cwd);
    const fullPath = path.resolve(root, filePath);
    const within = target => {
      const rel = path.relative(root, target);
      return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
    };
    if (typeof filePath !== 'string' || filePath.includes('\0') || !within(fullPath)) return ['File is outside the selected project'];
    try { if (!within(syncFs.realpathSync(fullPath))) return ['File is outside the selected project']; } catch {}
    return new Promise(resolve => {
      const options = { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 };
      const lines = output => output.split('\n').map(line => line.replace(/\r$/, ''));
      cp.execFile('git', ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', filePath], options, (err, stdout) => {
        if (!err && stdout.trim()) return resolve(lines(stdout));
        cp.execFile('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', fullPath], options, (_err, output) => {
          if (output.trim()) return resolve(lines(output));
          resolve([`No changes detected for ${filePath}`]);
        });
      });
    });
  }
}

export class ContextManager {
  constructor() {
    this.machines = [{ id: 'dev-pc', name: os.hostname().split('.')[0] || 'DEV-PC', isOnline: true }];
    this.harnesses = [
      { id: 'snowball.codex', name: 'Codex', isEnabled: true },
      { id: 'snowball.antigravity', name: 'Antigrav', isEnabled: true },
      { id: 'snowball.opencode', name: 'OpenCode', isEnabled: true }
    ];
    this.projectsByScope = {};
    this.sessionsByScope = {};
    this.modelCatalogs = new Map();
    this.modelSelectionScope = '';
    this.accessLevels = [];

    this.selectedMachineIdx = 0;
    this.selectedHarnessIdx = 0;
    this.selectedProjectIdx = 0;
    this.selectedSessionIdx = 0;
    this.sttEngineLabel = 'Whisper AI Engine';
    this.selectedModelIdx = 0;
    this.selectedEffortIdx = -1;
    this.selectedAccessIdx = 0;

    this.viewMode = 'session'; // session | workspace | changes | question | settings
    this.activeEditor = 'none'; // none | machine | harness | project | session | model | effort | access
    this.editorChoiceWindowStart = 0;
    this.editorFocusIdx = 0;

    // Files Modal (workspace)
    this.workspaceFiles = [];
    this.workspaceScrollRow = 0;
    this.workspaceCursorIdx = 0;
    this.workspaceSelectedFileIdx = 0;
    this.isWorkspaceViewerActive = false;
    this.workspaceFileContentLines = [];
    this.filePath = process.cwd();
    this.fileRoot = process.cwd();

    // Git Changes Modal
    this.changedFiles = [];
    this.selectedChangedFileIdx = 0;
    this.changesFilePage = 0;
    this.isChangesFileSelected = true;
    this.currentFileDiffLines = [];

    // Turns & Prompt Navigation
    this.currentTurns = [];
    this.showDetails = false;
    this.userPromptLineIndices = [];

    // Knobs & Audio
    this.volume = 75;
    this.isMuted = false;
    this.isSpeaking = false;
    this.isRecordingVoice = false;
    this.isTranscribingVoice = false;
    this.voiceDraftText = '';
    this.voiceDestinationLabel = '';
    this.voiceSubmission = 'idle';
    this.lastDispatchError = null;

    // Reader Top Screen
    this.readerTitle = 'Snowball Middleware';
    this.readerSubtitle = 'Session Active';
    this.readerLines = ['Connecting to local middleware...'];
    this.readerScrollLine = 0;
    this.lastReaderModeKey = '';

    // Scope Memory
    this.memoryHarnessPerMachine = new Map();
    this.memoryProjectPerHarness = new Map();
    this.memorySessionPerProject = new Map();

    this.updateReaderForCurrentSession();
  }

  syncSessionSettings() {
    const curSess = this.getCurrentSession();
    const catalog = this.currentModelCatalog();
    if (!catalog || catalog.length === 0) return;

    // 1. Model: match session's model or default model in catalog
    if (curSess && curSess.model) {
      const mIdx = catalog.findIndex(m =>
        m.model === curSess.model ||
        m.id === curSess.model ||
        m.displayName === curSess.model ||
        (typeof curSess.model === 'string' && curSess.model.includes('/') && m.model.endsWith(curSess.model.split('/')[1])) ||
        (typeof m.model === 'string' && m.model.includes('/') && typeof curSess.model === 'string' && curSess.model.endsWith(m.model.split('/')[1]))
      );
      this.selectedModelIdx = mIdx >= 0 ? mIdx : Math.max(0, catalog.findIndex(m => m.isDefault));
    } else {
      const defIdx = catalog.findIndex(m => m.isDefault);
      this.selectedModelIdx = defIdx >= 0 ? defIdx : 0;
      if (curSess && this.models[this.selectedModelIdx]) {
        curSess.model = this.models[this.selectedModelIdx];
      }
    }

    // 2. Effort: match session's effort or model's default effort
    const curModel = catalog[this.selectedModelIdx];
    const supportedEfforts = curModel?.efforts || [];
    if (curSess && curSess.effort && supportedEfforts.includes(curSess.effort)) {
      this.selectedEffortIdx = supportedEfforts.indexOf(curSess.effort);
    } else if (curModel?.defaultEffort && supportedEfforts.includes(curModel.defaultEffort)) {
      this.selectedEffortIdx = supportedEfforts.indexOf(curModel.defaultEffort);
      if (curSess) curSess.effort = curModel.defaultEffort;
    } else {
      this.selectedEffortIdx = supportedEfforts.length > 0 ? 0 : -1;
      if (curSess && this.selectedEffortIdx >= 0) curSess.effort = supportedEfforts[0];
    }

    // 3. Access: match session's access or default 'on-request'
    if (curSess && curSess.access && this.accessLevels.includes(curSess.access)) {
      this.selectedAccessIdx = this.accessLevels.indexOf(curSess.access);
    } else {
      const reqIdx = this.accessLevels.indexOf('on-request');
      this.selectedAccessIdx = reqIdx >= 0 ? reqIdx : 0;
      if (curSess && this.accessLevels.length > 0) curSess.access = this.accessLevels[this.selectedAccessIdx];
    }
  }

  setModelCatalog(models, scope = this.getScopeKey()) {
    if (!Array.isArray(models) || models.some(m => !m || typeof m.model !== 'string' || !m.model || !Array.isArray(m.efforts) || m.efforts.some(e => typeof e !== 'string'))) throw new Error('Invalid provider model catalog');
    this.modelCatalogs.set(scope, structuredClone(models));
    if (scope === this.getScopeKey()) {
      this.syncSessionSettings();
    }
  }

  currentModelCatalog() {
    const scope = this.getScopeKey();
    if (this.modelSelectionScope !== scope) {
      this.modelSelectionScope = scope;
      this.syncSessionSettings();
    }
    return this.modelCatalogs.get(scope) ?? [];
  }
  get models() { return this.currentModelCatalog().map(m => m.model); }
  get efforts() { return this.currentModelCatalog()[this.selectedModelIdx]?.efforts ?? []; }
  getExecutionSettings() {
    const model = this.models[this.selectedModelIdx];
    if (!model) return {};
    const effort = this.efforts[this.selectedEffortIdx];
    return { model, ...(effort ? { effort } : {}) };
  }

  getScopeKey() {
    const m = this.getCurrentMachine().id;
    const h = this.getCurrentHarness().id;
    return `${m}/${h}`;
  }

  getFullScopeKey() {
    const m = this.getCurrentMachine().id;
    const h = this.getCurrentHarness().id;
    const p = this.getCurrentProject().id;
    return `${m}/${h}/${p}`;
  }

  getCurrentMachine() {
    return this.machines[this.selectedMachineIdx % this.machines.length] || { id: 'dev-pc', name: 'DEV-PC', isOnline: true };
  }

  getCurrentHarness() {
    return this.harnesses[this.selectedHarnessIdx % this.harnesses.length] || { id: 'snowball.codex', name: 'Codex', isEnabled: true };
  }

  getProjectsForCurrentScope() {
    const key = this.getScopeKey();
    if (this.projectsByScope[key] && this.projectsByScope[key].length > 0) {
      return this.projectsByScope[key];
    }
    return [];
  }

  getCurrentProject() {
    const projs = this.getProjectsForCurrentScope();
    return projs[this.selectedProjectIdx % projs.length] || projs[0] || { id: 'none', name: 'None', path: '' };
  }

  getSessionsForCurrentScope() {
    const key = this.getFullScopeKey();
    if (this.sessionsByScope[key] && this.sessionsByScope[key].length > 0) {
      return this.sessionsByScope[key];
    }
    return [];
  }

  getCurrentSession() {
    const sess = this.getSessionsForCurrentScope();
    return sess[this.selectedSessionIdx % sess.length] || sess[0] || { id: 'none', title: 'Empty', preview: '', createdAt: 0 };
  }

  setSessionTurns(turns) {
    this.currentTurns = Array.isArray(turns) ? turns : [];
    this.updateReaderForCurrentSession();
    if (this.userPromptLineIndices.length > 0) {
      this.readerScrollLine = this.userPromptLineIndices[this.userPromptLineIndices.length - 1];
    } else {
      this.readerScrollLine = Math.max(0, this.readerLines.length - 4);
    }
  }

  toggleDetails() {
    this.showDetails = !this.showDetails;
    this.updateReaderForCurrentSession();
  }

  jumpPrevPrompt() {
    if (this.userPromptLineIndices.length === 0) return;
    const prevs = this.userPromptLineIndices.filter(idx => idx < this.readerScrollLine);
    if (prevs.length > 0) {
      this.readerScrollLine = prevs[prevs.length - 1];
    } else {
      this.readerScrollLine = this.userPromptLineIndices[0];
    }
  }

  jumpNextPrompt() {
    if (this.userPromptLineIndices.length === 0) return;
    const nexts = this.userPromptLineIndices.filter(idx => idx > this.readerScrollLine);
    if (nexts.length > 0) {
      this.readerScrollLine = nexts[0];
    } else {
      this.readerScrollLine = Math.max(0, this.readerLines.length - 4);
    }
  }

  saveActiveSessionState() {
    const curSess = this.getCurrentSession();
    if (!curSess) return;
    curSess.voiceDraftText = this.voiceDraftText;
    curSess.voiceSubmission = this.voiceSubmission;
    curSess.lastDispatchError = this.lastDispatchError;
    curSess.isRecordingVoice = this.isRecordingVoice;
    curSess.isTranscribingVoice = this.isTranscribingVoice;
    curSess.transcribingSeconds = this.transcribingSeconds;
    curSess.voiceDestinationLabel = this.voiceDestinationLabel;
    curSess.readerScrollLine = this.readerScrollLine;
    curSess.showDetails = this.showDetails;
    if (this.currentTurns && Array.isArray(this.currentTurns)) {
      curSess.turns = [...this.currentTurns];
      curSess.turnCount = this.currentTurns.length;
    }
  }

  restoreActiveSessionState() {
    const curSess = this.getCurrentSession();
    if (curSess) {
      this.voiceDraftText = curSess.voiceDraftText || '';
      this.voiceSubmission = curSess.voiceSubmission || 'idle';
      this.lastDispatchError = curSess.lastDispatchError || null;
      this.isRecordingVoice = curSess.isRecordingVoice || false;
      this.isTranscribingVoice = curSess.isTranscribingVoice || false;
      this.transcribingSeconds = curSess.transcribingSeconds || 0;
      this.voiceDestinationLabel = curSess.title || '';
      this.readerScrollLine = curSess.readerScrollLine || 0;
      this.showDetails = curSess.showDetails || false;
      if (curSess.turns && Array.isArray(curSess.turns)) {
        this.currentTurns = [...curSess.turns];
      } else {
        this.currentTurns = [];
      }
    } else {
      this.voiceDraftText = '';
      this.voiceSubmission = 'idle';
      this.lastDispatchError = null;
      this.isRecordingVoice = false;
      this.isTranscribingVoice = false;
      this.transcribingSeconds = 0;
      this.voiceDestinationLabel = '';
      this.readerScrollLine = 0;
      this.showDetails = false;
      this.currentTurns = [];
    }
    this.syncSessionSettings();
  }

  cycleMachine() {
    this.saveActiveSessionState();
    this.selectedMachineIdx = (this.selectedMachineIdx + 1) % this.machines.length;
    this.resolveProjectAndSession();
    this.activeEditor = 'none';
    this.restoreActiveSessionState();
    this.updateReaderForCurrentSession();
  }

  cycleHarness() {
    this.saveActiveSessionState();
    this.selectedHarnessIdx = (this.selectedHarnessIdx + 1) % this.harnesses.length;
    this.memoryHarnessPerMachine.set(this.getCurrentMachine().id, this.getCurrentHarness().id);
    this.resolveProjectAndSession();
    this.activeEditor = 'none';
    this.restoreActiveSessionState();
    this.updateReaderForCurrentSession();
  }

  selectProject(idx) {
    const projs = this.getProjectsForCurrentScope();
    if (idx >= 0 && idx < projs.length) {
      this.saveActiveSessionState();
      this.selectedProjectIdx = idx;
      this.memoryProjectPerHarness.set(this.getScopeKey(), projs[idx].id);
      this.resolveSession();
      this.activeEditor = 'none';
      this.restoreActiveSessionState();
      this.updateReaderForCurrentSession();
    }
  }

  selectSession(idx) {
    const sess = this.getSessionsForCurrentScope();
    if (idx >= 0 && idx < sess.length) {
      this.saveActiveSessionState();
      this.selectedSessionIdx = idx;
      this.memorySessionPerProject.set(this.getFullScopeKey(), sess[idx].id);
      this.activeEditor = 'none';
      this.restoreActiveSessionState();
      this.updateReaderForCurrentSession();
    }
  }

  resolveProjectAndSession() {
    const scopeKey = this.getScopeKey();
    const projs = this.getProjectsForCurrentScope();
    const rememberedProjId = this.memoryProjectPerHarness.get(scopeKey);
    if (rememberedProjId) {
      const pIdx = projs.findIndex(p => p.id === rememberedProjId);
      this.selectedProjectIdx = pIdx >= 0 ? pIdx : 0;
    } else {
      this.selectedProjectIdx = 0;
    }
    this.resolveSession();
  }

  resolveSession() {
    const fullScopeKey = this.getFullScopeKey();
    const sess = this.getSessionsForCurrentScope();
    const rememberedSessId = this.memorySessionPerProject.get(fullScopeKey);
    if (rememberedSessId) {
      const sIdx = sess.findIndex(s => s.id === rememberedSessId);
      this.selectedSessionIdx = sIdx >= 0 ? sIdx : 0;
    } else {
      this.selectedSessionIdx = 0;
    }
    this.restoreActiveSessionState();
  }

  openEditor(field) {
    if (this.activeEditor === field) {
      this.activeEditor = 'none';
    } else {
      this.activeEditor = field;
      switch (field) {
        case 'harness': this.editorFocusIdx = this.selectedHarnessIdx; break;
        case 'machine': this.editorFocusIdx = this.selectedMachineIdx; break;
        case 'project': this.editorFocusIdx = this.selectedProjectIdx; break;
        case 'session': this.editorFocusIdx = this.selectedSessionIdx; break;
        case 'model': this.editorFocusIdx = Math.max(0, this.selectedModelIdx); break;
        case 'effort': this.editorFocusIdx = Math.max(0, this.selectedEffortIdx); break;
        case 'access': this.editorFocusIdx = Math.max(0, this.selectedAccessIdx); break;
        default: this.editorFocusIdx = 0; break;
      }
      this.editorChoiceWindowStart = Math.max(0, this.editorFocusIdx - 2);
    }
    this.updateReaderForCurrentSession();
  }

  getEditorChoiceCount() {
    switch (this.activeEditor) {
      case 'harness': return this.harnesses.length;
      case 'machine': return this.machines.length;
      case 'project': return this.getProjectsForCurrentScope().length;
      case 'session': return this.getSessionsForCurrentScope().length;
      case 'model': return this.models.length;
      case 'effort': return this.efforts.length;
      case 'access': return this.accessLevels.length;
      default: return 0;
    }
  }

  commitActiveEditorChoice(idx) {
    const s = this.getCurrentSession();
    switch (this.activeEditor) {
      case 'harness':
        if (idx >= 0 && idx < this.harnesses.length) {
          this.saveActiveSessionState();
          this.selectedHarnessIdx = idx;
          this.memoryHarnessPerMachine.set(this.getCurrentMachine().id, this.getCurrentHarness().id);
          this.resolveProjectAndSession();
          this.restoreActiveSessionState();
        }
        break;
      case 'machine':
        if (idx >= 0 && idx < this.machines.length) {
          this.saveActiveSessionState();
          this.selectedMachineIdx = idx;
          this.resolveProjectAndSession();
          this.restoreActiveSessionState();
        }
        break;
      case 'project':
        this.selectProject(idx);
        break;
      case 'session':
        this.selectSession(idx);
        break;
      case 'model':
        if (idx >= 0 && idx < this.models.length) {
          this.selectedModelIdx = idx;
          if (s) s.model = this.models[idx];
          const curModel = this.currentModelCatalog()[idx];
          const defEffort = curModel?.defaultEffort || curModel?.efforts?.[0];
          const eIdx = (curModel?.efforts || []).indexOf(defEffort);
          this.selectedEffortIdx = eIdx >= 0 ? eIdx : 0;
          if (s) s.effort = curModel?.efforts?.[this.selectedEffortIdx];
        }
        break;
      case 'effort':
        if (idx >= 0 && idx < this.efforts.length) {
          this.selectedEffortIdx = idx;
          if (s) s.effort = this.efforts[idx];
        }
        break;
      case 'access':
        if (idx >= 0 && idx < this.accessLevels.length) {
          this.selectedAccessIdx = idx;
          if (s) s.access = this.accessLevels[idx];
        }
        break;
    }
    this.activeEditor = 'none';
    this.updateReaderForCurrentSession();
  }

  // --- Files Modal ---
  async readWorkspaceFiles(directory = this.getCurrentProject().path) {
    try {
      const project = this.getCurrentProject();
      if (project.id === 'none' || !project.path || !path.isAbsolute(project.path)) throw new Error('Select a real project before browsing files');
      const root = await fs.realpath(project.path);
      let target = directory;
      try { target = await fs.realpath(directory); } catch { target = root; }
      
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        target = root;
      }

      const entries = await fs.readdir(target, { withFileTypes: true });
      this.filePath = target;
      this.fileRoot = root;
      this.isWorkspaceViewerActive = false;

      const mapped = entries
        .filter(e => !e.isSymbolicLink() && e.name !== '.git' && !e.name.startsWith('.'))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));

      if (path.relative(root, target) !== '') {
        this.workspaceFiles = [{ name: '..', isDir: true }, ...mapped];
      } else {
        this.workspaceFiles = mapped;
      }
      this.workspaceScrollRow = 0;
      this.workspaceCursorIdx = 0;
      this.viewMode = 'workspace';
      this.activeEditor = 'none';
      this.updateReaderForCurrentSession();
    } catch (err) {
      console.warn('[Workspace] Read error:', err.message);
    }
  }

  moveWorkspaceCursor(delta) {
    if (this.workspaceFiles.length === 0) return;
    this.workspaceCursorIdx = Math.max(0, Math.min(this.workspaceFiles.length - 1, this.workspaceCursorIdx + delta));
    if (this.workspaceCursorIdx < this.workspaceScrollRow * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4);
    } else if (this.workspaceCursorIdx >= (this.workspaceScrollRow + 4) * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4) - 3;
    }
    const maxRow = Math.max(0, Math.ceil(this.workspaceFiles.length / 4) - 4);
    this.workspaceScrollRow = Math.max(0, Math.min(maxRow, this.workspaceScrollRow));
    this.updateReaderForCurrentSession();
  }

  async openFileContent(fileIdx, fileName) {
    try {
      const project = this.getCurrentProject();
      if (project.id === 'none' || !project.path || !path.isAbsolute(project.path)) throw new Error('Select a real project before previewing files');
      const root = await fs.realpath(project.path);
      const full = await fs.realpath(path.join(this.filePath, fileName));
      const relative = path.relative(root, full);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('File is outside the selected project');
      const stat = await fs.stat(full);
      if (stat.size > 256000) throw new Error('File exceeds 256KB preview limit');
      const text = await fs.readFile(full, 'utf8');
      if (text.includes('\0')) throw new Error('Binary file has no text preview');
      const lines = wrapText(text, 60);
      this.isWorkspaceViewerActive = true;
      this.workspaceSelectedFileIdx = fileIdx;
      this.workspaceFileContentLines = lines;
      this.readerScrollLine = 0;
      this.updateReaderForCurrentSession();
    } catch (err) {
      console.warn('[Workspace] File open error:', err.message);
    }
  }

  closeWorkspaceViewer() {
    this.isWorkspaceViewerActive = false;
    this.workspaceCursorIdx = this.workspaceSelectedFileIdx;
    this.updateReaderForCurrentSession();
  }

  // --- Changes Diff Modal ---
  openChangesView(files) {
    this.viewMode = 'changes';
    this.changedFiles = Array.isArray(files) ? files : [];
    this.selectedChangedFileIdx = 0;
    this.changesFilePage = 0;
    this.isChangesFileSelected = true;
    this.currentFileDiffLines = [];
    this.readerScrollLine = 0;
    this.updateReaderForCurrentSession();
  }

  selectChangesFile(idx, diffLines) {
    if (idx >= 0 && idx < this.changedFiles.length) {
      this.selectedChangedFileIdx = idx;
      this.changesFilePage = Math.floor(idx / 3);
    }
    this.isChangesFileSelected = true;
    if (diffLines !== undefined) {
      this.currentFileDiffLines = diffLines;
    }
    this.readerScrollLine = 0;
    this.updateReaderForCurrentSession();
  }

  toggleChangesFileSelection() {
    this.isChangesFileSelected = !this.isChangesFileSelected;
    this.updateReaderForCurrentSession();
  }

  scrollChangesFiles(delta) {
    if (this.changedFiles.length === 0) return;
    this.selectedChangedFileIdx = Math.max(0, Math.min(this.changedFiles.length - 1, this.selectedChangedFileIdx + delta));
    this.changesFilePage = Math.floor(this.selectedChangedFileIdx / 3);
    this.readerScrollLine = 0;
    this.updateReaderForCurrentSession();
  }

  pageChangesFiles(delta) {
    const maxPages = Math.max(0, Math.ceil(this.changedFiles.length / 3) - 1);
    this.changesFilePage = Math.max(0, Math.min(maxPages, this.changesFilePage + delta));
    this.updateReaderForCurrentSession();
  }

  // --- Knobs ---
  onLeftKnob(delta) {
    if (this.viewMode === 'changes') {
      if (!this.isChangesFileSelected) {
        this.scrollChangesFiles(delta);
      } else {
        const maxScroll = Math.max(0, this.readerLines.length - 4);
        this.readerScrollLine = Math.max(0, Math.min(maxScroll, this.readerScrollLine + delta));
        this.updateReaderForCurrentSession();
      }
    } else if (this.viewMode === 'workspace') {
      if (this.isWorkspaceViewerActive) {
        const total = this.workspaceFileContentLines.length;
        this.readerScrollLine = Math.max(0, Math.min(Math.max(0, total - 4), this.readerScrollLine + delta));
        this.updateReaderForCurrentSession();
      } else {
        this.moveWorkspaceCursor(delta);
      }
    } else if (this.viewMode === 'session') {
      if (this.activeEditor !== 'none') {
        const count = this.getEditorChoiceCount();
        this.editorFocusIdx = Math.max(0, Math.min(count - 1, this.editorFocusIdx + delta));
        if (this.editorFocusIdx < this.editorChoiceWindowStart) {
          this.editorChoiceWindowStart = this.editorFocusIdx;
        } else if (this.editorFocusIdx >= this.editorChoiceWindowStart + 5) {
          this.editorChoiceWindowStart = this.editorFocusIdx - 4;
        }
        this.updateReaderForCurrentSession();
      } else {
        const maxScroll = Math.max(0, this.readerLines.length - 4);
        this.readerScrollLine = Math.max(0, Math.min(maxScroll, this.readerScrollLine + delta));
        this.updateReaderForCurrentSession();
      }
    }
  }

  async onLeftKnobClick() {
    if (this.viewMode === 'changes') {
      this.toggleChangesFileSelection();
    } else if (this.viewMode === 'workspace') {
      if (this.isWorkspaceViewerActive) {
        this.closeWorkspaceViewer();
      } else {
        const item = this.workspaceFiles[this.workspaceCursorIdx];
        if (item) {
          if (item.isDir) {
            if (item.name === '..') {
              const isAtRoot = path.normalize(this.filePath).toLowerCase() === path.normalize(this.fileRoot).toLowerCase();
              const parent = isAtRoot ? this.fileRoot : path.dirname(this.filePath);
              await this.readWorkspaceFiles(parent);
            } else {
              await this.readWorkspaceFiles(path.join(this.filePath, item.name));
            }
          } else {
            await this.openFileContent(this.workspaceCursorIdx, item.name);
          }
        }
      }
    } else if (this.activeEditor !== 'none') {
      this.commitActiveEditorChoice(this.editorFocusIdx);
    }
  }

  onRightKnob(delta) {
    this.volume = Math.max(0, Math.min(100, this.volume + delta * 5));
  }

  onRightKnobClick() {
    this.isMuted = !this.isMuted;
  }

  updateReaderForCurrentSession() {
    const m = this.getCurrentMachine();
    const h = this.getCurrentHarness();
    const p = this.getCurrentProject();
    const s = this.getCurrentSession();

    let currentModeKey = '';

    if (this.viewMode === 'settings') {
      currentModeKey = 'settings';
      this.readerTitle = 'Settings';
      this.readerSubtitle = 'Snowball Control | Middleware';
      this.readerLines = ['Local Control Online', 'K17: Close settings'];
    } else if (this.activeEditor !== 'none') {
      let title = '', subtitle = '', items = [];
      switch (this.activeEditor) {
        case 'project': {
          const projs = this.getProjectsForCurrentScope();
          title = `PROJECTS (${projs.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = projs.map(pr => ({ label: pr.name, detail: pr.path }));
          break;
        }
        case 'session': {
          const sess = this.getSessionsForCurrentScope();
          title = `SESSIONS (${sess.length})`;
          subtitle = `${p.name} | Click: select`;
          items = sess.map(sn => ({ label: sn.title || 'Untitled', detail: sn.preview || sn.id.slice(0, 10) }));
          break;
        }
        case 'machine': {
          title = `MACHINES (${this.machines.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = this.machines.map(mn => ({ label: mn.name, detail: mn.isOnline ? 'Online' : 'Offline' }));
          break;
        }
        case 'harness': {
          title = `HARNESSES (${this.harnesses.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = this.harnesses.map(hn => ({ label: hn.name, detail: hn.isEnabled ? 'Ready' : 'Disabled' }));
          break;
        }
        case 'model': {
          const catalog = this.currentModelCatalog();
          title = `MODELS (${catalog.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = catalog.map(m => {
            const label = (m.displayName && m.model.includes('/')) ? m.displayName : m.model;
            const detail = label !== m.model ? m.model : '';
            return { label, detail };
          });
          break;
        }
        case 'effort': {
          title = `EFFORT (${this.efforts.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = this.efforts.map(ef => ({ label: ef }));
          break;
        }
        case 'access': {
          title = `ACCESS (${this.accessLevels.length})`;
          subtitle = 'Knob: browse | Click: select';
          items = this.accessLevels.map(ac => ({ label: ac }));
          break;
        }
      }

      const focusIdx = Math.max(0, Math.min(items.length - 1, this.editorFocusIdx));
      this.editorFocusIdx = focusIdx;

      const lines = [];
      items.forEach((it, idx) => {
        const isFoc = idx === focusIdx;
        const prefix = isFoc ? '[>' : '  ';
        const suffix = isFoc ? '<]' : '  ';
        const num = `${idx + 1}.`.padEnd(3);
        const label = it.label.length > 20 ? it.label.slice(0, 19) + '…' : it.label.padEnd(20);
        const detail = it.detail ? ` (${it.detail})` : '';
        lines.push(`${prefix} ${num} ${label}${detail} ${suffix}`);
      });

      this.readerTitle = title;
      this.readerSubtitle = subtitle;
      this.readerLines = lines.length > 0 ? lines : ['No items available.'];
      this.userPromptLineIndices = [];

      if (focusIdx < this.readerScrollLine) {
        this.readerScrollLine = focusIdx;
      } else if (focusIdx >= this.readerScrollLine + 4) {
        this.readerScrollLine = focusIdx - 3;
      }
      return;
    } else if (this.viewMode === 'changes') {
      const curFile = this.changedFiles[this.selectedChangedFileIdx];
      currentModeKey = `changes:${curFile?.path || 'none'}:${this.currentFileDiffLines.length}:${this.isChangesFileSelected}`;
      this.readerTitle = `DIFF | ${this.getCurrentProject().name}`;
      this.readerSubtitle = curFile
        ? (this.isChangesFileSelected ? `${curFile.status} ${curFile.path}` : `[Browse ${this.selectedChangedFileIdx + 1}/${this.changedFiles.length}] ${curFile.status} ${curFile.path}`)
        : 'No changed files';
      this.readerLines = this.currentFileDiffLines.length > 0
        ? this.currentFileDiffLines
        : (curFile ? [`Diff for ${curFile.name}`, 'No modifications detected.'] : ['Working tree clean.', 'No changed files found.']);
    } else if (this.viewMode === 'workspace') {
      const relPath = path.relative(this.fileRoot, this.filePath) || '/';
      const totalFiles = this.workspaceFiles.length;
      if (!this.isWorkspaceViewerActive) {
        currentModeKey = `workspace:${this.filePath}:${this.workspaceCursorIdx}`;
        const focusedItem = this.workspaceFiles[this.workspaceCursorIdx];
        this.readerTitle = `FILES | ${path.basename(this.filePath) || this.getCurrentProject().name}`;
        this.readerSubtitle = `[${totalFiles > 0 ? this.workspaceCursorIdx + 1 : 0}/${totalFiles}] /${relPath.replace(/\\/g, '/')}`;
        this.readerLines = [
          focusedItem ? `Selected: [${focusedItem.isDir ? 'DIR' : 'FILE'}] ${focusedItem.name}` : 'No files',
          `Location: ${path.join(this.filePath, focusedItem ? focusedItem.name : '')}`,
          `Grid Row ${Math.floor(this.workspaceCursorIdx / 4) + 1}/${Math.max(1, Math.ceil(totalFiles / 4))} | Total ${totalFiles} items`,
          'Left Knob: Navigate | Click/Press: Open | K18: Up | K19: Root'
        ];
      } else {
        currentModeKey = `workspace-viewer:${this.workspaceSelectedFileIdx}`;
        const totalLines = this.workspaceFileContentLines.length;
        this.readerTitle = `FILE | ${this.workspaceFiles[this.workspaceSelectedFileIdx]?.name || ''}`;
        this.readerSubtitle = `Line ${this.readerScrollLine + 1}/${totalLines} | /${relPath.replace(/\\/g, '/')}/${this.workspaceFiles[this.workspaceSelectedFileIdx]?.name || ''}`;
        this.readerLines = this.workspaceFileContentLines;
      }
    } else if (this.isRecordingVoice) {
      currentModeKey = `recording:${this.voiceDestinationLabel || s.id}`;
      this.readerTitle = 'Voice Input';
      this.readerSubtitle = 'Recording audio as a whole...';
      this.readerLines = [
        '[● RECORDING VOICE]',
        `Target: ${this.voiceDestinationLabel || s.title}`,
        '',
        'Speak prompt into microphone...',
        'Press [Done] (K20 or K16) when finished.',
        'Press [Cancel] (K4) to abort.',
      ];
    } else if (this.isTranscribingVoice) {
      const sec = this.transcribingSeconds || 0;
      currentModeKey = `transcribing:${this.voiceDestinationLabel || s.id}:${sec}`;
      this.readerTitle = 'Transcribing Voice';
      this.readerSubtitle = `Target: ${this.voiceDestinationLabel || s.title}`;
      this.readerLines = [
        `[TRANSCRIBING AUDIO] (${sec}s)`,
        '',
        `${this.sttEngineLabel || 'Whisper AI Engine'} is processing...`,
        `Elapsed: ${sec}s | K4: Cancel anytime`
      ];
    } else if (this.voiceSubmission !== 'idle') {
      currentModeKey = `submission:${this.voiceSubmission}`;
      this.readerTitle = this.voiceSubmission === 'sending' ? 'Dispatching Prompt' : 'Submission unconfirmed';
      this.readerSubtitle = `Target: ${this.voiceDestinationLabel || s.title}`;
      this.readerLines = [
        '[DISPATCHING TO HARNESS]',
        `Target: ${p.name} -> ${s.title}`,
        `Harness: ${h.name} (${m.name})`,
        '',
        'Awaiting agent response...',
        'You can cycle harness (K13) to continue other tasks.'
      ];
    } else if (this.voiceDraftText) {
      currentModeKey = `draft:${this.voiceDestinationLabel || s.id}:${this.voiceDraftText}:${this.lastDispatchError || ''}`;
      this.readerTitle = this.lastDispatchError ? 'Dispatch Error' : 'Voice Prompt Draft';
      this.readerSubtitle = this.lastDispatchError ? `Error: ${this.lastDispatchError}` : `Target: ${this.voiceDestinationLabel || s.title}`;
      const raw = this.voiceDraftText.trim();
      const draftLines = [];
      const words = raw.split(/\s+/);
      let cur = '';
      for (const w of words) {
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= 36) cur += ' ' + w;
        else { draftLines.push(cur); cur = w; }
      }
      if (cur) draftLines.push(cur);
      this.readerLines = [
        this.lastDispatchError ? `[FAILED: ${this.lastDispatchError.slice(0, 42)}]` : '[DRAFT PROMPT VERIFICATION]',
        ...draftLines.map(l => `"${l}"`),
        '',
        'Press [Send] (K16) to retry.',
        'Press [Talk] (K20) to replace draft.',
        'Press [Cancel] (K4) to discard.',
      ];
    } else {
      currentModeKey = `session:${m.id}/${h.id}/${p.id}/${s.id}:${this.showDetails}`;
      const harnessPills = this.harnesses
        .map((hn, idx) => (idx === this.selectedHarnessIdx ? `[>${hn.name}<]` : ` ${hn.name} `))
        .join(' ');

      const machinePills = this.machines
        .map((mn, idx) => (idx === this.selectedMachineIdx ? `[>${mn.name}<]` : ` ${mn.name} `))
        .join(' ');

      if (this.currentTurns.length > 0) {
        const lines = [];
        const promptIndices = [];
        for (const turn of this.currentTurns) {
          const userPrompt = turn.userPrompt || (turn.role === 'user' ? turn.text : '');
          const agentResponse = turn.agentResponse || (turn.role === 'agent' ? turn.text : '');
          const processDetails = turn.processDetails || [];

          const beforeCount = lines.length;
          if (userPrompt) {
            const promptLines = wrapWithPrefix(userPrompt, '[USER] ', '> ', 50);
            if (promptLines.length > 0) {
              promptIndices.push(lines.length);
              lines.push(...promptLines);
            }
          }
          if (this.showDetails && processDetails.length > 0) {
            for (const proc of processDetails) {
              const procLines = wrapWithPrefix(proc, '[PROCESS] ', '  ', 50);
              lines.push(...procLines);
            }
          }
          if (agentResponse) {
            const respLines = wrapWithPrefix(agentResponse, '[AGENT] ', '  ', 50);
            lines.push(...respLines);
          }
          if (lines.length > beforeCount && lines[lines.length - 1] !== '') {
            lines.push('');
          }
        }
        while (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }
        this.userPromptLineIndices = promptIndices;
        this.readerTitle = `${m.name} | [${h.name.toUpperCase()}]`;
        this.readerSubtitle = `${p.name} -> ${s.title} (${this.currentTurns.length} turns)`;
        this.readerLines = lines.length > 0 ? lines : ['No messages in session.'];
      } else {
        this.userPromptLineIndices = [];
        this.readerTitle = `${m.name} | [${h.name.toUpperCase()}]`;
        this.readerSubtitle = `${p.name} -> ${s.title}`;
        if (s.id && (s.id.startsWith('s-') || s.title === 'New task' || s.title === 'New Session' || !s.createdAt || s.turnCount === 0)) {
          this.readerLines = [
            `[NEW TASK READY]`,
            `Target: ${p.name} -> ${s.title}`,
            `Harness: ${h.name} (${m.name})`,
            `Press [Talk] (K20) to record voice prompt.`,
            `Press [Send] (K16) to dispatch.`,
            `Rotate Left Knob to browse sessions.`,
          ];
        } else {
          this.readerLines = [
            `HARNESS (K13): ${harnessPills}`,
            `MACHINE (K17): ${machinePills}`,
            `PROJECT (K9):  ${p.name}  |  SESSION (K5): ${s.title}`,
            s.preview ? `Preview: ${s.preview}` : `Ready on ${h.name} (${m.name})`,
            `Status: ${h.name} active on ${m.name} [ID: ${s.id}]`,
            `Model: ${this.models[this.selectedModelIdx] ?? 'Harness default'} | Effort: ${this.efforts[this.selectedEffortIdx] ?? 'Harness default'}`,
            `Turn: Idle | Rotate Left Knob to scroll`,
          ];
        }
      }
    }

    if (this.lastReaderModeKey !== currentModeKey) {
      this.lastReaderModeKey = currentModeKey;
      this.readerScrollLine = 0;
    } else {
      const maxScroll = Math.max(0, this.readerLines.length - 4);
      this.readerScrollLine = Math.min(this.readerScrollLine, maxScroll);
    }
  }

  getDeviceState() {
    const keys = [];
    const keyMatrix = [
      [17, 13, 9, 5, 1],
      [18, 14, 10, 6, 2],
      [19, 15, 11, 7, 3],
      [20, 16, 12, 8, 4],
    ];

    if (this.viewMode === 'question' && this.activeQuestion) {
      const opts = this.activeQuestion.options || [];
      for (let r = 0; r < 3; r++) {
        const opt = opts[r];
        for (let c = 0; c < 5; c++) {
          const kid = keyMatrix[r][c];
          if (opt) {
            keys.push({
              keyId: kid,
              labelTop: c === 0 ? `OPT ${r + 1}` : '',
              labelMain: c === 0 ? (opt.isSelected ? '[X]' : '[ ]') : opt.label.slice((c - 1) * 6, c * 6),
              isFilled: !!opt.isSelected,
              isEditing: false,
              isFocused: false,
            });
          } else {
            keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
          }
        }
      }
      keys.push({ keyId: 20, labelTop: 'INPUT', labelMain: 'Other', isFilled: false, isEditing: false, isFocused: false });
      keys.push({ keyId: 16, labelTop: 'ACTION', labelMain: 'Submit', isFilled: true, isEditing: false, isFocused: false });
      keys.push({ keyId: 12, labelTop: 'VOICE', labelMain: 'Speak', isFilled: this.isSpeaking, isEditing: false, isFocused: false });
      keys.push({ keyId: 8, labelTop: 'DISMISS', labelMain: 'Later', isFilled: false, isEditing: false, isFocused: false });
      keys.push({ keyId: 4, labelTop: 'ABORT', labelMain: 'Stop', isFilled: false, isEditing: false, isFocused: false });
    } else if (this.viewMode === 'settings') {
      for (let kid = 1; kid <= 20; kid++) {
        keys.push({
          keyId: kid,
          labelTop: kid === 17 ? 'SETTINGS' : '',
          labelMain: kid === 17 ? 'Close' : '',
          isFilled: kid === 17,
          isEditing: false,
          isFocused: false,
          isDisabled: kid !== 17
        });
      }
    } else if (this.viewMode === 'workspace') {
      if (!this.isWorkspaceViewerActive) {
        // Mode 1: 4x4 Full File Browser Mode
        keys.push({ keyId: 17, labelTop: 'MODAL', labelMain: 'Files', labelSub: 'Close', isFilled: true, isEditing: false, isFocused: false });
        keys.push({ keyId: 18, labelTop: 'DIR', labelMain: 'Up', labelSub: '..', isFilled: false, isEditing: false, isFocused: false });
        keys.push({ keyId: 19, labelTop: 'ROOT', labelMain: 'Home', labelSub: '/', isFilled: false, isEditing: false, isFocused: false });
        const totalFiles = this.workspaceFiles.length;
        keys.push({
          keyId: 20,
          labelTop: 'ITEM',
          labelMain: totalFiles > 0 ? `${this.workspaceCursorIdx + 1}/${totalFiles}` : '0/0',
          labelSub: `Row ${Math.floor(this.workspaceCursorIdx / 4) + 1}`,
          isFilled: false,
          isEditing: false,
          isFocused: false,
          isDisabled: false,
        });

        const gridRows = [
          [13, 9, 5, 1],
          [14, 10, 6, 2],
          [15, 11, 7, 3],
          [16, 12, 8, 4],
        ];

        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const kid = gridRows[r][c];
            const fIdx = this.workspaceScrollRow * 4 + r * 4 + c;
            if (fIdx < this.workspaceFiles.length) {
              const f = this.workspaceFiles[fIdx];
              const isCur = fIdx === this.workspaceCursorIdx;
              keys.push({
                keyId: kid,
                labelTop: f.isDir ? 'DIR' : 'FILE',
                labelMain: f.name.length > 9 ? f.name.slice(0, 9) : f.name,
                labelSub: f.isDir ? 'Folder' : (f.size || ''),
                isFilled: false,
                isEditing: false,
                isFocused: isCur,
              });
            } else {
              keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
            }
          }
        }
      } else {
        // Mode 2: File Viewer Mode (Content View like Changes)
        const fileCount = this.workspaceFiles.length;
        const curIdx = this.workspaceSelectedFileIdx;
        keys.push({
          keyId: 17,
          labelTop: fileCount > 0 ? `FILE ${curIdx + 1}/${fileCount}` : 'MODAL',
          labelMain: 'Files',
          labelSub: 'Close',
          isFilled: true,
          isEditing: false,
          isFocused: false,
          scrollTotal: fileCount,
          activeItem: curIdx,
        });

        const filePageStart = Math.floor(this.workspaceSelectedFileIdx / 3) * 3;
        const col0Keys = [18, 19, 20];
        for (let r = 0; r < 3; r++) {
          const kid = col0Keys[r];
          const fIdx = filePageStart + r;
          if (fIdx < this.workspaceFiles.length) {
            const f = this.workspaceFiles[fIdx];
            const isCurrent = fIdx === this.workspaceSelectedFileIdx;
            keys.push({
              keyId: kid,
              labelTop: f.isDir ? 'DIR' : 'FILE',
              labelMain: f.name.length > 8 ? f.name.slice(0, 8) : f.name,
              labelSub: f.isDir ? 'Folder' : (f.size || ''),
              isFilled: isCurrent,
              isFocused: isCurrent,
              isEditing: false,
            });
          } else {
            keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
          }
        }

        const viewerRows = [
          [13, 9, 5, 1],
          [14, 10, 6, 2],
          [15, 11, 7, 3],
          [16, 12, 8, 4],
        ];

        for (let r = 0; r < 4; r++) {
          const rowKeys = viewerRows[r];
          const lineBase = this.readerScrollLine + 4 + r * 6;
          const rowLines = [];
          for (let i = 0; i < 6; i++) {
            const lIdx = lineBase + i;
            if (lIdx < this.workspaceFileContentLines.length) {
              const line = this.workspaceFileContentLines[lIdx];
              let color = 0;
              const trimmed = line.trim();
              if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                color = 3; // amber
              } else if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('function ') || trimmed.startsWith('class ') || trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('return ')) {
                color = 1; // cyan
              }
              const chunks = sliceLineIntoChunks(line, 4, 15);
              rowLines.push({ chunks, color });
            }
          }

          if (rowLines.length > 0) {
            for (let c = 0; c < 4; c++) {
              const kid = rowKeys[c];
              const keyItems = rowLines.map(rl => rl.chunks[c] || '');
              const keyColors = rowLines.map(rl => rl.color);
              keys.push({
                keyId: kid,
                labelTop: '',
                labelMain: keyItems[0] || '',
                isFilled: false,
                isEditing: false,
                isFocused: false,
                isDisabled: false,
                isLinesMode: true,
                items: keyItems,
                itemColors: keyColors,
              });
            }
          } else {
            for (let c = 0; c < 4; c++) {
              const kid = rowKeys[c];
              keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
            }
          }
        }
      }
    } else if (this.viewMode === 'changes') {
      const fileCount = this.changedFiles.length;
      const curFileIdx = this.selectedChangedFileIdx;
      keys.push({
        keyId: 17,
        labelTop: fileCount > 0 ? `FILE ${curFileIdx + 1}/${fileCount}` : 'MODAL',
        labelMain: 'Changes',
        labelSub: 'Close',
        isFilled: true,
        isEditing: false,
        isFocused: false,
        scrollTotal: fileCount,
        activeItem: curFileIdx,
      });
      const filePageStart = this.changesFilePage * 3;
      const col0Keys = [18, 19, 20];
      for (let r = 0; r < 3; r++) {
        const kid = col0Keys[r];
        const fIdx = filePageStart + r;
        if (fIdx < this.changedFiles.length) {
          const f = this.changedFiles[fIdx];
          const isCur = fIdx === this.selectedChangedFileIdx;
          keys.push({
            keyId: kid,
            labelTop: f.status || 'M',
            labelMain: f.name.slice(0, 8),
            labelSub: f.path.length > 10 ? f.path.slice(-10) : f.path,
            isFilled: isCur && this.isChangesFileSelected,
            isFocused: isCur,
            isEditing: false,
          });
        } else {
          keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        }
      }

      const diffRows = [
        [13, 9, 5, 1],
        [14, 10, 6, 2],
        [15, 11, 7, 3],
        [16, 12, 8, 4],
      ];
      for (let r = 0; r < 4; r++) {
        const rowKeys = diffRows[r];
        const lineBase = this.readerScrollLine + 4 + r * 6;
        const rowLines = [];
        for (let i = 0; i < 6; i++) {
          const lIdx = lineBase + i;
          if (lIdx < this.currentFileDiffLines.length) {
            const line = this.currentFileDiffLines[lIdx];
            let color = 0;
            if (line.startsWith('+')) color = 1; // cyan
            else if (line.startsWith('-')) color = 2; // rose
            else if (line.startsWith('@@')) color = 3; // amber
            const chunks = sliceLineIntoChunks(line, 4, 15);
            rowLines.push({ chunks, color });
          }
        }
        if (rowLines.length > 0) {
          for (let c = 0; c < 4; c++) {
            const kid = rowKeys[c];
            const keyItems = rowLines.map(rl => rl.chunks[c] || '');
            const keyColors = rowLines.map(rl => rl.color);
            keys.push({
              keyId: kid,
              labelTop: '',
              labelMain: keyItems[0] || '',
              isFilled: false,
              isEditing: false,
              isFocused: false,
              isDisabled: false,
              isLinesMode: true,
              items: keyItems,
              itemColors: keyColors,
            });
          }
        } else {
          for (let c = 0; c < 4; c++) {
            const kid = rowKeys[c];
            keys.push({ keyId: kid, labelTop: '', labelMain: '', isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
          }
        }
      }
    } else {
      // Machine (K17): Pattern 3 multi-item list
      keys.push({
        keyId: 17,
        labelTop: 'MACHINE',
        labelMain: safeText(this.getCurrentMachine().name, 10),
        labelSub: 'K17:Cycle',
        isFilled: true,
        isEditing: this.activeEditor === 'machine',
        isFocused: false,
        items: this.machines.map(m => m.name),
        activeItem: this.selectedMachineIdx,
      });

      // Harness (K13): Pattern 3 multi-item list
      keys.push({
        keyId: 13,
        labelTop: 'HARNESS',
        labelMain: safeText(this.getCurrentHarness().name, 10),
        labelSub: 'K13:Cycle',
        isFilled: true,
        isEditing: this.activeEditor === 'harness',
        isFocused: false,
        items: this.harnesses.map(h => h.name),
        activeItem: this.selectedHarnessIdx,
      });
      keys.push({
        keyId: 9,
        labelTop: 'PROJECT',
        labelMain: safeText(this.getCurrentProject().name, 10),
        labelSub: 'K9:Pick',
        isFilled: true,
        isEditing: this.activeEditor === 'project'
      });
      keys.push({
        keyId: 5,
        labelTop: 'SESSION',
        labelMain: safeText(this.getCurrentSession().title, 10),
        labelSub: 'K5:Pick',
        isFilled: true,
        isEditing: this.activeEditor === 'session'
      });
      keys.push({
        keyId: 1,
        labelTop: 'ACTION',
        labelMain: 'New',
        isFilled: false
      });

      // Row 1: Config / Modals
      const curModelObj = this.currentModelCatalog()[this.selectedModelIdx];
      const modelLabel = (this.models[this.selectedModelIdx] && !this.models[this.selectedModelIdx].includes('/'))
        ? this.models[this.selectedModelIdx]
        : (curModelObj?.displayName || this.models[this.selectedModelIdx] || 'Default');
      keys.push({
        keyId: 18,
        labelTop: 'MODEL',
        labelMain: safeText(modelLabel, 15),
        isFilled: true,
        isEditing: this.activeEditor === 'model'
      });
      keys.push({
        keyId: 14,
        labelTop: 'EFFORT',
        labelMain: safeText(this.efforts[this.selectedEffortIdx] ?? 'Default', 15),
        isFilled: true,
        isEditing: this.activeEditor === 'effort'
      });
      keys.push({
        keyId: 10,
        labelTop: 'ACCESS',
        labelMain: safeText(this.accessLevels[this.selectedAccessIdx] || '', 15),
        isFilled: true,
        isEditing: this.activeEditor === 'access'
      });
      keys.push({
        keyId: 6,
        labelTop: 'VIEW',
        labelMain: 'Files',
        isFilled: false
      });
      keys.push({
        keyId: 2,
        labelTop: 'SYSTEM',
        labelMain: 'Settings',
        isFilled: false
      });

      // Row 2: Choices (if editor active) or Contextual Navigation
      if (this.activeEditor !== 'none') {
        const curProjs = this.getProjectsForCurrentScope();
        const curSess = this.getSessionsForCurrentScope();
        for (let c = 0; c < 5; c++) {
          const kid = keyMatrix[2][c];
          const choiceIdx = this.editorChoiceWindowStart + c;
          let label = '';
          let isChosen = false;

          if (this.activeEditor === 'harness' && choiceIdx < this.harnesses.length) {
            label = this.harnesses[choiceIdx].name;
            isChosen = choiceIdx === this.selectedHarnessIdx;
          } else if (this.activeEditor === 'machine' && choiceIdx < this.machines.length) {
            label = this.machines[choiceIdx].name;
            isChosen = choiceIdx === this.selectedMachineIdx;
          } else if (this.activeEditor === 'project' && choiceIdx < curProjs.length) {
            label = curProjs[choiceIdx].name;
            isChosen = choiceIdx === this.selectedProjectIdx;
          } else if (this.activeEditor === 'session' && choiceIdx < curSess.length) {
            label = curSess[choiceIdx].title;
            isChosen = choiceIdx === this.selectedSessionIdx;
          } else if (this.activeEditor === 'model' && choiceIdx < this.models.length) {
            const mObj = this.currentModelCatalog()[choiceIdx];
            label = (mObj?.displayName && this.models[choiceIdx]?.includes('/')) ? mObj.displayName : this.models[choiceIdx];
            isChosen = choiceIdx === this.selectedModelIdx;
          } else if (this.activeEditor === 'effort' && choiceIdx < this.efforts.length) {
            label = this.efforts[choiceIdx];
            isChosen = choiceIdx === this.selectedEffortIdx;
          } else if (this.activeEditor === 'access' && choiceIdx < this.accessLevels.length) {
            label = this.accessLevels[choiceIdx];
            isChosen = choiceIdx === this.selectedAccessIdx;
          }

          if (label) {
            keys.push({
              keyId: kid,
              labelTop: `ITEM ${choiceIdx + 1}`,
              labelMain: safeText(label, 15),
              isFilled: isChosen,
              isFocused: choiceIdx === this.editorFocusIdx
            });
          } else {
            keys.push({ keyId: kid, labelTop: '', labelMain: '', isDisabled: true });
          }
        }
      } else {
        keys.push({ keyId: 19, labelTop: 'PROMPT', labelMain: 'Prev', labelSub: 'Jump', isFilled: false });
        keys.push({ keyId: 15, labelTop: 'PROMPT', labelMain: 'Next', labelSub: 'Jump', isFilled: false });
        keys.push({
          keyId: 11,
          labelTop: 'DETAILS',
          labelMain: this.showDetails ? '[ ON ]' : '[ OFF ]',
          labelSub: this.showDetails ? 'All Steps' : 'Prompts',
          isFilled: this.showDetails,
          isEditing: this.showDetails
        });
        keys.push({ keyId: 7, labelTop: 'GIT', labelMain: 'Changes', labelSub: 'Diff', isFilled: false });
        keys.push({ keyId: 3, labelTop: '', labelMain: '', isDisabled: true });
      }

      // Row 3: Actions
      if (this.isRecordingVoice) {
        keys.push({
          keyId: 20,
          labelTop: 'MIC ON',
          labelMain: 'Done',
          labelSub: 'Transcribe',
          isFilled: true,
          isEditing: true,
          isFocused: false,
        });
        keys.push({
          keyId: 16,
          labelTop: 'FINISH',
          labelMain: 'Done',
          labelSub: 'Transcribe',
          isFilled: false,
          isEditing: false,
          isFocused: true,
        });
        keys.push({ keyId: 12, labelTop: 'AUDIO', labelMain: 'Speak', isFilled: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: '', labelMain: '', isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: 'ABORT',
          labelMain: 'Cancel',
          labelSub: 'Discard',
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      } else if (this.isTranscribingVoice) {
        const sec = this.transcribingSeconds || 0;
        keys.push({
          keyId: 20,
          labelTop: 'STT',
          labelMain: `${sec}s...`,
          isFilled: false,
          isDisabled: true,
        });
        keys.push({
          keyId: 16,
          labelTop: 'STT',
          labelMain: 'Working',
          isFilled: false,
          isDisabled: true,
        });
        keys.push({ keyId: 12, labelTop: 'AUDIO', labelMain: 'Speak', isFilled: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: '', labelMain: '', isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: 'ABORT',
          labelMain: 'Cancel',
          isFilled: true,
        });
      } else if (this.voiceDraftText) {
        keys.push({
          keyId: 20,
          labelTop: 'RE-RECORD',
          labelMain: 'Talk',
          labelSub: 'Replace',
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 16,
          labelTop: 'CONFIRM',
          labelMain: 'Send',
          labelSub: 'Dispatch',
          isFilled: true,
          isEditing: false,
          isFocused: true,
        });
        keys.push({ keyId: 12, labelTop: 'AUDIO', labelMain: 'Speak', isFilled: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: '', labelMain: '', isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: 'DISCARD',
          labelMain: 'Cancel',
          labelSub: 'Clear',
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      } else {
        keys.push({ keyId: 20, labelTop: 'VOICE', labelMain: 'Talk', isFilled: false });
        keys.push({ keyId: 16, labelTop: 'ACTION', labelMain: 'Send', isFilled: false });
        keys.push({ keyId: 12, labelTop: 'AUDIO', labelMain: 'Speak', isFilled: this.isSpeaking });
        keys.push({ keyId: 8, labelTop: '', labelMain: '', isDisabled: true });
        keys.push({ keyId: 4, labelTop: 'ABORT', labelMain: 'Stop', isFilled: false });
      }

      if (this.voiceSubmission !== 'idle') {
        for (const kid of [20, 16, 4]) {
          const k = keys.find(k => k.keyId === kid);
          if (k) {
            k.isDisabled = true;
            if (kid === 16) {
              k.labelMain = this.voiceSubmission === 'sending' ? 'Sending' : 'Check task';
              k.labelTop = 'DELIVERY';
              k.labelSub = '';
            }
            if (kid === 4 && this.voiceSubmission === 'unknown') {
              k.isDisabled = false;
              k.labelMain = 'Discard';
              k.labelTop = 'RECOVERY';
              k.labelSub = 'Drop draft';
            }
          }
        }
      }
    }

    return {
      viewMode: this.viewMode,
      activeEditor: this.activeEditor,
      title: this.readerTitle,
      subtitle: this.readerSubtitle,
      lines: this.readerLines,
      scroll: this.readerScrollLine,
      totalLines: this.readerLines.length,
      volume: this.volume,
      isMuted: this.isMuted,
      keys
    };
  }

  toPreviewPayload() {
    const state = this.getDeviceState();
    let visibleLines = state.lines.slice(state.scroll, state.scroll + 4).map(l => safeText(l, 160));

    const buildKeys = (includeSub) => {
      const out = [];
      for (const k of state.keys) {
        if (k.isDisabled) {
          out.push({ id: k.keyId, flags: 8, main: '' });
          continue;
        }
        let flags = 0;
        if (k.isFilled) flags |= 1;
        if (k.isEditing) flags |= 2;
        if (k.isFocused) flags |= 4;

        if (k.isLinesMode) {
          flags |= 32;
          const rawItems = (k.items || []).slice(0, 6);
          const rawColors = (k.itemColors || []).slice(0, 6);
          while (rawItems.length > 0 && !rawItems[rawItems.length - 1].trim()) {
            rawItems.pop();
            rawColors.pop();
          }
          if (rawItems.length === 0) {
            out.push({ id: k.keyId, flags: 8, main: '' });
            continue;
          }

          out.push({
            id: k.keyId,
            flags,
            items: rawItems.map(it => safeText(it, 20)),
            colors: rawColors,
          });
          continue;
        }

        if (Array.isArray(k.items) && (k.keyId === 13 || k.keyId === 17)) {
          flags |= 16;
        }

        const outKey = {
          id: k.keyId,
          main: safeText(k.labelMain || '', 16),
          flags
        };

        if (k.labelTop && !['ACTION', 'SYSTEM', 'ABORT', 'VIEW', 'AUDIO', 'VOICE', 'PROMPT'].includes(k.labelTop)) {
          outKey.top = safeText(k.labelTop, 12);
        }

        if (includeSub && k.labelSub && !['Jump', 'Diff', 'K17:Cycle', 'K13:Cycle', 'K9:Pick', 'K5:Pick'].includes(k.labelSub)) {
          outKey.sub = safeText(k.labelSub, 14);
        }

        if (Array.isArray(k.items) && (k.keyId === 13 || k.keyId === 17)) {
          outKey.items = k.items.slice(0, 4).map(it => safeText(it, 16));
        }
        if (Number.isInteger(k.activeItem)) outKey.activeItem = k.activeItem;
        if (Number.isInteger(k.scrollTotal)) outKey.total = k.scrollTotal;

        out.push(outKey);
      }

      // Ensure all 20 key positions are explicitly accounted for so hardware clears stale frames
      const seenIds = new Set(out.map(k => k.id));
      for (let id = 1; id <= 20; id++) {
        if (!seenIds.has(id)) {
          out.push({ id, flags: 8, main: '' });
        }
      }
      out.sort((a, b) => a.id - b.id);

      return out;
    };

    let keys = buildKeys(true);
    let payload = {
      mode: state.viewMode || 'session',
      title: safeText(state.title, 63),
      subtitle: safeText(state.subtitle, 63),
      lines: visibleLines,
      scroll: state.scroll,
      totalLines: Math.max(1, state.totalLines),
      volume: state.volume,
      muted: state.isMuted,
      keys
    };

    if (Buffer.byteLength(JSON.stringify(payload)) > 3800) {
      keys = buildKeys(false);
      payload.keys = keys;
    }

    return payload;
  }
}
