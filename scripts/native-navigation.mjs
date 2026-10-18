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
export function nativeNavigation(sessions, projects = {}) {
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
    result[harness] = [...roots.values()];
  }
  return result;
}

// Publish one copy of each native transcript, using the real host-scoped key.
// Internal ID/source aliases are lookup conveniences, not separate messages.
export function nativeTranscriptProjection(sessions, turns) {
  const result = {};
  for(const groups of Object.values(sessions))for(const list of Object.values(groups))for(const session of list) {
    if(session.sessionKey)result[session.sessionKey]=turns[session.sessionKey]??turns[session.id]??[];
  }
  return result;
}
