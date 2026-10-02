import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Discovers real sessions and conversation turns for Codex, Antigravity, and OpenCode.
 */
export function scanAllHarnessSessions() {
  const result = {
    'snowball.codex': {},
    'snowball.antigravity': {},
    'snowball.opencode': {}
  };

  const turnsStore = {};

  // 1. CODEX SESSIONS
  try {
    const codexDir = path.join(os.homedir(), '.codex');
    const indexPath = path.join(codexDir, 'session_index.jsonl');
    const sessionsDir = path.join(codexDir, 'sessions');

    // Build single-pass rollout map for instant O(1) lookups
    const rolloutMap = new Map();
    function indexRollouts(dir) {
      if (!fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            indexRollouts(full);
          } else if (e.name.endsWith('.jsonl')) {
            // Extract UUID/session ID from filename: rollout-YYYY-MM-DDTHH-MM-SS-<id>.jsonl
            const prefixMatch = e.name.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
            if (prefixMatch) {
              rolloutMap.set(prefixMatch[1], full);
            }
            const uuidMatch = e.name.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/);
            if (uuidMatch) {
              rolloutMap.set(uuidMatch[1], full);
            }
          }
        }
      } catch {}
    }
    indexRollouts(sessionsDir);

    if (fs.existsSync(indexPath)) {
      const indexLines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
      for (const line of indexLines) {
        try {
          const item = JSON.parse(line);
          const rollout = rolloutMap.get(item.id);
          let cwd = '';
          const turns = [];
          let sessModel = null;
          let sessEffort = null;
          let sessAccess = 'on-request';

          if (rollout) {
            const rLines = fs.readFileSync(rollout, 'utf8').split('\n').filter(Boolean);
            if (rLines[0]) {
              const meta = JSON.parse(rLines[0]);
              cwd = meta.payload?.cwd || '';
            }
            for (const rl of rLines) {
              try {
                const p = JSON.parse(rl);
                if (p.type === 'turn_context' && p.payload) {
                  if (p.payload.model) sessModel = p.payload.model;
                  if (p.payload.effort) sessEffort = p.payload.effort;
                  if (p.payload.approval_policy) sessAccess = p.payload.approval_policy;
                }
                const appMatch = rl.match(/<approval_policy>([^<]+)<\/approval_policy>/);
                if (appMatch) sessAccess = appMatch[1];

                if (p.type === 'response_item' && p.payload && p.payload.type === 'message') {
                  const role = p.payload.role;
                  if (role === 'user') {
                    const text = p.payload.content
                      ?.map(c => c.text)
                      .filter(t => t && !t.startsWith('# AGENTS.md') && !t.startsWith('<') && !t.startsWith('<ctrl94>thought'))
                      .join('\n')
                      .trim();
                    if (text && text.length > 5) {
                      turns.push({ role: 'user', text: text.slice(0, 800), userPrompt: text.slice(0, 800), time: '최근' });
                    }
                  } else if (role === 'assistant') {
                    const text = p.payload.content?.map(c => c.text).filter(Boolean).join('\n').trim();
                    if (text && text.length > 5) {
                      turns.push({ role: 'agent', text: text.slice(0, 800), agentResponse: text.slice(0, 800), time: '최근', processDetails: [] });
                    }
                  }
                } else if (p.type === 'response_item' && p.payload && (p.payload.type === 'function_call' || p.payload.type === 'tool_call' || p.payload.name)) {
                  const cmd = p.payload.name || (typeof p.payload.arguments === 'string' ? p.payload.arguments.slice(0, 80) : '');
                  if (cmd && turns.length > 0) {
                    const lastTurn = turns[turns.length - 1];
                    lastTurn.processDetails = lastTurn.processDetails || [];
                    lastTurn.processDetails.push(String(cmd).slice(0, 100));
                  }
                }
              } catch {}
            }
          }

          if (!cwd || !path.isAbsolute(cwd)) continue;
          const projName = path.basename(cwd);

          if (!result['snowball.codex'][projName]) {
            result['snowball.codex'][projName] = [];
          }

          const sessionKey = `host_minime/snowball.codex/default/${item.id}`;
          result['snowball.codex'][projName].push({
            id: item.id,
            cwd,
            sessionKey,
            title: item.thread_name,
            updatedAt: item.updated_at,
            readOnly: true,
            ownerId: null,
            model: sessModel,
            effort: sessEffort,
            access: sessAccess || 'on-request'
          });

          const savedTurns = turns.slice(-15);
          turnsStore[sessionKey] = savedTurns;
          turnsStore[item.id] = savedTurns;
        } catch {}
      }


    }
  } catch (e) {
    console.error('Codex session scan error:', e);
  }

  // 2. ANTIGRAVITY & OPENCODE SESSIONS VIA NATIVE DB SCANNER
  try {
    const pyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness-db-scanner.py');
    const pyOut = cp.execFileSync('python', [pyScript], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 20 * 1024 * 1024
    });
    const parsed = JSON.parse(pyOut);
    if (parsed.antigravity && typeof parsed.antigravity === 'object') {
      result['snowball.antigravity'] = parsed.antigravity;
    }
    if (parsed.opencode && typeof parsed.opencode === 'object') {
      result['snowball.opencode'] = parsed.opencode;
    }
    if (parsed.turns && typeof parsed.turns === 'object') {
      Object.assign(turnsStore, parsed.turns);
    }
  } catch (e) {
    console.error('Antigravity & OpenCode DB scan error:', e);
  }

  return { sessionsByHarness: result, turnsStore };
}

if (process.argv[1] && process.argv[1].endsWith('harness-session-scanner.mjs')) {
  const { sessionsByHarness, turnsStore } = scanAllHarnessSessions();
  console.log('Scanned sessions:');
  for (const [h, projs] of Object.entries(sessionsByHarness)) {
    console.log(`[${h}]`);
    for (const [p, list] of Object.entries(projs)) {
      console.log(`  Project: ${p} (${list.length} sessions)`);
      for (const s of list) {
        console.log(`    - ${s.title} [${(turnsStore[s.sessionKey] || []).length} turns]`);
      }
    }
  }
}
