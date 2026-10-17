'use strict';
const ui={
  ko:{heading:'기기 설정',subtitle:'기기 연결부터 업데이트와 Wi-Fi 설정까지, 이 창에서 진행합니다.',journey:['01 · 기기 확인','02 · 백업 + 업데이트','03 · 자동 재기동','04 · Wi-Fi + LAN 검색'],usb:'USB 기기',refresh:'다시 확인',empty:'',release:'제공 펌웨어',scope:'미들웨어에 포함된 펌웨어 기준입니다. 업데이트 버튼을 누르기 전에는 플래시를 쓰지 않습니다. 빌드 도구가 없으면 다운로드에 시간이 걸릴 수 있습니다.',wifi:'PC의 Wi-Fi 가져오기',readWifi:'연결된 Wi-Fi 확인',noWifi:'가져올 Wi-Fi를 확인하지 못했습니다. 유선 연결, OS 접근 권한 또는 지원되지 않는 보안 방식일 수 있습니다. 아래 기기 안내를 따라 설정할 수 있습니다.',wifiBoundary:'기존에 저장된 Wi-Fi는 덮어쓰지 않습니다. 가져오기를 선택한 경우에만 OS에서 비밀번호를 읽어 선택한 기기에 전달하며 화면·로그에 표시하지 않습니다. ',guide:'기기 조작 따라하기',caption:'설정 위치를 설명하는 안내 그림입니다. 실시간 기기 화면이 아닙니다.',steps:[],faces:'',current:'현재 버전',unknown:'미확인',available:'제공 버전',unrecognized:'Snowball 펌웨어 응답이 없습니다. 공기계 또는 다른 펌웨어일 수 있습니다.',confirm:'',install:'백업 후 설치',update:'백업 후 업데이트',latest:'최신 제공 버전입니다.',newer:'기기의 버전이 더 높습니다. 자동 다운그레이드하지 않습니다.',saved:'기존 Wi-Fi 보존',connected:'연결됨',notConnected:'저장됨 · 현재 연결 안 됨',needsWifi:'기기에 저장된 Wi-Fi가 없습니다.',unknownWifi:'Wi-Fi 저장 여부는 새 펌웨어 적용 후 확인합니다.',migrate:'이 Wi-Fi 가져오기',unplugged:'USB 연결 끊김',backup:'전체 플래시 백업',complete:'기기 응답 확인 완료',failed:'작업이 완료되지 않았습니다. 백업이 생성되었다면 아래 위치에 보존됩니다. 연결과 드라이버를 확인한 뒤 다시 확인하세요.',phase:{checking:'기기 버전 확인 중…',identify:'기기와 저장 영역 확인 중…',backup:'전체 플래시 백업 중…', 'backup-verified':'백업 크기·해시 확인 완료',build:'펌웨어 준비 중… (누락된 빌드 도구 다운로드 포함)','verify-backup-settings':'쓰기 전 설정과 백업 대조 중…',flash:'펌웨어 업데이트 중… USB 연결을 유지하세요.', 'verify-settings':'기존 설정 저장 영역 검증 중…','verify-nvs':'기존 설정 저장 영역 검증 중…',reboot:'자동 재기동 및 새 펌웨어 응답 확인 중…',wifi:'OS 권한 확인 및 실제 Wi-Fi 연결 확인 중…',complete:'완료',failed:'확인 필요',ready:'준비됨'},busy:'다른 USB 확인/작업이 진행 중입니다. 잠시 후 다시 시도하세요.'},
  en:{heading:'Device setup',subtitle:'USB detection, firmware and Wi-Fi in one window.',journey:['01 · Identify','02 · Back up + update','03 · Reboot','04 · Wi-Fi + LAN discovery'],usb:'USB devices',refresh:'Check again',empty:'',release:'Included firmware',scope:'Uses firmware included with this middleware. Flash is written only after you choose Install / Update. Missing build tools may take time to download.',wifi:'Import this PC’s Wi-Fi',readWifi:'Read connected Wi-Fi',noWifi:'Connected Wi-Fi is unavailable. This PC may use Ethernet, require OS permission or use unsupported security. You can configure the device using the guide below.',wifiBoundary:'Saved device Wi-Fi is never replaced. The OS password is read only when you choose Import and sent to the selected device; it never appears in the window or logs.',guide:'Follow the physical controls',caption:'Illustration of the controls, not a live device screen.',steps:[],faces:'',current:'Installed',unknown:'Unknown',available:'Included',unrecognized:'No Snowball firmware response. This may be a blank device or other firmware.',confirm:'',install:'Back up and install',update:'Back up and update',latest:'Matches the included firmware.',newer:'The device has a newer version. No automatic downgrade.',saved:'Saved Wi-Fi retained',connected:'Connected',notConnected:'Saved · currently disconnected',needsWifi:'No network is saved on the device.',unknownWifi:'Saved Wi-Fi status will be checked after the firmware update.',migrate:'Import this Wi-Fi',unplugged:'USB disconnected',backup:'Full flash backup',complete:'Device response verified',failed:'The operation did not complete. Any backup created remains at the location below. Check USB and drivers, then check again.',phase:{checking:'Checking device firmware…',identify:'Checking ESP32 and flash capacity…',backup:'Backing up the entire flash…','backup-verified':'Backup size and hash verified',build:'Preparing firmware… (including missing build tools)','verify-backup-settings':'Checking settings against the backup before writing…',flash:'Updating firmware… Keep USB connected.','verify-settings':'Verifying retained settings…','verify-nvs':'Verifying retained settings…',reboot:'Rebooting and checking new firmware…',wifi:'Waiting for OS permission and real Wi-Fi association…',complete:'Complete',failed:'Needs attention',ready:'Ready'},busy:'A USB check or operation is in progress. Try again shortly.'}
};
const failureText={ko:{backup_incomplete:'전체 백업이 완료되지 않아 펌웨어 쓰기를 시작하지 않았습니다.',nvs_changed_before_flash_reboot_unconfirmed:'쓰기 전 설정이 백업과 달라 펌웨어를 쓰지 않았습니다. 기존 펌웨어 재기동 응답을 확인하지 못했습니다. USB 연결을 확인하세요.',nvs_changed_before_flash_no_write:'쓰기 전 설정이 백업과 달라 펌웨어를 쓰지 않았습니다. 기존 펌웨어로 재기동했습니다. 다시 확인한 뒤 새 전체 백업으로 진행하세요.',nvs_layout_incompatible:'기존 저장 영역 배치가 호환되지 않아 펌웨어를 쓰지 않았습니다. 전체 백업은 보존됩니다.',nvs_preservation_failed_restore_backup:'저장 영역 보존 검증에 실패했습니다. 보존된 전체 백업으로 복원이 필요합니다.',original_core_required:'선택한 기종과 실제 기기를 확인하세요.',wifi_changed_review_again:'PC의 연결된 Wi-Fi가 바뀌었습니다. 연결 정보를 다시 확인하세요.',wifi_connection_unconfirmed:'Wi-Fi 연결을 확인하지 못했습니다. 아래 기기 안내로 설정을 확인하세요.',wifi_key_permission_required:'OS가 비밀번호 읽기를 허용하지 않았습니다. 기기에서 직접 설정할 수 있습니다.',usb_device_changed:'USB 기기가 바뀌었습니다. 다시 확인한 뒤 진행하세요.'},en:{backup_incomplete:'Full backup did not complete; firmware was not written.',nvs_changed_before_flash_reboot_unconfirmed:'Settings changed before writing. No firmware was written; restart of the existing firmware is unconfirmed. Check USB.',nvs_changed_before_flash_no_write:'Settings changed before writing. No firmware was written; the existing firmware was restarted. Check again and start with a new full backup.',nvs_layout_incompatible:'Existing storage layout is incompatible. Firmware was not written; the full backup remains.',nvs_preservation_failed_restore_backup:'Storage preservation failed. Restore the retained full flash backup.',original_core_required:'Confirm the selected model matches the physical device.',wifi_changed_review_again:'The PC changed Wi-Fi networks. Review the connected network again.',wifi_connection_unconfirmed:'Wi-Fi association is unconfirmed. Follow the device guide below.',wifi_key_permission_required:'OS password access was denied. Configure Wi-Fi on the device instead.',usb_device_changed:'The USB device changed. Check it again before continuing.'}};
const $=id=>document.getElementById(id);let language='ko',snapshot={devices:[],release:{version:'…',changes:{}}},hubState={profiles:[]},selectedProfile,lastRequestedProfile,error=null,refreshPending=false;const approved=new Set(),declinedWifi=new Set(),manualNetworks=new Map();
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function relation(a,b){const x=String(a??'').split('.').map(Number),y=String(b??'').split('.').map(Number);if(x.length!==3||x.some(Number.isNaN))return 'unknown';for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?'older':'newer';return 'current';}
function needsUpdate(device,release){const status=relation(device.hello?.firmware??device.currentVersion,release.components?.[device.component]?.version??release.version);return status!=='newer'&&(status!=='current'||device.imageMatch===false);}
function needsReview(device,release){return device.online&&device.phase!=='failed'&&(device.pending===true||(!(device.component==='qmk'&&device.nextStep==='enter-dfu'&&!device.currentVersion)&&needsUpdate(device,release)));}
function backupProgressView(device){
  const box=element('div'),ko=language==='ko',value=device.backupProgress;
  if(value){
    const bar=element('progress');bar.max=value.bytes;bar.value=value.completedBytes;bar.setAttribute('aria-label',ko?'전체 플래시 읽기 진행률':'Full flash read progress');box.append(bar);
    const percent=Math.floor(value.completedBytes*100/value.bytes),mib=bytes=>(bytes/1048576).toFixed(1),minutes=Math.floor(value.elapsedSeconds/60),seconds=String(value.elapsedSeconds%60).padStart(2,'0');
    box.append(element('p',`${percent}% · ${mib(value.completedBytes)} / ${mib(value.bytes)} MiB · ${minutes}:${seconds}`));
  }
  box.append(element('p',ko?'USB로 전체 플래시를 읽고 있습니다. 16MB 기기는 수분 걸릴 수 있으며, 파일은 읽기가 끝난 뒤 생성됩니다. 읽기 100% 이후 크기·해시 검증까지 완료해야 백업이 확인됩니다. USB 연결을 유지하세요.':'Reading the entire flash over USB. A 16MB device can take several minutes; the file is created after reading finishes. After the read reaches 100%, size and hash checks must finish before the backup is verified. Keep USB connected.','muted'));
  return box;
}
function actionFailureCode(cause){return String(cause?.message??'').match(/(?:^|[\s:])([a-z][a-z0-9_]{0,79})$/)?.[1]??'';}
function operationFailure(device,t){
  const ko=language==='ko';
  if(device.code==='insufficient_runtime_storage')return ko?'런타임 파일시스템의 여유 공간이 부족합니다. 기존 런타임을 보존했으며 전체 백업은 아래 위치에 유지됩니다.':'The runtime filesystem has insufficient free space. The existing runtime is retained and the full backup remains at the location below.';
  if(device.code==='backup_read_failed_reboot_unconfirmed')return ko?'전체 플래시 백업 읽기에 실패했고 기존 펌웨어의 재기동도 확인하지 못했습니다. 펌웨어 쓰기는 시작하지 않았습니다. USB를 다시 연결한 뒤 기기를 확인하세요.':'Full flash backup reading failed, and the existing firmware did not confirm its restart. Firmware writing did not start. Reconnect USB and check the device.';
  if(device.code==='backup_read_failed')return ko?'전체 플래시 백업 읽기에 실패했습니다. 펌웨어 쓰기는 시작하지 않았으며 기존 펌웨어의 재기동을 확인했습니다. USB 연결을 확인한 뒤 다시 시도하세요.':'Full flash backup reading failed. Firmware writing did not start, and the existing firmware restarted successfully. Check USB before trying again.';
  if(device.failedPhase==='backup'&&!device.backup)return ko?'전체 플래시 백업 읽기에 실패했습니다. 이번 백업은 완료되지 않았으며 펌웨어 쓰기는 시작하지 않았습니다. USB 연결을 확인한 뒤 다시 시도하세요.':'Full flash backup reading failed. This backup did not complete and firmware writing did not start. Check USB before trying again.';
  return failureText[language][device.code]??t.failed;
}
function actionFailure(cause){
  // Electron adds an IPC prefix. Match only known codes; never display raw paths or secrets.
  const codes={
    usb_setup_busy:['기기 확인 또는 업데이트가 진행 중입니다. 완료될 때까지 기다려 주세요.','A device check or update is in progress. Wait for it to finish.'],
    usb_device_disconnected:['기기 연결을 확인하지 못했습니다. 다시 확인해 주세요.','The device connection is unavailable. Check again.'],
    setup_target_disconnected:['선택한 기기 연결이 사라졌습니다. 다시 확인해 주세요.','The selected device is no longer available. Check again.'],
    usb_operation_timed_out:['기기 조회 응답 시간이 초과되었습니다. 연결과 미들웨어 로그를 확인해 주세요.','The device request timed out. Check the connection and middleware log.'],
    usb_helper_unavailable:['기기 확인 도구를 실행할 수 없습니다. 미들웨어 설치 상태를 확인해 주세요.','Device tools could not start. Check the middleware installation.'],
    firmware_review_required:['현재 기기와 제공 버전을 다시 확인하고 업데이트에 동의해 주세요.','Review the device and included version, then confirm the update.'],
    installed_preparation_changed:['설치된 기기 도구가 변경되었습니다. 미들웨어를 다시 시작해 주세요.','Installed device tools changed. Restart the middleware.'],
    wifi_review_required:['가져올 Wi-Fi를 다시 확인해 주세요.','Review the Wi-Fi network to import.'],
    usb_setup_closed:['기기 설정이 종료되었습니다. 트레이에서 다시 열어 주세요.','Device setup has closed. Open it again from the tray.'],
    ...Object.fromEntries(Object.keys(failureText.en).map(code=>[code,[failureText.ko[code],failureText.en[code]]]))
  };
  const code=actionFailureCode(cause);
  return codes[code]?.[language==='ko'?0:1]??(language==='ko'?'요청을 완료하지 못했습니다. 기기 상태와 미들웨어 로그를 확인해 주세요.':'The request failed. Check the device status and middleware log.');
}
async function action(request){
  if(request.action==='refresh'&&refreshPending)return;
  error=null;if(request.action==='refresh')refreshPending=true;render();
  try{accept(await window.snowballSetup.action({...request,profile:selectedProfile}));}
  catch(cause){error={message:actionFailureCode(cause)};}
  finally{if(request.action==='refresh')refreshPending=false;render();}
}
function render(){
  const base=ui[language],p=snapshot.presentation?.[language],t={...base,usb:snapshot.contract===2?(language==='ko'?'연결된 기기 / 저장 매체':'Connected devices / storage'):base.usb,journey:p?.journey??base.journey,empty:p?.connection??'',confirm:p?.confirmation??'',steps:p?.steps??[],faces:p?.note??''};
  $('profile-label').textContent=language==='ko'?'기기 종류':'Device type';
  $('profile').replaceChildren(...hubState.profiles.map(profile=>{const option=element('option',profile.name);option.value=profile.profile;return option;}));$('profile').value=selectedProfile??'';
  $('detected-profiles').replaceChildren(...hubState.profiles.filter(p=>p.devices.some(d=>d.online||d.phase==='awaiting-device')).map(profile=>{
    const devices=(profile.contract===2?visibleComponents(profile.devices):profile.devices).filter(d=>d.online||d.phase==='awaiting-device');
    const review=devices.some(d=>needsReview(d,profile.release));
    const label=profile.name+' · '+(language==='ko'?(review?'업데이트 확인':'연결됨'):(review?'Review update':'Detected'));
    const button=element('button',label,'secondary');button.setAttribute('aria-pressed',String(profile.profile===selectedProfile));
    button.addEventListener('click',()=>{$('profile').value=profile.profile;$('profile').dispatchEvent(new Event('change'));});return button;
  }));
  $('wifi-section').hidden=!snapshot.capabilities?.wifiImport;document.documentElement.lang=language;$('heading').textContent=t.heading;$('subtitle').textContent=t.subtitle;
  for(const [id,value]of Object.entries({'usb-title':t.usb,refresh:t.refresh,'release-title':`${t.release} · ${snapshot.release.version}`,'scope':t.scope,'wifi-title':t.wifi,'read-wifi':t.readWifi,'wifi-boundary':t.wifiBoundary,'guide-title':t.guide,'guide-caption':t.caption,'faces-note':t.faces}))$(id).textContent=value;
  if(snapshot.contract===2)$('release-title').textContent=language==='ko'?'제공 개선 사항':'Included changes';
  $('journey').replaceChildren(...t.journey.map(s=>element('span',s)));$('changes').replaceChildren(...(snapshot.release.changes[language]??[]).map(s=>element('li',s)));
  renderGuide(p);$('notice').textContent=error?actionFailure(error):snapshot.code?actionFailure(new Error(snapshot.code)):'';
  $('network').textContent=snapshot.network?`Wi-Fi · ${snapshot.network.ssid}${snapshot.network.enterprise?' · Enterprise (manual setup)':''}`:t.noWifi;
  $('refresh').disabled=!!snapshot.busy||refreshPending;$('read-wifi').disabled=!!snapshot.busy;
  if(refreshPending)$('refresh').textContent=language==='ko'?'다시 확인 중…':'Checking again…';
  if(snapshot.contract===2){$('devices').replaceChildren(...componentSections(t));return;}
  const cards=snapshot.devices.map(device=>{
    const card=element('article',undefined,'device');card.append(element('strong',`${device.port} · ${device.hello?.deviceId??device.label}`));
    if(!device.online)card.append(element('p',t.unplugged,'error'));
    const versions=element('div',undefined,'versions');
    for(const [label,version]of [[t.current,device.hello?.firmware??t.unknown],[t.available,snapshot.release.version]]){if(versions.childElementCount)versions.append(element('span','→','arrow'));const box=element('div',undefined,'version');box.append(element('small',label),element('strong',version));versions.append(box);}card.append(versions);
    const status=relation(device.hello?.firmware,snapshot.release.version);
    if(!device.hello)card.append(element('p',t.unrecognized));
    if(status==='current'||status==='newer')card.append(element('p',status==='current'?t.latest:t.newer,'muted'));
    if(device.hello?.wifiConfigured===true)card.append(element('p',`${t.saved} · ${device.hello.wifiSsid??''} · ${device.hello.wifiConnected?t.connected:t.notConnected}`));
    else card.append(element('p',device.hello?.wifiConfigured===false?t.needsWifi:t.unknownWifi));
    const actions=element('div',undefined,'actions');
    if(['older','unknown'].includes(status)){
      const check=element('label',undefined,'check'),input=element('input');input.type='checkbox';input.checked=approved.has(selectedProfile+device.port);input.disabled=!!snapshot.busy;check.append(input,element('span',t.confirm));card.append(check);
      let importWifi=null;if(snapshot.capabilities?.wifiImport&&snapshot.network&&!snapshot.network.enterprise&&device.hello?.wifiConfigured!==true){const label=element('label',undefined,'check');importWifi=element('input');importWifi.type='checkbox';importWifi.checked=!declinedWifi.has(selectedProfile+device.port);importWifi.disabled=!!snapshot.busy;importWifi.addEventListener('change',()=>{importWifi.checked?declinedWifi.delete(selectedProfile+device.port):declinedWifi.add(selectedProfile+device.port);});label.append(importWifi,element('span',language==='ko'?"저장된 Wi-Fi가 없으면 업데이트 후 PC Wi-Fi("+snapshot.network.ssid+" )를 가져옵니다.":"If no Wi-Fi is saved, import this PC’s network ("+snapshot.network.ssid+" ) after the update."));card.append(label);}const install=element('button',device.hello?t.update:t.install);const updateEnabled=()=>{install.disabled=!input.checked||snapshot.busy||!device.online||device.phase==='checking';};input.addEventListener('change',()=>{input.checked?approved.add(selectedProfile+device.port):approved.delete(selectedProfile+device.port);updateEnabled();});updateEnabled();install.addEventListener('click',()=>action({action:'install',port:device.port,version:snapshot.release.version,confirmBoard:true,migrateWifi:importWifi?.checked===true,...(importWifi?.checked?{ssid:snapshot.network.ssid}:{})}));actions.append(install);
    }
    if(snapshot.capabilities?.wifiImport&&device.hello?.usbSetup===true&&device.hello.wifiConfigured===false){const migrate=element('button',t.migrate);migrate.disabled=!snapshot.network||snapshot.network.enterprise||snapshot.busy||!device.online;migrate.addEventListener('click',()=>action({action:'migrate',port:device.port,ssid:snapshot.network.ssid}));actions.append(migrate);}
    card.append(actions);
    if(!['ready',undefined].includes(device.phase)){const progress=element('div',undefined,'progress');progress.setAttribute('role','status');progress.append(element('p',t.phase[device.phase]??device.phase));if(device.phase==='backup')progress.append(backupProgressView(device));if(device.phase==='failed'){progress.append(element('p',`${operationFailure(device,t)} (${device.code??'usb_operation_failed'})`,'error'));if(t.phase[device.failedPhase])progress.append(element('p',(language==='ko'?'실패 단계: ':'Failed during: ')+t.phase[device.failedPhase],'muted'));}if(device.backup)progress.append(element('p',`${t.backup}: ${device.backup}`,'muted'));card.append(progress);}
    return card;
  });$('devices').replaceChildren(...(cards.length?cards:[element('p',t.empty,'muted')]));
}

function visibleComponents(devices){
  // Only verified native maintenance identity plus address can fold LAN metadata.
  // USB keyboard identity is deliberately never inferred from this relationship.
  return devices.filter(d=>!(d.transport==='lan'&&d.deviceId&&d.address&&devices.some(m=>m.online&&m.transport==='maintenance'&&m.deviceId===d.deviceId&&m.address===d.address)));
}
function componentSections(t){
  const ko=language==='ko',devices=visibleComponents(snapshot.devices),sections=[];
  for(const component of [...(snapshot.components??[])].sort((a,b)=>(b==='runtime')-(a==='runtime'))){
    const records=devices.filter(d=>d.component===component),dfuPresent=records.some(d=>d.online&&d.nextStep!=='enter-dfu'),preparers=component==='qmk'&&!dfuPresent?devices.filter(d=>d.component==='runtime'&&d.transport==='maintenance'&&d.prepareSupported&&d.online&&d.phase!=='awaiting-device'):[];
    if(!records.length&&!preparers.length)continue;
    const section=element('section',undefined,'component-section');section.dataset.component=component;
    section.append(element('h3',component==='qmk'?(ko?'키보드 펌웨어 · QMK':'Keyboard firmware · QMK'):(ko?'화면·통신 소프트웨어 · 런타임':'Display and connection software · Runtime')));
    section.append(element('p',component==='qmk'?(ko?'사각 키와 노브의 입력을 처리합니다. 런타임과 버전 체계가 다릅니다.':'Handles square keys and knobs. Its version is independent of the runtime.'):(ko?'화면, 네트워크 연결과 하네스 제어를 담당합니다.':'Runs the display, networking and harness controls.'),'muted'));
    records.forEach(d=>section.append(componentCard(d,t)));
    preparers.forEach(d=>section.append(qmkPreparation(d)));
    if(component==='qmk'&&(preparers.length||records.some(d=>d.nextStep==='enter-dfu')))section.append(dfuGuide());
    sections.push(section);
  }
  return sections.length?sections:[element('p',t.empty,'muted')];
}
function dfuGuide(){
  const ko=language==='ko',details=element('details',undefined,'dfu-guide');
  details.append(element('summary',ko?'버튼으로 전환할 수 없을 때: 수동 DFU 진입':'If automatic entry is unavailable: manual DFU entry'));
  details.append(element('p',ko?'DFU는 키보드 펌웨어를 읽고 업데이트하는 모드입니다. 20개 사각 화면 키 중 맨 윗줄 맨 왼쪽 키를 사용합니다. 위쪽 원형 노브가 아닙니다.':'DFU is the mode for reading and updating keyboard firmware. Use the leftmost square display key in the top row of 20 keys, below the round knobs. Do not press a knob.'));
  const grid=element('div',undefined,'dfu-key-grid');grid.setAttribute('role','img');grid.setAttribute('aria-label',ko?'4행 5열 사각 키 배열의 왼쪽 위 키':'Top-left key in the four-row, five-column square key grid');
  for(let i=0;i<20;i++)grid.append(element('span',i===0?'▼':'',i===0?'dfu-key selected':'dfu-key'));details.append(grid);
  details.append(element('p',ko?'1. MK20 전원을 끕니다. 2. 표시한 사각 키를 누른 채 MK20 전원을 켭니다. 3. PC에 USB를 연결한 상태로 이 창에서 DFU 연결을 확인합니다. 별도 전원을 쓰는 경우 USB 케이블만 다시 꽂아서는 전원이 꺼지지 않을 수 있습니다.':'1. Turn MK20 off. 2. Hold the marked square key while powering MK20 on. 3. Keep USB connected to this PC and check for a DFU connection here. With a separate power supply, reconnecting USB alone may not power-cycle the keyboard.'));
  return details;
}
function qmkPreparation(device){
  const ko=language==='ko',key=selectedProfile+device.port+':qmk',card=element('div',undefined,'qmk-preparation');
  card.append(element('strong',ko?'키보드 버전 확인을 위한 모드 전환':'Enter firmware check mode'));
  card.append(element('p',ko?'USB를 연결해 둔 채 아래에서 동의하고 진행하세요. 선택한 MK20의 키보드를 DFU로 전환한 뒤 실제 이미지를 비교합니다. 업데이트가 필요하면 별도의 백업 후 업데이트 버튼이 나타납니다.':'Keep this MK20 connected by USB, then confirm below. Its keyboard enters DFU so the installed image can be compared. If needed, a separate back up and update action appears.','muted'));
  card.append(element('p',(ko?'대상 MK20: ':'Target MK20: ')+(device.deviceId??device.label)+(device.address?' · '+device.address:''),'muted'));
  const check=element('label',undefined,'check'),confirm=element('input');confirm.type='checkbox';confirm.checked=approved.has(key);confirm.disabled=snapshot.busy;
  check.append(confirm,element('span',ko?'위 MK20의 USB를 이 PC에 연결했으며 키보드 모드 전환에 동의합니다.':'This MK20 is connected to this PC by USB. Allow its keyboard to enter firmware check mode.'));card.append(check);
  const button=element('button',ko?'키보드 펌웨어 확인 모드로 전환':'Enter keyboard firmware check mode');
  const enabled=()=>{button.disabled=!confirm.checked||snapshot.busy;};confirm.addEventListener('change',()=>{confirm.checked?approved.add(key):approved.delete(key);enabled();});enabled();
  button.addEventListener('click',()=>action({action:'prepare',port:device.port,version:snapshot.release.version,confirmBoard:true}));card.append(button);
  card.append(element('p',ko?'모드를 바꾸는 단계이며 펌웨어는 아직 쓰지 않습니다. 일반 키보드 입력이 잠시 중단됩니다.':'This step changes mode without writing firmware. Normal keyboard input stops temporarily.','muted'));
  if(device.lastAction==='prepare'&&device.phase==='identify')card.append(element('p',ko?'키보드의 DFU 연결을 확인하고 있습니다…':'Checking for the keyboard DFU connection…','progress'));
  if(device.lastAction==='prepare'&&device.phase==='failed')card.append(element('p',ko?'DFU 연결을 확인하지 못했습니다. 펌웨어는 쓰지 않았습니다. 아래 수동 DFU 안내를 확인하세요.':'DFU attachment was not confirmed. Firmware was not written. See the manual DFU instructions below.','error'));
  return card;
}
function componentCard(device,t){
  const ko=language==='ko',key=selectedProfile+device.port,component=snapshot.release.components[device.component];
  const card=element('article',undefined,'device');card.dataset.target=device.port;
  const connection=device.transport==='maintenance'?(ko?'LAN 연결 · 관리 권한 확인됨':'LAN connected · maintenance authorized'):device.transport==='lan'?(ko?'LAN 연결 · 상태 조회':'LAN connected · status only'):device.component==='qmk'?(device.nextStep==='enter-dfu'?(ko?'USB 키보드 연결됨':'USB keyboard connected'):'USB · DFU'):(ko?'USB / 복구 매체':'USB / recovery storage');
  card.append(element('strong',connection));
  if(device.deviceId)card.append(element('p',device.deviceId+(device.address?' · '+device.address:''),'muted'));
  else card.append(element('p',device.label,'muted'));
  const versions=element('div',undefined,'versions');
  for(const [label,version]of [[t.current,device.currentVersion??t.unknown],[t.available,component?.version??t.unknown]]){if(versions.childElementCount)versions.append(element('span','→','arrow'));const box=element('div',undefined,'version');box.append(element('small',label),element('strong',version));versions.append(box);}card.append(versions);
  const guidance={
    'enter-dfu':ko?'일반 USB 키보드 모드에서는 정확한 설치 버전을 읽을 수 없습니다. 미확인은 구버전이라는 뜻이 아닙니다. 아래 확인 모드 전환 또는 수동 DFU 안내를 사용하세요.':'Normal USB keyboard mode cannot report the exact installed version. Unknown does not mean outdated. Use firmware check mode below or the manual DFU instructions.',
    'usb-driver':ko?'DFU 읽기 또는 드라이버 접근을 확인하지 못했습니다. 백업이 가능해질 때까지 쓰지 않습니다.':'DFU readback or driver access is unavailable. Writing is blocked until backup is possible.',
    'qmk-readback':ko?'DFU 모드 전환과 USB 접근은 확인했지만 키보드 펌웨어를 끝까지 읽지 못했습니다. 펌웨어는 쓰지 않았습니다. 다시 확인하거나 아래 버튼으로 일반 키보드 모드로 돌아갈 수 있습니다.':'DFU mode and USB access are confirmed, but the complete keyboard firmware could not be read. Firmware was not written. Check again or return to keyboard mode below.',
    'usb-connect':ko?'LAN에서 상태를 확인했습니다. 업데이트에는 허용된 관리 연결이 필요합니다.':'Status was read over LAN. Updating requires an authorized maintenance connection.',
    'maintenance':ko?'기존에 허용된 LAN 관리 연결을 확인했습니다. SD 카드를 기기에 둔 채 런타임 파티션 전체를 백업하고 제공 파일만 업데이트합니다. 기존 Wi-Fi·PC 등록을 보존하며 재부팅 후 실제 실행 파일을 확인합니다.':'An existing authorized LAN maintenance connection is verified. Leave the SD card in the device. The full runtime partition is backed up before updating the included files; saved Wi-Fi and PC registrations are preserved, and running images are checked after reboot.',
    'usb-bootstrap':ko?'USB 업데이트 수신기 응답을 기다립니다. 부팅 중일 수 있어 자동으로 다시 확인합니다. 수신기가 없는 구 펌웨어는 최초 이관이 필요하며 응답 전에는 쓰지 않습니다.':'Waiting for the USB update receiver; startup is retried automatically. Legacy firmware without the receiver needs initial migration. No writes before a valid response.',
    'insert-card':ko?'복구용 카드 리더 연결입니다. 일반 업데이트는 기기에 SD 카드를 둔 채 USB로 진행합니다.':'Recovery card-reader attachment. Normal updates use USB with the SD card left in the device.',
    'return-card':ko?'안전하게 카드를 분리해 MK20에 돌려 넣고 전원을 연결하세요. 부팅 확인은 실제 실행 중인 버전·해시를 LAN에서 확인합니다.':'Safely remove the card, return it to MK20 and power it on. Check boot verifies actual running version/hashes over LAN.'
  };if(guidance[device.nextStep]&&!(device.nextStep==='maintenance'&&!needsUpdate(device,snapshot.release)))card.append(element('p',guidance[device.nextStep]));
  if(device.wifiConfigured===true)card.append(element('p',t.saved));
  const status=relation(device.currentVersion,component?.version),updateNeeded=needsUpdate(device,snapshot.release);
  if(device.imageMatch===false)card.append(element('p',device.component==='qmk'?(ko?'키보드 펌웨어 전체 읽기를 마쳤으며 제공 이미지와 다릅니다. 기존 버전 번호는 식별할 수 없습니다. 아래에서 백업 후 설치를 선택할 수 있습니다.':'The complete keyboard firmware was read and differs from the included image. Its existing version number cannot be identified. You can choose back up and install below.'):(ko?'설치 이미지가 제공 빌드와 다릅니다. 업데이트 확인이 필요합니다.':'Installed images differ from the included build. Review the update.'),'muted'));
  if((status==='current'&&device.imageMatch!==false)||status==='newer')card.append(element('p',status==='current'?t.latest:t.newer,'muted'));
  if(device.writable&&device.online&&device.phase!=='awaiting-device'&&updateNeeded){
    const check=element('label',undefined,'check'),confirm=element('input');confirm.type='checkbox';confirm.checked=approved.has(key);confirm.disabled=snapshot.busy;check.append(confirm,element('span',t.confirm));card.append(check);
    let importBox,manual=manualNetworks.get(key)??{enabled:false,ssid:'',password:''};
    if(device.component==='runtime'&&device.wifiConfigured===false){
      if(snapshot.network&&!snapshot.network.enterprise){const label=element('label',undefined,'check');importBox=element('input');importBox.type='checkbox';importBox.checked=!manual.enabled&&!declinedWifi.has(key);importBox.disabled=snapshot.busy;label.append(importBox,element('span',(ko?'저장된 Wi-Fi가 없으면 가져오기: ':'Import only when no Wi-Fi is saved: ')+snapshot.network.ssid));importBox.addEventListener('change',()=>{importBox.checked?declinedWifi.delete(key):declinedWifi.add(key);});card.append(label);}
      if(snapshot.capabilities.manualWifi){
        const label=element('label',undefined,'check'),enable=element('input');enable.type='checkbox';enable.checked=manual.enabled;enable.disabled=snapshot.busy;label.append(enable,element('span',ko?'Wi-Fi 직접 입력':'Enter Wi-Fi manually'));card.append(label);
        const fields=element('div');fields.hidden=!manual.enabled;
        const ssid=element('input'),password=element('input');ssid.type='text';ssid.placeholder='SSID';ssid.value=manual.ssid;ssid.setAttribute('aria-label','SSID');password.type='password';password.placeholder=ko?'비밀번호 (개방형 네트워크는 비움)':'Password (empty for open network)';password.setAttribute('aria-label',ko?'Wi-Fi 비밀번호':'Wi-Fi password');password.autocomplete='off';password.value=manual.password;
        ssid.disabled=password.disabled=snapshot.busy;
        ssid.addEventListener('input',()=>{manual.ssid=ssid.value;manualNetworks.set(key,manual);});password.addEventListener('input',()=>{manual.password=password.value;manualNetworks.set(key,manual);});
        enable.addEventListener('change',()=>{manual.enabled=enable.checked;manualNetworks.set(key,manual);fields.hidden=!manual.enabled;if(importBox)importBox.checked=!manual.enabled&&!declinedWifi.has(key);});fields.append(ssid,password);card.append(fields);
      }
    }
    const install=element('button',device.transport==='maintenance'?(ko?'백업 후 런타임 업데이트':'Back up and update runtime'):device.currentVersion?t.update:t.install);const enabled=()=>{install.disabled=!confirm.checked||snapshot.busy;};confirm.addEventListener('change',()=>{confirm.checked?approved.add(key):approved.delete(key);enabled();});enabled();
    install.addEventListener('click',()=>{
      const network=manual.enabled?{ssid:manual.ssid,password:manual.password}:undefined;
      const request={action:'install',port:device.port,version:snapshot.release.version,confirmBoard:true,migrateWifi:importBox?.checked===true&&!network,...(importBox?.checked&&!network?{ssid:snapshot.network.ssid}:{}),...(network?{network}:{})};
      manualNetworks.delete(key);if(network){manual.password='';for(const input of card.querySelectorAll('input[type=password]'))input.value='';}
      void action(request);
    });card.append(install);
  }
  if(!device.writable&&device.online&&device.phase!=='awaiting-device'&&status!=='newer'&&device.nextStep!=='enter-dfu'){
    const reason=device.transport==='lan'?(ko?'LAN 발견 · 관리 연결 확인 필요':'LAN discovered · maintenance connection required'):
      device.nextStep==='enter-dfu'?(ko?'키보드 USB 연결됨 · 업데이트에는 DFU 모드 필요':'Keyboard USB connected · DFU required to update'):
      ['usb-driver','qmk-readback'].includes(device.nextStep)?(ko?'DFU 백업 접근 불가':'DFU backup access unavailable'):
      device.nextStep==='usb-bootstrap'?(ko?'USB 업데이트 수신기 응답 없음':'USB updater did not respond'):
      (ko?'런타임 USB 연결 미확인':'Runtime USB connection not confirmed');
    card.append(element('p',reason,'muted'));
    if(device.component!=='qmk')card.append(element('p',device.transport==='lan'?(ko?'LAN 발견만으로 업데이트 권한이 생기지 않습니다. 관리 연결을 확인하면 이 런타임 항목에서 업데이트할 수 있습니다.':'LAN discovery does not grant update access. Updating becomes available here once maintenance access is verified.'):
      (ko?'다시 확인은 연결 상태만 조회합니다. 기기에 업데이트 수신기가 없는 경우, PC 미들웨어 업데이트나 반복 조회만으로 수신기가 설치되지 않습니다.':'Check again only reads connection state. Updating the PC middleware or repeatedly scanning cannot install a missing device-side updater.'),'muted'));
  }
  if(device.phase==='awaiting-device'){
    const verify=element('button',ko?'부팅 확인':'Check boot');verify.disabled=snapshot.busy;verify.addEventListener('click',()=>action({action:'verify',port:device.port}));card.append(verify);
  }
  if(device.component==='qmk'&&device.online&&(device.returnSupported&&['ready','qmk-readback'].includes(device.nextStep)||device.writable&&device.nextStep==='ready')){
    const resume=element('button',ko?'업데이트 없이 키보드로 돌아가기':'Return to keyboard without updating','secondary');resume.disabled=snapshot.busy;
    resume.addEventListener('click',()=>action({action:'return-keyboard',port:device.port,version:snapshot.release.version,confirmBoard:true}));card.append(resume);
  }
  if(!['ready',undefined].includes(device.phase)&&device.lastAction!=='prepare'){
    const box=element('div',undefined,'progress');box.setAttribute('role','status');
    const backupPhase=device.component==='runtime'?(ko?'런타임 파티션 전체 백업 중…':'Backing up the complete runtime partition…'):(ko?'QMK 앱·설정 영역 전체 백업 중…':'Backing up the complete QMK application/settings region…');
    box.append(element('p',device.phase==='awaiting-device'?(ko?'고급 복구 후 실제 부팅 확인을 기다립니다.':'Waiting for actual boot after advanced recovery.'):device.phase==='identify'?(ko?'선택한 기기를 확인하고 있습니다…':'Checking the selected device…'):device.phase==='backup'?backupPhase:device.phase==='complete'?t.complete:(t.phase[device.phase]??device.phase)));
    if(device.phase==='failed')box.append(element('p',`${device.code==='qmk_reboot_unconfirmed'?(ko?'일반 키보드 연결을 확인하지 못했습니다. MK20 전원을 완전히 껐다가 사각 키를 누르지 않은 채 다시 켜고 다시 확인하세요. 별도 전원을 사용하면 USB 재연결만으로 전원이 꺼지지 않을 수 있습니다.':'The normal keyboard connection was not confirmed. Fully power MK20 off, then turn it on without holding a square key and check again. Reconnecting USB alone may not power-cycle a separately powered device.'):t.failed} (${device.code??'device_setup_failed'})`,'error'));
    if(device.backup)box.append(element('p',(ko?'복구 백업: ':'Recovery backup: ')+device.backup,'muted'));card.append(box);
  }
  return card;
}

function accept(state){hubState=state;if(state.selectedProfile&&state.selectedProfile!==lastRequestedProfile){selectedProfile=state.selectedProfile;lastRequestedProfile=state.selectedProfile;}if(!state.profiles.some(p=>p.profile===selectedProfile))selectedProfile=state.profiles[0]?.profile;const active=state.profiles.find(p=>p.profile===selectedProfile);snapshot=active?{...active,busy:state.busy,checking:state.checking}:{devices:[],release:{version:'…',changes:{}}};}
// Tutorial navigation only: these controls never call the device/preload API.
const guidePages=new Map();
function guideMove(delta){const p=snapshot.presentation?.[language];const total=p?.walkthrough?.length??p?.steps?.length??0;guidePages.set(selectedProfile,Math.max(0,Math.min(total-1,(guidePages.get(selectedProfile)??0)+delta)));renderGuide(p);}
function renderGuide(p){
  const root=$('device-diagram');root.replaceChildren();if(!p)return;
  const ko=language==='ko',frames=p.walkthrough??p.steps.map(text=>({text,screen:[p.diagram.title,p.diagram.selection,p.diagram.hint],control:'next'}));
  const index=Math.min(guidePages.get(selectedProfile)??0,frames.length-1),frame=frames[index];
  $('guide-instruction').textContent=frame.text;
  $('guide-steps').replaceChildren(...frames.map((entry,i)=>{const li=element('li'),button=element('button',entry.text,'guide-step');button.setAttribute('aria-current',String(i===index));button.addEventListener('click',()=>{guidePages.set(selectedProfile,i);renderGuide(p);});li.append(button);return li;}));
  $('guide-back').textContent=ko?'이전':'Back';$('guide-next').textContent=index===frames.length-1?(ko?'처음부터':'Start again'):(ko?'다음 단계':'Next');$('guide-back').disabled=index===0;$('guide-position').textContent=`${index+1} / ${frames.length}`;
  const shell=element('div',undefined,'guide-device '+(p.diagram.model??'generic'));shell.setAttribute('aria-label',p.diagram.title);
  const screen=element('div',undefined,'guide-screen');screen.append(element('small',ko?'조작 안내 · 실제 화면 아님':'CONTROL GUIDE · NOT LIVE'));frame.screen.forEach((s,i)=>screen.append(element(i===0?'strong':'div',s)));
  const control=(label,id,cls='')=>{const b=element('button',label,'physical '+cls);b.type='button';b.disabled=frame.control!==id;b.dataset.control=id;b.setAttribute('aria-label',label+(ko?' · 안내에서 눌러보기':' · try in the guide'));if(!b.disabled){b.classList.add('highlight');b.addEventListener('click',()=>guideMove(1));}return b;};
  if(p.diagram.model==='mk20'){
    const top=element('div',undefined,'mk20-top'),left=element('div',undefined,'knob-controls'),right=element('div',undefined,'knob-controls');
    left.append(control(ko?'왼쪽 노브 누르기':'Press left knob','left-press','knob'),control('↶  '+(ko?'돌리기':'Turn')+'  ↷','left-turn','turn'));
    right.append(control(ko?'오른쪽 노브':'Right knob','volume','knob'),element('small',ko?'볼륨 / 음소거':'Volume / mute'));top.append(left,screen,right);shell.append(top);
    const keys=element('div',undefined,'mk20-keys');
    // Exact physical matrix from get_mapped_key_index(), not sequential key IDs.
    for(const id of [17,13,9,5,1,18,14,10,6,2,19,15,11,7,3,20,16,12,8,4]){
      const b=control('K'+id,id===17?'machine-key':'key-'+id,'display-key');b.append(element('small',id===17?'Machines':id===16?'Pair / Select':id===4?'Back':id===8?'Forget':''));keys.append(b);
    }shell.append(keys);
  }else if(p.diagram.model==='m5stack-core'){
    shell.append(element('div','M5STACK · CORE','device-brand'),screen);
    const keys=element('div',undefined,'m5-buttons');keys.append(control('A  ↑','up'),control('B  ↵','select'),control('C  ↓','down'));shell.append(keys);
    const keyboard=element('div',undefined,'faces-keyboard');keyboard.append(element('small','FACES · QWERTY'));
    for(const row of ['Q W E R T Y U I O P','A S D F G H J K L','⇧ Z X C V B N M ⌫'])keyboard.append(element('div',row));keyboard.append(control(ko?'입력 후 Enter ↵':'After typing, Enter ↵','enter'));shell.append(keyboard);
  }else{shell.append(screen,element('p',p.diagram.hint));}
  root.append(shell);
}
$('guide-back').addEventListener('click',()=>guideMove(-1));
$('guide-next').addEventListener('click',()=>{const p=snapshot.presentation?.[language];const total=p?.walkthrough?.length??p?.steps?.length??0;if((guidePages.get(selectedProfile)??0)===total-1)guidePages.set(selectedProfile,-1);guideMove(1);});
$('profile').addEventListener('change',event=>{selectedProfile=event.target.value;accept(hubState);render();if(snapshot.capabilities?.wifiImport)void action({action:'wifi'});});
$('language').addEventListener('change',event=>{language=event.target.value;render();});$('refresh').addEventListener('click',()=>action({action:'refresh'}));$('read-wifi').addEventListener('click',()=>action({action:'wifi'}));
// Polling timestamps and the scan lease do not change visible device facts.
// Keep the existing DOM (including focus, open instructions and consent) on those events.
const visibleState=state=>JSON.stringify({...state,profiles:state.profiles.map(p=>p.contract===2?{...p,devices:visibleComponents(p.devices)}:p)},(key,value)=>['checking','checked','wasPresent'].includes(key)?undefined:value);
let lastVisibleState;
window.snowballSetup.subscribe(state=>{const signature=visibleState(state);accept(state);if(signature!==lastVisibleState){lastVisibleState=signature;render();}});
window.snowballSetup.snapshot().then(state=>{lastVisibleState=visibleState(state);accept(state);language=state.language==='en'?'en':'ko';$('language').value=language;render();if(snapshot.capabilities?.wifiImport)void action({action:'wifi'});});
