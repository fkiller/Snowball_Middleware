import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

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
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const localProjects = data['local-projects'] || {};
      for (const [id, proj] of Object.entries(localProjects)) {
        const root = proj.rootPaths?.[0] || '';
        result['snowball.codex'].push({
          candidateId: `codex_${id}`,
          nativeProjectId: id,
          displayName: proj.name || path.basename(root) || 'Codex Project',
          root: root,
          harness: { pluginId: 'snowball.codex', instanceId: 'default' }
        });
      }
      const remoteProjects = data['remote-projects'] || [];
      for (const r of remoteProjects) {
        result['snowball.codex'].push({
          candidateId: `codex_${r.id}`,
          nativeProjectId: r.id,
          displayName: r.label || 'Snowball',
          root: r.remotePath || r.hostId || 'remote',
          harness: { pluginId: 'snowball.codex', instanceId: 'default' }
        });
      }
    }
  } catch (e) {
    console.error('Error scanning Codex projects:', e);
  }

  // 2. ANTIGRAVITY
  try {
    const agProjects = new Map();
    // Also scan APPDATA/Antigravity storage.json
    const appData = process.env.APPDATA || '';
    const storageJson = path.join(appData, 'Antigravity', 'User', 'globalStorage', 'storage.json');
    if (fs.existsSync(storageJson)) {
      try {
        const data = JSON.parse(fs.readFileSync(storageJson, 'utf8'));
        const ws = data?.profileAssociations?.workspaces || {};
        for (const uri of Object.keys(ws)) {
          let p = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
          p = path.normalize(p);
          if (fs.existsSync(p)) {
            agProjects.set(p, path.basename(p) || p);
          }
        }
      } catch {}
    }

    let idx = 1;
    for (const [root, name] of agProjects.entries()) {
      result['snowball.antigravity'].push({
        candidateId: `ag_${idx++}`,
        nativeProjectId: name,
        displayName: name,
        root: root,
        harness: { pluginId: 'snowball.antigravity', instanceId: 'default' }
      });
    }
  } catch (e) {
    console.error('Error scanning Antigravity projects:', e);
  }

  // 3. OPENCODE
  try {
    const ocProjects = new Map();
    const pyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness-db-scanner.py');
    const data = JSON.parse(cp.execFileSync('python', [pyScript], { encoding: 'utf8', timeout: 12000,
      windowsHide: true, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
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
