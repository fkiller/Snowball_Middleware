import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { ContextManager, wrapText } from "./context.js";
import { VoiceDraft, type DraftDestination } from "../audio/draft.js";
import type { NativeVoiceProvider } from "../audio/provider.js";
import type { DeviceInputPacket } from "../protocol/messages.js";
import type { KeyVisual, ProjectInfo, SessionInfo } from "../types.js";
import { GitProvider } from "../vcs/git.js";
import { CodexDesktopClient } from "../codex/desktop.js";

export function extractTurnUserPrompt(items: any[]): string {
  const parts: string[] = [];
  for (const item of items || []) {
    if (item.type === "userMessage") {
      const text = (item.content || []).map((c: any) => c.text || "").join("\n") || item.text || "";
      if (text) parts.push(text);
    } else if (item.type === "functionCallOutput" && item.name === "send_message_to_thread") {
      const match = (item.output || "").match(/<input>([\s\S]*?)<\/input>/);
      const text = match ? match[1].trim() : (item.output || "");
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

export function turnContainsUserPrompt(turn: any, prompt: string): boolean {
  const normPrompt = prompt.replace(/\s+/g, " ").trim();
  const extracted = extractTurnUserPrompt(turn.items || []).replace(/\s+/g, " ").trim();
  if (extracted === normPrompt || (normPrompt && extracted.includes(normPrompt))) return true;
  return (turn.items || []).some((item: any) => {
    if (item.type === "userMessage") {
      const text = ((item.content || []).map((part: any) => part.text || "").join("\n") || item.text || "").replace(/\s+/g, " ").trim();
      return text === normPrompt || (normPrompt && text.includes(normPrompt));
    }
    if (item.type === "functionCallOutput" && item.name === "send_message_to_thread") {
      const output = (item.output || "").replace(/\s+/g, " ").trim();
      return output.includes(normPrompt);
    }
    return false;
  });
}

export interface MvpDesktopClient {
  isConnected: boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
  sendMessageToThread(threadId: string, prompt: string, model?: string, thinking?: string): Promise<any>;
}

export interface MvpBackend extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  request<T = any>(method: string, params?: any): Promise<T>;
  respondServerRequest(id: string | number, result: any): void;
}
type Pending = { id: string | number; method: string; params: any; answers: Record<string, { answers: string[] }>; question: number; selected: number; sending?: boolean };
type Task = { phase: string; turnId?: string; text: string };

/** Single-owner Codex MVP. All button and asynchronous event paths are exercised without hardware. */
export class MvpController {
  readonly context = new ContextManager();
  readonly draft = new VoiceDraft();
  readonly tasks = new Map<string, Task>();
  readonly pending: Pending[] = [];
  connected = false;
  connecting = false;
  private revision = 0;
  private startingVoice = false;
  private cancellingVoice = false;
  private replacing?: { text: string; destination: DraftDestination };
  private voiceQuestion?: { request: Pending; questionId: string };
  private notice = "";
  private noticeTitle = "";
  private requestView = false;
  private filePath = "";
  private fileRoot = "";
  private fileReading = false;
  private questionOffset = 0;
  private modelSpecs: any[] = [];
  private disposed = false;
  private beforeSend?: string[];
  private persisted = "";

  constructor(
    readonly backend: MvpBackend,
    readonly voice: NativeVoiceProvider,
    private changed: () => void = () => {},
    private storagePath?: string,
    readonly desktop: MvpDesktopClient = new CodexDesktopClient()
  ) {
    const c = this.context;
    c.harnesses = [
      { id: "codex", name: "Codex", isEnabled: true },
      { id: "antigravity", name: "Antigrav", isEnabled: true },
      { id: "opencode", name: "OpenCode", isEnabled: true },
    ];
    c.projectsByScope = {}; c.sessionsByScope = {}; c.workspaceFiles = [];
    c.models = ["Default"]; c.efforts = ["Default"]; c.selectedEffortIdx = 0;
    c.accessLevels = ["on-request"]; c.selectedAccessIdx = 0;
    backend.on("raw_event", event => this.event(event));
    backend.on("raw_request", request => this.receive(request));
    backend.on("exit", () => { this.connected = false; this.info("Codex disconnected", "Draft retained. K3 reconnects; no automatic Send."); });
    if (storagePath && syncFs.existsSync(storagePath)) {
      const saved = JSON.parse(syncFs.readFileSync(storagePath, "utf8"));
      if (saved.draft?.text && ["review", "unknown", "sending"].includes(saved.draft.phase)) {
        this.draft.restore({ ...saved.draft, phase: saved.question ? "unknown" : saved.draft.phase });
        this.beforeSend = saved.beforeSend;
      }
    }
  }
  private target() { return this.context.getCurrentSession().id; }
  private project() { return this.context.getCurrentProject(); }
  private key(id: number, text: string, disabled = false, sub = ""): KeyVisual {
    return { keyId: id, labelTop: "", labelMain: text, labelSub: sub, isDisabled: disabled, isFilled: false, isEditing: false, isFocused: false };
  }
  private info(title: string, body: string) { this.noticeTitle = title; this.notice = body; this.context.readerScrollLine = 0; this.paint(); }
  private clearNotice() { this.notice = ""; this.noticeTitle = ""; }
  async connect() {
    if (this.connecting || this.disposed) return;
    this.connecting = true; this.info("Connecting", "Loading Codex projects and tasks...");
    try {
      await this.backend.start(); this.connected = true;
      try {
        const ok = await this.desktop.connect();
        if (ok) console.log("[MvpController] Connected to Codex Desktop IPC channel.");
      } catch (e: any) {
        console.warn("[MvpController] Desktop pipe connect warning:", e?.message || e);
      }
      const models = await this.backend.request("model/list", {});
      this.modelSpecs = models.data || [];
      if (this.modelSpecs.length) {
        this.context.models = this.modelSpecs.map(m => m.id || m.model);
        const idx = this.modelSpecs.findIndex(m => m.isDefault);
        this.context.selectedModelIdx = Math.max(0, idx); this.updateEfforts();
      }
      await this.refresh(); this.clearNotice();
    } catch (e) { this.connected = false; this.noticeTitle = "Connection failed"; this.notice = `${e}\nK3: Retry connection`; }
    finally { this.connecting = false; this.paint(); }
  }
  private updateEfforts() {
    const model = this.modelSpecs[this.context.selectedModelIdx];
    this.context.efforts = model?.supportedReasoningEfforts?.map((v: any) => v.reasoningEffort) || ["Default"];
    this.context.selectedEffortIdx = Math.max(0, this.context.efforts.indexOf(model?.defaultReasoningEffort));
  }
  private normalizePath(p: string): string {
    if (!p) return "";
    const resolved = path.resolve(p);
    if (process.platform === "win32" && resolved.length >= 2 && resolved[1] === ":") {
      return resolved[0].toUpperCase() + resolved.slice(1);
    }
    return resolved;
  }

  async refresh() {
    const generation = ++this.revision;
    const priorProject = this.project().id, priorSession = this.target();
    const result = await this.backend.request("thread/list", { limit: 100 });
    if (generation !== this.revision) return;
    const threads: any[] = result.data || [];
    const roots: string[] = [];
    for (const t of threads) {
      if (!t.cwd) continue;
      const norm = this.normalizePath(t.cwd);
      if (!roots.some(r => r.toLowerCase() === norm.toLowerCase())) {
        roots.push(norm);
      }
    }
    const procCwd = this.normalizePath(process.cwd());
    if (!roots.some(r => r.toLowerCase() === procCwd.toLowerCase())) roots.unshift(procCwd);
    const projects: ProjectInfo[] = roots.map(root => ({ id: root, name: path.basename(root) || root, path: root }));
    this.context.projectsByScope["dev-pc/codex"] = projects;
    for (const p of projects) {
      this.context.sessionsByScope[`dev-pc/codex/${p.id}`] = threads
        .filter(t => t.cwd && this.normalizePath(t.cwd).toLowerCase() === p.path.toLowerCase())
        .map(t => ({
          id: t.id, title: t.name || t.title || t.preview || t.id, preview: t.preview || "", createdAt: t.createdAt || 0,
        }));
    }
    this.context.selectedProjectIdx = Math.max(0, projects.findIndex(p => p.id.toLowerCase() === priorProject.toLowerCase()));
    this.context.selectedSessionIdx = Math.max(0, this.context.getSessionsForCurrentScope().findIndex(s => s.id === priorSession));
    await this.load();
  }
  async load() {
    const id = this.target(), generation = ++this.revision;
    if (id === "none") { this.context.setSessionTurns([]); this.paint(); return; }
    if (this.context.getCurrentHarness().id !== "codex") {
      const sess = this.context.getCurrentSession();
      this.context.setSessionTurns([
        {
          id: sess.id,
          userPrompt: `Harness: ${this.context.getCurrentHarness().name}`,
          agentResponse: sess.preview || `Ready on ${this.context.getCurrentHarness().name} (${this.context.getCurrentMachine().name})`,
        }
      ]);
      this.paint();
      return;
    }
    const response = await this.backend.request("thread/read", { threadId: id, includeTurns: true });
    if (generation !== this.revision || this.target() !== id) return;
    const turns = response.thread?.turns || [];
    this.context.setSessionTurns(turns.map((turn: any) => ({
      id: turn.id, userPrompt: extractTurnUserPrompt(turn.items),
      agentResponse: (turn.items || []).filter((i: any) => i.type === "agentMessage").map((i: any) => i.text || "").join("\n"),
      processDetails: (turn.items || []).filter((i: any) => i.type === "commandExecution").map((i: any) => i.command || ""),
    })));
    const latest = turns.at(-1);
    if (latest) this.tasks.set(id, { phase: latest.status, turnId: latest.id, text: "" });
    else this.tasks.set(id, { phase: "idle", text: "" });
    this.paint();
  }
  private event(event: any) {
    const p = event.params || {}, id = p.threadId;
    if (event.method === "serverRequest/resolved") {
      const index = this.pending.findIndex(r => String(r.id) === String(p.requestId));
      if (index >= 0) this.pending.splice(index, 1);
    }
    if (event.method === "turn/started") this.tasks.set(id, { phase: "inProgress", turnId: p.turn.id, text: "" });
    if (event.method === "item/agentMessage/delta") {
      const t = this.tasks.get(id) || { phase: "inProgress", turnId: p.turnId, text: "" };
      t.text += p.delta || ""; this.tasks.set(id, t);
    }
    if (event.method === "turn/completed") {
      const t = this.tasks.get(id) || { text: "", phase: "" };
      t.phase = p.turn.status; t.turnId = p.turn.id; this.tasks.set(id, t);
      for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].params.threadId === id && this.pending[i].params.turnId === p.turn.id) this.pending.splice(i, 1);
      if (id === this.target() && this.context.viewMode === "session" && !this.draft.snapshot?.text) void this.load().catch(e => this.info("Read failed", String(e)));
    }
    this.paint();
  }
  private receive(request: any) {
    if (!["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/tool/requestUserInput"].includes(request.method)) return;
    this.pending.push({ ...request, answers: {}, question: 0, selected: -1 });
    if (!this.draft.snapshot || ["sent", "cancelled", "empty", "failed"].includes(this.draft.snapshot.phase)) this.requestView = true;
    this.paint();
  }
  private activeRequest() { return this.pending[0]; }
  private async stopTask(id = this.target()) {
    const task = this.tasks.get(id);
    if (!task?.turnId || !["inProgress", "stopping"].includes(task.phase)) return this.info("Stop unavailable", "No confirmed running turn. Refresh the task.");
    if (task.phase === "stopping") return;
    task.phase = "stopping"; this.info("Stop requested", "Waiting for Codex to confirm interruption.");
    try {
      await this.backend.request("turn/interrupt", { threadId: id, turnId: task.turnId });
      // ACK is not a completed turn. Only turn/completed changes terminal status.
      this.clearNotice(); this.paint();
    } catch (e) { task.phase = "inProgress"; this.info("Stop unconfirmed", String(e)); }
  }
  private async startVoice() {
    if (this.startingVoice || this.cancellingVoice) return;
    const prior = this.draft.snapshot;
    if (prior && ["sending", "unknown", "recording", "transcribing"].includes(prior.phase)) return;
    if (!this.connected || this.target() === "none") return this.info("Select a task", "Create or select a Codex task before recording.");
    if (prior?.phase === "review") { this.replacing = { text: prior.text, destination: prior.destination }; this.draft.cancel(); }
    const request = this.requestView ? this.activeRequest() : undefined;
    const question = request?.params.questions?.[request.question];
    this.voiceQuestion = question ? { request: request!, questionId: question.id } : undefined;
    const destination: DraftDestination = { machineId: "dev-pc", harnessId: "codex", projectId: this.project().id, sessionId: request?.params.threadId || this.target(), owner: "cli" };
    const capture = this.draft.begin(destination);
    this.requestView = false; this.startingVoice = true; this.clearNotice(); this.paint();
    try { await this.voice.start(capture.id); }
    catch (e) { this.draft.fail(capture.id); this.info("Microphone unavailable", `${e}\nK20: Retry`); }
    finally { this.startingVoice = false; this.paint(); }
  }
  private async finishVoice() {
    const snapshot = this.draft.snapshot;
    if (this.startingVoice || !snapshot || !this.draft.transcribing(snapshot.id)) return;
    this.paint();
    try {
      const text = await this.voice.finish(snapshot.id);
      if (this.draft.complete(snapshot.id, text) && !text.trim()) this.info("No speech recognized", "K20: Record again. No prompt was sent.");
    } catch (e) { if (this.draft.fail(snapshot.id)) this.info("Transcription failed", `${e}\nK20: Retry`); }
    this.paint();
  }
  private async cancelVoice() {
    const snapshot = this.draft.snapshot;
    if (!snapshot || !this.draft.cancel()) return;
    this.cancellingVoice = true; this.paint();
    try { if (["recording", "transcribing"].includes(snapshot.phase)) await this.voice.cancel(snapshot.id); }
    catch (e) { this.info("Capture cleanup failed", String(e)); }
    finally { this.cancellingVoice = false; this.paint(); }
  }
  edit(text: string) { this.draft.edit(text); this.paint(); }
  private restoreDraft() {
    if (!this.replacing || this.draft.snapshot?.phase === "sending" || this.draft.snapshot?.phase === "unknown") return;
    this.draft.cancel(); const value = this.replacing; this.replacing = undefined;
    const capture = this.draft.begin(value.destination); this.draft.transcribing(capture.id); this.draft.complete(capture.id, value.text); this.paint();
  }
  private pollDesktopTurn(threadId: string) {
    let attempts = 0;
    const maxAttempts = 60; // 90 seconds
    const interval = setInterval(async () => {
      attempts++;
      if (this.disposed || attempts > maxAttempts) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await this.backend.request("thread/read", { threadId, includeTurns: true });
        const turns = res.thread?.turns || [];
        const latest = turns.at(-1);
        if (latest) {
          this.tasks.set(threadId, { phase: latest.status, turnId: latest.id, text: "" });
          if (this.target() === threadId) {
            await this.load();
          }
          if (latest.status !== "inProgress") {
            clearInterval(interval);
          }
        }
      } catch {
        // Ignored on transient read error
      }
    }, 1500);
    interval.unref();
  }
  private async send() {
    const snapshot = this.draft.snapshot;
    if (!this.connected || snapshot?.phase !== "review" || !snapshot.text.trim()) return;
    this.clearNotice();
    const promise = this.draft.submit(async (destination, text) => {
      if (this.voiceQuestion) {
        const { request, questionId } = this.voiceQuestion;
        if (!this.pending.includes(request)) throw new Error("Question expired; answer was not sent.");
        request.answers[questionId] = { answers: [text] }; request.question++; request.selected = -1;
        this.requestView = true; this.voiceQuestion = undefined;
        if (request.question >= request.params.questions.length) await this.answer(request);
        return;
      }

      const before = await this.backend.request("thread/read", { threadId: destination.sessionId, includeTurns: true }).catch(() => ({ thread: { turns: [] } }));
      this.beforeSend = (before.thread?.turns || []).map((t: any) => t.id);
      this.paint();

      let isDesktopDelegated = false;
      try {
        await this.backend.request("thread/resume", { threadId: destination.sessionId });
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (msg.includes("already has an active writer") || msg.includes("thread-store conflict")) {
          console.log(`[MvpController] Thread ${destination.sessionId} has active desktop writer. Routing via Codex Desktop IPC...`);
          if (!this.desktop.isConnected) {
            await this.desktop.connect();
          }
          if (this.desktop.isConnected) {
            isDesktopDelegated = true;
          } else {
            throw err;
          }
        } else if (msg.includes("no rollout found")) {
          console.log(`[MvpController] Thread ${destination.sessionId} has no rollout yet (fresh thread). Proceeding to turn/start...`);
        } else {
          throw err;
        }
      }

      if (isDesktopDelegated) {
        await this.desktop.sendMessageToThread(destination.sessionId, text);
        this.tasks.set(destination.sessionId, { phase: "inProgress", text: "" });
        this.pollDesktopTurn(destination.sessionId);
      } else {
        const model = this.context.models[this.context.selectedModelIdx];
        const effort = this.context.efforts[this.context.selectedEffortIdx];
        const result = await this.backend.request("turn/start", {
          threadId: destination.sessionId,
          input: [{ type: "text", text }],
          model: model === "Default" ? null : model,
          effort: effort === "Default" ? null : effort,
          approvalPolicy: "on-request"
        });
        const existing = this.tasks.get(destination.sessionId);
        if (!existing || existing.turnId !== result.turn?.id) {
          this.tasks.set(destination.sessionId, { phase: result.turn?.status || "inProgress", turnId: result.turn?.id, text: "" });
        }
      }
    });
    this.paint();
    try { await promise; this.replacing = undefined; this.clearNotice(); }
    catch (e) { this.info("Submission unconfirmed", `${e}\nOriginal draft retained. Check the original task.`); }
    this.paint();
  }
  private async reconcile() {
    const d = this.draft.snapshot;
    if (d?.phase !== "unknown" || this.voiceQuestion) return;
    const read = await this.backend.request("thread/read", { threadId: d.destination.sessionId, includeTurns: true });
    const match = (read.thread?.turns || []).some((turn: any) =>
      (!this.beforeSend || !this.beforeSend.includes(turn.id)) &&
      turnContainsUserPrompt(turn, d.text)
    );
    if (match) {
      this.draft.confirmDelivered(d.id);
      this.info("Delivery confirmed", "The original task contains this prompt. No replay was performed.");
      await this.load();
    } else {
      this.info("Delivery still unknown", "No matching new prompt.\nK16: Check again | K4: Discard draft");
    }
  }
  private async answer(request: Pending) {
    if (request.sending || !this.pending.includes(request)) return;
    request.sending = true; this.paint();
    try {
      this.backend.respondServerRequest(request.id, request.method === "item/tool/requestUserInput" ? { answers: request.answers } : { decision: request.selected === 0 ? "accept" : "decline" });
      this.pending.splice(this.pending.indexOf(request), 1); this.requestView = this.pending.length > 0;
      this.info("Answer dispatched", "Awaiting the agent's next event.");
    } catch (e) { request.sending = false; this.info("Answer failed", String(e)); }
  }
  private async files(directory: string) {
    const generation = ++this.revision;
    let projPath = this.project()?.path;
    try {
      if (!projPath || !(await fs.stat(projPath)).isDirectory()) {
        projPath = process.cwd();
      }
    } catch {
      projPath = process.cwd();
    }
    const root = await fs.realpath(projPath);
    let target = directory;
    try {
      target = await fs.realpath(directory);
    } catch {
      target = root;
    }
    if (target !== root && !target.startsWith(root + path.sep)) {
      target = root;
    }
    const entries = await fs.readdir(target, { withFileTypes: true });
    if (generation !== this.revision) return;
    this.filePath = target;
    this.fileRoot = root;
    this.fileReading = false;
    const mapped = entries
      .filter(e => !e.isSymbolicLink() && e.name !== ".git" && !e.name.startsWith(".probe-"))
      .sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
    if (target !== root) {
      this.context.workspaceFiles = [{ name: "..", isDir: true }, ...mapped];
    } else {
      this.context.workspaceFiles = mapped;
    }
    this.context.workspaceScrollRow = 0;
    this.context.workspaceCursorIdx = 0;
    this.context.isWorkspaceViewerActive = false;
    this.context.viewMode = "workspace";
    this.context.activeEditor = "none";
    this.clearNotice();
    this.paint();
  }
  private async openFileForViewing(fileIdx: number, fileName: string) {
    const c = this.context;
    const generation = ++this.revision;
    const full = await fs.realpath(path.join(this.filePath, fileName));
    if (!full.startsWith(this.fileRoot + path.sep) && full !== this.fileRoot) {
      throw new Error("Outside project");
    }
    const stat = await fs.stat(full);
    if (stat.size > 256000) throw new Error("File exceeds 256 KB preview limit");
    const text = await fs.readFile(full, "utf8");
    if (generation !== this.revision) return;
    if (text.includes("\0")) throw new Error("Binary file has no text preview");
    const lines = wrapText(text);
    this.fileReading = true;
    c.readerTitle = fileName;
    c.readerLines = lines;
    c.openWorkspaceViewer(fileIdx, lines);
  }
  async input(packet: DeviceInputPacket) {
    try { await this.dispatch(packet); }
    catch (e) { this.info("Action failed", String(e)); }
    this.paint();
  }
  private async dispatch(packet: DeviceInputPacket) {
    const c = this.context;
    if (packet.type === "knob_right") { packet.isClick ? c.onRightKnobClick() : c.onRightKnob(packet.delta || 0); return; }
    if (packet.type === "knob_left") {
      if (this.requestView) { this.questionOffset = Math.max(0, this.questionOffset + (packet.delta || 0)); return; }
      if (packet.isClick) {
        if (c.activeEditor !== "none") {
          const field = c.activeEditor;
          c.onLeftKnobClick();
          if (field === "model") this.updateEfforts();
          if (["session", "project", "machine", "harness"].includes(field)) await this.load();
        } else if (c.viewMode === "changes") {
          c.onLeftKnobClick();
          if (c.isChangesFileSelected && c.changedFiles.length > 0) {
            const curFile = c.changedFiles[c.selectedChangedFileIdx];
            if (curFile) {
              const generation = ++this.revision;
              const lines = await GitProvider.getFileDiff(curFile.path, this.project().path);
              if (generation === this.revision && c.viewMode === "changes") {
                c.currentFileDiffLines = lines;
                c.updateReaderForCurrentSession();
              }
            }
          }
        } else if (c.viewMode === "workspace") {
          if (c.isWorkspaceViewerActive) {
            c.closeWorkspaceViewer();
            this.fileReading = false;
          } else {
            const item = c.workspaceFiles[c.workspaceCursorIdx];
            if (item) {
              if (item.isDir) {
                if (item.name === "..") {
                  const parent = (this.filePath === this.fileRoot) ? this.fileRoot : path.dirname(this.filePath);
                  await this.files(parent);
                } else {
                  await this.files(path.join(this.filePath, item.name));
                }
              } else {
                await this.openFileForViewing(c.workspaceCursorIdx, item.name);
              }
            }
          }
        }
        return;
      }
      if (this.notice) this.clearNotice();
      if (c.viewMode === "workspace") {
        c.onLeftKnob(packet.delta || 0);
        return;
      }
      if (this.fileReading) c.readerScrollLine = Math.max(0, Math.min(c.readerLines.length - 4, c.readerScrollLine + (packet.delta || 0)));
      else {
        const prevIdx = c.selectedChangedFileIdx;
        c.onLeftKnob(packet.delta || 0);
        if (c.viewMode === "changes" && !c.isChangesFileSelected && c.selectedChangedFileIdx !== prevIdx) {
          const curFile = c.changedFiles[c.selectedChangedFileIdx];
          if (curFile) {
            const generation = ++this.revision;
            const lines = await GitProvider.getFileDiff(curFile.path, this.project().path);
            if (generation === this.revision && c.viewMode === "changes") {
              c.currentFileDiffLines = lines;
              c.updateReaderForCurrentSession();
            }
          }
        }
      }
      return;
    }
    if (packet.type !== "key" || !packet.isDown) return;
    const k = packet.keyId!;
    if (this.state().keys.find(key => key.keyId === k)?.isDisabled === true) return;
    if (k !== 16 || this.draft.snapshot?.phase !== "unknown") {
      this.clearNotice();
    }
    if (this.requestView) {
      const request = this.activeRequest(); if (!request) return;
      const rows = [[17,13,9,5,1],[18,14,10,6,2],[19,15,11,7,3]];
      const row = rows.findIndex(r => r.includes(k));
      if (row >= 0) request.selected = this.questionOffset + row;
      else if (k === 8) this.requestView = false;
      else if (k === 4) await this.stopTask(request.params.threadId);
      else if (k === 20) await this.startVoice();
      else if (k === 16) {
        if (request.method === "item/tool/requestUserInput") {
          const q = request.params.questions[request.question];
          request.answers[q.id] = { answers: [q.options[request.selected].label] };
          request.question++; request.selected = -1; this.questionOffset = 0;
          if (request.question < request.params.questions.length) return;
        }
        await this.answer(request);
      }
      return;
    }
    if (c.viewMode === "settings") { if (k === 17) { c.viewMode = "session"; this.clearNotice(); } return; }
    if (c.viewMode === "workspace") {
      if (!c.isWorkspaceViewerActive) {
        // Mode 1: Full File Browser Mode
        if (k === 17) {
          ++this.revision;
          c.viewMode = "session";
        } else if (k === 18) {
          const parent = (this.filePath === this.fileRoot) ? this.fileRoot : path.dirname(this.filePath);
          await this.files(parent);
        } else if (k === 19) {
          await this.files(this.fileRoot);
        } else if (k === 20) {
          return;
        } else {
          // (2,1)-(5,4) 16-key grid
          const gridRows = [
            [13, 9, 5, 1],
            [14, 10, 6, 2],
            [15, 11, 7, 3],
            [16, 12, 8, 4],
          ];
          for (let r = 0; r < 4; r++) {
            const cIdx = gridRows[r].indexOf(k);
            if (cIdx >= 0) {
              const fIdx = c.workspaceScrollRow * 4 + r * 4 + cIdx;
              if (fIdx < c.workspaceFiles.length) {
                c.workspaceCursorIdx = fIdx;
                const file = c.workspaceFiles[fIdx];
                if (file.isDir) {
                  if (file.name === "..") {
                    const parent = (this.filePath === this.fileRoot) ? this.fileRoot : path.dirname(this.filePath);
                    await this.files(parent);
                  } else {
                    await this.files(path.join(this.filePath, file.name));
                  }
                } else {
                  await this.openFileForViewing(fIdx, file.name);
                }
              }
              break;
            }
          }
        }
      } else {
        // Mode 2: File Viewer Mode
        if (k === 17) {
          ++this.revision;
          this.fileReading = false;
          c.closeWorkspaceViewer();
          c.viewMode = "session";
        } else if ([18, 19, 20].includes(k)) {
          const pageStart = Math.floor(c.workspaceSelectedFileIdx / 3) * 3;
          const slot = [18, 19, 20].indexOf(k);
          const targetIdx = pageStart + slot;
          if (targetIdx < c.workspaceFiles.length) {
            if (targetIdx === c.workspaceSelectedFileIdx) {
              // Pressing currently active file exits back to Full File Browser Mode
              c.closeWorkspaceViewer();
              this.fileReading = false;
            } else {
              const targetItem = c.workspaceFiles[targetIdx];
              if (targetItem.isDir) {
                c.closeWorkspaceViewer();
                this.fileReading = false;
                if (targetItem.name === "..") {
                  const parent = (this.filePath === this.fileRoot) ? this.fileRoot : path.dirname(this.filePath);
                  await this.files(parent);
                } else {
                  await this.files(path.join(this.filePath, targetItem.name));
                }
              } else {
                await this.openFileForViewing(targetIdx, targetItem.name);
              }
            }
          }
        }
      }
      return;
    }
    if (c.viewMode === "changes") {
      if ([17,7].includes(k)) { ++this.revision; c.viewMode = "session"; }
      else if ([18,19,20].includes(k)) {
        const i = c.changesFilePage * 3 + [18,19,20].indexOf(k);
        if (i < c.changedFiles.length) {
          if (c.isChangesFileSelected && c.selectedChangedFileIdx === i) {
            c.isChangesFileSelected = false;
            c.updateReaderForCurrentSession();
          } else {
            const generation = ++this.revision;
            const lines = await GitProvider.getFileDiff(c.changedFiles[i].path, this.project().path);
            if (generation === this.revision && c.viewMode === "changes") c.selectChangesFile(i, lines);
          }
        }
      }
      return;
    }
    if (k === 3 && c.activeEditor !== "none") { const field = c.activeEditor; c.commitActiveEditorChoice(c.editorChoiceWindowStart + 4); if (field === "model") this.updateEfforts(); if (["project","session","machine","harness"].includes(field)) await this.load(); return; }
    if (k === 3) { if (this.pending.length) { this.requestView = true; this.questionOffset = 0; } else if (!this.connected) await this.connect(); else await this.refresh(); return; }
    this.clearNotice();
    if (k === 1) {
      c.activeEditor = "none";
      const project = this.project(), generation = ++this.revision;
      const result = await this.backend.request("thread/start", { cwd: project.path, approvalPolicy: "on-request" });
      const session: SessionInfo = { id: result.thread.id, title: "New task", preview: "", createdAt: Date.now() };
      const scope = `dev-pc/codex/${project.id}`; (c.sessionsByScope[scope] ||= []).unshift(session);
      if (generation === this.revision) {
        c.selectSession(0);
        await this.load();
      }
    } else if (k === 17) {
      c.cycleMachine();
      await this.load();
    } else if (k === 13) {
      c.cycleHarness();
      await this.load();
    } else if (k === 9 || k === 5 || k === 18 || k === 14) c.openEditor(({9:"project",5:"session",18:"model",14:"effort"} as const)[k as 9]);
    else if (k === 2) { c.activeEditor = "none"; c.viewMode = "settings"; }
    else if (k === 6) await this.files(this.project().path);
    else if ([19,15,11,7].includes(k)) {
      if (c.activeEditor !== "none") { const field = c.activeEditor; c.commitActiveEditorChoice(c.editorChoiceWindowStart + [19,15,11,7,3].indexOf(k)); if (field === "model") this.updateEfforts(); if (["project","session","machine","harness"].includes(field)) await this.load(); }
      else if (k === 19) c.jumpPrevPrompt(); else if (k === 15) c.jumpNextPrompt(); else if (k === 11) c.toggleDetails();
      else {
        const generation = ++this.revision, files = await GitProvider.getChangedFiles(this.project().path);
        if (generation !== this.revision) return;
        let initialDiff: string[] = [];
        if (files.length > 0) {
          initialDiff = await GitProvider.getFileDiff(files[0].path, this.project().path);
        }
        if (generation === this.revision) {
          c.openChangesView(files);
          if (files.length > 0) {
            c.selectChangesFile(0, initialDiff);
          }
        }
      }
    } else if (k === 20) { if (this.draft.snapshot?.phase === "recording") await this.finishVoice(); else await this.startVoice(); }
    else if (k === 16) { if (this.draft.snapshot?.phase === "unknown") await this.reconcile(); else if (this.draft.snapshot?.phase === "recording") await this.finishVoice(); else await this.send(); }
    else if (k === 8) this.restoreDraft();
    else if (k === 4) {
      if (this.draft.snapshot && ["review","recording","transcribing"].includes(this.draft.snapshot.phase)) await this.cancelVoice();
      else if (this.draft.snapshot?.phase === "unknown") {
        this.draft.discard();
        this.clearNotice();
        this.paint();
      } else await this.stopTask();
    }
  }
  state() {
    const c = this.context, d = this.draft.snapshot;
    c.isRecordingVoice = d?.phase === "recording";
    c.isTranscribingVoice = d?.phase === "transcribing";
    c.voiceDraftText = d?.text || "";
    c.voiceSubmission = d?.phase === "sending" || d?.phase === "unknown" ? d.phase : "idle";
    c.voiceDestinationLabel = d ? `${d.destination.sessionId}` : "";
    if (!this.fileReading && c.viewMode !== "workspace") c.updateReaderForCurrentSession();
    const state = c.getDeviceState();
    for (const key of state.keys) key.isDisabled = !!key.isDisabled;
    const replace = (key: KeyVisual) => { state.keys = state.keys.map(k => k.keyId === key.keyId ? key : k); };
    if (c.viewMode === "session") {
      for (const id of [10,12]) { const key = state.keys.find(k => k.keyId === id)!; key.isDisabled = true; }
      if (c.activeEditor === "none") replace(this.key(3, this.pending.length ? `Requests ${this.pending.length}` : this.connected ? "Refresh" : "Reconnect", this.connecting));
      for (const id of [1,18,14,20,16]) if (!this.connected || this.connecting) state.keys.find(k => k.keyId === id)!.isDisabled = true;
      if (this.target() === "none") for (const id of [20,16,4,5]) state.keys.find(k => k.keyId === id)!.isDisabled = true;
      if (this.startingVoice || this.cancellingVoice) {
        for (const id of [20,16,4]) state.keys.find(k => k.keyId === id)!.isDisabled = true;
        state.topTitle = this.startingVoice ? "Starting microphone" : "Cancelling microphone";
        state.topBodyLines = ["Wait for capture acknowledgement."];
      }
      const task = this.tasks.get(this.target());
      if (!d || ["sent","cancelled","failed","empty"].includes(d.phase)) {
        replace(this.key(4, task?.phase === "stopping" ? "Stopping" : "Stop", !this.connected || task?.phase !== "inProgress"));
        if (task) { state.topSubtitle = `${task.phase} | ${this.project().name}`; if (task.text) state.topBodyLines = wrapText(task.text); }
        if (this.target() === "none") { state.topTitle = "No task selected"; state.topBodyLines = ["K1: New task in selected project.", "K3: Refresh task list."]; }
      }
      if (this.replacing) replace(this.key(8, "Undo", !["review","failed","empty","cancelled"].includes(d?.phase || ""), "Restore draft"));
      if (d?.phase === "unknown") {
        replace(this.key(16, "Check task", !this.connected || !!this.voiceQuestion));
        replace(this.key(4, "Discard", false, "Drop draft"));
      }
    }
    if (c.viewMode === "workspace") {
      const relPath = path.relative(this.fileRoot, this.filePath) || "/";
      const totalFiles = c.workspaceFiles.length;
      if (!c.isWorkspaceViewerActive) {
        const focusedItem = c.workspaceFiles[c.workspaceCursorIdx];
        state.topTitle = `FILES | ${path.basename(this.filePath) || this.project().name}`;
        state.topSubtitle = `[${totalFiles > 0 ? c.workspaceCursorIdx + 1 : 0}/${totalFiles}] /${relPath.replace(/\\/g, "/")}`;
        state.topBodyLines = [
          focusedItem ? `Selected: [${focusedItem.isDir ? "DIR" : "FILE"}] ${focusedItem.name}` : "No files",
          `Location: ${path.join(this.filePath, focusedItem ? focusedItem.name : "")}`,
          `Grid Row ${Math.floor(c.workspaceCursorIdx / 4) + 1}/${Math.max(1, Math.ceil(totalFiles / 4))} | Total ${totalFiles} items`,
          "Left Knob: Navigate | Click/Press Key: Open | K18: Up | K19: Root",
        ];
        state.topScrollLine = 0;
        state.topTotalLines = 4;
      } else {
        const totalLines = c.workspaceFileContentLines.length;
        state.topTitle = `FILE | ${c.readerTitle}`;
        state.topSubtitle = `Line ${c.readerScrollLine + 1}/${totalLines} | /${relPath.replace(/\\/g, "/")}/${c.readerTitle}`;
        state.topBodyLines = c.workspaceFileContentLines;
        state.topScrollLine = c.readerScrollLine;
        state.topTotalLines = totalLines;
      }
    }
    if (this.notice) { state.topTitle = this.noticeTitle; state.topBodyLines = wrapText(this.notice); }
    if (d?.phase === "unknown") { state.topTitle = "Delivery unknown"; state.topBodyLines = ["Do not replay. Check original task.", ...wrapText(d.text)]; }
    if (this.requestView && this.activeRequest()) {
      const r = this.activeRequest(), q = r.params.questions?.[r.question];
      const options = q ? q.options || [] : [{label:"Approve"},{label:"Deny"}];
      this.questionOffset = Math.min(this.questionOffset, Math.max(0, options.length - 3));
      state.topTitle = q ? `Question ${r.question + 1}/${r.params.questions.length}` : "Approval required";
      state.topSubtitle = `Task ${r.params.threadId}`;
      state.topBodyLines = wrapText(q?.question || r.params.command || r.params.reason || "Allow file changes?");
      state.viewMode = "question";
      state.keys = [];
      for (const [row, ids] of [[17,13,9,5,1],[18,14,10,6,2],[19,15,11,7,3]].entries()) {
        const i = this.questionOffset + row, text = options[i]?.label || "";
        ids.forEach((id,col) => { const key = this.key(id, col === 0 ? (r.selected === i ? "[X]" : "[ ]") : Array.from(text).slice((col-1)*5,col*5).join(""), !options[i] || !!r.sending); key.isFilled = r.selected === i; state.keys.push(key); });
      }
      state.keys.push(this.key(20,"Other", !q || !q.isOther || q.isSecret || !!r.sending), this.key(16,q ? "Next / Send" : "Submit", r.selected < 0 || !!r.sending),this.key(12,"",true),this.key(8,"Later"),this.key(4,"Stop",this.tasks.get(r.params.threadId)?.phase !== "inProgress"));
    }
    if (c.viewMode !== "changes") {
      state.topBodyLines = state.topBodyLines.flatMap(line => wrapText(line));
      c.readerLines = state.topBodyLines;
    }
    state.topTotalLines = state.topBodyLines.length;
    state.topScrollLine = Math.max(0, Math.min(c.readerScrollLine, state.topTotalLines - 4));
    return state;
  }
  paint() {
    if (this.disposed) return;
    if (this.storagePath) {
      const value = JSON.stringify({ draft: this.draft.snapshot, beforeSend: this.beforeSend, question: !!this.voiceQuestion });
      if (value !== this.persisted) {
        syncFs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
        syncFs.writeFileSync(this.storagePath + ".tmp", value, { mode: 0o600 });
        syncFs.renameSync(this.storagePath + ".tmp", this.storagePath);
        this.persisted = value;
      }
    }
    this.changed();
  }
  async close() {
    this.disposed = true;
    this.voice.close();
    try { this.desktop.disconnect(); } catch {}
    await this.backend.stop();
  }
}
