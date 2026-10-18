import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function canonicalProjectRoot(root) {
  if (!root || !path.isAbsolute(root)) return '';
  let stat, resolved;
  try { stat=fs.statSync(root,{bigint:true}); if (!stat.isDirectory()) return ''; resolved = fs.realpathSync(root); }
  catch { return ''; }
  // Filesystem identity also preserves distinct case-sensitive Windows folders.
  return stat.ino ? `${stat.dev}:${stat.ino}` : resolved;
}
export const projectHistoryKey = (harness, root) => `p:${harness}:${canonicalProjectRoot(root)}`;
export const sessionHistoryKey = sessionKey => `s:${sessionKey}`;

export function nativeNavigation(sessions, projects = {}, history) {
  const result = {};
  for (const harness of new Set([...Object.keys(projects), ...Object.keys(sessions)])) {
    const roots = new Map();
    const observe = (root, name) => {
      const key = canonicalProjectRoot(root); if (!key) return;
      if (!roots.has(key)) roots.set(key, {id:'project_'+createHash('sha256').update(key).digest('hex').slice(0,16), root:path.resolve(root), displayName:name || path.basename(root), sessions:[]});
      return roots.get(key);
    };
    // Native project/sidebar order precedes session-only observations.
    for (const project of projects[harness] || []) observe(project.root, project.displayName);
    const seen = new Set();
    for (const [name, list] of Object.entries(sessions[harness] || {})) for (const session of list) {
      if (seen.has(session.id)) continue;
      const project = observe(session.projectRoot || session.cwd, session.projectName || name);
      if (!project) continue;
      seen.add(session.id); project.sessions.push({...session, projectRoot:project.root, projectName:project.displayName});
    }
    let ordered = [...roots.values()];
    if (history) {
      ordered = history.order(ordered, p => projectHistoryKey(harness,p.root));
      for (const project of ordered) project.sessions = history.order(project.sessions, s => sessionHistoryKey(s.sessionKey));
    }
    result[harness] = ordered;
  }
  return result;
}
