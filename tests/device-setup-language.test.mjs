import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps/desktop/device-setup.js',import.meta.url),'utf8');

function setupRenderer(){
  // Presentation-only DOM/IPC fixtures; no device operation or success is simulated.
  const element=()=>({textContent:'',value:'',dataset:{},children:[],listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(name,callback){this.listeners[name]=callback;}});
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  let failure='usb_setup_busy',subscription;
  const context=vm.createContext({document:{getElementById:node,createElement:element,documentElement:{}},window:{snowballSetup:{subscribe(callback){subscription=callback;},snapshot:async()=>({profiles:[],language:'ko'}),action:async()=>{if(failure)throw Error(failure);return {profiles:[]};}}}});
  vm.runInContext(source,context);
  const language=value=>{node('language').value=value;node('language').listeners.change({target:node('language')});};
  return {context,node,language,emit:state=>subscription(state),setFailure:value=>{failure=value;}};
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
  const runtime=vm.runInContext("componentCard({port:'maintenance',transport:'maintenance',component:'runtime',currentVersion:'0.2.6',writable:true,online:true,phase:'ready',nextStep:'maintenance',prepareSupported:true},ui.ko)",ui.context);
  assert.equal(runtime.children.some(c=>c.listeners.click),false,'QMK controls do not belong to the runtime version card');
});

test('MK20 sections fold only matching LAN identities and keep QMK consent and DOM stable during polling',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  const maintenance={port:'maintenance',label:'MK20 maintenance',transport:'maintenance',deviceId:'mk20-aabbccddeeff',address:'192.168.1.2',component:'runtime',currentVersion:'0.2.6',imageMatch:true,writable:true,online:true,phase:'ready',nextStep:'maintenance',prepareSupported:true};
  const lan={...maintenance,port:'lan',transport:'lan',writable:false,prepareSupported:false};
  const usb={port:'usb',label:'MK20 USB QMK',component:'qmk',currentVersion:null,writable:false,online:true,phase:'ready',nextStep:'enter-dfu'};
  const profile={profile:'mk20',name:'MK20',contract:2,components:['qmk','runtime'],release:{version:'0.2.6',changes:{},components:{runtime:{version:'0.2.6'},qmk:{version:'2026.9.18'}}},capabilities:{},devices:[maintenance,lan,usb]};
  const state={profiles:[profile],busy:false,checking:false};ui.emit(state);
  const sections=ui.node('devices').children;
  assert.deepEqual(sections.map(s=>s.dataset.component),['runtime','qmk']);
  assert.equal(sections[0].children.filter(c=>c.dataset.target).length,1);
  const preparation=sections[1].children.find(c=>c.className==='qmk-preparation');
  const check=preparation.children.find(c=>c.className==='check').children[0],button=preparation.children.find(c=>c.listeners.click);
  assert.equal(button.disabled,true);check.checked=true;check.listeners.change();assert.equal(button.disabled,false);
  ui.emit({...state,checking:true,profiles:[{...profile,checking:true,devices:profile.devices.map(d=>({...d,checked:Date.now(),wasPresent:true}))}]});
  assert.equal(ui.node('devices').children,sections,'read-only scan does not replace focused controls');
  assert.equal(check.checked,true);assert.equal(button.disabled,false);
  ui.emit({...state,checking:false});assert.equal(ui.node('devices').children,sections);
  ui.emit({...state,profiles:[{...profile,devices:[maintenance,usb]}]});assert.equal(ui.node('devices').children,sections,'expiry of folded LAN metadata does not replace visible controls');
  const mismatches=vm.runInContext(`visibleComponents(${JSON.stringify([maintenance,{...lan,address:'192.168.1.3'},{...lan,port:'foreign',deviceId:'mk20-112233445566'},usb])}).length`,ui.context);
  assert.equal(mismatches,4,'address alone, model and USB count never merge separate devices');
  const guide=sections[1].children.find(c=>c.className==='dfu-guide');
  assert.ok(guide.children.some(c=>c.textContent.includes('원형 노브가 아닙니다')));
  const buttons=vm.runInContext("componentCard({port:'dfu',label:'DFU',component:'qmk',currentVersion:'2026.9.18',online:true,writable:true,nextStep:'ready',phase:'ready'},ui.ko).children.filter(c=>c.listeners.click).map(c=>c.textContent).join('|')",ui.context);
  assert.equal(buttons,'업데이트 없이 키보드로 돌아가기','a matching DFU image can exit without reflashing');
});

test('DFU replaces mode entry and readback failure allows an explicit return without offering a write',async()=>{
  const ui=setupRenderer();await new Promise(resolve=>setImmediate(resolve));
  const maintenance={port:'maintenance',component:'runtime',transport:'maintenance',prepareSupported:true,online:true,currentVersion:'0.2.6',imageMatch:true,phase:'ready',nextStep:'maintenance',writable:true};
  const dfu={port:'dfu',label:'MK20 QMK DFU',component:'qmk',online:true,currentVersion:null,phase:'ready',nextStep:'qmk-readback',writable:false,returnSupported:true};
  const profile={profile:'mk20',name:'MK20',contract:2,components:['runtime','qmk'],devices:[maintenance,dfu],release:{version:'0.2.6',components:{runtime:{version:'0.2.6'},qmk:{version:'2026.9.18'}},changes:{}}};
  ui.emit({profiles:[profile],busy:false,checking:false});
  for(const language of ['ko','en','ko']){
    ui.language(language);
    const qmk=ui.node('devices').children.find(c=>c.dataset.component==='qmk');
    assert.ok(!qmk.children.some(c=>c.className==='qmk-preparation'),'DFU attachment supersedes entry controls');
    const card=qmk.children.find(c=>c.dataset.target==='dfu');
    const text=card.children.map(c=>c.textContent).join(' ');
    assert.match(text,language==='ko'?/DFU 모드 전환과 USB 접근은 확인/:/DFU mode and USB access are confirmed/);
    const buttons=card.children.filter(c=>c.listeners.click);
    assert.equal(buttons.length,1,'only the non-writing keyboard return is available');
    assert.match(buttons[0].textContent,language==='ko'?/업데이트 없이 키보드로 돌아가기/:/Return to keyboard without updating/);
    assert.doesNotMatch(text,/missing device-side updater|업데이트 수신기가 없는 경우/);
    const ready=vm.runInContext(`componentCard(${JSON.stringify({...dfu,nextStep:'ready',writable:true,imageMatch:false})},ui.${language})`,ui.context);
    assert.match(ready.children.map(c=>c.textContent).join(' '),language==='ko'?/키보드 펌웨어 전체 읽기를 마쳤으며/:/complete keyboard firmware was read/);
    const failed=vm.runInContext(`componentCard(${JSON.stringify({...dfu,nextStep:'ready',writable:true,phase:'failed',lastAction:'return-keyboard',code:'qmk_reboot_unconfirmed'})},ui.${language})`,ui.context);
    const notice=failed.children.find(c=>c.className==='progress');
    assert.match(notice.children.map(c=>c.textContent).join(' '),language==='ko'?/전원을 완전히 껐다가/:/Fully power MK20 off/);
  }
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
