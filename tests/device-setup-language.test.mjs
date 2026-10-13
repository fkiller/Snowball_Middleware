import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps/desktop/device-setup.js',import.meta.url),'utf8');

function setupRenderer(){
  // Presentation-only DOM/IPC fixtures; no device operation or success is simulated.
  const element=()=>({textContent:'',value:'',children:[],listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(name,callback){this.listeners[name]=callback;}});
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  let failure='usb_setup_busy';
  const context=vm.createContext({document:{getElementById:node,createElement:element,documentElement:{}},window:{snowballSetup:{subscribe(){},snapshot:async()=>({profiles:[],language:'ko'}),action:async()=>{if(failure)throw Error(failure);return {profiles:[]};}}}});
  vm.runInContext(source,context);
  const language=value=>{node('language').value=value;node('language').listeners.change({target:node('language')});};
  return {context,node,language,setFailure:value=>{failure=value;}};
}

test('an existing action failure follows ko/en/ko changes without retrying the device operation',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  await vm.runInContext("action({action:'wifi'})",ui.context);
  assert.match(ui.node('notice').textContent,/기기 확인 또는 업데이트/);
  ui.language('en');assert.match(ui.node('notice').textContent,/A device check or update is in progress/);
  ui.language('ko');assert.match(ui.node('notice').textContent,/기기 확인 또는 업데이트/);
  ui.language('en');ui.setFailure('Error invoking remote method: usb_device_disconnected');
  await vm.runInContext("action({action:'wifi'})",ui.context);
  assert.match(ui.node('notice').textContent,/device connection is unavailable/);
  ui.language('ko');assert.match(ui.node('notice').textContent,/기기 연결을 확인하지 못했습니다/);
  ui.setFailure('private path C:\\secret\\password');
  await vm.runInContext("action({action:'wifi'})",ui.context);
  assert.match(ui.node('notice').textContent,/요청을 완료하지 못했습니다/);
  ui.language('en');assert.match(ui.node('notice').textContent,/The request failed/);
  assert.doesNotMatch(ui.node('notice').textContent,/secret|password/);
  ui.setFailure(null);await vm.runInContext("action({action:'wifi'})",ui.context);
  assert.equal(ui.node('notice').textContent,'');
});

test('incoming errors follow the selected language while background discovery stays quiet',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext("snapshot.code='usb_setup_busy';render()",ui.context);
  assert.match(ui.node('notice').textContent,/기기 확인 또는 업데이트/);
  ui.language('en');assert.match(ui.node('notice').textContent,/A device check or update is in progress/);
  vm.runInContext('snapshot.code=null;snapshot.checking=true;render()',ui.context);
  assert.equal(ui.node('notice').textContent,'');
  ui.language('ko');assert.equal(ui.node('notice').textContent,'');
});

test('current component hides update, differing images allow repair, and newer versions never downgrade',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext("selectedProfile='mk20';snapshot={release:{version:'0.2.6',components:{runtime:{version:'0.2.6'}}},capabilities:{}}",ui.context);
  const labels=extra=>vm.runInContext(`componentCard({port:'target',label:'MK20',component:'runtime',currentVersion:'0.2.6',writable:true,online:true,phase:'ready',${extra}},ui.ko).children.filter(c=>c.listeners.click).map(c=>c.textContent).join('|')`,ui.context);
  assert.equal(labels('imageMatch:true'),'');
  assert.match(labels('imageMatch:false'),/업데이트/);
  assert.equal(labels("currentVersion:'0.3.0',imageMatch:false"),'');
  const prepare=vm.runInContext("snapshot.release.components.qmk={version:'2026.9.18'};componentCard({port:'maintenance',label:'LAN maintenance',transport:'maintenance',component:'runtime',currentVersion:'0.2.6',writable:true,online:true,phase:'ready',nextStep:'maintenance',prepareSupported:true},ui.ko).children.find(c=>c.textContent==='QMK 업데이트 준비')",ui.context);
  assert.ok(prepare);assert.equal(prepare.disabled,true);
});

test('a failed unverified backup is distinguished from later failures in either language',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  const message=()=>vm.runInContext("operationFailure({failedPhase:'backup'},ui[language])",ui.context);
  assert.match(message(),/백업 읽기에 실패/);
  assert.match(message(),/펌웨어 쓰기는 시작하지 않았습니다/);
  ui.language('en');assert.match(message(),/firmware writing did not start/);
  const later=vm.runInContext("operationFailure({failedPhase:'flash'},ui[language])",ui.context);
  assert.doesNotMatch(later,/writing did not start/);
});
