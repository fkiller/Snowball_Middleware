import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import readline from 'node:readline';
import { scanAntigravityCatalog, scanOpenCodeCatalog } from './harness-catalog-scanner.mjs';

const CODEX_EXE = 'C:\\Users\\wondo\\AppData\\Local\\OpenAI\\Codex\\bin\\faa963e871dd422c\\codex.exe';
const AGY_EXE = 'C:\\Users\\wondo\\AppData\\Local\\agy\\bin\\agy.exe';
const OPENCODE_CMD = 'C:\\nvm4w\\nodejs\\opencode.cmd';

/**
 * Synchronizes Codex thread metadata in ~/.codex/state_5.sqlite so it is immediately visible in Codex Desktop.
 */
export function syncCodexThread(threadId, title) {
  if (!threadId) return;
  try {
    const cleanTitle = (title || 'New conversation').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    const pyScript = `import sqlite3, os
db_path = os.path.expanduser('~/.codex/state_5.sqlite')
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("UPDATE threads SET thread_source = 'user', originator = 'codex_work_desktop', name = ? WHERE id = ?", ('${cleanTitle}', '${threadId}'))
    conn.commit()
    conn.close()
`;
    cp.execFileSync('python', ['-c', pyScript], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  } catch (err) {
    // Non-fatal note
  }
}

/**
 * Synchronizes Antigravity conversation and brain metadata into ~/.gemini/antigravity
 * so that it is immediately visible in Antigravity Desktop App.
 */
export function syncAntigravityConversation(conversationId, title) {
  if (!conversationId || conversationId.startsWith('s-')) return;
  try {
    const cleanTitle = (title || 'New conversation').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    const pyScript = `import sqlite3, os, shutil
cid = '${conversationId}'
cli_db = os.path.expanduser('~/.gemini/antigravity-cli/conversation_summaries.db')
app_db = os.path.expanduser('~/.gemini/antigravity/conversation_summaries.db')
cli_brain = os.path.expanduser(f'~/.gemini/antigravity-cli/brain/{cid}')
app_brain = os.path.expanduser(f'~/.gemini/antigravity/brain/{cid}')

if os.path.exists(cli_brain):
    shutil.copytree(cli_brain, app_brain, dirs_exist_ok=True)

if os.path.exists(cli_db) and os.path.exists(app_db):
    c_cli = sqlite3.connect(cli_db)
    c_cli.row_factory = sqlite3.Row
    row = c_cli.execute("SELECT * FROM conversation_summaries WHERE conversation_id = ?", (cid,)).fetchone()
    c_cli.close()
    if row:
        cols = list(row.keys())
        vals = list(row)
        if 'app_data_dir' in cols:
            vals[cols.index('app_data_dir')] = 'antigravity'
        if 'title' in cols and '${cleanTitle}' and '${cleanTitle}' != 'New conversation':
            cur_title = row['title']
            if not cur_title or cur_title == 'Starting A New Conversation':
                vals[cols.index('title')] = '${cleanTitle}'
                if 'preview' in cols:
                    vals[cols.index('preview')] = '${cleanTitle}'
        c_app = sqlite3.connect(app_db)
        col_str = ','.join([f'\`{col}\`' for col in cols])
        placeholders = ','.join(['?'] * len(cols))
        c_app.execute(f"INSERT OR REPLACE INTO conversation_summaries ({col_str}) VALUES ({placeholders})", vals)
        c_app.commit()
        c_app.close()
`;
    cp.execFileSync('python', ['-c', pyScript], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  } catch (err) {
    // Non-fatal sync
  }
}

/**
 * Executes a turn on Codex via stdio app-server.
 */
export async function runCodexTurn(threadId, promptText, cwd, model = 'gpt-6-astra', effort = 'medium', onDelta) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(CODEX_EXE, ['app-server', '--listen', 'stdio://'], {
      env: { ...process.env, CODEX_HOME: path.join(os.homedir(), '.codex') },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const rl = readline.createInterface({ input: p.stdout });
    let agentText = '';
    let currentThreadId = threadId;

    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('Codex turn timed out after 45s'));
    }, 45000);

    rl.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
          if (!currentThreadId || currentThreadId.startsWith('s-')) {
            p.stdin.write(JSON.stringify({
              id: 2,
              jsonrpc: '2.0',
              method: 'thread/start',
              params: {
                cwd: cwd || process.cwd(),
                approvalPolicy: 'on-request',
                sandbox: 'read-only',
                threadSource: 'user',
                originator: 'codex_work_desktop',
                ...(model ? { model } : {})
              }
            }) + '\n');
          } else {
            p.stdin.write(JSON.stringify({
              id: 2,
              jsonrpc: '2.0',
              method: 'thread/resume',
              params: { threadId: currentThreadId, excludeTurns: true }
            }) + '\n');
          }
        } else if (msg.id === 2) {
          if (msg.error) {
            clearTimeout(timer);
            p.kill();
            return reject(new Error(msg.error.message || 'Codex thread setup failed'));
          }
          if (msg.result?.thread?.id) {
            currentThreadId = msg.result.thread.id;
            try {
              const indexPath = path.join(os.homedir(), '.codex', 'session_index.jsonl');
              const entry = JSON.stringify({
                id: currentThreadId,
                thread_name: promptText.slice(0, 32) || 'New conversation',
                updated_at: new Date().toISOString()
              }) + '\n';
              fs.appendFileSync(indexPath, entry, 'utf8');
            } catch {}
            syncCodexThread(currentThreadId, promptText.slice(0, 32));
          }
          const turnParams = {
            threadId: currentThreadId,
            input: [{ type: 'text', text: promptText }]
          };
          if (model) turnParams.model = model;
          if (effort && effort !== 'none') turnParams.effort = effort;

          p.stdin.write(JSON.stringify({
            id: 3,
            jsonrpc: '2.0',
            method: 'turn/start',
            params: turnParams
          }) + '\n');
        } else if (msg.id === 3 && msg.error) {
          clearTimeout(timer);
          p.kill();
          return reject(new Error(msg.error.message || 'Codex turn start failed'));
        }

        if (msg.method === 'item/agentMessage/delta') {
          const d = msg.params?.delta;
          const piece = typeof d === 'string' ? d : (d?.text || '');
          agentText += piece;
          if (onDelta && piece) onDelta(piece);
        } else if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage') {
          if (msg.params.item.text) {
            agentText = msg.params.item.text;
          }
        }

        if (msg.method === 'turn/completed') {
          clearTimeout(timer);
          syncCodexThread(currentThreadId, promptText.slice(0, 32));
          setTimeout(() => {
            p.kill();
            resolve({
              sessionId: currentThreadId,
              response: agentText.trim() || 'Done'
            });
          }, 300);
        }
      } catch {}
    });

    p.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    p.stdin.write(JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: { clientInfo: { name: 'codex_work_desktop', title: 'Codex Desktop', version: '0.158.0' } }
    }) + '\n');
  });
}

/**
 * Executes a turn on Antigravity via agy stream-json CLI.
 */
export async function runAntigravityTurn(conversationId, promptText, cwd, model, effort, onDelta) {
  return new Promise((resolve, reject) => {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
    if (conversationId && !conversationId.startsWith('s-')) {
      args.push('--conversation', conversationId);
    }
    let agyModel = model;
    let modelEfforts = [];
    if (model) {
      try {
        const cat = scanAntigravityCatalog();
        const found = cat.find(m =>
          m.model === model ||
          m.displayName === model ||
          (m.displayName && m.displayName.toLowerCase() === model.toLowerCase())
        );
        if (found) {
          agyModel = found.model;
          modelEfforts = found.efforts || [];
        }
      } catch {}
    }
    if (agyModel) args.push('--model', agyModel);

    // Effort handling:
    // 1. Claude models on agy NEVER accept --effort (throws: --effort is not supported for model ...)
    // 2. Models with built-in effort suffix (e.g. -high, -medium, -low, -max) already have fixed effort,
    //    and passing --effort conflicts if mismatched (e.g. gemini-3.8-flash-high conflicts with --effort=medium).
    // 3. Only pass --effort if model supports variable effort and doesn't already have it in the model name.
    const isClaude = agyModel && agyModel.toLowerCase().includes('claude');
    const hasBuiltinEffort = agyModel && (
      agyModel.endsWith('-high') ||
      agyModel.endsWith('-medium') ||
      agyModel.endsWith('-low') ||
      agyModel.endsWith('-max')
    );
    if (effort && effort !== 'none' && !isClaude && !hasBuiltinEffort) {
      if (modelEfforts.length === 0 || modelEfforts.includes(effort)) {
        args.push('--effort', effort);
      }
    }

    const p = cp.spawn(AGY_EXE, args, {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('Antigravity turn timed out after 45s'));
    }, 45000);

    let currentConvId = conversationId;
    let agentText = '';

    const rl = readline.createInterface({ input: p.stdout });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'init') {
          currentConvId = msg.conversation_id || currentConvId;
          p.stdin.write(JSON.stringify({
            event: 'user',
            message: { content: promptText }
          }) + '\n');
        } else if (msg.event === 'step_update' && msg.step_update?.text_delta) {
          const piece = msg.step_update.text_delta;
          agentText += piece;
          if (onDelta && piece) onDelta(piece);
        } else if (msg.event === 'result') {
          clearTimeout(timer);
          p.kill();
          const finalId = msg.result?.conversation_id || currentConvId;
          syncAntigravityConversation(finalId, promptText.slice(0, 32));
          setTimeout(() => {
            syncAntigravityConversation(finalId, promptText.slice(0, 32));
          }, 300);
          if (msg.result?.status === 'ERROR') {
            reject(new Error(msg.result.error || 'Antigravity turn error'));
          } else {
            resolve({
              sessionId: finalId,
              response: msg.result?.response?.trim() || agentText.trim() || 'Done'
            });
          }
        }
      } catch {}
    });

    p.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Executes a turn on OpenCode via opencode run CLI.
 */
export async function runOpenCodeTurn(sessionId, promptText, cwd, model = 'opencode/muse-spark-1.3-contributor-free', variant, onDelta) {
  return new Promise((resolve, reject) => {
    let ocModel = model;
    let allowedVariants = [];
    if (model) {
      try {
        const cat = scanOpenCodeCatalog();
        const found = cat.find(m =>
          m.model === model ||
          m.displayName === model ||
          (m.model.includes('/') && model.includes('/') && m.model === model) ||
          (m.model.includes('/') && m.model.endsWith('/' + model)) ||
          (m.displayName && m.displayName.toLowerCase() === model.toLowerCase())
        );
        if (found) {
          ocModel = found.model;
          allowedVariants = found.efforts || [];
        }
      } catch {}
    }
    if (!ocModel) ocModel = 'opencode/muse-spark-1.3-contributor-free';

    const args = [
      '/c', OPENCODE_CMD, 'run',
      '--format', 'json',
      '--model', ocModel,
      '--dir', cwd || process.cwd()
    ];
    if (sessionId && !sessionId.startsWith('s-')) {
      args.push('-s', sessionId);
    }
    const candidateVariant = variant || (allowedVariants.length > 0 && allowedVariants[0] !== 'none' ? allowedVariants[0] : null);
    if (candidateVariant && candidateVariant !== 'none') {
      if (allowedVariants.length === 0 || allowedVariants.includes(candidateVariant)) {
        args.push('--variant', candidateVariant);
      }
    }
    args.push(promptText);

    const p = cp.spawn('cmd.exe', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('OpenCode turn timed out after 45s'));
    }, 45000);

    let activeSessionId = sessionId;
    let agentText = '';

    const rl = readline.createInterface({ input: p.stdout });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.sessionID && (!activeSessionId || activeSessionId.startsWith('s-'))) {
          activeSessionId = msg.sessionID;
        }
        if (msg.type === 'text' && msg.part?.text) {
          const piece = msg.part.text;
          agentText += piece;
          if (onDelta && piece) onDelta(piece);
        }
      } catch {}
    });

    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !agentText) {
        reject(new Error(`OpenCode exited with code ${code}`));
      } else {
        resolve({
          sessionId: activeSessionId,
          response: agentText.trim() || 'Done'
        });
      }
    });

    p.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Dispatches a prompt to whichever harness is active.
 */
export async function dispatchHarnessTurn({ harnessId, sessionId, promptText, cwd, model, effort, onDelta }) {
  if (harnessId === 'snowball.codex') {
    return runCodexTurn(sessionId, promptText, cwd, model, effort, onDelta);
  } else if (harnessId === 'snowball.antigravity') {
    return runAntigravityTurn(sessionId, promptText, cwd, model, effort, onDelta);
  } else if (harnessId === 'snowball.opencode') {
    return runOpenCodeTurn(sessionId, promptText, cwd, model, effort, onDelta);
  } else {
    throw new Error(`Unsupported harness: ${harnessId}`);
  }
}
