import test from 'node:test';
import assert from 'node:assert/strict';
import {policiesFromSchema,listNativeAccess,nativeAccessParams} from '../scripts/native-access.mjs';
import {dispatchHarnessTurn} from '../scripts/harness-dispatch.mjs';
test('approval choices are read only from the installed protocol field schema',()=>{
  assert.deepEqual(policiesFromSchema({definitions:{Ignored:{type:'string',enum:['wrong']}}}),[]);
  const schema={properties:{approvalPolicy:{anyOf:[{$ref:'#/definitions/Policy'},{type:'null'}]}},definitions:{Policy:{oneOf:[{type:'string',enum:['native-one','native-two']},{type:'object',properties:{custom:{type:'string',enum:['not-a-choice']}}}]}}};
  assert.deepEqual(policiesFromSchema(schema),['native-one','native-two']);
});
test('unsupported providers never advertise or silently ignore an access override',async()=>{
  assert.deepEqual(await listNativeAccess('snowball.opencode'),[]);
  assert.deepEqual(await nativeAccessParams('snowball.codex',undefined),{});
  await assert.rejects(nativeAccessParams('snowball.antigravity','anything'),/unsupported_native_access/);
  await assert.rejects(dispatchHarnessTurn({harnessId:'snowball.opencode',access:'anything'}),/unsupported_native_access/);
});
