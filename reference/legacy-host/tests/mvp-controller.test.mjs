import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MvpController } from '../dist/state/mvp-controller.js';
import { wrapText } from '../dist/state/context.js';
const press = keyId => ({ type:'key', keyId, isDown:true });
function setup() {
  const backend = new EventEmitter(), calls = [], answers = [];
  backend.start = async () => {}; backend.stop = async () => {};
  backend.request = async (method, params) => {
    calls.push({method,params});
    if (method === 'model/list') return {data:[]};
    if (method === 'thread/list') return {data:[{id:'s',cwd:process.cwd(),title:'한글 작업'}]};
    if (method === 'thread/read') return {thread:{turns:[]}};
    if (method === 'turn/start') return {turn:{id:'t',status:'inProgress'}};
    return {};
  };
  backend.respondServerRequest = (id, result) => answers.push({id,result});
  const voice = { start:async()=>{}, finish:async()=> '한글 README 수정', cancel:async()=>{}, close(){} };
  const desktop = { isConnected: false, connect: async () => false, disconnect: () => {}, sendMessageToThread: async () => ({}) };
  const controller = new MvpController(backend, voice, () => {}, undefined, desktop);
  return {controller, backend, voice, calls, answers, desktop};
}
test('offline controller blocks command dispatch and displays reconnect', async () => {
  const {controller,calls} = setup();
  await controller.input(press(20)); await controller.input(press(1));
  assert.equal(calls.length,0);
  assert.equal(controller.state().keys.find(k=>k.keyId===3).labelMain,'Reconnect');
});
test('real dispatcher capture -> review -> send once -> interrupt acknowledgement -> completed', async () => {
  const {controller:c,backend,calls} = setup(); await c.connect();
  await c.input(press(20)); assert.equal(c.draft.snapshot.phase,'recording');
  await c.input(press(16)); assert.equal(c.draft.snapshot.phase,'review');
  assert.equal(calls.filter(x=>x.method==='turn/start').length,0);
  await Promise.all([c.input(press(16)),c.input(press(16))]);
  assert.equal(calls.filter(x=>x.method==='turn/start').length,1);
  await c.input(press(4)); assert.equal(c.tasks.get('s').phase,'stopping');
  assert.deepEqual(calls.find(x=>x.method==='turn/interrupt').params,{threadId:'s',turnId:'t'});
  backend.emit('raw_event',{method:'turn/completed',params:{threadId:'s',turn:{id:'t',status:'interrupted'}}});
  assert.equal(c.tasks.get('s').phase,'interrupted');
});
test('recording start acknowledgement gates Done and cancellation discards late text', async () => {
  const {controller:c,voice} = setup(); await c.connect();
  let ready; voice.start = () => new Promise(r=>{ready=r;});
  const starting = c.input(press(20));
  assert.equal(c.state().topTitle,'Starting microphone');
  await c.input(press(16)); assert.equal(c.draft.snapshot.phase,'recording');
  ready(); await starting;
  let finish; voice.finish = () => new Promise(r=>{finish=r;});
  const transcribing = c.input(press(16)); await c.input(press(4));
  finish('late'); await transcribing;
  assert.equal(c.draft.snapshot.phase,'cancelled'); assert.equal(c.draft.snapshot.text,'');
});
test('failed Send retains text, blocks replay and Talk, and stays visible', async () => {
  const {controller:c,backend,calls} = setup(); await c.connect();
  await c.input(press(20)); await c.input(press(16));
  const request = backend.request;
  backend.request = async (m,p) => { if(m==='turn/start') throw new Error('lost ACK'); return request(m,p); };
  await c.input(press(16)); await c.input(press(20)); await c.input(press(16));
  assert.equal(c.draft.snapshot.phase,'unknown'); assert.equal(c.draft.snapshot.text,'한글 README 수정');
  assert.equal(c.state().topTitle,'Delivery unknown');
});
test('replacement is undoable and edits are used for actual Send', async () => {
  const {controller:c,calls,voice} = setup(); await c.connect();
  await c.input(press(20)); await c.input(press(16));
  voice.finish=async()=> 'replacement'; await c.input(press(20)); await c.input(press(16));
  await c.input(press(8)); assert.equal(c.draft.snapshot.text,'한글 README 수정');
  c.edit('수정된 초안'); await c.input(press(16));
  assert.equal(calls.find(x=>x.method==='turn/start').params.input[0].text,'수정된 초안');
});
test('approval Later can reopen; native numeric ID and accept decision are preserved', async () => {
  const {controller:c,backend,answers} = setup(); await c.connect();
  backend.emit('raw_request',{id:0,method:'item/commandExecution/requestApproval',params:{threadId:'s',turnId:'t',command:'echo test'}});
  await c.input(press(8)); assert.equal(c.state().viewMode,'session');
  await c.input(press(3)); assert.equal(c.state().viewMode,'question');
  await c.input(press(17)); await c.input(press(16));
  assert.deepEqual(answers,[{id:0,result:{decision:'accept'}}]);
});
test('multi-question answers retain question IDs and wait for explicit final submission', async () => {
  const {controller:c,backend,answers} = setup(); await c.connect();
  backend.emit('raw_request',{id:'ask',method:'item/tool/requestUserInput',params:{threadId:'s',questions:[
    {id:'a',question:'첫 질문',options:[{label:'One'}]}, {id:'b',question:'다음 질문',options:[{label:'Two'}]},
  ]}});
  await c.input(press(17)); await c.input(press(16)); assert.equal(answers.length,0);
  await c.input(press(17)); await c.input(press(16));
  assert.deepEqual(answers[0].result,{answers:{a:{answers:['One']},b:{answers:['Two']}}});
});
test('Korean wraps by rendered width, without surrogate splitting or dropped characters', () => {
  const text='한글 TOP 표시 README 😀 테스트 '.repeat(4);
  const lines=wrapText(text);
  assert.equal(lines.join(''),text);
  assert.ok(lines.every(l=>Array.from(l).reduce((n,c)=>n+(c.codePointAt(0)<128?1:2),0)<=50));
  const lines42=wrapText(text, 42);
  assert.ok(lines42.every(l=>Array.from(l).reduce((n,c)=>n+(c.codePointAt(0)<128?1:2),0)<=42));
});
test('K17 and K13 are enabled and cycle machine and harness in session mode', async () => {
  const {controller:c} = setup(); await c.connect();
  const keys = c.state().keys;
  const k17 = keys.find(k => k.keyId === 17);
  const k13 = keys.find(k => k.keyId === 13);
  assert.equal(k17.isDisabled, false);
  assert.equal(k13.isDisabled, false);
  assert.equal(k17.labelTop, 'MACHINE');
  assert.equal(k13.labelTop, 'HARNESS');
  const initialHarness = c.context.getCurrentHarness().id;
  await c.input(press(13));
  assert.notEqual(c.context.getCurrentHarness().id, initialHarness);
});
test('active writer conflict on thread/resume routes send through CodexDesktopClient', async () => {
  const {controller:c,backend,desktop} = setup();
  let desktopSent = null;
  desktop.isConnected = true;
  desktop.sendMessageToThread = async (threadId, prompt) => {
    desktopSent = { threadId, prompt };
    return { threadId };
  };
  await c.connect();
  await c.input(press(20)); await c.input(press(16));
  const origRequest = backend.request;
  backend.request = async (m, p) => {
    if (m === 'thread/resume') {
      throw new Error('thread-store conflict: thread s already has an active writer');
    }
    return origRequest(m, p);
  };
  await c.input(press(16));
  assert.deepEqual(desktopSent, { threadId: 's', prompt: '한글 README 수정' });
  assert.equal(c.draft.snapshot.phase, 'sent');
  assert.equal(c.draft.snapshot.text, '');
  assert.equal(c.tasks.get('s').phase, 'inProgress');
});
test('reconcile recognizes prompt inside functionCallOutput send_message_to_thread', async () => {
  const {controller:c,backend} = setup();
  await c.connect();
  await c.input(press(20)); await c.input(press(16));
  const origRequest = backend.request;
  backend.request = async (m, p) => {
    if (m === 'turn/start') throw new Error('network drop');
    return origRequest(m, p);
  };
  await c.input(press(16));
  assert.equal(c.draft.snapshot.phase, 'unknown');

  backend.request = async (m, p) => {
    if (m === 'thread/read') {
      return {
        thread: {
          turns: [
            {
              id: 'new-turn-1',
              status: 'completed',
              items: [
                {
                  type: 'functionCallOutput',
                  name: 'send_message_to_thread',
                  output: '<codex_delegation><input>한글 README 수정</input></codex_delegation>'
                },
                {
                  type: 'agentMessage',
                  text: '작업 완료'
                }
              ]
            }
          ]
        }
      };
    }
    return origRequest(m, p);
  };
  await c.input(press(16));
  assert.equal(c.draft.snapshot.phase, 'sent');
  assert.equal(c.draft.snapshot.text, '');
});

test('K1 creates a new thread and automatically selects and loads it', async () => {
  const {controller:c,backend} = setup();
  await c.connect();
  c.context.setSessionTurns([{ id: 'old-turn', userPrompt: 'old prompt', agentResponse: 'old resp' }]);
  assert.equal(c.context.currentTurns.length, 1);
  const origRequest = backend.request;
  backend.request = async (m, p) => {
    if (m === 'thread/start') {
      return { thread: { id: 'new-thread-id', createdAt: Date.now() } };
    }
    if (m === 'thread/read' && p.threadId === 'new-thread-id') {
      return { thread: { id: 'new-thread-id', turns: [] } };
    }
    return origRequest(m, p);
  };
  await c.input(press(1));
  assert.equal(c.context.getCurrentSession().id, 'new-thread-id');
  assert.equal(c.context.currentTurns.length, 0);
  assert.equal(c.tasks.get('new-thread-id').phase, 'idle');
});

test('send() on a fresh thread with no rollout proceeds to turn/start without throwing', async () => {
  const {controller:c,backend} = setup();
  await c.connect();
  await c.input(press(20)); await c.input(press(16));
  const origRequest = backend.request;
  let turnStarted = false;
  backend.request = async (m, p) => {
    if (m === 'thread/resume') {
      throw new Error('no rollout found for thread id s');
    }
    if (m === 'turn/start') {
      turnStarted = true;
      return { turn: { id: 'turn-fresh-1', status: 'inProgress' } };
    }
    return origRequest(m, p);
  };
  await c.input(press(16));
  assert.equal(turnStarted, true);
  assert.equal(c.draft.snapshot.phase, 'sent');
});

test('K4 discards unknown draft when delivery is unconfirmed', async () => {
  const {controller:c,backend} = setup();
  await c.connect();
  await c.input(press(20)); await c.input(press(16));
  const origRequest = backend.request;
  backend.request = async (m, p) => {
    if (m === 'turn/start') throw new Error('lost connection');
    return origRequest(m, p);
  };
  await c.input(press(16));
  assert.equal(c.draft.snapshot.phase, 'unknown');
  assert.equal(c.state().keys.find(k => k.keyId === 4).labelMain, 'Discard');
  await c.input(press(4));
  assert.equal(c.draft.snapshot.phase, 'cancelled');
  assert.equal(c.draft.snapshot.text, '');
});

