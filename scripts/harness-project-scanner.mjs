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
    // Known roots from Antigravity
    const candidatePaths = [
      'E:\\developments\\projects\\Snowball_Control',
      'E:\\developments\\projects\\GnuNae',
      'C:\\Users\\wondo\\OneDrive\\Documents\\GimMyTwitterB',
      'C:\\Users\\wondo'
    ];
    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) {
        agProjects.set(cp, path.basename(cp) || cp);
      }
    }
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
    // From OpenCode UI screenshot: TuneStairs, Snowball_Control, Default Project
    const candidatePaths = [
      { name: 'TuneStairs', path: 'E:\\developments\\projects\\TuneStairs' },
      { name: 'Snowball_Control', path: 'E:\\developments\\projects\\Snowball_Control' },
      { name: 'Default Project', path: process.env.USERPROFILE || 'C:\\Users\\wondo' }
    ];
    for (const cp of candidatePaths) {
      ocProjects.set(cp.name, { displayName: cp.name, root: cp.path });
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
