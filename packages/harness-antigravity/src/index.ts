import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { formatSessionKey, parseSessionKey, type DispatchPort, type DispatchReceipt, type CommandRecord, type DecisionRecord } from '@snowball/core';
export { antigravityManifest } from './manifest.js';

export interface AntigravityBinding {
  hostId: string;
  instanceId: string;
  brainDir?: string;
}

export interface AntigravitySessionSummary {
  nativeId: string;
  sessionKey: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  readOnly: true;
  ownerId: null;
}

export interface AntigravityTurn {
  stepIndex: number;
  type: string;
  source: string;
  status?: string;
  content?: string;
  createdAt?: string;
}

export class AntigravityObserverAdapter extends EventEmitter implements DispatchPort {
  readonly ownerId = 'antigravity-observer';
  readonly #binding: AntigravityBinding;
  readonly #brainDir: string;
  readonly #watchers = new Map<string, fs.FSWatcher>();
  #connected = false;

  constructor(binding: AntigravityBinding) {
    super();
    this.#binding = structuredClone(binding);
    this.#brainDir = binding.brainDir || path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  }

  async start(): Promise<void> {
    this.#connected = true;
  }

  status() {
    return {
      connected: this.#connected,
      auth: 'not_required' as const,
      surface: 'transcript-observer' as const,
      credentialSource: 'antigravity-brain' as const,
      existingDesktopControl: false,
      readOnly: true,
      capabilities: ['observe'] as const,
      instanceId: this.#binding.instanceId,
      brainDir: this.#brainDir,
    };
  }

  private sessionKey(conversationId: string): string {
    return formatSessionKey({
      hostId: this.#binding.hostId,
      harness: { pluginId: 'snowball.antigravity', instanceId: this.#binding.instanceId },
      nativeSessionId: conversationId,
    });
  }

  async listSessions(limit = 50): Promise<AntigravitySessionSummary[]> {
    if (!fs.existsSync(this.#brainDir)) return [];
    const entries = fs.readdirSync(this.#brainDir, { withFileTypes: true });
    const sessions: AntigravitySessionSummary[] = [];

    const dirs = entries
      .filter(d => d.isDirectory() && /^[0-9a-fA-F-]{8,64}$/.test(d.name))
      .map(d => {
        const dirPath = path.join(this.#brainDir, d.name);
        let mtime = 0;
        try { mtime = fs.statSync(dirPath).mtimeMs; } catch {}
        return { id: d.name, dirPath, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    for (const dir of dirs) {
      let preview = `Conversation ${dir.id.slice(0, 8)}`;
      const transcriptPath = path.join(dir.dirPath, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf8');
          const lines = content.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const step = JSON.parse(line);
            if (step.type === 'USER_INPUT' && step.content) {
              const text = String(step.content)
                .replace(/<USER_REQUEST>/gi, '')
                .replace(/<\/USER_REQUEST>/gi, '')
                .trim()
                .replace(/\s+/g, ' ');
              if (text) {
                preview = text.slice(0, 80);
                break;
              }
            }
          }
        } catch {}
      }
      sessions.push({
        nativeId: dir.id,
        sessionKey: this.sessionKey(dir.id),
        title: preview.slice(0, 32),
        preview,
        createdAt: dir.mtime,
        updatedAt: dir.mtime,
        readOnly: true,
        ownerId: null,
      });
    }

    return sessions;
  }

  async readSession(conversationId: string): Promise<{ nativeId: string; readOnly: true; turns: AntigravityTurn[] }> {
    const transcriptPath = path.join(this.#brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Session ${conversationId} transcript not found`);
    }
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const turns: AntigravityTurn[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        turns.push({
          stepIndex: step.step_index ?? turns.length,
          type: step.type ?? 'unknown',
          source: step.source ?? 'unknown',
          status: step.status,
          content: typeof step.content === 'string' ? step.content.slice(0, 65536) : undefined,
          createdAt: step.created_at,
        });
      } catch {}
    }
    return { nativeId: conversationId, readOnly: true, turns };
  }

  watchSession(conversationId: string): void {
    if (this.#watchers.has(conversationId)) return;
    const transcriptPath = path.join(this.#brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    let offset = 0;
    try { offset = fs.statSync(transcriptPath).size; } catch {}

    const watcher = fs.watch(transcriptPath, () => {
      try {
        const stat = fs.statSync(transcriptPath);
        if (stat.size > offset) {
          const fd = fs.openSync(transcriptPath, 'r');
          const length = stat.size - offset;
          const buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, offset);
          fs.closeSync(fd);
          offset = stat.size;

          const newLines = buf.toString('utf8').split('\n');
          for (const line of newLines) {
            if (!line.trim()) continue;
            try {
              const step = JSON.parse(line);
              this.emit('event', {
                sessionKey: this.sessionKey(conversationId),
                ownerId: null,
                kind: step.type === 'USER_INPUT' ? 'turn/started' : 'item/agentMessage/delta',
                text: typeof step.content === 'string' ? step.content.slice(0, 65536) : undefined,
              });
            } catch {}
          }
        }
      } catch {}
    });

    this.#watchers.set(conversationId, watcher);
  }

  unwatchSession(conversationId: string): void {
    const watcher = this.#watchers.get(conversationId);
    if (watcher) {
      watcher.close();
      this.#watchers.delete(conversationId);
    }
  }

  /**
   * DispatchPort conformance: Antigravity is strictly observe-only.
   * Any mutation attempts are rejected as unsupported.
   */
  async execute(
    envelope: { command: CommandRecord; decision?: DecisionRecord },
    _signal: AbortSignal
  ): Promise<DispatchReceipt> {
    const input = envelope.command.input;
    const target = parseSessionKey(input.sessionKey);
    if (target.harness.pluginId !== 'snowball.antigravity') {
      return { status: 'not_sent', reason: 'owner_mismatch' };
    }
    // R-TRUTH: observe-only harness never claims control and rejects send/interrupt/decision
    return { status: 'not_sent', reason: 'read_only_harness' };
  }

  async stop(): Promise<void> {
    this.#connected = false;
    for (const watcher of this.#watchers.values()) {
      watcher.close();
    }
    this.#watchers.clear();
  }
}
