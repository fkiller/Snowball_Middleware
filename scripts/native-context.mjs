import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {nativeNavigation, canonicalProjectRoot} from './native-navigation.mjs';

// Refresh actual local observations without replacing objects owned by a
// pending native turn or transcription. Separate identically named directories.
export function reconcileNativeContext(context, sessions, projects = {}) {
  context.saveActiveSessionState();
  const project = context.getCurrentProject(), session = context.getCurrentSession();
  if (project.id !== 'none') context.memoryProjectPerHarness.set(context.getScopeKey(), project.id);
  if (session.id !== 'none') context.memorySessionPerProject.set(context.getFullScopeKey(), session.id);
  const canonical = canonicalProjectRoot;
  const catalog = nativeNavigation(sessions, projects, context.navigationHistory);
  for (const harness of context.harnesses) {
    const scope = `dev-pc/${harness.id}`, roots = new Map();
    const observe = (root, name) => {
      if (!root || !path.isAbsolute(root)) return;
      try {if(!fs.statSync(root).isDirectory())return;}catch{return;}
      const key = canonical(root);
      if (!roots.has(key)) roots.set(key, {path: path.resolve(root), name, sessions: []});
      return roots.get(key);
    };
    for (const project of catalog[harness.id] || []) {
      const observed = observe(project.root, project.displayName);
      if (observed) observed.sessions.push(...project.sessions);
    }
    const prior = context.projectsByScope[scope] ?? [], refreshed = [];
    const priorSessions = Object.entries(context.sessionsByScope).filter(([key])=>key.startsWith(scope+'/')).flatMap(([,list])=>list);
    for (const [key, observed] of roots) {
      const existing = prior.find(item => canonical(item.path) === key);
      const duplicate = [...roots.values()].filter(item => item.name === observed.name).length > 1;
      const id = existing?.id ?? (duplicate ? `${observed.name}@${createHash('sha256').update(key).digest('hex').slice(0,12)}` : observed.name);
      const fullScope = `${scope}/${id}`, old = context.sessionsByScope[fullScope] ?? [];
      const list = observed.sessions.map(native => {
        const retained = old.find(item => item.id === native.id) || priorSessions.find(item => item.id === native.id);
        if (retained) { retained.title=native.title;retained.preview=native.preview;retained.cwd=native.cwd;retained.updatedAt=native.updatedAt;return retained; }
        return { ...native };
      });
      for (const retained of old) {
        if (!list.some(item => item.id === retained.id) && (retained.id.startsWith('s-') || retained.voiceSubmission==='sending' || retained.isTranscribingVoice || retained.voiceDraftText)) list.push(retained);
      }
      for(const previous of prior) {
        if(!observed.sessions.some(native=>canonical(native.cwd)===canonical(previous.path)))continue;
        for(const retained of context.sessionsByScope[`${scope}/${previous.id}`] || []) {
          if(list.some(item=>item.id===retained.id)||!retained.id.startsWith('s-'))continue;
          retained.cwd ||= previous.path;list.push(retained);
        }
      }
      context.sessionsByScope[fullScope]=list;
      refreshed.push({id,name:observed.name,path:observed.path});
    }
    context.projectsByScope[scope]=refreshed;
  }
  const activeScope=context.getScopeKey();
  const retainedProject=(context.projectsByScope[activeScope]||[]).find(p=>(context.sessionsByScope[`${activeScope}/${p.id}`]||[]).some(s=>s.id===session.id));
  if(retainedProject){context.memoryProjectPerHarness.set(activeScope,retainedProject.id);context.memorySessionPerProject.set(`${activeScope}/${retainedProject.id}`,session.id);}
  context.resolveProjectAndSession();
}
