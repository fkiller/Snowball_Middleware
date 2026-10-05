import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as cp from 'node:child_process';
import * as readline from 'node:readline';
import { formatSessionKey, parseSessionKey, type DispatchPort, type DispatchReceipt, type CommandRecord, type DecisionRecord } from '@snowball/plugin-sdk';
export { antigravityManifest } from './manifest.js';
export {harnessPresentation} from './presentation.js';

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
  model?: string;
  effort?: string;
  access?: string;
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

  async createSession(root: string, options: { model?: string; effort?: string } = {}): Promise<{ sessionKey: string; ownerId: string; nativeSessionId: string }> {
    return new Promise((resolve, reject) => {
      const agyExe = 'C:\\Users\\wondo\\AppData\\Local\\agy\\bin\\agy.exe';
      const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
      if (options.model) args.push('--model', options.model);
      if (options.effort) args.push('--effort', options.effort);

      const p = cp.spawn(agyExe, args, {
        cwd: root || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timer = setTimeout(() => {
        p.kill();
        reject(new Error('Antigravity session creation timed out'));
      }, 10000);

      const rl = readline.createInterface({ input: p.stdout });
      rl.on('line', line => {
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'init' && msg.conversation_id) {
            clearTimeout(timer);
            p.kill();
            resolve({
              sessionKey: this.sessionKey(msg.conversation_id),
              ownerId: this.ownerId,
              nativeSessionId: msg.conversation_id
            });
          }
        } catch {}
      });

      p.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async listModels(): Promise<Array<{ model: string; displayName: string; efforts: string[]; defaultEffort: string | null }>> {
    return [
      {
        model: 'Gemini 3.8 Flash High',
        displayName: 'Gemini 3.8 Flash High',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
      },
      {
        model: 'Gemini 3.7 Flash Medium',
        displayName: 'Gemini 3.7 Flash Medium',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'medium',
      },
      {
        model: 'Gemini 3.6 Flash Medium',
        displayName: 'Gemini 3.6 Flash Medium',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'medium',
      },
      {
        model: 'Gemini 3.1 Pro Low',
        displayName: 'Gemini 3.1 Pro Low',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'low',
      },
      {
        model: 'Claude Sonnet 4.6 (Thinking)',
        displayName: 'Claude Sonnet 4.6 (Thinking)',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
      },
      {
        model: 'Claude Opus 4.6 (Thinking)',
        displayName: 'Claude Opus 4.6 (Thinking)',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
      },
      {
        model: 'GPT-OSS 120B (Medium)',
        displayName: 'GPT-OSS 120B (Medium)',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'medium',
      },
    ];
  }

  private transcriptPath(conversationId: string): string {
    if (typeof conversationId !== 'string' || !/^[0-9a-fA-F-]{8,64}$/.test(conversationId)) throw new Error('invalid_session_id');
    const root = fs.realpathSync(this.#brainDir);
    const file = path.join(root, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(file)) return file;
    const resolved = fs.realpathSync(file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('transcript_outside_root');
    if (fs.statSync(resolved).size > 4 * 1024 * 1024) throw new Error('transcript_limit');
    return resolved;
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
      let model = 'Gemini 3.1 Pro (High)';
      let effort = 'high';
      const access = 'on-request';
      let transcriptPath: string;
      try { transcriptPath = this.transcriptPath(dir.id); } catch { continue; }
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf8');
          const lines = content.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const step = JSON.parse(line);
            if (typeof step.content === 'string') {
              const settingMatch = step.content.match(/Model Selection` from .* to (.*?)\./);
              if (settingMatch && settingMatch[1]) {
                model = settingMatch[1].trim();
              }
            }
            if (step.type === 'USER_INPUT' && step.content) {
              const text = String(step.content)
                .replace(/<USER_REQUEST>/gi, '')
                .replace(/<\/USER_REQUEST>/gi, '')
                .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
                .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
                .trim()
                .replace(/\s+/g, ' ');
              if (text && preview === `Conversation ${dir.id.slice(0, 8)}`) {
                preview = text.slice(0, 80);
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
        model,
        effort,
        access,
      });
    }

    return sessions;
  }

  async readSession(conversationId: string): Promise<{ nativeId: string; readOnly: true; turns: AntigravityTurn[]; model?: string; effort?: string; access?: string }> {
    const transcriptPath = this.transcriptPath(conversationId);
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Session ${conversationId} transcript not found`);
    }
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const turns: AntigravityTurn[] = [];
    let model = 'Gemini 3.1 Pro (High)';
    let effort = 'high';
    const access = 'on-request';
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        if (typeof step.content === 'string') {
          const settingMatch = step.content.match(/Model Selection` from .* to (.*?)\./);
          if (settingMatch && settingMatch[1]) {
            model = settingMatch[1].trim();
          }
        }
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
    return { nativeId: conversationId, readOnly: true, turns, model, effort, access };
  }

  watchSession(conversationId: string): void {
    if (this.#watchers.has(conversationId)) return;
    const transcriptPath = this.transcriptPath(conversationId);
    if (!fs.existsSync(transcriptPath)) return;

    let offset = 0;
    try { offset = fs.statSync(transcriptPath).size; } catch {}

    const watcher = fs.watch(transcriptPath, () => {
      try {
        const stat = fs.statSync(this.transcriptPath(conversationId));
        if (stat.size > offset) {
          const fd = fs.openSync(this.transcriptPath(conversationId), 'r');
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

  async execute(
    envelope: { command: CommandRecord; decision?: DecisionRecord },
    _signal?: AbortSignal
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
