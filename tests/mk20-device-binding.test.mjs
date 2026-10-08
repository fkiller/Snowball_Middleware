import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceRegistry, formatSessionKey} from '../packages/core/dist/index.js';
import {connectMk20Device} from '../scripts/mk20-device-binding.mjs';

const peer = {targetAddress:'192.168.1.248', deviceId:'mk20-aabbccddeeff'};
test('MK20 reselection and failed startup reconnect one registered controller and retain its selection', () => {
  const registry = new DeviceRegistry();
  const first = connectMk20Device(registry, peer);
  const context = registry.getContext(first.binding.controllerId);
  const sessionKey = formatSessionKey({hostId:'host_'+'a'.repeat(32),harness:{pluginId:'snowball.codex',instanceId:'one'},nativeSessionId:'selected-session'});
  context.selectScope({sessionKey});
  first.release(); // Selection release or startup failing after registration.
  assert.equal(registry.list()[0].state,'offline');
  const second = connectMk20Device(registry, {...peer,targetAddress:'192.168.1.249'});
  assert.equal(second.reconnected,true);
  assert.equal(second.binding.deviceId,first.binding.deviceId);
  assert.equal(second.binding.controllerId,first.binding.controllerId);
  assert.equal(second.binding.revision,1);
  assert.equal(registry.list().length,1);
  assert.equal(registry.list()[0].state,'ready');
  assert.equal(registry.getContext(second.binding.controllerId).getSelection().sessionKey,sessionKey);
  second.release();
  const third = connectMk20Device(registry,peer);
  assert.equal(third.binding.revision,2);
  assert.equal(registry.list().length,1);
});

test('old MK20 disposal cannot disconnect its replacement or another device', () => {
  const registry = new DeviceRegistry();
  const first = connectMk20Device(registry,peer);
  const replacement = connectMk20Device(registry,peer);
  const other = connectMk20Device(registry,{...peer,deviceId:'mk20-001122334455'});
  first.release(); first.release();
  assert.equal(registry.list().find(d=>d.deviceId===replacement.binding.deviceId).state,'ready');
  replacement.release();
  assert.equal(registry.list().find(d=>d.deviceId===replacement.binding.deviceId).state,'offline');
  assert.equal(registry.list().find(d=>d.deviceId===other.binding.deviceId).state,'ready');
});

test('MK20 registration refuses invalid identities and keeps USB/other sources separate', () => {
  const registry = new DeviceRegistry();
  assert.throws(()=>connectMk20Device(registry,{...peer,deviceId:'mk20-name'}),/Invalid MK20/);
  assert.throws(()=>connectMk20Device(registry,{...peer,targetAddress:'8.8.8.8'}),/Invalid MK20/);
  const source={pluginId:'plugin.device-hid',instanceId:'mk20-qmk'};
  const generation=registry.beginScan(source);
  const candidate=registry.observe(source,generation,{nativeDeviceId:'usb',label:'USB',transport:'hid',capabilities:['button'],supported:true,verifiedIdentity:'mk20-mac-aa:bb:cc:dd:ee:ff'});
  registry.finishScan(source,generation,'ready');
  const usb=registry.register(candidate.candidateId,generation);
  const lan=connectMk20Device(registry,peer);
  assert.notEqual(lan.binding.controllerId,usb.binding.controllerId);
  lan.release();
  assert.equal(registry.list().find(d=>d.deviceId===usb.binding.deviceId).state,'ready');
});
