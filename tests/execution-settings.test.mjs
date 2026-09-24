import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from '../scripts/context-manager.mjs';
test('hardware context only offers the current provider catalog and resets effort on model/scope changes', () => {
 const context = new ContextManager(); assert.deepEqual(context.models, []); assert.deepEqual(context.getExecutionSettings(), {}); assert.deepEqual(context.accessLevels, []);
 context.setModelCatalog([{model:'actual-a',efforts:['low','high']},{model:'actual-b',efforts:['low']}]);
 context.models; context.selectedModelIdx = 0; context.selectedEffortIdx = 1;
 assert.deepEqual(context.getExecutionSettings(), {model:'actual-a',effort:'high'});
 context.selectedModelIdx = 1; assert.deepEqual(context.getExecutionSettings(), {model:'actual-b'});
 context.selectedHarnessIdx = 1; assert.deepEqual(context.models, []); assert.deepEqual(context.getExecutionSettings(), {});
});
