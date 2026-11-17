import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from '../scripts/context-manager.mjs';
import { syncSkinSettings, handleSkinSettingsInput } from '../scripts/mk20-settings.mjs';
const native = process.env.SNOWBALL_TEST_MK20 === '1' ? await import('../../Snowball_Control/plugins/device-mk20/src/index.mjs') : undefined;
function setup() {
  const transport = new native.Mk20LabTransport({labEnabled:true,localAddress:'127.0.0.1',targetAddress:'127.0.0.1'});
  const context = new ContextManager(); context.viewMode='settings';
  syncSkinSettings(context,transport); context.updateReaderForCurrentSession();
  return {context,transport};
}
const button = id => ({kind:'button',button:`key-${id}`,pressed:true});
test('Settings uses actual plugin skins and applies the direct key mapping', {skip:!native}, () => {
  const {context,transport}=setup();
  const skins=transport.listSkins();
  assert.ok(skins.length>1);
  assert.equal(context.getDeviceState().keys.find(k=>k.keyId===15).labelMain,skins[1].name);
  handleSkinSettingsInput(context,transport,button(15));
  assert.equal(transport.getActiveSkin().id,skins[1].id);
  assert.equal(context.getDeviceState().keys.find(k=>k.keyId===15).labelTop,'ACTIVE');
  assert.ok(context.readerSubtitle.includes(skins[1].name));
});
test('Knob browse is distinct from apply; cycle and first operate on the registered catalog', {skip:!native}, () => {
  const {context,transport}=setup();const skins=transport.listSkins(),initial=transport.getActiveSkin().id;
  handleSkinSettingsInput(context,transport,{kind:'knob-turn',knob:'left',delta:1});
  assert.equal(transport.getActiveSkin().id,initial);
  handleSkinSettingsInput(context,transport,{kind:'knob-click',knob:'left'});
  assert.equal(transport.getActiveSkin().id,skins[1].id);
  handleSkinSettingsInput(context,transport,button(18));
  assert.equal(transport.getActiveSkin().id,skins[2].id);
  handleSkinSettingsInput(context,transport,button(10));
  assert.equal(transport.getActiveSkin().id,skins[0].id);
});
test('Newly registered plugin skins are discoverable on later pages without source edits', {skip:!native}, () => {
  const {context,transport}=setup();
  transport.registerSkin({...native.BUILTIN_MK20_SKINS[0],id:'settings-integration-skin',name:'Registered skin',isBuiltin:false});
  syncSkinSettings(context,transport);
  const index=context.settingsSkins.findIndex(s=>s.id==='settings-integration-skin');
  handleSkinSettingsInput(context,transport,{kind:'knob-turn',knob:'left',delta:index});
  const key=context.getDeviceState().keys.find(k=>k.labelMain==='Registered skin');
  assert.ok(key);handleSkinSettingsInput(context,transport,button(key.keyId));
  assert.equal(transport.getActiveSkin().id,'settings-integration-skin');
});
test('K4 closes without losing drafts, session selection or the selected plugin skin', {skip:!native}, () => {
  const {context,transport}=setup();context.voiceDraftText='보존할 초안';
  const session=context.getCurrentSession().id;
  handleSkinSettingsInput(context,transport,button(18));const skin=transport.getActiveSkin().id;
  handleSkinSettingsInput(context,transport,button(4));
  assert.equal(context.viewMode,'session');assert.equal(context.voiceDraftText,'보존할 초안');
  assert.equal(context.getCurrentSession().id,session);assert.equal(transport.getActiveSkin().id,skin);
});

test('Scoped Settings metadata fits the real wire encoder capacity', {skip:!native}, () => {
  const {context,transport}=setup();
  context.harnessPresentations={'codex':{}};
  const payload=context.toPreviewPayload();
  const encoded=native.encodeLegacyPreview({...payload,skinId:transport.getActiveSkin().id,controllerId:'ctl_0123456789abcdef',runId:'0123456789abcdef0123456789abcdef',leaseToken:'0123456789abcdef0123456789abcdef'},1);
  assert.ok(encoded.length>1400);assert.ok(encoded.length<=4096);
  const parsed=JSON.parse(encoded);assert.equal(parsed.keys.filter(k=>k.top?.startsWith('SKIN')||k.top==='ACTIVE').length,8);
});
