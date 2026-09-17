import { spawn, ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";

export interface CodexThreadSummary {
  id: string;
  preview: string;
  cwd: string;
  createdAt: number;
  path?: string;
  projectId?: string | null;
  title?: string;
}

export interface CodexApprovalEvent {
  callId: string;
  threadId?: string;
  turnId: string;
  command: string[];
  cwd: string;
  reason: string | null;
}

export function discoverCodexBinary(): string {
  if (process.env.CODEX_BIN && fs.existsSync(process.env.CODEX_BIN)) {
    return process.env.CODEX_BIN;
  }
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  if (localAppData) {
    const binDir = path.join(localAppData, "OpenAI", "Codex", "bin");
    if (fs.existsSync(binDir)) {
      const entries = fs.readdirSync(binDir);
      for (const entry of entries) {
        const candidate = path.join(binDir, entry, "codex.exe");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "codex";
}

export class CodexAdapter extends EventEmitter {
  private process: ChildProcess | null = null;
  private reqId = 1;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private initialized = false;
  private serverIds = new Map<string, string | number>();
  private activeTurns = new Map<string, string>();
  public get isConnected() { return this.initialized; }
  public binPath: string;

  constructor(binPath?: string) {
    super();
    this.binPath = binPath || discoverCodexBinary();
    // Default error handler to prevent unhandled EventEmitter throws
    this.on("error", (err) => {
      console.error("[CodexAdapter] Internal error:", err.message || err);
    });
  }

  public async start(): Promise<void> {
    if (this.process) return;

    return new Promise((resolve, reject) => {
      console.log(`[CodexAdapter] Spawning Codex app-server via: ${this.binPath}`);
      try {
        this.process = spawn(this.binPath, ["app-server"], {
          stdio: ["pipe", "pipe", "inherit"],
          shell: false,
          windowsHide: true,
        });
      } catch (e) {
        return reject(e);
      }

      const rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      rl.on("line", (line) => {
        this.handleLine(line);
      });

      this.process.on("error", (err) => {
        console.error("[CodexAdapter] Child process spawn error:", err);
        this.emit("error", err);
        reject(err);
      });

      this.process.on("exit", (code, signal) => {
        console.log(`[CodexAdapter] Exited with code ${code}, signal ${signal}`);
        this.process = null;
        this.initialized = false;
        for (const request of this.pendingRequests.values()) request.reject(new Error("Codex disconnected; delivery may be unknown"));
        this.pendingRequests.clear();
        this.serverIds.clear();
        this.activeTurns.clear();
        this.emit("exit", { code, signal });
      });

      // Send initialize for Codex 0.153.4
      this.request("initialize", {
        clientInfo: {
          name: "snowball-control",
          title: "Snowball Control Host",
          version: "0.153.4",
        },
        capabilities: {
          experimentalApi: true,
        },
      })
        .then((initRes) => {
          this.initialized = true;
          this.process?.stdin?.write(JSON.stringify({ method: "initialized" }) + "\n");
          console.log("[CodexAdapter] Initialized Codex app-server:", initRes?.serverInfo?.version || "0.153.4");
          resolve();
        })
        .catch(reject);
    });
  }

  public async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Response to a pending request
    if (typeof msg.id === "number" && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server requests (e.g. approval prompts)
    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }

    // Event/notification
    if (msg.method || msg.type) {
      this.handleNotification(msg);
    }
  }

  private handleServerRequest(req: any) {
    this.serverIds.set(String(req.id), req.id);
    this.emit("raw_request", req);

    if (req.method === "item/commandExecution/requestApproval") {
      const params = req.params || {};
      const app: CodexApprovalEvent = {
        callId: String(req.id),
        threadId: params.threadId,
        turnId: params.turnId || "",
        command: params.command ? [params.command] : [],
        cwd: params.cwd || "",
        reason: params.reason || null,
      };
      this.emit("approval_request", app);
    } else if (req.method === "item/fileChange/requestApproval") {
      const params = req.params || {};
      const app: CodexApprovalEvent = {
        callId: String(req.id),
        threadId: params.threadId,
        turnId: params.turnId || "",
        command: ["apply_patch", params.path || ""],
        cwd: "",
        reason: "File modification approval",
      };
      this.emit("approval_request", app);
    }
  }

  private handleNotification(msg: any) {
    const method = msg.method || msg.type;
    const params = msg.params || {};
    if (method === "turn/started" && params.turn?.id) this.activeTurns.set(params.threadId, params.turn.id);
    if (method === "turn/completed") this.activeTurns.delete(params.threadId);
    this.emit("raw_event", msg);

    if (method === "item/agentMessage/delta") {
      this.emit("delta", {
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        content: params.delta || "",
      });
    } else if (method === "turn/completed") {
      this.emit("turn_completed", params);
    } else if (method === "thread/status/changed") {
      this.emit("thread_status", params);
    }
  }

  public request<T = any>(method: string, params?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        return reject(new Error("Codex process not running"));
      }

      const id = this.reqId++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex ${method} timed out; verify delivery before retrying`));
      }, 30000);
      this.pendingRequests.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });

      const payload =
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }) + "\n";

      this.process.stdin.write(payload, error => {
        if (error) { this.pendingRequests.get(id)?.reject(error); this.pendingRequests.delete(id); }
      });
    });
  }

  public async listThreads(limit = 20): Promise<CodexThreadSummary[]> {
    const res = await this.request<{ data?: any[]; threads?: any[] }>("thread/list", { limit });
    const list = res?.data || res?.threads || [];
    if (!Array.isArray(list)) return [];
    return list.map((t) => ({
      id: t.id,
      preview: (t.preview || t.title || t.name || "").trim().slice(0, 80),
      cwd: t.cwd || "",
      createdAt: t.createdAt || 0,
      path: t.path || "",
      projectId: t.projectId || null,
      title: t.title || t.preview || "",
    }));
  }

  public async startThread(cwd: string, model?: string, effort?: string): Promise<string> {
    const res = await this.request<{ thread?: { id: string }; id?: string }>("thread/start", {
      cwd,
      model: model || "gpt-6-astra",
      effort: effort || null,
    });
    return res.thread?.id || res.id || "";
  }

  /**
   * Rejoin/observe an existing thread in 0.153.4.
   * Handles the creation-time empty-rollout file race with bounded retry.
   */
  public async resumeThread(threadId: string, maxRetries = 5, retryDelayMs = 200): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.request("thread/resume", { threadId });
        return res;
      } catch (err: any) {
        const msg = String(err.message || "");
        if (msg.includes("is empty") && attempt < maxRetries) {
          console.log(`[CodexAdapter] thread/resume empty rollout race, retrying (${attempt}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        throw err;
      }
    }
  }

  public async sendPrompt(threadId: string, text: string, model?: string, effort?: string): Promise<void> {
    await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
      model: model || "gpt-6-astra",
      effort: effort || null,
    });
  }

  public async interrupt(threadId: string, turnId?: string): Promise<void> {
    const activeId = turnId || this.activeTurns.get(threadId);
    if (!activeId) throw new Error("No confirmed active turn. Refresh the task before Stop.");
    await this.request("turn/interrupt", {
      threadId,
      turnId: activeId,
    });
  }

  public respondServerRequest(reqId: string | number, result: any): void {
    if (!this.process || !this.process.stdin?.writable) throw new Error("Codex disconnected");
    const nativeId = this.serverIds.get(String(reqId));
    if (nativeId === undefined) throw new Error("Request is no longer pending");
    const payload =
      JSON.stringify({
        jsonrpc: "2.0",
        id: nativeId,
        result,
      }) + "\n";
    this.process.stdin.write(payload);
    this.serverIds.delete(String(reqId));
  }
}
