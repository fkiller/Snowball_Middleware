import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as os from "node:os";
import { AgentHarness, ApprovalRequest, StreamDelta, SessionTurn } from "./types.js";
import { ProjectInfo, SessionInfo } from "../types.js";
import { CodexAdapter as RawCodexAdapter, CodexThreadSummary } from "../codex/adapter.js";

function normalizePath(p: string): string {
  if (!p) return "";
  let clean = p.replace(/^\\\\\?\\/, "");
  try {
    clean = path.resolve(clean);
  } catch {}
  return process.platform === "win32" ? clean.toLowerCase() : clean;
}

export class CodexHarness extends EventEmitter implements AgentHarness {
  public readonly id = "codex" as const;
  public readonly name = "Codex";

  private adapter: RawCodexAdapter;
  private currentThreadId?: string;
  private cachedThreads: Map<string, CodexThreadSummary> = new Map();
  private cachedProjects: ProjectInfo[] = [];

  constructor(adapter?: RawCodexAdapter) {
    super();
    this.adapter = adapter || new RawCodexAdapter();

    this.adapter.on("delta", (delta: { threadId?: string; content: string }) => {
      this.emit("delta", {
        sessionId: delta.threadId || this.currentThreadId || "active",
        content: delta.content,
      });
    });

    this.adapter.on("approval_request", (app: any) => {
      const req: ApprovalRequest = {
        id: app.callId,
        sessionId: this.currentThreadId || "active",
        prompt: app.reason || app.command?.join(" ") || "Codex Permission Request",
        options: [
          { id: "allow", label: "Approve" },
          { id: "deny", label: "Deny" },
        ],
      };
      this.emit("approval_request", req);
    });
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async start(): Promise<void> {
    await this.adapter.start();
  }

  public async stop(): Promise<void> {
    await this.adapter.stop();
  }

  public async listProjects(): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    const seenPaths = new Set<string>();

    // 1. Try official Codex project/list (experimentalApi)
    try {
      const res = await this.adapter.request<{ data?: any[] }>("project/list", {});
      if (Array.isArray(res?.data) && res.data.length > 0) {
        for (const p of res.data) {
          const rootPath = p.roots?.[0]?.path;
          if (rootPath) {
            const norm = normalizePath(rootPath);
            seenPaths.add(norm);
            projects.push({
              id: p.id || `proj-${projects.length + 1}`,
              name: p.name || path.basename(rootPath),
              path: rootPath.replace(/^\\\\\?\\/, ""),
            });
          }
        }
      }
    } catch {
      // project/list not available or failed
    }

    // 2. Discover projects from thread roots
    try {
      const threads = await this.adapter.listThreads(100);
      for (const t of threads) {
        if (t.id) this.cachedThreads.set(t.id, t);
        if (!t.cwd) continue;
        if (t.cwd.includes(".probe-codex") || t.cwd.toLowerCase().includes("\\temp\\")) continue;

        const cleanPath = t.cwd.replace(/^\\\\\?\\/, "");
        const norm = normalizePath(cleanPath);
        if (!seenPaths.has(norm)) {
          seenPaths.add(norm);
          projects.push({
            id: `proj-${projects.length + 1}`,
            name: path.basename(cleanPath) || "Project",
            path: cleanPath,
          });
        }
      }
    } catch {}

    // 3. Ensure current working directory is represented
    const curDir = process.cwd();
    const curNorm = normalizePath(curDir);
    const existing = projects.find((p) => {
      const pNorm = normalizePath(p.path);
      return curNorm === pNorm || curNorm.startsWith(pNorm + "\\") || curNorm.startsWith(pNorm + "/");
    });

    if (existing) {
      // Sort matching project to top
      projects.sort((a, b) => (a.id === existing.id ? -1 : b.id === existing.id ? 1 : 0));
    } else {
      projects.unshift({
        id: "current-workspace",
        name: path.basename(curDir),
        path: curDir,
      });
    }

    this.cachedProjects = projects.length > 0
      ? projects
      : [{ id: "p0", name: path.basename(process.cwd()), path: process.cwd() }];
    return this.cachedProjects;
  }

  public async listSessions(projectId?: string): Promise<SessionInfo[]> {
    try {
      const threads = await this.adapter.listThreads(100);
      for (const t of threads) {
        if (t.id) this.cachedThreads.set(t.id, t);
      }

      let filtered = threads.filter(
        (t) => !t.cwd?.includes(".probe-codex") && !t.cwd?.toLowerCase().includes("\\temp\\")
      );

      if (projectId) {
        const projects = this.cachedProjects.length > 0 ? this.cachedProjects : await this.listProjects();
        const targetProj = projects.find((p) => p.id === projectId);
        if (targetProj) {
          const targetNorm = normalizePath(targetProj.path);
          filtered = filtered.filter((t) => {
            if (t.projectId && t.projectId === targetProj.id) return true;
            const tNorm = normalizePath(t.cwd);
            return tNorm === targetNorm || tNorm.startsWith(targetNorm + path.sep);
          });
        }
      }

      return filtered.map((t, idx) => {
        let title = (t.title || t.preview || `Session ${idx + 1}`)
          .replace(/\r?\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (title.length > 40) title = title.slice(0, 37) + "...";
        const preview = (t.preview || t.title || "")
          .replace(/\r?\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        return {
          id: t.id,
          title: title || `Session ${idx + 1}`,
          createdAt: t.createdAt,
          preview,
        };
      });
    } catch {
      return [];
    }
  }

  public async getTurns(sessionId: string): Promise<SessionTurn[]> {
    let rolloutPath = "";

    // 1. Check cached thread path
    const cached = this.cachedThreads.get(sessionId);
    if (cached?.path) {
      rolloutPath = cached.path.replace(/^\\\\\?\\/, "");
    }

    // 2. If not found, refresh thread list to locate rollout path
    if (!rolloutPath || !fs.existsSync(rolloutPath)) {
      try {
        const threads = await this.adapter.listThreads(100);
        const match = threads.find((t) => t.id === sessionId);
        if (match?.path) {
          rolloutPath = match.path.replace(/^\\\\\?\\/, "");
        }
      } catch {}
    }

    // 3. If still not found, search ~/.codex/sessions for sessionId
    if (!rolloutPath || !fs.existsSync(rolloutPath)) {
      const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
      if (fs.existsSync(sessionsRoot)) {
        try {
          const findRollout = (dir: string): string => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                const found = findRollout(full);
                if (found) return found;
              } else if (e.name.includes(sessionId) && e.name.endsWith(".jsonl")) {
                return full;
              }
            }
            return "";
          };
          rolloutPath = findRollout(sessionsRoot);
        } catch {}
      }
    }

    if (!rolloutPath || !fs.existsSync(rolloutPath)) {
      return [];
    }

    return this.parseRolloutJsonl(rolloutPath);
  }

  private async parseRolloutJsonl(filePath: string): Promise<SessionTurn[]> {
    const turns: SessionTurn[] = [];
    let curUser = "";
    let curAsst: string[] = [];
    let curProcs: string[] = [];
    let turnCount = 0;

    const commitTurn = () => {
      if (curUser || curAsst.length > 0) {
        turnCount++;
        turns.push({
          id: `turn-${turnCount}`,
          userPrompt: curUser || "User Prompt",
          agentResponse: curAsst.join("\n").trim(),
          processDetails: [...curProcs],
        });
        curUser = "";
        curAsst = [];
        curProcs = [];
      }
    };

    try {
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type === "response_item") {
            const p = d.payload || {};
            const role = p.role;
            const itemType = p.type;

            if (role === "user" && itemType === "message") {
              const contents = Array.isArray(p.content) ? p.content : [];
              const texts = contents
                .filter((c: any) => c.type === "input_text" || c.type === "text")
                .map((c: any) => c.text || "")
                .join("\n")
                .trim();

              if (
                texts &&
                !texts.startsWith("# AGENTS.md") &&
                !texts.startsWith("<permissions") &&
                !texts.startsWith("<recommended_plugins")
              ) {
                commitTurn();
                curUser = texts;
              }
            } else if (role === "assistant" && itemType === "message") {
              const contents = Array.isArray(p.content) ? p.content : [];
              const texts = contents
                .filter((c: any) => c.type === "output_text" || c.type === "text")
                .map((c: any) => c.text || "")
                .join("\n")
                .trim();
              if (texts) curAsst.push(texts);
            } else if (itemType === "reasoning") {
              const summary = (p.summary || "").slice(0, 100).trim();
              if (summary) curProcs.push(`Thought: ${summary}`);
            } else if (itemType === "tool_call" || itemType === "tool-invocation") {
              const toolName = p.name || p.toolName || "tool";
              curProcs.push(`Tool: ${toolName}`);
            } else if (itemType === "commandExecution") {
              curProcs.push(`Command: ${p.command || "command"}`);
            }
          }
        } catch {}
      }

      commitTurn();
    } catch (err) {
      console.warn(`[CodexHarness] Failed to stream parse rollout ${filePath}:`, err);
    }

    return turns;
  }

  public async createSession(projectId?: string): Promise<SessionInfo> {
    const projects = this.cachedProjects.length ? this.cachedProjects : await this.listProjects();
    const project = projectId ? projects.find(p => p.id === projectId) : undefined;
    if (projectId && !project) throw new Error("Selected project is unavailable. Refresh projects first.");
    const cwd = project?.path || process.cwd();
    const threadId = await this.adapter.startThread(cwd);
    this.currentThreadId = threadId;
    return {
      id: threadId,
      title: "New Session",
      createdAt: Date.now(),
      preview: "",
    };
  }

  public async sendPrompt(
    sessionId: string,
    text: string,
    options?: { model?: string; effort?: string; access?: string }
  ): Promise<void> {
    this.currentThreadId = sessionId;
    await this.adapter.sendPrompt(sessionId, text, options?.model, options?.effort);
  }

  public async interrupt(sessionId: string): Promise<void> {
    await this.adapter.interrupt(sessionId);
  }

  public async respondApproval(approvalId: string, decision: string): Promise<void> {
    this.adapter.respondServerRequest(approvalId, {
      decision: decision === "deny" ? "denied" : "approved",
    });
  }
}
