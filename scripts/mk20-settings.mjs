// MK20 settings use the connected transport's actual registered skin catalog.
const slots = [19, 15, 11, 7, 3];
export function syncSkinSettings(context, transport) {
  context.settingsSkins = transport.listSkins();
  context.settingsSkinId = transport.getActiveSkin().id;
  if (!Number.isInteger(context.settingsSkinFocus)) context.settingsSkinFocus = Math.max(0, context.settingsSkins.findIndex(s => s.id === context.settingsSkinId));
  context.settingsSkinFocus = Math.max(0, Math.min(context.settingsSkins.length - 1, context.settingsSkinFocus));
}
export function skinSettingsView(context) {
  const skins = context.settingsSkins ?? [], focus = context.settingsSkinFocus ?? 0;
  const active = skins.find(s => s.id === context.settingsSkinId), selected = skins[focus];
  const start = Math.floor(focus / slots.length) * slots.length;
  const keys = Array.from({length:20}, (_, i) => ({keyId:i+1,labelMain:'',isDisabled:true}));
  const set = (id, value) => Object.assign(keys[id-1], {isDisabled:false}, value);
  set(17, {labelTop:'MACHINES',labelMain:'Change PC',isFilled:true});
  set(4, {labelTop:'SETTINGS',labelMain:'Close',isFilled:true});
  set(18, {labelTop:'SKIN',labelMain:'Next',isDisabled:!skins.length});
  set(14, {labelTop:'SKIN',labelMain:'Apply',isDisabled:!selected});
  set(10, {labelTop:'SKIN',labelMain:'First',isDisabled:!skins.length});
  slots.forEach((id, offset) => {
    const skin = skins[start+offset];
    if (skin) set(id, {labelTop:skin.id===context.settingsSkinId?'ACTIVE':`SKIN ${start+offset+1}`,labelMain:skin.name,labelSub:skin.id===context.settingsSkinId?'Selected':'Select',isFilled:skin.id===context.settingsSkinId,isFocused:start+offset===focus});
  });
  return {title:'Settings',subtitle:`Skin: ${active?.name ?? 'Unavailable'}`,lines:[`Active: ${active?.name ?? 'No skins registered'}`,`Focus ${skins.length?focus+1:0}/${skins.length}: ${selected?.name ?? 'Unavailable'}`,selected?.description ?? 'No registered device skins', 'Left knob: browse / click: apply', 'K18: Next | K10: First | K4: Close'],keys};
}
export function handleSkinSettingsInput(context, transport, input) {
  if (context.viewMode !== 'settings') return false;
  syncSkinSettings(context, transport);
  const skins = context.settingsSkins;
  const apply = index => {
    const skin = skins[index];
    if (skin) { transport.setSkin(skin.id); context.settingsSkinFocus=index; syncSkinSettings(context,transport); }
  };
  if (input.kind==='knob-turn' && input.knob==='left') {
    context.settingsSkinFocus=Math.max(0,Math.min(skins.length-1,context.settingsSkinFocus+input.delta));
  } else if (input.kind==='knob-click' && input.knob==='left') apply(context.settingsSkinFocus);
  else if (input.kind==='button' && input.pressed) {
    const key=Number(input.button.replace('key-',''));
    if (key===4 || key===17) { context.viewMode='session'; context.activeEditor='none'; }
    else if (key===18 && skins.length) apply((skins.findIndex(s=>s.id===context.settingsSkinId)+1)%skins.length);
    else if (key===14) apply(context.settingsSkinFocus);
    else if (key===10) apply(0);
    else if (slots.includes(key)) apply(Math.floor(context.settingsSkinFocus/slots.length)*slots.length+slots.indexOf(key));
  } else return false;
  context.updateReaderForCurrentSession();
  return true;
}
