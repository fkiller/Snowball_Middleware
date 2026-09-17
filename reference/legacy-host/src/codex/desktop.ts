import * as net from "node:net";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";

export interface DesktopProject {
  projectId: string;
  projectKind: "local" | "remote" | "chatgpt";
  label: string;
  path?: string;
  hostId: string | null;
  hostDisplayName: string | null;
  isGitRepository?: boolean;
}

export interface DesktopThread {
  id: string;
  kind: "codex" | "chatgpt";
  projectId: string | null;
  hostId?: string;
  status: "idle" | "running" | "notLoaded" | string;
  cwd?: string;
  updatedAt: number;
  title: string;
  summary: string | null;
}

export interface DesktopRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

export interface DesktopRateLimits {
  limitId: string;
  primary: DesktopRateLimitWindow;
  secondary: DesktopRateLimitWindow;
  planType: string;
  accountId?: string;
}

export class CodexDesktopClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private pipePath: string | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private pendingBuffer = Buffer.alloc(0);
  public isConnected = false;
  public anchorThreadId: string | null = null;

  constructor(pipePath?: string) {
    super();
    this.pipePath = pipePath || null;
    this.anchorThreadId = CodexDesktopClient.getAnchorThreadId();
  }

  /**
   * Reads latest valid thread from session_index.jsonl to anchor desktop calls.
   */
  public static getAnchorThreadId(): string | null {
    try {
      const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, "utf8").trim();
        const lines = content.split(/\r?\n/).filter(Boolean);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]);
          return last.id || null;
        }
      }
    } catch {
      // Fallback
    }
    return null;
  }

  /**
   * Discovers active Codex Desktop named pipe on Windows.
   */
  public static discoverDesktopPipe(): string | null {
    if (process.platform !== "win32") {
      return null;
    }

    // Try finding pipe via running processes first
    try {
      const procCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'codex.exe'\\" | ForEach-Object { if ($_.CommandLine -match 'codex-browser-use-[a-f0-9-]+') { $Matches[0] } }"`;
      const out = cp.execSync(procCmd, { encoding: "utf8", timeout: 3000 }).trim();
      if (out) {
        const pipeName = out.split(/\r?\n/)[0].trim();
        if (pipeName) {
          return `\\\\.\\pipe\\${pipeName}`;
        }
      }
    } catch {
      // Fall through to directory listing
    }

    // Fallback: list \\.\pipe\ directory
    try {
      const dirCmd = `powershell -NoProfile -Command "[System.IO.Directory]::GetFiles('\\\\.\\pipe\\\\') -like '*codex-browser-use*'"`;
      const out = cp.execSync(dirCmd, { encoding: "utf8", timeout: 3000 }).trim();
      const pipes = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (pipes.length > 0) {
        return pipes[0];
      }
    } catch {
      // Not available
    }

    return null;
  }

  /**
   * Connect to the Codex Desktop IPC pipe.
   */
  public async connect(): Promise<boolean> {
    if (this.isConnected && this.socket && !this.socket.destroyed) {
      return true;
    }

    if (!this.pipePath) {
      this.pipePath = CodexDesktopClient.discoverDesktopPipe();
    }

    if (!this.pipePath) {
      return false;
    }

    const pipe = this.pipePath;
    return new Promise((resolve) => {
      console.log(`[CodexDesktopClient] Connecting to desktop pipe: ${pipe}`);
      try {
        const socket = net.createConnection(pipe, () => {
          this.socket = socket;
          this.isConnected = true;
          console.log("[CodexDesktopClient] Connected to Codex Desktop IPC channel.");

          socket.on("data", (chunk) => this.onData(chunk));
          socket.on("error", (err) => {
            console.error("[CodexDesktopClient] Pipe error:", err.message);
            this.cleanup();
          });
          socket.on("close", () => {
            console.log("[CodexDesktopClient] Pipe closed.");
            this.cleanup();
          });

          resolve(true);
        });

        socket.once("error", (err) => {
          console.warn("[CodexDesktopClient] Connection failed:", err.message);
          this.cleanup();
          resolve(false);
        });
      } catch (err: any) {
        console.warn("[CodexDesktopClient] Failed to open pipe connection:", err.message);
        resolve(false);
      }
    });
  }

  private cleanup() {
    this.isConnected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error("Codex Desktop pipe disconnected"));
    }
    this.pending.clear();
    this.pendingBuffer = Buffer.alloc(0);
    this.emit("disconnected");
  }

  private onData(chunk: Buffer) {
    this.pendingBuffer = Buffer.concat([this.pendingBuffer, chunk]);

    while (this.pendingBuffer.length >= 4) {
      const frameLen = this.pendingBuffer.readUInt32LE(0);
      if (this.pendingBuffer.length < 4 + frameLen) {
        break;
      }

      const payload = this.pendingBuffer.subarray(4, 4 + frameLen);
      this.pendingBuffer = this.pendingBuffer.subarray(4 + frameLen);

      try {
        const resp = JSON.parse(payload.toString("utf8"));
        if (typeof resp.id === "number" && this.pending.has(resp.id)) {
          const { resolve, reject } = this.pending.get(resp.id)!;
          this.pending.delete(resp.id);
          if (resp.error) {
            const errStr = typeof resp.error === "object" ? JSON.stringify(resp.error) : String(resp.error);
            reject(new Error(errStr));
          } else {
            resolve(resp.result);
          }
        }
      } catch (e: any) {
        console.error("[CodexDesktopClient] Failed to parse response frame:", e.message);
      }
    }
  }

  public callRpc<T = any>(method: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed || !this.isConnected) {
        return reject(new Error("Desktop client not connected"));
      }

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const bodyStr = JSON.stringify({
        id,
        jsonrpc: "2.0",
        method,
        params,
      });
      const payload = Buffer.from(bodyStr, "utf8");
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32LE(payload.length, 0);
      payload.copy(frame, 4);

      this.socket.write(frame);
    });
  }

  public async callTool<T = any>(
    toolName: string,
    toolArgs: any = {},
    threadId?: string,
    namespace = "codex_app"
  ): Promise<T> {
    const tid = threadId || this.anchorThreadId || "01a073fc-fd58-7a73-8d78-803d0333a370";
    const res = await this.callRpc("tools/call", {
      namespace,
      tool: toolName,
      arguments: toolArgs,
      threadId: tid,
      callId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      turnId: `turn_${Date.now()}`,
    });

    if (res?.contentItems?.[0]?.text) {
      try {
        return JSON.parse(res.contentItems[0].text) as T;
      } catch {
        return res.contentItems[0].text as unknown as T;
      }
    }
    return res as T;
  }

  /**
   * Retrieves registered projects from Codex Desktop.
   */
  public async listProjects(): Promise<DesktopProject[]> {
    const res = await this.callTool<{ projects: DesktopProject[] }>("list_projects");
    return res?.projects || [];
  }

  /**
   * Retrieves active and recent threads from Codex Desktop.
   */
  public async listThreads(limit = 20): Promise<DesktopThread[]> {
    const res = await this.callTool<{ threads: DesktopThread[] }>("list_threads", { limit });
    return res?.threads || [];
  }

  /**
   * Reads turns and output of a specific thread.
   */
  public async readThread(threadId: string, turnLimit = 5, includeOutputs = false): Promise<any> {
    return this.callTool("read_thread", {
      threadId,
      turnLimit,
      includeOutputs,
    }, threadId);
  }

  /**
   * Directs the Codex Desktop application window to navigate to the specified thread.
   */
  public async navigateToCodexPage(threadId: string): Promise<void> {
    await this.callTool("navigate_to_codex_page", { threadId }, threadId);
  }

  /**
   * Sends a follow-up prompt to a Codex thread.
   */
  public async sendMessageToThread(
    threadId: string,
    prompt: string,
    model?: string,
    thinking?: string
  ): Promise<any> {
    const res = await this.callTool<any>("send_message_to_thread", {
      threadId,
      prompt,
      model: model || undefined,
      thinking: thinking || undefined,
    }, threadId);
    if (typeof res === "string" && (res.includes("already has an active writer") || res.includes("error") || res.includes("failed"))) {
      throw new Error(res);
    }
    return res;
  }

  /**
   * Retrieves current live rate limits directly from the desktop session.
   */
  public async getUsageLimits(): Promise<DesktopRateLimits | null> {
    const res = await this.callTool<any>("get_usage_limits");
    if (res?.rateLimits) {
      return res.rateLimits as DesktopRateLimits;
    }
    return null;
  }

  public disconnect() {
    this.cleanup();
  }
}
