import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";
import * as os from "node:os";
import { AgentHarness, ApprovalRequest, StreamDelta, SessionTurn } from "./types.js";
import { ProjectInfo, SessionInfo } from "../types.js";

export interface AntigravityAdapterOptions {
  appDataDir?: string;
  agyPath?: string;
}

export class AntigravityAdapter extends EventEmitter implements AgentHarness {
  public readonly id = "antigravity" as const;
  public readonly name = "Antigrav";

  private appDataDir: string;
  private agyPath: string;
  private isRunning = false;
  private activeChild: cp.ChildProcess | null = null;
  private transcriptWatchers: Map<string, fs.FSWatcher> = new Map();

  constructor(options: AntigravityAdapterOptions = {}) {
    super();
    this.appDataDir =
      options.appDataDir ||
      path.join(os.homedir(), ".gemini", "antigravity");
    this.agyPath =
      options.agyPath ||
      path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        "agy",
        "bin",
        "agy.exe"
      );
  }

  public async isAvailable(): Promise<boolean> {
    if (process.env.ANTIGRAVITY_AGENT === "1") return true;
    if (fs.existsSync(this.agyPath)) return true;
    if (fs.existsSync(this.appDataDir)) return true;
    return false;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Antigravity] Initialized Antigravity adapter (appData: ${this.appDataDir})`);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.activeChild) {
      this.activeChild.kill();
      this.activeChild = null;
    }
    for (const watcher of this.transcriptWatchers.values()) {
      watcher.close();
    }
    this.transcriptWatchers.clear();
  }

  public async listProjects(): Promise<ProjectInfo[]> {
    const discovered = new Map<string, string>(); // path -> name

    // 1. Current workspace root
    const current = path.resolve(process.cwd());
    discovered.set(current, path.basename(current));
    if (path.basename(current).toLowerCase() === "host" && (fs.existsSync(path.join(current, "..", "AGENTS.md")) || fs.existsSync(path.join(current, "..", ".git")))) {
      const parent = path.resolve(current, "..");
      discovered.set(parent, path.basename(parent));
    }

    // 2. Scan Antigravity IDE workspace storage
    const roamingDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Antigravity"
    );
    const wsStorageDir = path.join(roamingDir, "User", "workspaceStorage");
    if (fs.existsSync(wsStorageDir)) {
      try {
        const wsFolders = fs.readdirSync(wsStorageDir, { withFileTypes: true });
        for (const f of wsFolders) {
          if (!f.isDirectory()) continue;
          const wsJsonPath = path.join(wsStorageDir, f.name, "workspace.json");
          if (fs.existsSync(wsJsonPath)) {
            try {
              const content = JSON.parse(fs.readFileSync(wsJsonPath, "utf8"));
              if (content.folder && typeof content.folder === "string") {
                let p = decodeURIComponent(content.folder.replace(/^file:\/\/\/?/, ""));
                if (process.platform === "win32" && /^[a-zA-Z]:/.test(p)) {
                  p = path.normalize(p);
                }
                if (fs.existsSync(p)) {
                  discovered.set(p, path.basename(p));
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    // 3. Scan state.vscdb for recently opened paths
    const vscdbPath = path.join(roamingDir, "User", "globalStorage", "state.vscdb");
    if (fs.existsSync(vscdbPath)) {
      try {
        const rawBuf = fs.readFileSync(vscdbPath);
        const str = rawBuf.toString("utf8");
        const matches = str.match(/file:\/\/\/(?:[a-zA-Z]%3A|[a-zA-Z]:)[^\x00-\x1f\x7f-\xff"'<>\s\\]+/gi) || [];
        for (const m of matches) {
          try {
            let decoded = decodeURIComponent(m.replace(/^file:\/\/\/?/, ""));
            decoded = path.normalize(decoded);
            if (fs.existsSync(decoded) && fs.statSync(decoded).isDirectory()) {
              discovered.set(decoded, path.basename(decoded));
            }
          } catch {}
        }
      } catch {}
    }

    // 4. Scan code_tracker/active directories
    const activeDir = path.join(this.appDataDir, "code_tracker", "active");
    if (fs.existsSync(activeDir)) {
      try {
        const entries = fs.readdirSync(activeDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || e.name === "no_repo") continue;
          const baseName = e.name.replace(/_[a-f0-9]{40}$/i, "");
          const candidatePath = path.join(path.dirname(current), baseName);
          if (fs.existsSync(candidatePath)) {
            discovered.set(candidatePath, baseName);
          }
        }
      } catch {}
    }

    const projects: ProjectInfo[] = [];
    let idx = 1;
    for (const [p, name] of discovered.entries()) {
      const slug = name.toLowerCase().replace(/[_ ]/g, "-").replace(/[^a-z0-9-]/g, "");
      projects.push({
        id: slug || `ag-proj-${idx++}`,
        name: name.slice(0, 14),
        path: p,
      });
    }

    return projects;
  }

  public async listSessions(projectId?: string): Promise<SessionInfo[]> {
    const brainDir = path.join(this.appDataDir, "brain");
    if (!fs.existsSync(brainDir)) return [];

    const sessions: SessionInfo[] = [];
    try {
      const convs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const dirPath = path.join(brainDir, d.name);
          const stat = fs.statSync(dirPath);
          return { id: d.name, mtime: stat.mtimeMs, dirPath };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 15);

      for (const conv of convs) {
        let preview = `Conversation ${conv.id.slice(0, 8)}`;
        const transcriptPath = path.join(conv.dirPath, ".system_generated", "logs", "transcript.jsonl");

        if (fs.existsSync(transcriptPath)) {
          try {
            const content = fs.readFileSync(transcriptPath, "utf8");
            const lines = content.split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              const step = JSON.parse(line);
              if (step.type === "USER_INPUT" && step.content) {
                let text = String(step.content)
                  .replace(/<USER_REQUEST>/gi, "")
                  .replace(/<\/USER_REQUEST>/gi, "")
                  .trim();
                text = text.replace(/^#+.*$/gm, "").replace(/\s+/g, " ").trim();
                if (text) {
                  preview = text.slice(0, 80);
                  break;
                }
              }
            }
          } catch {}
        }

        const cleanTitle = preview.replace(/\s+/g, " ").trim();
        sessions.push({
          id: conv.id,
          title: cleanTitle.slice(0, 16) || `Session ${conv.id.slice(0, 6)}`,
          createdAt: conv.mtime,
          preview: cleanTitle,
        });
      }
    } catch (err) {
      console.warn("[Antigravity] Failed to list sessions:", err);
    }

    return sessions;
  }

  public async getTurns(sessionId: string): Promise<SessionTurn[]> {
    const transcriptPath = path.join(
      this.appDataDir,
      "brain",
      sessionId,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    );
    if (!fs.existsSync(transcriptPath)) return [];

    const turns: SessionTurn[] = [];
    let currentTurn: SessionTurn | null = null;

    try {
      const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const step = JSON.parse(line);

        if (step.type === "USER_INPUT" && step.content) {
          if (currentTurn) turns.push(currentTurn);
          let raw = String(step.content)
            .replace(/<USER_REQUEST>/gi, "")
            .replace(/<\/USER_REQUEST>/gi, "")
            .trim();
          raw = raw.replace(/^#+.*$/gm, "").replace(/\s+/g, " ").trim();
          currentTurn = {
            id: `turn-${turns.length + 1}`,
            userPrompt: raw || "User input",
            agentResponse: "",
            processDetails: [],
            timestamp: step.created_at ? new Date(step.created_at).getTime() : Date.now(),
          };
        } else if (currentTurn) {
          if (step.type === "PLANNER_RESPONSE") {
            if (step.content) {
              const text = String(step.content).trim();
              if (text) {
                currentTurn.agentResponse = currentTurn.agentResponse
                  ? `${currentTurn.agentResponse}\n${text}`
                  : text;
              }
            }
            if (step.thinking) {
              const th = String(step.thinking).trim().replace(/\s+/g, " ").slice(0, 100);
              currentTurn.processDetails?.push(`Thinking: ${th}`);
            }
            if (step.tool_calls && Array.isArray(step.tool_calls)) {
              for (const tc of step.tool_calls) {
                const name = tc.name || tc.function?.name || "tool";
                currentTurn.processDetails?.push(`Tool: ${name}`);
              }
            }
          } else if (step.type === "TOOL_RESULT") {
            const summary =
              step.summary ||
              (typeof step.content === "string"
                ? step.content.slice(0, 60)
                : "Tool completed");
            currentTurn.processDetails?.push(`Result: ${summary}`);
          }
        }
      }
      if (currentTurn) turns.push(currentTurn);
    } catch (err) {
      console.warn(`[Antigravity] Failed to parse turns for ${sessionId}:`, err);
    }

    return turns;
  }

  public async createSession(projectId?: string): Promise<SessionInfo> {
    const newId = `ag-${Date.now()}`;
    return {
      id: newId,
      title: "New Conversation",
      createdAt: Date.now(),
      preview: "Start chatting with Antigravity...",
    };
  }

  public async sendPrompt(
    sessionId: string,
    text: string,
    options?: { model?: string; effort?: string; access?: string }
  ): Promise<void> {
    console.log(`[Antigravity] Dispatching prompt to session ${sessionId}: "${text}"`);

    // Attach watcher for transcript deltas if transcript exists
    this.watchSessionTranscript(sessionId);

    // If agy CLI is installed, execute agy
    if (fs.existsSync(this.agyPath)) {
      const args = ["--conversation", sessionId, "--print", text];
      if (options?.access === "unrestricted") {
        args.push("--dangerously-skip-permissions");
      }

      this.activeChild = cp.spawn(this.agyPath, args, {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.activeChild.stdout?.on("data", (chunk: Buffer) => {
        const str = chunk.toString("utf8");
        this.emit("delta", { sessionId, content: str });
      });

      this.activeChild.on("exit", () => {
        this.activeChild = null;
      });
    } else {
      // Fallback: emit acknowledgment
      this.emit("delta", {
        sessionId,
        content: `[Antigravity] Prompt queued for session ${sessionId.slice(0, 8)}`,
      });
    }
  }

  public async interrupt(sessionId: string): Promise<void> {
    if (this.activeChild) {
      console.log(`[Antigravity] Interrupting turn for session ${sessionId}...`);
      this.activeChild.kill();
      this.activeChild = null;
    }
  }

  public async respondApproval(approvalId: string, decision: string): Promise<void> {
    console.log(`[Antigravity] Approval response: ${approvalId} -> ${decision}`);
  }

  public watchSessionTranscript(sessionId: string): void {
    if (this.transcriptWatchers.has(sessionId)) return;

    const transcriptPath = path.join(
      this.appDataDir,
      "brain",
      sessionId,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    );

    if (!fs.existsSync(transcriptPath)) return;

    let lastSize = fs.statSync(transcriptPath).size;
    try {
      const watcher = fs.watch(transcriptPath, () => {
        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.size > lastSize) {
            const fd = fs.openSync(transcriptPath, "r");
            const diffLen = stat.size - lastSize;
            const buf = Buffer.alloc(diffLen);
            fs.readSync(fd, buf, 0, diffLen, lastSize);
            fs.closeSync(fd);
            lastSize = stat.size;

            const newContent = buf.toString("utf8");
            for (const line of newContent.split("\n")) {
              if (!line.trim()) continue;
              try {
                const step = JSON.parse(line);
                if (step.type === "PLANNER_RESPONSE" && step.content) {
                  this.emit("delta", { sessionId, content: step.content });
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        } catch {
          // Ignored
        }
      });
      this.transcriptWatchers.set(sessionId, watcher);
    } catch {
      // Watcher not supported
    }
  }
}
