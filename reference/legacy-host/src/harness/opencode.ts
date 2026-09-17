import { EventEmitter } from "node:events";
import * as cp from "node:child_process";
import * as path from "node:path";
import { AgentHarness, ApprovalRequest, StreamDelta, SessionTurn } from "./types.js";
import { ProjectInfo, SessionInfo } from "../types.js";

export interface OpenCodeAdapterOptions {
  baseUrl?: string;
  authPassword?: string;
  autoSpawn?: boolean;
}

export class OpenCodeAdapter extends EventEmitter implements AgentHarness {
  public readonly id = "opencode" as const;
  public readonly name = "OpenCode";

  private baseUrl: string;
  private authPassword?: string;
  private autoSpawn: boolean;
  private serverProcess: cp.ChildProcess | null = null;
  private sseAbortController: AbortController | null = null;
  private isRunning = false;

  constructor(options: OpenCodeAdapterOptions = {}) {
    super();
    this.baseUrl = options.baseUrl || process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";
    this.authPassword = options.authPassword || process.env.OPENCODE_SERVER_PASSWORD;
    this.autoSpawn = options.autoSpawn ?? true;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok || res.status === 401) return true;
    } catch {
      // Check if opencode CLI binary exists
      try {
        const cmd = process.platform === "win32" ? "opencode.cmd" : "opencode";
        const out = cp.spawnSync(cmd, ["--version"], {
          encoding: "utf8",
          shell: process.platform === "win32",
          windowsHide: true,
        });
        if (out.status === 0) return true;
      } catch {
        // Ignored
      }
    }
    return false;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    let serverReady = false;
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok || res.status === 401) serverReady = true;
    } catch {
      // Not yet running
    }

    if (!serverReady && this.autoSpawn) {
      console.log(`[OpenCode] Starting local OpenCode server on ${this.baseUrl}...`);
      try {
        const urlObj = new URL(this.baseUrl);
        const port = urlObj.port || "4096";
        const hostname = urlObj.hostname || "127.0.0.1";

        const env = { ...process.env };
        if (this.authPassword) env.OPENCODE_SERVER_PASSWORD = this.authPassword;

        const cmd = process.platform === "win32" ? "opencode.cmd" : "opencode";
        this.serverProcess = cp.spawn(cmd, ["serve", "--port", port, "--hostname", hostname], {
          env,
          shell: process.platform === "win32",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        this.serverProcess.on("exit", (code) => {
          console.log(`[OpenCode] Server process exited with code ${code}`);
          this.serverProcess = null;
        });

        // Wait up to 6s for server to become responsive
        const start = Date.now();
        while (Date.now() - start < 6000) {
          await new Promise((r) => setTimeout(r, 250));
          try {
            const probe = await fetch(`${this.baseUrl}/global/health`, {
              headers: this.getHeaders(),
              signal: AbortSignal.timeout(500),
            });
            if (probe.ok || probe.status === 401) {
              serverReady = true;
              break;
            }
          } catch {
            // Keep trying
          }
        }
      } catch (err) {
        console.warn(`[OpenCode] Could not spawn server:`, err);
      }
    }

    this.isRunning = true;
    this.startEventStream().catch((err) => {
      console.warn("[OpenCode] Event stream background error:", err);
    });
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  public async listProjects(): Promise<ProjectInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/project`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as any[];
      const filtered = list.filter(
        (p) => (p.worktree || p.path) && p.worktree !== "/" && p.path !== "/"
      );
      const targets = filtered.length > 0 ? filtered : list;
      return targets.map((p, idx) => {
        const projectPath = p.worktree || p.path || process.cwd();
        return {
          id: p.id || `proj-${idx}`,
          name: p.name || path.basename(projectPath) || `Project ${idx + 1}`,
          path: projectPath,
        };
      });
    } catch {
      return [{ id: "local-project", name: path.basename(process.cwd()), path: process.cwd() }];
    }
  }

  public async listSessions(projectId?: string): Promise<SessionInfo[]> {
    try {
      const url = projectId ? `${this.baseUrl}/session?projectID=${encodeURIComponent(projectId)}` : `${this.baseUrl}/session`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) return [];
      const list = (await res.json()) as any[];
      return list.map((s, idx) => ({
        id: s.id || `sess-${idx}`,
        title: s.title || s.slug || `Session ${idx + 1}`,
        createdAt: s.time?.created || s.createdAt || s.updated_at || Date.now(),
        preview: s.preview || s.title || s.slug || "",
      }));
    } catch {
      return [];
    }
  }


  public async createSession(projectId?: string): Promise<SessionInfo> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ projectID: projectId }),
    });
    if (!res.ok) throw new Error(`Failed to create OpenCode session: ${res.statusText}`);
    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title || "New Session",
      createdAt: data.createdAt || Date.now(),
      preview: "",
    };
  }

  public async getTurns(sessionId: string): Promise<SessionTurn[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      const messages = (await res.json()) as any[];
      if (!Array.isArray(messages)) return [];

      const turns: SessionTurn[] = [];
      let currentTurn: SessionTurn | null = null;

      for (const msg of messages) {
        const role = msg.info?.role;
        const parts = Array.isArray(msg.parts) ? msg.parts : [];

        if (role === "user") {
          if (currentTurn) turns.push(currentTurn);
          const userTexts = parts
            .filter((p: any) => p.type === "text" && p.text)
            .map((p: any) => p.text.trim())
            .filter(Boolean);

          currentTurn = {
            id: msg.info?.id || `turn-${turns.length + 1}`,
            userPrompt: userTexts.join("\n") || "User prompt",
            agentResponse: "",
            processDetails: [],
            timestamp: msg.info?.time?.created || Date.now(),
          };
        } else if (currentTurn) {
          const asstTexts = parts
            .filter((p: any) => p.type === "text" && p.text)
            .map((p: any) => p.text.trim())
            .filter(Boolean);
          if (asstTexts.length) {
            const resp = asstTexts.join("\n");
            currentTurn.agentResponse = currentTurn.agentResponse
              ? `${currentTurn.agentResponse}\n${resp}`
              : resp;
          }

          for (const p of parts) {
            if (p.type === "reasoning" && p.text) {
              const th = p.text.replace(/\s+/g, " ").trim().slice(0, 100);
              currentTurn.processDetails?.push(`Thinking: ${th}`);
            } else if (p.type === "tool-invocation" || p.type === "tool-call") {
              const toolName = p.toolName || p.name || p.tool || "tool";
              currentTurn.processDetails?.push(`Tool: ${toolName}`);
            } else if (p.type === "step-start") {
              currentTurn.processDetails?.push("Step started");
            }
          }
        }
      }
      if (currentTurn) turns.push(currentTurn);
      return turns;
    } catch (err) {
      console.warn(`[OpenCode] Failed to fetch turns for ${sessionId}:`, err);
      return [];
    }
  }

  public async sendPrompt(
    sessionId: string,
    text: string,
    options?: { model?: string; effort?: string; access?: string }
  ): Promise<void> {
    const payload: any = {
      parts: [{ type: "text", text }],
    };
    if (options?.model) payload.model = options.model;

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`OpenCode sendPrompt failed: ${res.status} ${res.statusText}`);
    }
  }

  public async interrupt(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
        method: "POST",
        headers: this.getHeaders(),
      });
    } catch (err) {
      console.error("[OpenCode] Interrupt failed:", err);
    }
  }

  public async respondApproval(approvalId: string, decision: string): Promise<void> {
    // OpenCode permission decision endpoint
    try {
      await fetch(`${this.baseUrl}/permissions/${approvalId}/reply`, {
        method: "POST",
        headers: { ...this.getHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    } catch (err) {
      console.error("[OpenCode] Approval reply error:", err);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.authPassword) {
      const basic = Buffer.from(`opencode:${this.authPassword}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }
    return headers;
  }

  private async startEventStream(): Promise<void> {
    while (this.isRunning) {
      try {
        this.sseAbortController = new AbortController();
        const res = await fetch(`${this.baseUrl}/global/event`, {
          headers: {
            ...this.getHeaders(),
            Accept: "text/event-stream",
          },
          signal: this.sseAbortController.signal,
        });

        if (!res.ok || !res.body) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (this.isRunning) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;
              try {
                const event = JSON.parse(dataStr);
                this.handleServerEvent(event);
              } catch {
                // Ignore malformed JSON event
              }
            }
          }
        }
      } catch (err: any) {
        if (!this.isRunning) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  private handleServerEvent(event: any): void {
    if (!event || !event.type) return;

    // OpenCode event types: message.part.delta, message.created, question.created, permission.asked, permission.request
    if (event.type === "message.part.delta" && event.properties?.delta) {
      const text =
        typeof event.properties.delta === "string"
          ? event.properties.delta
          : (event.properties.delta.text || "");
      const delta: StreamDelta = {
        sessionId: event.properties.sessionID || "unknown",
        content: text,
      };
      if (delta.content) this.emit("delta", delta);
    } else if (
      (event.type === "question.created" ||
        event.type === "permission.asked" ||
        event.type === "permission.request") &&
      event.properties
    ) {
      const req: ApprovalRequest = {
        id: event.properties.requestID || event.properties.id || event.id,
        sessionId: event.properties.sessionID || "unknown",
        prompt:
          event.properties.description ||
          event.properties.question ||
          "OpenCode Question",
        options: (event.properties.choices || []).map((c: any, i: number) => ({
          id: c.id || String(i),
          label: c.label || c,
          isSelected: i === 0,
        })),
      };
      if (!req.options.length) {
        req.options = [
          { id: "allow", label: "Approve", isSelected: true },
          { id: "deny", label: "Deny", isSelected: false },
        ];
      }
      this.emit("approval_request", req);
    }

  }
}


