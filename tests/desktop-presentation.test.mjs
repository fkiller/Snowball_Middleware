import test from 'node:test';
import assert from 'node:assert/strict';
import {AttentionNotifications,labels} from '../apps/desktop/presentation.mjs';

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
