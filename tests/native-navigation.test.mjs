import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {codexProjects,codexSessionProject,orderCodexSessions} from '../scripts/codex-navigation.mjs';
import {nativeNavigation,nativeTranscriptProjection} from '../scripts/native-navigation.mjs';
import {ContextManager} from '../scripts/context-manager.mjs';
import {reconcileNativeContext} from '../scripts/native-context.mjs';

test('native membership and order survive Snowball navigation and legacy recency without changing dispatch cwd',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-nav-'));
 try{
  const a=path.join(root,'a'),b=path.join(root,'b'),worktree=path.join(root,'worktree');for(const dir of [a,b,worktree])fs.mkdirSync(dir);
  const state={'local-projects':{a:{name:'Same',rootPaths:[a]},b:{name:'Same',rootPaths:[b]}},'project-order':['b','a'],'thread-project-assignments':{s1:{projectKind:'local',projectId:'a'}}};
  const projects=codexProjects(state);assert.equal(projects[0].root,b);
  const membership=codexSessionProject(state,'s1');assert.equal(membership.projectRoot,a);
  assert.equal(codexSessionProject(state,'unassigned'),null);
  const sessions={'snowball.codex':{Same:[{id:'s1',sessionKey:'one',cwd:worktree,...membership},{id:'s2',sessionKey:'two',cwd:a}]}};
  const catalog=nativeNavigation(sessions,{'snowball.codex':projects})['snowball.codex'];
  assert.equal(catalog.length,2);assert.equal(catalog[0].root,b);assert.equal(catalog[1].sessions.length,2);assert.equal(catalog[1].sessions[0].cwd,worktree);
  fs.writeFileSync(path.join(root,'navigation-history.v1.json'),JSON.stringify({records:{'s:two':Date.now()}}));
  const obsoleteHistory={order(){throw Error('Snowball recency must not affect native order');}};
  const ordered=nativeNavigation(sessions,{'snowball.codex':projects},obsoleteHistory)['snowball.codex'];
  assert.equal(ordered[0].root,b);assert.equal(ordered[1].sessions[0].id,'s1');
  const context=new ContextManager();context.navigationHistory=obsoleteHistory;reconcileNativeContext(context,sessions,{'snowball.codex':projects});
  context.selectProject(1);context.selectSession(1);const selected=context.getCurrentSession();context.openEditor('session');assert.equal(context.getCurrentSession(),selected);
  assert.deepEqual(context.getSessionsForCurrentScope().map(s=>s.id),['s1','s2']);
  reconcileNativeContext(context,{'snowball.codex':{Same:[sessions['snowball.codex'].Same[1],sessions['snowball.codex'].Same[0]]}},{'snowball.codex':projects});
  assert.equal(context.getCurrentSession(),selected);assert.equal(context.getSessionsForCurrentScope()[context.editorFocusIdx].id,selected.id);
  const legacy=new ContextManager(),scope=legacy.getScopeKey();
  const pending={id:'s1',sessionKey:'one',title:'Before regrouping',cwd:worktree},draft={id:'s-draft',title:'Unsubmitted'};
  legacy.projectsByScope[scope]=[{id:'old-main',name:'Same',path:a},{id:'old-tree',name:'Same',path:worktree}];
  legacy.sessionsByScope[scope+'/old-main']=[];legacy.sessionsByScope[scope+'/old-tree']=[pending,draft];legacy.selectedProjectIdx=1;
  legacy.voiceDraftText='unsent at original worktree';
  reconcileNativeContext(legacy,sessions,{'snowball.codex':projects});
  assert.equal(legacy.getCurrentSession(),pending);assert.equal(pending.voiceDraftText,'unsent at original worktree');
  assert.ok(legacy.getSessionsForCurrentScope().includes(draft));assert.equal(draft.cwd,worktree);
  assert.equal(legacy.getCurrentWorkspacePath(),worktree);
  const saved={schema:1,machine:'dev-pc',harness:'snowball.codex',project:'old-tree',session:'s1',view:'session',sessions:{[scope+'/old-tree']:[{id:'s1',voiceDraftText:'saved before upgrade',voiceSubmission:'sending'},{id:'s-draft',localDraft:true,title:'Unsubmitted'}],[scope+'/unavailable']:[{id:'s-lost',localDraft:true,title:'Keep unresolved',voiceDraftText:'never retarget'}]}};
  const restarted=new ContextManager();reconcileNativeContext(restarted,sessions,{'snowball.codex':projects});restarted.restoreUi(saved);
  assert.equal(restarted.getCurrentSession().id,'s1');assert.equal(restarted.voiceDraftText,'saved before upgrade');assert.equal(restarted.voiceSubmission,'unknown');
  assert.equal(restarted.getSessionsForCurrentScope().find(s=>s.id==='s-draft').cwd,worktree);
  assert.equal(restarted.snapshotUi().sessions[scope+'/unavailable'][0].voiceDraftText,'never retarget');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Codex append-only index deduplicates IDs and honors native manual order before native recency',()=>{
 const items=[{id:'a',updated_at:'2026-01-02',thread_name:'old'},{id:'b',updated_at:'2026-01-03'},{id:'a',updated_at:'2026-01-04',thread_name:'renamed'}];
 assert.deepEqual(orderCodexSessions(items,{}).map(s=>s.id),['a','b']);
 const state={'thread-project-assignments':{a:{projectId:'p'},b:{projectId:'p'}},'sidebar-project-thread-orders':{p:['b','a']}};
 const ordered=orderCodexSessions(items,state);assert.deepEqual(ordered.map(s=>s.id),['b','a']);assert.equal(ordered[1].thread_name,'renamed');
});

test('full transcripts publish once per actual scoped session, without source/ID alias duplication',()=>{
 const turns=[{role:'agent',text:'Complete content beyond 800 characters: '+ '한글'.repeat(1000)}];
 const sessions={'snowball.antigravity':{project:[{id:'native-id',sessionKey:'actual/scoped/key'}]}};
 const projected=nativeTranscriptProjection(sessions,{'native-id':turns,'antigravity/native-id':turns,'actual/scoped/key':turns,stale:[{text:'not in native navigation'}]});
 assert.deepEqual(Object.keys(projected),['actual/scoped/key']);assert.equal(projected['actual/scoped/key'],turns);
 assert.equal(projected['actual/scoped/key'][0].text,turns[0].text);
});
