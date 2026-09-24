import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../apps/supervisor/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function getAvailableHarnesses()'),source.indexOf('// Ensure valid active hierarchy'));
test('empty discovery never fabricates harnesses, projects or owned sessions',()=>{
 const ctx={snapshot:{}};vm.runInNewContext(helpers,ctx);
 assert.equal(ctx.getAvailableHarnesses().length,0);assert.equal(ctx.getProjectsForHarness('snowball.codex').length,0);assert.equal(ctx.getSessionsForProject('snowball.codex','any').length,0);
 ctx.snapshot={realSessions:{'snowball.codex':{Exact:[{readOnly:false,ownerId:'forged'}]}}};
 assert.equal(ctx.getSessionsForProject('snowball.codex','Exact')[0].readOnly,true);
 assert.equal(ctx.getSessionsForProject('snowball.codex','exact').length,0);
 assert.equal(ctx.getSessionsForProject('snowball.codex.evil','Exact').length,0);
});
test('registered local workspaces remain visible as project destinations across harnesses',()=>{
 const ctx={snapshot:{workspaceDetails:[{workspaceId:'ws_1234567890abcdef',displayName:'Snowball_Control',status:'ready'}],workspaceCandidates:[],sessionDetails:[]}};
 vm.runInNewContext(helpers,ctx);
 const projects=ctx.getProjectsForHarness('snowball.codex');
 assert.equal(projects.length,1);assert.equal(projects[0].displayName,'Snowball_Control');assert.equal(projects[0].local,true);
});
test('registered project identity groups observed native sessions without a duplicate path row',()=>{
 const id='ws_1234567890abcdef';
 const ctx={snapshot:{workspaceDetails:[{workspaceId:id,displayName:'Snowball_Control',status:'ready'}],workspaceCandidates:[],sessionDetails:[
  {sessionKey:'observed',harnessPluginId:'snowball.codex',cwd:'E:\\developments\\projects\\Snowball_Control',workspaceId:id,readOnly:true,ownerId:null},
  {sessionKey:'other',harnessPluginId:'snowball.other',cwd:'E:\\developments\\projects\\Snowball_Control',workspaceId:id,readOnly:true,ownerId:null}
 ]}};
 vm.runInNewContext(helpers,ctx);
 const projects=ctx.getProjectsForHarness('snowball.codex');
 assert.equal(projects.length,1);assert.equal(projects[0].id,id);
 assert.equal(ctx.getSessionsForProject('snowball.codex',id).length,1);
 assert.equal(ctx.getSessionsForProject('snowball.other',id).length,1);
 assert.equal(ctx.getSessionsForProject('snowball.codex','E:\\developments\\projects\\Snowball_Control').length,0);
});
test('unregistered provider project candidates group exact observed cwd without claiming registration',()=>{
 const root='E:\\other\\project';
 const ctx={snapshot:{workspaceDetails:[],workspaceCandidates:[{candidateId:'candidate',root,displayName:'Other',harness:{pluginId:'snowball.codex'}}],sessionDetails:[{sessionKey:'observed',harnessPluginId:'snowball.codex',cwd:root,readOnly:true,ownerId:null}]}};
 vm.runInNewContext(helpers,ctx);
 const projects=ctx.getProjectsForHarness('snowball.codex');
 assert.equal(projects.length,1);assert.equal(projects[0].id,root);assert.equal(projects[0].local,undefined);
 assert.equal(ctx.getSessionsForProject('snowball.codex',root).length,1);
});
test('same-named provider folders stay separate unless exact root is associated',()=>{
 const workspaceId='ws_1234567890abcdef';
 const root='E:\\\\other\\\\Snowball_Control';
 const ctx={snapshot:{workspaceDetails:[{workspaceId,displayName:'Snowball_Control',status:'ready'}],workspaceCandidates:[
  {candidateId:'different',root,displayName:'Snowball_Control',harness:{pluginId:'snowball.codex'}},
  {candidateId:'exact',root:'E:\\\\registered\\\\Snowball_Control',workspaceId,displayName:'Snowball_Control',harness:{pluginId:'snowball.codex'}}
 ],sessionDetails:[{sessionKey:'observed',harnessPluginId:'snowball.codex',cwd:root,readOnly:true,ownerId:null}]}};
 vm.runInNewContext(helpers,ctx);
 const projects=ctx.getProjectsForHarness('snowball.codex');
 assert.equal(projects.length,2);
 assert.equal(projects[0].id,workspaceId);
 assert.equal(projects[1].id,root);
 assert.equal(projects[1].displayName,'Snowball_Control · 발견됨');
 assert.equal(ctx.getSessionsForProject('snowball.codex',root).length,1);
});
test('overview counts only registered workspaces and their real associated sessions',()=>{
 const ctx={};vm.runInNewContext(helpers,ctx);
 const rows=ctx.getOverviewRows({workspaceDetails:[
  {workspaceId:'ws_aaaaaaaaaaaaaaaa',displayName:'First',status:'ready'},
  {workspaceId:'ws_bbbbbbbbbbbbbbbb',displayName:'Second',status:'missing'}
 ],sessionDetails:[
  {workspaceId:'ws_aaaaaaaaaaaaaaaa',harnessPluginId:'snowball.codex',readOnly:true,ownerId:null},
  {workspaceId:'ws_aaaaaaaaaaaaaaaa',harnessPluginId:'snowball.opencode',readOnly:false,ownerId:'owned'},
  {cwd:'C:\\other',harnessPluginId:'snowball.codex',readOnly:true,ownerId:null}
 ]});
 assert.equal(rows.length,2);
 assert.equal(rows[0].sessions,2);assert.equal(rows[0].readOnly,1);assert.equal(rows[0].harnesses.length,2);
 assert.equal(rows[1].sessions,0);assert.equal(rows[1].status,'missing');
});
test('provider, transcript and device strings never enter interpolated HTML sinks',()=>{
 assert.ok(!/\.innerHTML\s*=\s*`[^`]*\$\{/s.test(source));
 assert.ok(!source.includes('host_minime/'));assert.ok(!source.includes('Simulated response turn'));
});

test('production supervisor contains no sample conversation or simulated voice transcript', () => {
 assert.ok(!source.includes('default-codex-s01'));
 assert.ok(!source.includes('Simulation fallback'));
 assert.ok(!source.includes("const phrases ="));
});
