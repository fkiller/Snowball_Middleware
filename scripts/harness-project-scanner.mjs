import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {readCodexNavigation, codexProjects} from './codex-navigation.mjs';

export function scanHarnessProjects() {
  const result = {
    'snowball.codex': [],
    'snowball.antigravity': [],
    'snowball.opencode': []
  };

  // 1. CODEX
  try {
    const p = path.join(process.env.USERPROFILE || '', '.codex', '.codex-global-state.json');
    if (fs.existsSync(p)) {
      const data = readCodexNavigation();
      result['snowball.codex'] = codexProjects(data);
    }
  } catch (e) {
    console.error('Error scanning Codex projects:', e);
  }

  // 2. ANTIGRAVITY and OPENCODE from the same actual native scan
  try {
    const ocProjects = new Map();
    const pyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness-db-scanner.py');
    const data = JSON.parse(cp.execFileSync('python', [pyScript, '--projects-only'], { encoding: 'utf8', timeout: 12000,
      windowsHide: true, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
    result['snowball.antigravity'] = data.antigravityProjects || [];
    for (const [name, sessions] of Object.entries(data.opencode || {})) {
      const cwd = sessions.find(session => session.cwd && path.isAbsolute(session.cwd))?.cwd;
      if (cwd) ocProjects.set(name, { displayName: name, root: cwd });
    }

    let idx = 1;
    for (const [name, info] of ocProjects.entries()) {
      result['snowball.opencode'].push({
        candidateId: `oc_${idx++}`,
        nativeProjectId: name,
        displayName: info.displayName,
        root: info.root,
        harness: { pluginId: 'snowball.opencode', instanceId: 'default' }
      });
    }
  } catch (e) {
    console.error('Error scanning OpenCode projects:', e);
  }

  return result;
}

if (process.argv[1] && process.argv[1].endsWith('harness-project-scanner.mjs')) {
  console.log(JSON.stringify(scanHarnessProjects(), null, 2));
}
