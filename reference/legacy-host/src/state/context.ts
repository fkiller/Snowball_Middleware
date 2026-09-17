import * as os from "node:os";
import {
  MachineInfo,
  HarnessInfo,
  ProjectInfo,
  SessionInfo,
  ViewMode,
  ActiveEditorField,
  V2DeviceState,
  KeyVisual,
  QuestionCard,
} from "../types.js";
import { SessionTurn } from "../harness/types.js";
import { ChangedFile } from "../vcs/git.js";

export function stringDisplayWidth(str: string): number {
  let w = 0;
  for (const char of str) {
    w += char.codePointAt(0)! < 128 ? 1 : 2;
  }
  return w;
}

export function wrapText(text: string, maxLen = 50): string[] {
  if (!text) return [""];
  // Match the panel's fixed glyph advances: ASCII 8px, Unicode 16px.
  // Iterate code points, never slice UTF-16 surrogate pairs or UTF-8 bytes.
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "", width = 0;
    for (const char of raw.replace(/\t/g, "    ").replace(/\r/g, "")) {
      const advance = char.codePointAt(0)! < 128 ? 1 : 2;
      if (width + advance > maxLen) { lines.push(line); line = ""; width = 0; }
      line += char; width += advance;
    }
    lines.push(line);
  }
  return lines;
}

export function wrapWithPrefix(text: string, firstPrefix: string, contPrefix: string, maxLen = 50): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const firstPWidth = stringDisplayWidth(firstPrefix);
  const contPWidth = stringDisplayWidth(contPrefix);
  const firstMax = Math.max(1, maxLen - firstPWidth);
  const contMax = Math.max(1, maxLen - contPWidth);

  let isFirst = true;
  for (const raw of text.split("\n")) {
    let line = "", width = 0;
    for (const char of raw.replace(/\t/g, "    ").replace(/\r/g, "")) {
      const advance = char.codePointAt(0)! < 128 ? 1 : 2;
      const curMax = isFirst ? firstMax : contMax;
      if (width + advance > curMax) {
        lines.push((isFirst ? firstPrefix : contPrefix) + line);
        isFirst = false;
        line = "";
        width = 0;
      }
      line += char;
      width += advance;
    }
    lines.push((isFirst ? firstPrefix : contPrefix) + line);
    isFirst = false;
  }
  return lines;
}

export function sliceLineIntoChunks(line: string, chunkCount = 4, chunkWidth = 12): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  let currentWidth = 0;
  let chunkIdx = 0;

  for (const char of line.replace(/\t/g, "  ").replace(/\r/g, "")) {
    const advance = char.codePointAt(0)! < 128 ? 1 : 2;
    if (currentWidth + advance > chunkWidth) {
      if (chunkIdx < chunkCount - 1) {
        chunks.push(currentChunk);
        currentChunk = "";
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
    chunks.push("");
  }
  return chunks;
}

export class ContextManager {
  // Machine catalog - only genuine detected host (and dynamic mesh peers if connected)
  public machines: MachineInfo[] = [
    { id: "dev-pc", name: os.hostname() || "DEV-PC", isOnline: true },
  ];

  // Harness catalog
  public harnesses: HarnessInfo[] = [
    { id: "codex", name: "Codex", isEnabled: true },
    { id: "antigravity", name: "Antigrav", isEnabled: true },
    { id: "opencode", name: "OpenCode", isEnabled: true },
  ];

  // Scoped Project Catalogs: keyed by "machineId/harnessId"
  public projectsByScope: Record<string, ProjectInfo[]> = {
    "dev-pc/codex": [
      { id: "snowball", name: "Snowball", path: "E:\\developments\\projects\\Snowball_Control" },
      { id: "gnunae", name: "GnuNae", path: "E:\\developments\\projects\\GnuNae" },
      { id: "gimmytwitter", name: "TwitterB", path: "C:\\Users\\wondo\\OneDrive\\Documents\\GimMyTwitterB" },
      { id: "mk20-hud", name: "MK20-HUD", path: "E:\\developments\\projects\\Snowball_Control\\hardware\\mk20\\hud" },
    ],
    "dev-pc/antigravity": [
      { id: "snowball-control", name: "Snowball_Control", path: "E:\\developments\\projects\\Snowball_Control" },
      { id: "gnunae", name: "GnuNae", path: "E:\\developments\\projects\\GnuNae" },
      { id: "descentvr", name: "descentVR", path: "E:\\developments\\projects\\descentVR" },
    ],
    "dev-pc/opencode": [
      { id: "snowball-control", name: "Snowball_Control", path: "E:\\developments\\projects\\Snowball_Control" },
    ],
  };

  // Scoped Session Catalogs: keyed by "machineId/harnessId/projectId"
  public sessionsByScope: Record<string, SessionInfo[]> = {
    "dev-pc/codex/snowball": [
      { id: "s-01", title: "Dual Knob Tuning", createdAt: Date.now() - 3600000, preview: "Unbind right knob HID keycodes across layers" },
      { id: "s-02", title: "V2 UI State Machine", createdAt: Date.now() - 7200000, preview: "Revamped product design implementation" },
      { id: "s-03", title: "Codex 0.153.4 Scope", createdAt: Date.now() - 86400000, preview: "Native pub/sub multi-client verification" },
      { id: "s-new", title: "New Session", createdAt: Date.now(), preview: "Start fresh conversation" },
    ],
    "dev-pc/codex/gnunae": [
      { id: "gn-01", title: "Audio Sync Refactor", createdAt: Date.now() - 1000000, preview: "Optimized sample rate conversion for streaming" },
      { id: "gn-02", title: "FFmpeg Pipeline", createdAt: Date.now() - 5000000, preview: "Low-latency PCM audio buffer management" },
    ],
  };

  public models: string[] = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "claude-3-7"];
  public efforts: string[] = ["low", "medium", "high"];
  public accessLevels: string[] = ["untrusted", "on-request", "never"];

  // Selected State
  public selectedMachineIdx = 0;
  public selectedHarnessIdx = 0;
  public selectedProjectIdx = 0;
  public selectedSessionIdx = 0;

  public selectedModelIdx = 0;
  public selectedEffortIdx = 1; // medium
  public selectedAccessIdx = 1; // on-request

  // Navigation & View Mode
  public viewMode: ViewMode = "session";
  public activeEditor: ActiveEditorField = "none";
  public editorChoiceWindowStart = 0;
  public editorFocusIdx = 0;

  // Workspace / Files Modal state
  public workspaceFiles: { name: string; isDir: boolean; size?: string }[] = [
    { name: "..", isDir: true },
    { name: "docs", isDir: true },
    { name: "hardware", isDir: true },
    { name: "host", isDir: true },
    { name: "README.md", isDir: false, size: "4.2KB" },
    { name: "AGENTS.md", isDir: false, size: "3.1KB" },
    { name: "HANDOFF.md", isDir: false, size: "8.5KB" },
    { name: "CODEX_VERIFICATION.md", isDir: false, size: "7.1KB" },
    { name: "CODEX_CAPABILITY_PLAN.md", isDir: false, size: "14.2KB" },
    { name: "mk20-hud.c", isDir: false, size: "86KB" },
    { name: "v2_state.c", isDir: false, size: "7.2KB" },
    { name: "v2_render.c", isDir: false, size: "5.1KB" },
  ];
  public workspaceScrollRow = 0; // 4 items per row in 4x4 grid
  public currentFilePath: string = "/";
  public isWorkspaceViewerActive: boolean = false;
  public workspaceCursorIdx: number = 0;
  public workspaceSelectedFileIdx: number = 0;
  public workspaceFileContentLines: string[] = [];

  public moveWorkspaceCursor(delta: number): void {
    if (this.workspaceFiles.length === 0) return;
    this.workspaceCursorIdx = Math.max(0, Math.min(this.workspaceFiles.length - 1, this.workspaceCursorIdx + delta));
    // Auto-scroll 4x4 grid by row (4 items per row)
    if (this.workspaceCursorIdx < this.workspaceScrollRow * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4);
    } else if (this.workspaceCursorIdx >= (this.workspaceScrollRow + 4) * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4) - 3;
    }
    const maxRow = Math.max(0, Math.ceil(this.workspaceFiles.length / 4) - 4);
    this.workspaceScrollRow = Math.max(0, Math.min(maxRow, this.workspaceScrollRow));
  }

  public openWorkspaceViewer(fileIdx: number, lines: string[]): void {
    this.isWorkspaceViewerActive = true;
    this.workspaceSelectedFileIdx = fileIdx;
    this.workspaceFileContentLines = lines;
    this.readerScrollLine = 0;
  }

  public closeWorkspaceViewer(): void {
    this.isWorkspaceViewerActive = false;
    this.workspaceCursorIdx = this.workspaceSelectedFileIdx;
    if (this.workspaceCursorIdx < this.workspaceScrollRow * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4);
    } else if (this.workspaceCursorIdx >= (this.workspaceScrollRow + 4) * 4) {
      this.workspaceScrollRow = Math.floor(this.workspaceCursorIdx / 4) - 3;
    }
    const maxRow = Math.max(0, Math.ceil(this.workspaceFiles.length / 4) - 4);
    this.workspaceScrollRow = Math.max(0, Math.min(maxRow, this.workspaceScrollRow));
  }

  // Audio / Knobs
  public volume = 75; // 0..100
  public isMuted = false;
  public isSpeaking = false;
  public isRecordingVoice = false;
  public isTranscribingVoice = false;
  public voiceDraftText = "";
  public voiceDestinationLabel = "";
  public voiceSubmission: "idle" | "sending" | "unknown" = "idle";

  // Reader content
  public readerTitle = "Snowball Control V2";
  public readerSubtitle = "Session Active";
  public readerLines: string[] = [
    "Codex session connected.",
    "System ready for physical input.",
    "Rotate Left Knob to scroll conversation lines.",
    "Press K17/K13 to cycle Machine and Harness directly.",
    "Press K6 for Files browser modal.",
  ];
  public readerScrollLine = 0;

  // Session turn details and prompt navigation
  public currentTurns: SessionTurn[] = [];
  public showDetails = false;
  public userPromptLineIndices: number[] = [];

  // Git Changes Modal state
  public changedFiles: ChangedFile[] = [];
  public selectedChangedFileIdx = 0;
  public changesFilePage = 0; // 3 files per page
  public isChangesFileSelected = true; // true = file selected (left knob scrolls diff); false = file deselected (left knob scrolls file list)
  public currentFileDiffLines: string[] = [];

  // Question Card (if any)
  public activeQuestion?: QuestionCard;

  // Memory of last selected children
  private memoryHarnessPerMachine = new Map<string, string>();
  private memoryProjectPerHarness = new Map<string, string>();
  private memorySessionPerProject = new Map<string, string>();

  constructor() {
    this.updateReaderForCurrentSession();
  }

  public setSessionTurns(turns: SessionTurn[]): void {
    this.currentTurns = turns;
    this.updateReaderForCurrentSession();
  }

  public toggleDetails(): void {
    this.showDetails = !this.showDetails;
    this.updateReaderForCurrentSession();
  }

  public jumpPrevPrompt(): void {
    if (this.userPromptLineIndices.length === 0) return;
    const prevs = this.userPromptLineIndices.filter((idx) => idx < this.readerScrollLine);
    if (prevs.length > 0) {
      this.readerScrollLine = prevs[prevs.length - 1];
    } else {
      this.readerScrollLine = this.userPromptLineIndices[0];
    }
  }

  public jumpNextPrompt(): void {
    if (this.userPromptLineIndices.length === 0) return;
    const nexts = this.userPromptLineIndices.filter((idx) => idx > this.readerScrollLine);
    if (nexts.length > 0) {
      this.readerScrollLine = nexts[0];
    } else {
      const maxScroll = Math.max(0, this.readerLines.length - 4);
      this.readerScrollLine = maxScroll;
    }
  }

  public openChangesView(files: ChangedFile[]): void {
    this.viewMode = "changes";
    this.changedFiles = files;
    this.selectedChangedFileIdx = 0;
    this.changesFilePage = 0;
    this.isChangesFileSelected = true;
    this.currentFileDiffLines = [];
    this.readerScrollLine = 0;
    this.updateReaderForCurrentSession();
  }

  public selectChangesFile(idx: number, diffLines?: string[]): void {
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

  public toggleChangesFileSelection(): void {
    this.isChangesFileSelected = !this.isChangesFileSelected;
    this.updateReaderForCurrentSession();
  }

  public scrollChangesFiles(delta: number): void {
    if (this.changedFiles.length === 0) return;
    this.selectedChangedFileIdx = Math.max(0, Math.min(this.changedFiles.length - 1, this.selectedChangedFileIdx + delta));
    this.changesFilePage = Math.floor(this.selectedChangedFileIdx / 3);
    this.readerScrollLine = 0;
    this.updateReaderForCurrentSession();
  }

  public pageChangesFiles(delta: number): void {
    const maxPages = Math.max(0, Math.ceil(this.changedFiles.length / 3) - 1);
    this.changesFilePage = Math.max(0, Math.min(maxPages, this.changesFilePage + delta));
  }

  // --- Scope Resolution ---

  public getScopeKey(): string {
    const m = this.getCurrentMachine().id;
    const h = this.getCurrentHarness().id;
    return `${m}/${h}`;
  }

  public getFullScopeKey(): string {
    const m = this.getCurrentMachine().id;
    const h = this.getCurrentHarness().id;
    const p = this.getCurrentProject().id;
    return `${m}/${h}/${p}`;
  }

  public getProjectsForCurrentScope(): ProjectInfo[] {
    const key = this.getScopeKey();
    if (this.projectsByScope[key] && this.projectsByScope[key].length > 0) {
      return this.projectsByScope[key];
    }
    // Fallback default
    return [
      { id: "default-proj-1", name: `${this.getCurrentHarness().name}-Core`, path: `/workspace/core` },
      { id: "default-proj-2", name: `${this.getCurrentHarness().name}-App`, path: `/workspace/app` },
    ];
  }

  public getSessionsForCurrentScope(): SessionInfo[] {
    const key = this.getFullScopeKey();
    if (this.sessionsByScope[key] && this.sessionsByScope[key].length > 0) {
      return this.sessionsByScope[key];
    }
    return [
      { id: "s-1", title: `${this.getCurrentProject().name} Main`, createdAt: Date.now(), preview: "Initial working session" },
      { id: "s-new", title: "New Session", createdAt: Date.now(), preview: "Start fresh conversation" },
    ];
  }

  // --- Cascading Context Resets ---

  public cycleMachine(): void {
    this.selectedMachineIdx = (this.selectedMachineIdx + 1) % this.machines.length;
    const mId = this.getCurrentMachine().id;

    // 1. Resolve remembered Harness for this Machine
    const rememberedHarnessId = this.memoryHarnessPerMachine.get(mId);
    if (rememberedHarnessId) {
      const hIdx = this.harnesses.findIndex((h) => h.id === rememberedHarnessId);
      this.selectedHarnessIdx = hIdx >= 0 ? hIdx : 0;
    } else {
      this.selectedHarnessIdx = 0;
    }

    // 2. Resolve remembered Project & Session for (Machine, Harness)
    this.resolveProjectAndSession();
    this.activeEditor = "none";
    this.updateReaderForCurrentSession();
  }

  public cycleHarness(): void {
    this.selectedHarnessIdx = (this.selectedHarnessIdx + 1) % this.harnesses.length;
    this.memoryHarnessPerMachine.set(this.getCurrentMachine().id, this.getCurrentHarness().id);

    // Resolve Project & Session for (Machine, Harness)
    this.resolveProjectAndSession();
    this.activeEditor = "none";
    this.updateReaderForCurrentSession();
  }

  public selectProject(idx: number): void {
    const projs = this.getProjectsForCurrentScope();
    if (idx >= 0 && idx < projs.length) {
      this.selectedProjectIdx = idx;
      this.memoryProjectPerHarness.set(this.getScopeKey(), projs[idx].id);

      // Resolve Session for (Machine, Harness, Project)
      this.resolveSession();
      this.activeEditor = "none";
      this.updateReaderForCurrentSession();
    }
  }

  public selectSession(idx: number): void {
    const sess = this.getSessionsForCurrentScope();
    if (idx >= 0 && idx < sess.length) {
      this.selectedSessionIdx = idx;
      this.memorySessionPerProject.set(this.getFullScopeKey(), sess[idx].id);
      this.activeEditor = "none";
      this.updateReaderForCurrentSession();
    }
  }

  private resolveProjectAndSession(): void {
    const scopeKey = this.getScopeKey();
    const projs = this.getProjectsForCurrentScope();
    const rememberedProjId = this.memoryProjectPerHarness.get(scopeKey);
    if (rememberedProjId) {
      const pIdx = projs.findIndex((p) => p.id === rememberedProjId);
      this.selectedProjectIdx = pIdx >= 0 ? pIdx : 0;
    } else {
      this.selectedProjectIdx = 0;
    }
    this.resolveSession();
  }

  private resolveSession(): void {
    const fullScopeKey = this.getFullScopeKey();
    const sess = this.getSessionsForCurrentScope();
    const rememberedSessId = this.memorySessionPerProject.get(fullScopeKey);
    if (rememberedSessId) {
      const sIdx = sess.findIndex((s) => s.id === rememberedSessId);
      this.selectedSessionIdx = sIdx >= 0 ? sIdx : 0;
    } else {
      this.selectedSessionIdx = 0;
    }
  }

  private lastReaderModeKey = "";

  public updateReaderForCurrentSession(): void {
    const m = this.getCurrentMachine();
    const h = this.getCurrentHarness();
    const p = this.getCurrentProject();
    const s = this.getCurrentSession();

    let currentModeKey = "";

    if (this.viewMode === "settings") {
      currentModeKey = "settings";
      this.readerTitle = "Settings";
      this.readerSubtitle = "Codex MVP | Local Whisper";
      this.readerLines = ["Voice input: Local Whisper", "Review transcript before Send.", "Speech setup: host configuration.", "K17: Close settings"];
    } else if (this.activeEditor !== "none") {
      let title = "";
      let subtitle = "";
      let items: Array<{ id: string; label: string; detail?: string }> = [];

      switch (this.activeEditor) {
        case "project": {
          const projs = this.getProjectsForCurrentScope();
          title = `SELECT PROJECT (${projs.length} available)`;
          subtitle = "Left Knob: browse | Click / Row 2: select | K9: cancel";
          items = projs.map((pr) => ({
            id: pr.id,
            label: pr.name,
            detail: pr.path,
          }));
          break;
        }
        case "session": {
          const sess = this.getSessionsForCurrentScope();
          title = `SELECT SESSION (${sess.length} available)`;
          subtitle = `${p.name} | Left Knob: browse | Click / Row 2: select | K5: cancel`;
          items = sess.map((sn) => ({
            id: sn.id,
            label: sn.title || "Untitled Session",
            detail: sn.preview || sn.id.slice(0, 12),
          }));
          break;
        }
        case "machine": {
          title = `SELECT MACHINE (${this.machines.length} available)`;
          subtitle = "Left Knob: browse | Click: select | K17: cancel";
          items = this.machines.map((mn) => ({
            id: mn.id,
            label: mn.name,
            detail: mn.isOnline ? "Online" : "Offline",
          }));
          break;
        }
        case "harness": {
          title = `SELECT HARNESS (${this.harnesses.length} available)`;
          subtitle = "Left Knob: browse | Click: select | K13: cancel";
          items = this.harnesses.map((hn) => ({
            id: hn.id,
            label: hn.name,
            detail: hn.isEnabled ? "Ready" : "Disabled",
          }));
          break;
        }
        case "model": {
          title = `SELECT MODEL (${this.models.length} available)`;
          subtitle = "Left Knob: browse | Click: select | K18: cancel";
          items = this.models.map((md) => ({ id: md, label: md }));
          break;
        }
        case "effort": {
          title = `SELECT EFFORT (${this.efforts.length} available)`;
          subtitle = "Left Knob: browse | Click: select | K14: cancel";
          items = this.efforts.map((ef) => ({ id: ef, label: ef }));
          break;
        }
        case "access": {
          title = `SELECT ACCESS (${this.accessLevels.length} available)`;
          subtitle = "Left Knob: browse | Click: select | K10: cancel";
          items = this.accessLevels.map((ac) => ({ id: ac, label: ac }));
          break;
        }
      }

      const focusIdx = Math.max(0, Math.min(items.length - 1, this.editorFocusIdx));
      this.editorFocusIdx = focusIdx;

      const lines: string[] = [];
      items.forEach((it, idx) => {
        const isFocused = idx === focusIdx;
        const prefix = isFocused ? "[>" : "  ";
        const suffix = isFocused ? "<]" : "  ";
        const num = `${idx + 1}.`.padEnd(3);
        const label = it.label.length > 20 ? it.label.slice(0, 19) + "…" : it.label.padEnd(20);
        const detail = it.detail ? ` (${it.detail})` : "";
        lines.push(`${prefix} ${num} ${label}${detail} ${suffix}`);
      });

      this.readerTitle = title;
      this.readerSubtitle = subtitle;
      this.readerLines = lines.length > 0 ? lines : ["No items available."];
      this.userPromptLineIndices = [];

      // Auto-window the reader scroll so the focused item is visible on the 5-line screen
      if (focusIdx < this.readerScrollLine) {
        this.readerScrollLine = focusIdx;
      } else if (focusIdx >= this.readerScrollLine + 5) {
        this.readerScrollLine = focusIdx - 4;
      }
      return;
    } else if (this.viewMode === "changes") {
      const curFile = this.changedFiles[this.selectedChangedFileIdx];
      currentModeKey = `changes:${curFile?.path || "none"}:${this.currentFileDiffLines.length}:${this.isChangesFileSelected}`;
      this.readerTitle = `DIFF | ${this.getCurrentProject().name}`;
      this.readerSubtitle = curFile
        ? (this.isChangesFileSelected ? `${curFile.status} ${curFile.path}` : `[Browse ${this.selectedChangedFileIdx + 1}/${this.changedFiles.length}] ${curFile.status} ${curFile.path}`)
        : "No changed files";
      this.readerLines = this.currentFileDiffLines.length > 0
        ? this.currentFileDiffLines
        : (curFile ? [`Diff for ${curFile.name}`, "No modifications detected."] : ["Working tree clean.", "No changed files found."]);
    } else if (this.isRecordingVoice) {
      currentModeKey = `recording:${this.voiceDestinationLabel || s.id}`;
      this.readerTitle = "Voice Input";
      this.readerSubtitle = "Recording audio as a whole...";
      this.readerLines = [
        "[● RECORDING VOICE]",
        `Target: ${this.voiceDestinationLabel || s.title}`,
        "",
        "Speak prompt into microphone...",
        "Press [Done] (K20 or K16) when finished.",
        "Press [Cancel] (K4) to abort.",
      ];
    } else if (this.isTranscribingVoice) {
      currentModeKey = `transcribing:${this.voiceDestinationLabel || s.id}`;
      this.readerTitle = "Transcribing Voice";
      this.readerSubtitle = `Target: ${this.voiceDestinationLabel || s.title}`;
      this.readerLines = [
        "[TRANSCRIBING AUDIO]",
        "Processing recorded speech utterance...",
        "",
        "Please wait a moment...",
      ];
    } else if (this.voiceSubmission !== "idle") {
      currentModeKey = `submission:${this.voiceSubmission}`;
      this.readerTitle = this.voiceSubmission === "sending" ? "Sending voice draft" : "Submission unconfirmed";
      this.readerSubtitle = `Target: ${this.voiceDestinationLabel || s.title}`;
      this.readerLines = ["Draft preserved; do not send again.", "Check the original task for delivery.", ...wrapText(this.voiceDraftText)];
    } else if (this.voiceDraftText) {
      currentModeKey = `draft:${this.voiceDestinationLabel || s.id}:${this.voiceDraftText}`;
      this.readerTitle = "Voice Prompt Draft";
      this.readerSubtitle = `Target: ${this.voiceDestinationLabel || s.title}`;

      // Auto-wrap draft text across multiple lines of max ~36 chars for MK20 display
      const raw = this.voiceDraftText.trim();
      const draftLines: string[] = [];
      const words = raw.split(/\s+/);
      let cur = "";
      for (const w of words) {
        if (!cur) {
          cur = w;
        } else if (cur.length + 1 + w.length <= 36) {
          cur += " " + w;
        } else {
          draftLines.push(cur);
          cur = w;
        }
      }
      if (cur) draftLines.push(cur);

      this.readerLines = [
        `[DRAFT PROMPT VERIFICATION]`,
        ...draftLines.map((l) => `"${l}"`),
        "",
        "Press [Send] (K16) to dispatch.",
        "Press [Talk] (K20) to replace draft.",
        "Press [Cancel] (K4) to discard.",
      ];
    } else {
      currentModeKey = `session:${m.id}/${h.id}/${p.id}/${s.id}`;
      
      const harnessPills = this.harnesses
        .map((hn, idx) => (idx === this.selectedHarnessIdx ? `[>${hn.name}<]` : ` ${hn.name} `))
        .join(" ");

      const machinePills = this.machines
        .map((mn, idx) => (idx === this.selectedMachineIdx ? `[>${mn.name}<]` : ` ${mn.name} `))
        .join(" ");

      if (this.currentTurns.length > 0) {
        const lines: string[] = [];
        const promptIndices: number[] = [];
        for (const turn of this.currentTurns) {
          if (turn.userPrompt) {
            const promptLines = wrapWithPrefix(turn.userPrompt, "[USER] ", "> ", 50);
            if (promptLines.length > 0) {
              promptIndices.push(lines.length);
              lines.push(...promptLines);
            }
          }
          if (this.showDetails && turn.processDetails && turn.processDetails.length > 0) {
            for (const proc of turn.processDetails) {
              const procLines = wrapWithPrefix(proc, "[PROCESS] ", "  ", 50);
              lines.push(...procLines);
            }
          }
          if (turn.agentResponse) {
            const respLines = wrapWithPrefix(turn.agentResponse, "[AGENT] ", "  ", 50);
            lines.push(...respLines);
          }
          lines.push(""); // separator between turns
        }
        this.userPromptLineIndices = promptIndices;
        this.readerTitle = `${m.name} | [${h.name.toUpperCase()}]`;
        this.readerSubtitle = `${p.name} -> ${s.title} (${this.currentTurns.length} turns)`;
        this.readerLines = lines;
      } else {
        this.userPromptLineIndices = [];
        this.readerTitle = `${m.name} | [${h.name.toUpperCase()}]`;
        this.readerSubtitle = `${p.name} -> ${s.title}`;
        this.readerLines = [
          `HARNESS (K13): ${harnessPills}`,
          `MACHINE (K17): ${machinePills}`,
          `PROJECT (K9):  ${p.name}  |  SESSION (K5): ${s.title}`,
          s.preview ? `Preview: ${s.preview}` : `Ready on ${h.name} (${m.name})`,
          `Status: ${h.name} active on ${m.name} [ID: ${s.id}]`,
          `Model: ${this.models[this.selectedModelIdx]} | Effort: ${this.efforts[this.selectedEffortIdx]}`,
          `Turn: Idle | Rotate Left Knob to scroll`,
        ];
      }
    }

    if (this.lastReaderModeKey !== currentModeKey) {
      this.lastReaderModeKey = currentModeKey;
      this.readerScrollLine = 0;
    } else {
      // Content updated in same view: clamp scroll position rather than resetting to top
      const maxScroll = Math.max(0, this.readerLines.length - 4);
      this.readerScrollLine = Math.min(this.readerScrollLine, maxScroll);
    }
  }

  public getCurrentMachine(): MachineInfo {
    return this.machines[this.selectedMachineIdx];
  }

  public getCurrentHarness(): HarnessInfo {
    return this.harnesses[this.selectedHarnessIdx];
  }

  public getCurrentProject(): ProjectInfo {
    const projs = this.getProjectsForCurrentScope();
    return projs[this.selectedProjectIdx] || projs[0] || { id: "none", name: "None", path: "/" };
  }

  public getCurrentSession(): SessionInfo {
    const sess = this.getSessionsForCurrentScope();
    return sess[this.selectedSessionIdx] || sess[0] || { id: "none", title: "Empty", createdAt: 0, preview: "" };
  }

  // --- Left Knob Navigation ---

  public onLeftKnob(delta: number): void {
    if (this.viewMode === "changes") {
      if (!this.isChangesFileSelected) {
        // File browsing mode: scroll through changed files
        this.scrollChangesFiles(delta);
      } else {
        // Diff content mode: scroll diff lines
        const maxScroll = Math.max(0, this.readerLines.length - 4);
        this.readerScrollLine = Math.max(0, Math.min(maxScroll, this.readerScrollLine + delta));
      }
    } else if (this.viewMode === "session") {
      if (this.activeEditor !== "none") {
        // Choice list browsing on Row 3
        const listLen = this.getEditorChoiceCount();
        this.editorFocusIdx = Math.max(0, Math.min(listLen - 1, this.editorFocusIdx + delta));
        // Keep 5-item window visible
        if (this.editorFocusIdx < this.editorChoiceWindowStart) {
          this.editorChoiceWindowStart = this.editorFocusIdx;
        } else if (this.editorFocusIdx >= this.editorChoiceWindowStart + 5) {
          this.editorChoiceWindowStart = this.editorFocusIdx - 4;
        }
        this.updateReaderForCurrentSession();
      } else {
        // Reader line scrolling: 4 lines visible on screen, firmly clamped
        const maxScroll = Math.max(0, this.readerLines.length - 4);
        this.readerScrollLine = Math.max(0, Math.min(maxScroll, this.readerScrollLine + delta));
      }
    } else if (this.viewMode === "workspace") {
      if (this.isWorkspaceViewerActive) {
        // In Viewer Mode: scroll content line-by-line, clamped so 4 lines remain on top display
        const totalLines = this.workspaceFileContentLines.length;
        const maxScroll = Math.max(0, totalLines - 4);
        this.readerScrollLine = Math.max(0, Math.min(maxScroll, this.readerScrollLine + delta));
      } else {
        // In Full File Browser Mode: move pre-selected cursor across 4x4 grid, scrolling 1 row at boundaries
        this.moveWorkspaceCursor(delta);
      }
    }
  }

  public onLeftKnobClick(): void {
    if (this.viewMode === "changes") {
      this.toggleChangesFileSelection();
    } else if (this.viewMode === "workspace") {
      if (this.isWorkspaceViewerActive) {
        this.closeWorkspaceViewer();
      }
    } else if (this.activeEditor !== "none") {
      this.commitActiveEditorChoice(this.editorFocusIdx);
    }
  }

  // --- Right Knob (Dedicated Volume / Mute) ---

  public onRightKnob(delta: number): void {
    this.volume = Math.max(0, Math.min(100, this.volume + delta * 5));
  }

  public onRightKnobClick(): void {
    this.isMuted = !this.isMuted;
  }

  // --- Editor Open & Commit ---

  public openEditor(field: ActiveEditorField): void {
    if (this.activeEditor === field) {
      this.activeEditor = "none";
    } else {
      this.activeEditor = field;
      switch (field) {
        case "harness":
          this.editorFocusIdx = this.selectedHarnessIdx;
          break;
        case "machine":
          this.editorFocusIdx = this.selectedMachineIdx;
          break;
        case "project":
          this.editorFocusIdx = this.selectedProjectIdx;
          break;
        case "session":
          this.editorFocusIdx = this.selectedSessionIdx;
          break;
        case "model":
          this.editorFocusIdx = this.selectedModelIdx;
          break;
        case "effort":
          this.editorFocusIdx = this.selectedEffortIdx;
          break;
        case "access":
          this.editorFocusIdx = this.selectedAccessIdx;
          break;
        default:
          this.editorFocusIdx = 0;
          break;
      }
      this.editorChoiceWindowStart = Math.max(0, this.editorFocusIdx - 2);
    }
    this.updateReaderForCurrentSession();
  }


  private getEditorChoiceCount(): number {
    switch (this.activeEditor) {
      case "harness": return this.harnesses.length;
      case "machine": return this.machines.length;
      case "project": return this.getProjectsForCurrentScope().length;
      case "session": return this.getSessionsForCurrentScope().length;
      case "model": return this.models.length;
      case "effort": return this.efforts.length;
      case "access": return this.accessLevels.length;
      default: return 0;
    }
  }

  public commitActiveEditorChoice(idx: number): void {
    switch (this.activeEditor) {
      case "harness":
        if (idx >= 0 && idx < this.harnesses.length) {
          this.selectedHarnessIdx = idx;
          this.memoryHarnessPerMachine.set(this.getCurrentMachine().id, this.getCurrentHarness().id);
          this.resolveProjectAndSession();
        }
        this.activeEditor = "none";
        this.updateReaderForCurrentSession();
        break;
      case "machine":
        if (idx >= 0 && idx < this.machines.length) {
          this.selectedMachineIdx = idx;
          this.resolveProjectAndSession();
        }
        this.activeEditor = "none";
        this.updateReaderForCurrentSession();
        break;
      case "project":
        this.selectProject(idx);
        break;
      case "session":
        this.selectSession(idx);
        break;
      case "model":
        if (idx >= 0 && idx < this.models.length) this.selectedModelIdx = idx;
        this.activeEditor = "none";
        this.updateReaderForCurrentSession();
        break;
      case "effort":
        if (idx >= 0 && idx < this.efforts.length) this.selectedEffortIdx = idx;
        this.activeEditor = "none";
        this.updateReaderForCurrentSession();
        break;
      case "access":
        if (idx >= 0 && idx < this.accessLevels.length) this.selectedAccessIdx = idx;
        this.activeEditor = "none";
        this.updateReaderForCurrentSession();
        break;
    }
  }

  // --- Generate 20 Key Visuals ---

  public getDeviceState(): V2DeviceState {
    const keys: KeyVisual[] = [];

    // Physical key matrix layout:
    // Row 0: K17 (col 0), K13 (col 1), K9 (col 2), K5 (col 3), K1 (col 4)
    // Row 1: K18 (col 0), K14 (col 1), K10 (col 2), K6 (col 3), K2 (col 4)
    // Row 2: K19 (col 0), K15 (col 1), K11 (col 2), K7 (col 3), K3 (col 4)
    // Row 3: K20 (col 0), K16 (col 1), K12 (col 2), K8 (col 3), K4 (col 4)

    const keyMatrix = [
      [17, 13, 9, 5, 1],
      [18, 14, 10, 6, 2],
      [19, 15, 11, 7, 3],
      [20, 16, 12, 8, 4],
    ];

    if (this.viewMode === "settings") {
      for (let keyId = 1; keyId <= 20; keyId++) {
        keys.push({ keyId, labelTop: keyId === 17 ? "SETTINGS" : "",
          labelMain: keyId === 17 ? "Close" : "", isFilled: keyId === 17,
          isEditing: false, isFocused: false, isDisabled: keyId !== 17 });
      }
    } else if (this.viewMode === "changes") {
      // Split Diff Modal:
      // (1,1): K17 Close button (Modal origin button has selected background & file scrollbar)
      const fileCount = this.changedFiles.length;
      const curFileIdx = this.selectedChangedFileIdx;
      keys.push({
        keyId: 17,
        labelTop: fileCount > 0 ? `FILE ${curFileIdx + 1}/${fileCount}` : "MODAL",
        labelMain: "Changes",
        labelSub: "Close",
        isFilled: true,
        isEditing: false,
        isFocused: false,
        scrollTotal: fileCount,
        activeItem: curFileIdx,
      });

      // Col 0 (Rows 1..3: K18, K19, K20): Changed Files list (3 per page)
      const filePageStart = this.changesFilePage * 3;
      const col0Keys = [18, 19, 20];
      for (let r = 0; r < 3; r++) {
        const kid = col0Keys[r];
        const fIdx = filePageStart + r;
        if (fIdx < this.changedFiles.length) {
          const f = this.changedFiles[fIdx];
          const isCurrent = fIdx === this.selectedChangedFileIdx;
          const isSel = isCurrent && this.isChangesFileSelected;
          const isFoc = isCurrent;
          keys.push({
            keyId: kid,
            labelTop: f.status || "M",
            labelMain: f.name.slice(0, 8),
            labelSub: f.path.length > 10 ? f.path.slice(-10) : f.path,
            isFilled: isSel,
            isFocused: isFoc,
            isEditing: false,
          });
        } else {
          keys.push({ keyId: kid, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        }
      }

      // Area (2,1)-(5,4): Cols 1..4, Rows 0..3 = 16 keys Text View showing diff lines
      // Top Display shows lines readerScrollLine + 0 .. readerScrollLine + 3 (4 lines).
      // The 4 key rows show the dense multi-line area immediately below the Top Display (up to 6 lines per row = 24 lines):
      // Row 1: (2,1)-(5,1) -> 6 lines starting at readerScrollLine + 4 across keys [13, 9, 5, 1]
      // Row 2: (2,2)-(5,2) -> 6 lines starting at readerScrollLine + 10 across keys [14, 10, 6, 2]
      // Row 3: (2,3)-(5,3) -> 6 lines starting at readerScrollLine + 16 across keys [15, 11, 7, 3]
      // Row 4: (2,4)-(5,4) -> 6 lines starting at readerScrollLine + 22 across keys [16, 12, 8, 4]
      const diffRows = [
        [13, 9, 5, 1],
        [14, 10, 6, 2],
        [15, 11, 7, 3],
        [16, 12, 8, 4],
      ];

      for (let r = 0; r < 4; r++) {
        const rowKeys = diffRows[r];
        const lineBase = this.readerScrollLine + 4 + r * 6;

        const rowLines: { chunks: string[]; color: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const lIdx = lineBase + i;
          if (lIdx < this.currentFileDiffLines.length) {
            const line = this.currentFileDiffLines[lIdx];
            let color = 0; // white
            if (line.startsWith("+")) color = 1; // cyan
            else if (line.startsWith("-")) color = 2; // rose
            else if (line.startsWith("@@")) color = 3; // amber
            const chunks = sliceLineIntoChunks(line, 4, 12);
            rowLines.push({ chunks, color });
          }
        }

        if (rowLines.length > 0) {
          for (let c = 0; c < 4; c++) {
            const kid = rowKeys[c];
            const keyItems = rowLines.map((rl) => rl.chunks[c] || "");
            const keyColors = rowLines.map((rl) => rl.color);

            keys.push({
              keyId: kid,
              labelTop: "",
              labelMain: keyItems[0] || "",
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
            keys.push({
              keyId: kid,
              labelTop: "",
              labelMain: "",
              isFilled: false,
              isEditing: false,
              isFocused: false,
              isDisabled: true,
            });
          }
        }
      }
    } else if (this.viewMode === "workspace") {
      if (!this.isWorkspaceViewerActive) {
        // Mode 1: Full File Browser Mode
        // Col 1: K17 (Close, selected fill), K18 (DIR Up), K19 (DIR Root), K20 (Item index / total)
        keys.push({
          keyId: 17,
          labelTop: "MODAL",
          labelMain: "Files",
          labelSub: "Close",
          isFilled: true,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 18,
          labelTop: "DIR",
          labelMain: "Up",
          labelSub: "..",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 19,
          labelTop: "ROOT",
          labelMain: "Home",
          labelSub: "/",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        const totalFiles = this.workspaceFiles.length;
        keys.push({
          keyId: 20,
          labelTop: "ITEM",
          labelMain: totalFiles > 0 ? `${this.workspaceCursorIdx + 1}/${totalFiles}` : "0/0",
          labelSub: `Row ${Math.floor(this.workspaceCursorIdx / 4) + 1}`,
          isFilled: false,
          isEditing: false,
          isFocused: false,
          isDisabled: false,
        });

        // Area (2,1)-(5,4): 4 rows x 4 cols = 16 keys
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
                labelTop: f.isDir ? "DIR" : "FILE",
                labelMain: f.name.length > 9 ? f.name.slice(0, 9) : f.name,
                labelSub: f.isDir ? "Folder" : (f.size || ""),
                isFilled: false, // Pre-selected outline only, no fill
                isEditing: false,
                isFocused: isCur, // Cyan outline border
              });
            } else {
              keys.push({
                keyId: kid,
                labelTop: "",
                labelMain: "",
                isFilled: false,
                isEditing: false,
                isFocused: false,
                isDisabled: true,
              });
            }
          }
        }
      } else {
        // Mode 2: File Viewer Mode (Content View like Changes)
        // Col 1: K17 (Close with file scrollbar), K18..K20 (3 files with selected file filled)
        const fileCount = this.workspaceFiles.length;
        const curIdx = this.workspaceSelectedFileIdx;
        keys.push({
          keyId: 17,
          labelTop: fileCount > 0 ? `FILE ${curIdx + 1}/${fileCount}` : "MODAL",
          labelMain: "Files",
          labelSub: "Close",
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
              labelTop: f.isDir ? "DIR" : "FILE",
              labelMain: f.name.length > 8 ? f.name.slice(0, 8) : f.name,
              labelSub: f.isDir ? "Folder" : (f.size || ""),
              isFilled: isCurrent,
              isFocused: isCurrent,
              isEditing: false,
            });
          } else {
            keys.push({
              keyId: kid,
              labelTop: "",
              labelMain: "",
              isFilled: false,
              isEditing: false,
              isFocused: false,
              isDisabled: true,
            });
          }
        }

        // Area (2,1)-(5,4): 16 keys Text View showing file content lines
        const viewerRows = [
          [13, 9, 5, 1],
          [14, 10, 6, 2],
          [15, 11, 7, 3],
          [16, 12, 8, 4],
        ];

        for (let r = 0; r < 4; r++) {
          const rowKeys = viewerRows[r];
          const lineBase = this.readerScrollLine + 4 + r * 6;

          const rowLines: { chunks: string[]; color: number }[] = [];
          for (let i = 0; i < 6; i++) {
            const lIdx = lineBase + i;
            if (lIdx < this.workspaceFileContentLines.length) {
              const line = this.workspaceFileContentLines[lIdx];
              let color = 0; // white
              const trimmed = line.trim();
              if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
                color = 3; // amber
              } else if (trimmed.startsWith("import ") || trimmed.startsWith("export ") || trimmed.startsWith("function ") || trimmed.startsWith("class ") || trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("return ")) {
                color = 1; // cyan
              }
              const chunks = sliceLineIntoChunks(line, 4, 12);
              rowLines.push({ chunks, color });
            }
          }

          if (rowLines.length > 0) {
            for (let c = 0; c < 4; c++) {
              const kid = rowKeys[c];
              const keyItems = rowLines.map((rl) => rl.chunks[c] || "");
              const keyColors = rowLines.map((rl) => rl.color);

              keys.push({
                keyId: kid,
                labelTop: "",
                labelMain: keyItems[0] || "",
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
              keys.push({
                keyId: kid,
                labelTop: "",
                labelMain: "",
                isFilled: false,
                isEditing: false,
                isFocused: false,
                isDisabled: true,
              });
            }
          }
        }
      }
    } else if (this.viewMode === "question" && this.activeQuestion) {
      // Question view: Rows 0..2 = 3 spanning option rows
      const opts = this.activeQuestion.options;
      for (let r = 0; r < 3; r++) {
        const opt = opts[r];
        for (let c = 0; c < 5; c++) {
          const kid = keyMatrix[r][c];
          if (opt) {
            keys.push({
              keyId: kid,
              labelTop: c === 0 ? `OPT ${r + 1}` : "",
              labelMain: c === 0 ? (opt.isSelected ? "[X]" : "[ ]") : opt.label.slice((c - 1) * 6, c * 6),
              isFilled: opt.isSelected,
              isEditing: false,
              isFocused: false,
            });
          } else {
            keys.push({ keyId: kid, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
          }
        }
      }
      // Row 3: Other, Submit, Speak, Later, Stop
      keys.push({ keyId: 20, labelTop: "INPUT", labelMain: "Other", isFilled: false, isEditing: false, isFocused: false });
      keys.push({ keyId: 16, labelTop: "ACTION", labelMain: "Submit", isFilled: true, isEditing: false, isFocused: false });
      keys.push({ keyId: 12, labelTop: "VOICE", labelMain: "Speak", isFilled: this.isSpeaking, isEditing: false, isFocused: false });
      keys.push({ keyId: 8, labelTop: "DISMISS", labelMain: "Later", isFilled: false, isEditing: false, isFocused: false });
      keys.push({ keyId: 4, labelTop: "ABORT", labelMain: "Stop", isFilled: false, isEditing: false, isFocused: false });
    } else {
      // Default Session view
      // Row 0 (Context): Machine, Harness, Project, Session, New
      // Machine (K17): Pattern 3 multi-item list
      keys.push({
        keyId: 17,
        labelTop: "MACHINE",
        labelMain: this.getCurrentMachine().name,
        labelSub: "K17:Cycle",
        isFilled: true,
        isEditing: this.activeEditor === "machine",
        isFocused: false,
        items: this.machines.map((m) => m.name),
        activeItem: this.selectedMachineIdx,
      });

      // Harness (K13): Pattern 3 multi-item list
      keys.push({
        keyId: 13,
        labelTop: "HARNESS",
        labelMain: this.getCurrentHarness().name,
        labelSub: "K13:Cycle",
        isFilled: true,
        isEditing: this.activeEditor === "harness",
        isFocused: false,
        items: this.harnesses.map((h) => h.name),
        activeItem: this.selectedHarnessIdx,
      });

      // Project (K9)
      keys.push({
        keyId: 9,
        labelTop: "PROJECT",
        labelMain: this.getCurrentProject().name,
        labelSub: "K9:Pick",
        isFilled: true,
        isEditing: this.activeEditor === "project",
        isFocused: false,
      });

      // Session (K5)
      keys.push({
        keyId: 5,
        labelTop: "SESSION",
        labelMain: this.getCurrentSession().title,
        labelSub: "K5:Pick",
        isFilled: true,
        isEditing: this.activeEditor === "session",
        isFocused: false,
      });

      // New (K1)
      keys.push({
        keyId: 1,
        labelTop: "ACTION",
        labelMain: "New",
        isFilled: false,
        isEditing: false,
        isFocused: false,
      });

      // Row 1 (Config/Modals): Model, Effort, Access, Files, Settings
      keys.push({
        keyId: 18,
        labelTop: "MODEL",
        labelMain: this.models[this.selectedModelIdx],
        isFilled: true,
        isEditing: this.activeEditor === "model",
        isFocused: false,
      });
      keys.push({
        keyId: 14,
        labelTop: "EFFORT",
        labelMain: this.efforts[this.selectedEffortIdx],
        isFilled: true,
        isEditing: this.activeEditor === "effort",
        isFocused: false,
      });
      keys.push({
        keyId: 10,
        labelTop: "ACCESS",
        labelMain: this.accessLevels[this.selectedAccessIdx],
        isFilled: true,
        isEditing: this.activeEditor === "access",
        isFocused: false,
      });
      keys.push({
        keyId: 6,
        labelTop: "VIEW",
        labelMain: "Files",
        isFilled: false,
        isEditing: false,
        isFocused: false,
      });
      keys.push({
        keyId: 2,
        labelTop: "SYSTEM",
        labelMain: "Settings",
        isFilled: false,
        isEditing: false,
        isFocused: false,
      });

      // Row 2: Contextual Navigation OR Choice items when editing
      if (this.activeEditor !== "none") {
        const curProjs = this.getProjectsForCurrentScope();
        const curSess = this.getSessionsForCurrentScope();

        // Choice picker window on Row 2
        for (let c = 0; c < 5; c++) {
          const kid = keyMatrix[2][c];
          const choiceIdx = this.editorChoiceWindowStart + c;
          let label = "";
          let isChosen = false;

          if (this.activeEditor === "harness" && choiceIdx < this.harnesses.length) {
            label = this.harnesses[choiceIdx].name;
            isChosen = choiceIdx === this.selectedHarnessIdx;
          } else if (this.activeEditor === "machine" && choiceIdx < this.machines.length) {
            label = this.machines[choiceIdx].name;
            isChosen = choiceIdx === this.selectedMachineIdx;
          } else if (this.activeEditor === "project" && choiceIdx < curProjs.length) {
            label = curProjs[choiceIdx].name;
            isChosen = choiceIdx === this.selectedProjectIdx;
          } else if (this.activeEditor === "session" && choiceIdx < curSess.length) {
            label = curSess[choiceIdx].title;
            isChosen = choiceIdx === this.selectedSessionIdx;
          } else if (this.activeEditor === "model" && choiceIdx < this.models.length) {
            label = this.models[choiceIdx];
            isChosen = choiceIdx === this.selectedModelIdx;
          } else if (this.activeEditor === "effort" && choiceIdx < this.efforts.length) {
            label = this.efforts[choiceIdx];
            isChosen = choiceIdx === this.selectedEffortIdx;
          } else if (this.activeEditor === "access" && choiceIdx < this.accessLevels.length) {
            label = this.accessLevels[choiceIdx];
            isChosen = choiceIdx === this.selectedAccessIdx;
          }

          if (label) {
            keys.push({
              keyId: kid,
              labelTop: `ITEM ${choiceIdx + 1}`,
              labelMain: label,
              isFilled: isChosen,
              isEditing: false,
              isFocused: choiceIdx === this.editorFocusIdx,
            });
          } else {
            keys.push({ keyId: kid, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
          }
        }
      } else {
        // Standard Contextual Navigation: Prev Prompt, Next Prompt, Detail Filter, Changes Git
        keys.push({
          keyId: 19,
          labelTop: "PROMPT",
          labelMain: "Prev",
          labelSub: "Jump",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 15,
          labelTop: "PROMPT",
          labelMain: "Next",
          labelSub: "Jump",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 11,
          labelTop: "DETAILS",
          labelMain: this.showDetails ? "[ ON ]" : "[ OFF ]",
          labelSub: this.showDetails ? "All Steps" : "Prompts Only",
          isFilled: this.showDetails,
          isEditing: this.showDetails,
          isFocused: false,
        });
        keys.push({
          keyId: 7,
          labelTop: "GIT",
          labelMain: "Changes",
          labelSub: "Diff",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({ keyId: 3, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
      }

      // Row 3 (Conversation Actions): Talk, Send, Speak, Unassigned, Stop
      if (this.isRecordingVoice) {
        keys.push({
          keyId: 20,
          labelTop: "MIC ON",
          labelMain: "Done",
          labelSub: "Transcribe",
          isFilled: true,
          isEditing: true,
          isFocused: false,
        });
        keys.push({
          keyId: 16,
          labelTop: "FINISH",
          labelMain: "Done",
          labelSub: "Transcribe",
          isFilled: false,
          isEditing: false,
          isFocused: true,
        });
        keys.push({ keyId: 12, labelTop: "AUDIO", labelMain: "Speak", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: "ABORT",
          labelMain: "Cancel",
          labelSub: "Discard",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      } else if (this.isTranscribingVoice) {
        keys.push({
          keyId: 20,
          labelTop: "STT",
          labelMain: "Wait...",
          isFilled: false,
          isEditing: false,
          isFocused: false,
          isDisabled: true,
        });
        keys.push({
          keyId: 16,
          labelTop: "STT",
          labelMain: "Working",
          isFilled: false,
          isEditing: false,
          isFocused: false,
          isDisabled: true,
        });
        keys.push({ keyId: 12, labelTop: "AUDIO", labelMain: "Speak", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: "ABORT",
          labelMain: "Cancel",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      } else if (this.voiceDraftText) {
        keys.push({
          keyId: 20,
          labelTop: "RE-RECORD",
          labelMain: "Talk",
          labelSub: "Replace",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 16,
          labelTop: "CONFIRM",
          labelMain: "Send",
          labelSub: "Dispatch",
          isFilled: true,
          isEditing: false,
          isFocused: true,
        });
        keys.push({ keyId: 12, labelTop: "AUDIO", labelMain: "Speak", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({ keyId: 8, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: "DISCARD",
          labelMain: "Cancel",
          labelSub: "Clear",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      } else {
        keys.push({
          keyId: 20,
          labelTop: "VOICE",
          labelMain: "Talk",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({
          keyId: 16,
          labelTop: "ACTION",
          labelMain: "Send",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
        keys.push({ keyId: 12, labelTop: "AUDIO", labelMain: "Speak", isFilled: this.isSpeaking, isEditing: false, isFocused: false });
        keys.push({ keyId: 8, labelTop: "", labelMain: "", isFilled: false, isEditing: false, isFocused: false, isDisabled: true });
        keys.push({
          keyId: 4,
          labelTop: "ABORT",
          labelMain: "Stop",
          isFilled: false,
          isEditing: false,
          isFocused: false,
        });
      }
    }

    // The same disabled state is enforced by the input dispatcher.
    for (const key of keys) {
      if (this.viewMode === "session" || this.viewMode === "editor") {
        if (key.keyId === 12) key.isDisabled = true; // TTS is outside this MVP.
        if (key.keyId === 16 && !this.isRecordingVoice && !this.voiceDraftText.trim()) key.isDisabled = true;
        if ([20, 16, 4].includes(key.keyId) && this.voiceSubmission !== "idle") {
          key.isDisabled = true;
          key.labelMain = key.keyId === 16 ? (this.voiceSubmission === "sending" ? "Sending" : "Check task") : "";
          key.labelTop = key.keyId === 16 ? "DELIVERY" : "";
          key.labelSub = "";
        }
      }
      if (this.viewMode === "question" && [20, 12].includes(key.keyId)) key.isDisabled = true;
      if (this.viewMode === "question" && key.keyId === 16) {
        key.isDisabled = !this.activeQuestion?.isPermission || !this.activeQuestion.options.some(o => o.isSelected);
      }
    }

    return {
      viewMode: this.viewMode,
      activeEditor: this.activeEditor,
      machine: this.getCurrentMachine().name,
      harness: this.getCurrentHarness().name,
      project: this.getCurrentProject().name,
      session: this.getCurrentSession().title,
      model: this.models[this.selectedModelIdx],
      effort: this.efforts[this.selectedEffortIdx],
      access: this.accessLevels[this.selectedAccessIdx],
      volume: this.volume,
      isMuted: this.isMuted,
      isSpeaking: this.isSpeaking,
      topTitle: this.readerTitle,
      topSubtitle: this.readerSubtitle,
      topBodyLines: this.readerLines,
      topScrollLine: this.readerScrollLine,
      topTotalLines: this.readerLines.length,
      question: this.activeQuestion,
      keys,
    };
  }
}
