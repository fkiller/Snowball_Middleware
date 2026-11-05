import test from 'node:test';
import assert from 'node:assert/strict';
import {AttentionNotifications,labels,desktopJourneyGuide} from '../apps/desktop/presentation.mjs';

test('OS attention notifications react once to new actionable state and respect mute',()=>{
 const policy=new AttentionNotifications();
 const snapshot=(id,enabled=true)=>({settings:{notifications:enabled},decisions:id?[{decisionId:id,status:'pending'}]:[],commands:[]});
 assert.equal(policy.update(snapshot('old')),false);
 assert.equal(policy.update(snapshot('new')),true);
 assert.equal(policy.update(snapshot('new')),false);
 assert.equal(policy.update(snapshot('muted',false)),false);
 assert.equal(policy.update(snapshot('muted')),false);
 assert.equal(policy.update({...snapshot(null),commands:[{commandId:'failed',status:'unknown'}]}),true);
 assert.equal(labels('en').open,'Open Supervisor');assert.equal(labels('ko').open,'Supervisor 열기');
});

test('desktop guidance reports device setup availability and leaves remote pairing and multi-PC control pending',()=>{
 const available=desktopJourneyGuide('ko',true),unavailable=desktopJourneyGuide('en',false);
 assert.match(available.detail,/트레이의 기기 설정/);
 assert.match(available.detail,/페어링은 개발 중/);
 assert.match(available.detail,/통합 제어는 아직 제공되지 않습니다/);
 assert.match(unavailable.detail,/device setup is not currently available/);
 assert.match(unavailable.detail,/pairing is still in development/);
 assert.match(unavailable.detail,/Unified control across computers is not yet available/);
});
