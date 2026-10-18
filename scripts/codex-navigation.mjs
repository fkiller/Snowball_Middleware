import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function readCodexNavigation() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/.codex-global-state.json'), 'utf8')); }
  catch { return {}; }
}
export function codexProjects(state) {
  const projects = Object.entries(state['local-projects'] || {});
  const order = state['project-order'] || [];
  return projects.map(([id, project], index) => ({ id, project, index }))
    .sort((a, b) => {
      const rank = id => order.indexOf(id) < 0 ? order.length : order.indexOf(id);
      return rank(a.id) - rank(b.id) || a.index - b.index;
    }).flatMap(({ id, project }) => (project.rootPaths || []).filter(root => path.isAbsolute(root)).slice(0,1).map(root => ({
      candidateId: `codex_${id}`, nativeProjectId: id, displayName: project.name || path.basename(root), root,
      harness: { pluginId: 'snowball.codex', instanceId: 'default' }
    })));
}
export function codexSessionProject(state, id) {
  const assignment = state['thread-project-assignments']?.[id];
  if (assignment?.projectKind !== 'local') return null;
  const project = codexProjects(state).find(p => p.nativeProjectId === assignment.projectId);
  return project ? { projectRoot: project.root, projectName: project.displayName, nativeProjectId: project.nativeProjectId } : null;
}
export function orderCodexSessions(items, state) {
  // The index is append-only: renames/updates may repeat a thread ID.
  const unique = new Map(items.filter(item => item?.id).map(item => [item.id, item]));
  const lists = state['sidebar-project-thread-orders'] || {};
  return [...unique.values()].sort((a, b) => {
    const pa = state['thread-project-assignments']?.[a.id]?.projectId;
    const pb = state['thread-project-assignments']?.[b.id]?.projectId;
    const order = pa === pb && Array.isArray(lists[pa]) ? lists[pa] : [];
    const rank = id => order.indexOf(id) < 0 ? order.length : order.indexOf(id);
    return rank(a.id) - rank(b.id) || (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
  });
}
