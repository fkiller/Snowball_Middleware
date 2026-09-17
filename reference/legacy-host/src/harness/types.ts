import { ProjectInfo, SessionInfo } from "../types.js";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  prompt: string;
  isMultiSelect?: boolean;
  options: Array<{ id: string; label: string; isSelected?: boolean }>;
}

export interface StreamDelta {
  sessionId: string;
  content: string;
}

export interface SessionTurn {
  id: string;
  userPrompt: string;
  agentResponse: string;
  processDetails?: string[];
  timestamp?: number;
}

export interface AgentHarness {
  readonly id: "codex" | "antigravity" | "opencode";
  readonly name: string;

  isAvailable(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;

  listProjects(): Promise<ProjectInfo[]>;
  listSessions(projectId: string): Promise<SessionInfo[]>;
  createSession(projectId: string): Promise<SessionInfo>;
  getTurns?(sessionId: string): Promise<SessionTurn[]>;

  sendPrompt(
    sessionId: string,
    text: string,
    options?: { model?: string; effort?: string; access?: string }
  ): Promise<void>;

  interrupt(sessionId: string): Promise<void>;

  on(event: "delta", listener: (delta: StreamDelta) => void): this;
  on(event: "approval_request", listener: (approval: ApprovalRequest) => void): this;

  respondApproval(approvalId: string, decision: "allow" | "deny" | "allow_all" | string): Promise<void>;
}
