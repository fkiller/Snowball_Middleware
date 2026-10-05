import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../apps/supervisor/app.js',import.meta.url),'utf8');
const checkpoint=source.slice(source.indexOf('function checkpointController()'),source.indexOf('let selectedDevices'));
test('a reload immediately after typing or navigation observes this tab latest memory before network debounce',()=>{
  const memory=new Map();const tab={controllerReady:true,controllerTimer:undefined,webControllerId:'ctl_aaaaaaaaaaaaaaaa',activeHarness:'snowball.codex',activeProject:'actual',activeSessionKey:'actual-session',viewMode:'workspace',currentLanguage:'ko',promptDrafts:new Map([['actual-session','한글 unsent']]),executionBySession:new Map(),activeDraft:null,clearTimeout(){},setTimeout(){return 1;},sessionStorage:{setItem:(key,value)=>memory.set(key,value)}};
  vm.runInNewContext(checkpoint,tab);tab.checkpointController();
  const first=JSON.parse(memory.get('snowball_ui:'+tab.webControllerId));assert.equal(first.drafts[0][1],'한글 unsent');
  tab.activeSessionKey='another-session';tab.checkpointController();const latest=JSON.parse(memory.get('snowball_ui:'+tab.webControllerId));assert.equal(latest.activeSessionKey,'another-session');assert.equal(latest.drafts[0][0],'actual-session');
  const other={...tab,webControllerId:'ctl_bbbbbbbbbbbbbbbb',currentLanguage:'en',promptDrafts:new Map()};vm.runInNewContext(checkpoint,other);other.checkpointController();assert.equal(JSON.parse(memory.get('snowball_ui:'+other.webControllerId)).language,'en');assert.equal(JSON.parse(memory.get('snowball_ui:'+tab.webControllerId)).language,'ko');
});
test('shared tray settings use their own actual value and never change tab language implicitly',()=>{
  const handler=source.slice(source.indexOf('if(trayLanguage)trayLanguage.onchange'),source.indexOf('if(notifications)notifications.onchange'));
  assert.ok(!handler.includes('setLanguage'));assert.ok(source.includes("trayLanguage.value=snapshot?.settings?.language"));assert.ok(!source.includes('localStorage.setItem'));
});
