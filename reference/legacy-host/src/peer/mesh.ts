import * as http from "node:http";
import * as os from "node:os";
import { EventEmitter } from "node:events";
import { MachineInfo, ProjectInfo, SessionInfo } from "../types.js";
import { AgentHarness } from "../harness/types.js";

export interface PeerNode {
  id: string;
  name: string;
  host: string;
  port: number;
  isOnline: boolean;
  harnesses: string[];
  lastSeen: number;
}

export interface MeshRouterOptions {
  localId?: string;
  localName?: string;
  port?: number;
  knownPeers?: Array<{ id: string; name: string; host: string; port: number }>;
}

export class MeshRouter extends EventEmitter {
  public readonly localId: string;
  public readonly localName: string;
  public readonly port: number;

  private server: http.Server | null = null;
  private peers: Map<string, PeerNode> = new Map();
  private localHarnesses: Map<string, AgentHarness> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: MeshRouterOptions = {}) {
    super();
    this.localId = options.localId || "dev-pc";
    this.localName = options.localName || os.hostname();
    this.port = options.port || 7702;

    // Register default known peer topologies
    const defaultPeers = options.knownPeers || [
      { id: "dev-pc", name: "DEV-PC", host: "127.0.0.1", port: this.port },
      { id: "mac-studio", name: "STUDIO", host: "192.168.1.200", port: 7702 },
      { id: "linux-srv", name: "SERVER", host: "192.168.1.210", port: 7702 },
    ];

    for (const p of defaultPeers) {
      this.peers.set(p.id, {
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        isOnline: p.id === this.localId,
        harnesses: ["codex", "antigravity", "opencode"],
        lastSeen: p.id === this.localId ? Date.now() : 0,
      });
    }
  }

  public registerHarness(harness: AgentHarness): void {
    this.localHarnesses.set(harness.id, harness);
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleHttp(req, res));
      this.server.listen(this.port, () => {
        console.log(`[MeshRouter] Peer mesh HTTP server listening on port ${this.port}`);
        this.startHeartbeats();
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.server) {
      await new Promise<void>((res) => this.server?.close(() => res()));
      this.server = null;
    }
  }

  public getMachines(): MachineInfo[] {
    return Array.from(this.peers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isOnline: p.isOnline,
    }));
  }

  public async listProjects(machineId: string, harnessId: string): Promise<ProjectInfo[]> {
    if (machineId === this.localId || machineId === "local") {
      const h = this.localHarnesses.get(harnessId);
      return h ? await h.listProjects() : [];
    }

    const peer = this.peers.get(machineId);
    if (!peer) return [];

    try {
      return await this.callRemote(peer, "listProjects", { harnessId });
    } catch {
      return [];
    }
  }

  public async listSessions(machineId: string, harnessId: string, projectId: string): Promise<SessionInfo[]> {
    if (machineId === this.localId || machineId === "local") {
      const h = this.localHarnesses.get(harnessId);
      return h ? await h.listSessions(projectId) : [];
    }

    const peer = this.peers.get(machineId);
    if (!peer) return [];

    try {
      return await this.callRemote(peer, "listSessions", { harnessId, projectId });
    } catch {
      return [];
    }
  }

  public async sendPrompt(
    machineId: string,
    harnessId: string,
    sessionId: string,
    text: string,
    options?: { model?: string; effort?: string; access?: string }
  ): Promise<void> {
    if (machineId === this.localId || machineId === "local") {
      const h = this.localHarnesses.get(harnessId);
      if (h) await h.sendPrompt(sessionId, text, options);
      return;
    }

    const peer = this.peers.get(machineId);
    if (!peer) throw new Error(`Remote machine ${machineId} is not in mesh catalog.`);

    await this.callRemote(peer, "sendPrompt", { harnessId, sessionId, text, options });
  }

  public async interrupt(machineId: string, harnessId: string, sessionId: string): Promise<void> {
    if (machineId === this.localId || machineId === "local") {
      const h = this.localHarnesses.get(harnessId);
      if (h) await h.interrupt(sessionId);
      return;
    }

    const peer = this.peers.get(machineId);
    if (!peer) return;

    try {
      await this.callRemote(peer, "interrupt", { harnessId, sessionId });
    } catch {
      // Best-effort interrupt
    }
  }

  public async probePeers(): Promise<void> {
    for (const peer of this.peers.values()) {
      if (peer.id === this.localId) continue;
      try {
        const res = await fetch(`http://${peer.host}:${peer.port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          peer.isOnline = true;
          peer.lastSeen = Date.now();
        } else {
          peer.isOnline = false;
        }
      } catch {
        peer.isOnline = false;
      }
    }
  }

  private async callRemote(peer: PeerNode, method: string, params: any): Promise<any> {
    try {
      const res = await fetch(`http://${peer.host}:${peer.port}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`Remote RPC failed: ${res.statusText}`);
      peer.isOnline = true;
      peer.lastSeen = Date.now();
      const data = (await res.json()) as any;
      return data.result;
    } catch (err) {
      peer.isOnline = false;
      throw err;
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          machineId: this.localId,
          name: this.localName,
          harnesses: Array.from(this.localHarnesses.keys()),
          status: "online",
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/rpc") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { method, params } = JSON.parse(body);
          const harness = this.localHarnesses.get(params?.harnessId);
          let result: any = null;

          if (method === "listProjects" && harness) {
            result = await harness.listProjects();
          } else if (method === "listSessions" && harness) {
            result = await harness.listSessions(params?.projectId);
          } else if (method === "sendPrompt" && harness) {
            result = await harness.sendPrompt(params?.sessionId, params?.text, params?.options);
          } else if (method === "interrupt" && harness) {
            result = await harness.interrupt(params?.sessionId);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private startHeartbeats(): void {
    this.heartbeatTimer = setInterval(async () => {
      for (const peer of this.peers.values()) {
        if (peer.id === this.localId) continue;
        try {
          const res = await fetch(`http://${peer.host}:${peer.port}/health`, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) {
            peer.isOnline = true;
            peer.lastSeen = Date.now();
          } else {
            peer.isOnline = false;
          }
        } catch {
          peer.isOnline = false;
        }
      }
    }, 5000);
  }
}
