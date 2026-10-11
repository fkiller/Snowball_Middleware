'use strict';
const ui={
  ko:{heading:'기기 설정',subtitle:'기기 연결부터 업데이트와 Wi-Fi 설정까지, 이 창에서 진행합니다.',journey:['01 · 기기 확인','02 · 백업 + 업데이트','03 · 자동 재기동','04 · Wi-Fi + LAN 검색'],usb:'USB 기기',refresh:'다시 확인',empty:'',release:'제공 펌웨어',scope:'미들웨어에 포함된 펌웨어 기준입니다. 업데이트 버튼을 누르기 전에는 플래시를 쓰지 않습니다. 빌드 도구가 없으면 다운로드에 시간이 걸릴 수 있습니다.',wifi:'PC의 Wi-Fi 가져오기',readWifi:'연결된 Wi-Fi 확인',noWifi:'가져올 Wi-Fi를 확인하지 못했습니다. 유선 연결, OS 접근 권한 또는 지원되지 않는 보안 방식일 수 있습니다. 아래 기기 안내를 따라 설정할 수 있습니다.',wifiBoundary:'기존에 저장된 Wi-Fi는 덮어쓰지 않습니다. 가져오기를 선택한 경우에만 OS에서 비밀번호를 읽어 선택한 기기에 전달하며 화면·로그에 표시하지 않습니다. ',guide:'기기 조작 따라하기',caption:'설정 위치를 설명하는 안내 그림입니다. 실시간 기기 화면이 아닙니다.',steps:[],faces:'',current:'현재 버전',unknown:'미확인',available:'제공 버전',unrecognized:'Snowball 펌웨어 응답이 없습니다. 공기계 또는 다른 펌웨어일 수 있습니다.',confirm:'',install:'백업 후 설치',update:'백업 후 업데이트',latest:'최신 제공 버전입니다.',newer:'기기의 버전이 더 높습니다. 자동 다운그레이드하지 않습니다.',saved:'기존 Wi-Fi 보존',connected:'연결됨',notConnected:'저장됨 · 현재 연결 안 됨',needsWifi:'기기에 저장된 Wi-Fi가 없습니다.',unknownWifi:'Wi-Fi 저장 여부는 새 펌웨어 적용 후 확인합니다.',migrate:'이 Wi-Fi 가져오기',unplugged:'USB 연결 끊김',backup:'전체 플래시 백업',complete:'기기 응답 확인 완료',failed:'작업이 완료되지 않았습니다. 백업이 생성되었다면 아래 위치에 보존됩니다. 연결과 드라이버를 확인한 뒤 다시 확인하세요.',phase:{checking:'기기 버전 확인 중…',identify:'기기와 저장 영역 확인 중…',backup:'전체 플래시 백업 중…', 'backup-verified':'백업 크기·해시 확인 완료',build:'펌웨어 준비 중… (누락된 빌드 도구 다운로드 포함)',flash:'펌웨어 업데이트 중… USB 연결을 유지하세요.', 'verify-settings':'기존 설정 저장 영역 검증 중…','verify-nvs':'기존 설정 저장 영역 검증 중…',reboot:'자동 재기동 및 새 펌웨어 응답 확인 중…',wifi:'OS 권한 확인 및 실제 Wi-Fi 연결 확인 중…',complete:'완료',failed:'확인 필요',ready:'준비됨'},busy:'다른 USB 확인/작업이 진행 중입니다. 잠시 후 다시 시도하세요.'},
  en:{heading:'Device setup',subtitle:'USB detection, firmware and Wi-Fi in one window.',journey:['01 · Identify','02 · Back up + update','03 · Reboot','04 · Wi-Fi + LAN discovery'],usb:'USB devices',refresh:'Check again',empty:'',release:'Included firmware',scope:'Uses firmware included with this middleware. Flash is written only after you choose Install / Update. Missing build tools may take time to download.',wifi:'Import this PC’s Wi-Fi',readWifi:'Read connected Wi-Fi',noWifi:'Connected Wi-Fi is unavailable. This PC may use Ethernet, require OS permission or use unsupported security. You can configure the device using the guide below.',wifiBoundary:'Saved device Wi-Fi is never replaced. The OS password is read only when you choose Import and sent to the selected device; it never appears in the window or logs.',guide:'Follow the physical controls',caption:'Illustration of the controls, not a live device screen.',steps:[],faces:'',current:'Installed',unknown:'Unknown',available:'Included',unrecognized:'No Snowball firmware response. This may be a blank device or other firmware.',confirm:'',install:'Back up and install',update:'Back up and update',latest:'Matches the included firmware.',newer:'The device has a newer version. No automatic downgrade.',saved:'Saved Wi-Fi retained',connected:'Connected',notConnected:'Saved · currently disconnected',needsWifi:'No network is saved on the device.',unknownWifi:'Saved Wi-Fi status will be checked after the firmware update.',migrate:'Import this Wi-Fi',unplugged:'USB disconnected',backup:'Full flash backup',complete:'Device response verified',failed:'The operation did not complete. Any backup created remains at the location below. Check USB and drivers, then check again.',phase:{checking:'Checking device firmware…',identify:'Checking ESP32 and flash capacity…',backup:'Backing up the entire flash…','backup-verified':'Backup size and hash verified',build:'Preparing firmware… (including missing build tools)',flash:'Updating firmware… Keep USB connected.','verify-settings':'Verifying retained settings…','verify-nvs':'Verifying retained settings…',reboot:'Rebooting and checking new firmware…',wifi:'Waiting for OS permission and real Wi-Fi association…',complete:'Complete',failed:'Needs attention',ready:'Ready'},busy:'A USB check or operation is in progress. Try again shortly.'}
};
const failureText={ko:{backup_incomplete:'전체 백업이 완료되지 않아 펌웨어 쓰기를 시작하지 않았습니다.',nvs_layout_incompatible:'기존 저장 영역 배치가 호환되지 않아 펌웨어를 쓰지 않았습니다. 전체 백업은 보존됩니다.',nvs_preservation_failed_restore_backup:'저장 영역 보존 검증에 실패했습니다. 보존된 전체 백업으로 복원이 필요합니다.',original_core_required:'선택한 기종과 실제 기기를 확인하세요.',wifi_changed_review_again:'PC의 연결된 Wi-Fi가 바뀌었습니다. 연결 정보를 다시 확인하세요.',wifi_connection_unconfirmed:'Wi-Fi 연결을 확인하지 못했습니다. 아래 기기 안내로 설정을 확인하세요.',wifi_key_permission_required:'OS가 비밀번호 읽기를 허용하지 않았습니다. 기기에서 직접 설정할 수 있습니다.',usb_device_changed:'USB 기기가 바뀌었습니다. 다시 확인한 뒤 진행하세요.'},en:{backup_incomplete:'Full backup did not complete; firmware was not written.',nvs_layout_incompatible:'Existing storage layout is incompatible. Firmware was not written; the full backup remains.',nvs_preservation_failed_restore_backup:'Storage preservation failed. Restore the retained full flash backup.',original_core_required:'Confirm the selected model matches the physical device.',wifi_changed_review_again:'The PC changed Wi-Fi networks. Review the connected network again.',wifi_connection_unconfirmed:'Wi-Fi association is unconfirmed. Follow the device guide below.',wifi_key_permission_required:'OS password access was denied. Configure Wi-Fi on the device instead.',usb_device_changed:'The USB device changed. Check it again before continuing.'}};
const $=id=>document.getElementById(id);let language='ko',snapshot={devices:[],release:{version:'…',changes:{}}},hubState={profiles:[]},selectedProfile,lastRequestedProfile,error='';const approved=new Set(),declinedWifi=new Set(),manualNetworks=new Map();
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function relation(a,b){const x=String(a??'').split('.').map(Number),y=String(b??'').split('.').map(Number);if(x.length!==3||x.some(Number.isNaN))return 'unknown';for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?'older':'newer';return 'current';}
async function action(request){error='';try{accept(await window.snowballSetup.action({...request,profile:selectedProfile}));}catch{error=ui[language].busy;}render();}
function render(){
  const base=ui[language],p=snapshot.presentation?.[language],t={...base,usb:snapshot.contract===2?(language==='ko'?'연결된 기기 / 저장 매체':'Connected devices / storage'):base.usb,journey:p?.journey??base.journey,empty:p?.connection??'',confirm:p?.confirmation??'',steps:p?.steps??[],faces:p?.note??''};
  $('profile-label').textContent=language==='ko'?'기기 종류':'Device type';
  $('profile').replaceChildren(...hubState.profiles.map(profile=>{const option=element('option',profile.name);option.value=profile.profile;return option;}));$('profile').value=selectedProfile??'';
  $('detected-profiles').replaceChildren(...hubState.profiles.filter(p=>p.devices.some(d=>d.online||d.phase==='awaiting-device')).map(profile=>{
    const devices=profile.devices.filter(d=>d.online||d.phase==='awaiting-device');
    const needsReview=devices.some(d=>d.imageMatch===false||!['current','newer'].includes(relation(d.hello?.firmware??d.currentVersion,profile.release.components?.[d.component]?.version??profile.release.version)));
    const label=profile.name+' · '+(language==='ko'?(needsReview?'업데이트 확인':'연결됨'):(needsReview?'Review update':'Detected'));
    const button=element('button',label,'secondary');button.setAttribute('aria-pressed',String(profile.profile===selectedProfile));
    button.addEventListener('click',()=>{$('profile').value=profile.profile;$('profile').dispatchEvent(new Event('change'));});return button;
  }));
  $('wifi-section').hidden=!snapshot.capabilities?.wifiImport;document.documentElement.lang=language;$('heading').textContent=t.heading;$('subtitle').textContent=t.subtitle;
  for(const [id,value]of Object.entries({'usb-title':t.usb,refresh:t.refresh,'release-title':`${t.release} · ${snapshot.release.version}`,'scope':t.scope,'wifi-title':t.wifi,'read-wifi':t.readWifi,'wifi-boundary':t.wifiBoundary,'guide-title':t.guide,'guide-caption':t.caption,'faces-note':t.faces}))$(id).textContent=value;
  $('journey').replaceChildren(...t.journey.map(s=>element('span',s)));$('changes').replaceChildren(...(snapshot.release.changes[language]??[]).map(s=>element('li',s)));
  renderGuide(p);$('notice').textContent=error||(snapshot.code?t.noWifi:'');
  $('network').textContent=snapshot.network?`Wi-Fi · ${snapshot.network.ssid}${snapshot.network.enterprise?' · Enterprise (manual setup)':''}`:t.noWifi;
  $('refresh').disabled=$('read-wifi').disabled=!!snapshot.busy;
  const cards=snapshot.devices.map(device=>{
    if(snapshot.contract===2)return componentCard(device,t);
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
      let importWifi=null;if(snapshot.capabilities?.wifiImport&&snapshot.network&&!snapshot.network.enterprise&&device.hello?.wifiConfigured!==true){const label=element('label',undefined,'check');importWifi=element('input');importWifi.type='checkbox';importWifi.checked=!declinedWifi.has(selectedProfile+device.port);importWifi.disabled=!!snapshot.busy;importWifi.addEventListener('change',()=>{importWifi.checked?declinedWifi.delete(selectedProfile+device.port):declinedWifi.add(selectedProfile+device.port);});label.append(importWifi,element('span',language==='ko'?"저장된 Wi-Fi가 없으면 업데이트 후 PC Wi-Fi("+snapshot.network.ssid+" )를 가져옵니다.":"If no Wi-Fi is saved, import this PC’s network ("+snapshot.network.ssid+" ) after the update."));card.append(label);}const install=element('button',device.hello?t.update:t.install);const updateEnabled=()=>{install.disabled=!input.checked||snapshot.busy||snapshot.checking||!device.online||device.phase==='checking';};input.addEventListener('change',()=>{input.checked?approved.add(selectedProfile+device.port):approved.delete(selectedProfile+device.port);updateEnabled();});updateEnabled();install.addEventListener('click',()=>action({action:'install',port:device.port,version:snapshot.release.version,confirmBoard:true,migrateWifi:importWifi?.checked===true,...(importWifi?.checked?{ssid:snapshot.network.ssid}:{})}));actions.append(install);
    }
    if(snapshot.capabilities?.wifiImport&&device.hello?.usbSetup===true&&device.hello.wifiConfigured===false){const migrate=element('button',t.migrate);migrate.disabled=!snapshot.network||snapshot.network.enterprise||snapshot.busy||!device.online;migrate.addEventListener('click',()=>action({action:'migrate',port:device.port,ssid:snapshot.network.ssid}));actions.append(migrate);}
    card.append(actions);
    if(!['ready',undefined].includes(device.phase)){const progress=element('div',undefined,'progress');progress.setAttribute('role','status');progress.append(element('p',t.phase[device.phase]??device.phase));if(device.phase==='failed')progress.append(element('p',`${failureText[language][device.code]??t.failed} (${device.code??'usb_operation_failed'})`,'error'));if(device.backup)progress.append(element('p',`${t.backup}: ${device.backup}`,'muted'));card.append(progress);}
    return card;
  });$('devices').replaceChildren(...(cards.length?cards:[element('p',t.empty,'muted')]));
}

function componentCard(device,t){
  const ko=language==='ko',key=selectedProfile+device.port,component=snapshot.release.components[device.component];
  const card=element('article',undefined,'device');card.append(element('strong',device.label));
  if(device.transport==='lan')card.append(element('p',ko?'같은 네트워크의 기기 검색 신호를 받았습니다. USB 연결과 별도의 관찰이며, 이전 펌웨어가 버전을 응답하지 않으면 미확인으로 표시합니다. 아래 준비 안내에서 업데이트를 이어갑니다.':'Received device discovery on this LAN. This observation is separate from USB; older firmware without a version response stays Unknown. Continue with the preparation guide below.','muted'));
  const versions=element('div',undefined,'versions');
  for(const [label,version]of [[t.current,device.currentVersion??t.unknown],[t.available,component?.version??t.unknown]]){if(versions.childElementCount)versions.append(element('span','→','arrow'));const box=element('div',undefined,'version');box.append(element('small',label),element('strong',version));versions.append(box);}card.append(versions);
  const guidance={
    'enter-dfu':ko?'USB를 빼고 좌측 상단 키를 누른 채 다시 연결하세요. DFU 연결을 실제로 확인한 뒤 업데이트할 수 있습니다.':'Unplug USB, hold the top-left key and reconnect. Updating requires an actual DFU attachment.',
    'usb-driver':ko?'DFU 읽기 또는 드라이버 접근을 확인하지 못했습니다. 백업이 가능해질 때까지 쓰지 않습니다.':'DFU readback or driver access is unavailable. Writing is blocked until backup is possible.',
    'usb-connect':ko?'USB 연결 상태에서 업데이트합니다. SD 카드를 분리하지 않습니다. 제품용 USB 응답을 기다립니다.':'Updating uses the connected USB cable. Keep the SD card in the device. Waiting for product USB.',
    'usb-bootstrap':ko?'USB 업데이트 수신기 응답을 기다립니다. 부팅 중일 수 있어 자동으로 다시 확인합니다. 수신기가 없는 구 펌웨어는 최초 이관이 필요하며 응답 전에는 쓰지 않습니다.':'Waiting for the USB update receiver; startup is retried automatically. Legacy firmware without the receiver needs initial migration. No writes before a valid response.',
    'insert-card':ko?'복구용 카드 리더 연결입니다. 일반 업데이트는 기기에 SD 카드를 둔 채 USB로 진행합니다.':'Recovery card-reader attachment. Normal updates use USB with the SD card left in the device.',
    'return-card':ko?'안전하게 카드를 분리해 MK20에 돌려 넣고 전원을 연결하세요. 부팅 확인은 실제 실행 중인 버전·해시를 LAN에서 확인합니다.':'Safely remove the card, return it to MK20 and power it on. Check boot verifies actual running version/hashes over LAN.'
  };if(guidance[device.nextStep])card.append(element('p',guidance[device.nextStep]));
  if(device.wifiConfigured===true)card.append(element('p',t.saved));
  const status=device.imageMatch===false?'unknown':relation(device.currentVersion,component?.version);
  if(device.imageMatch===false)card.append(element('p',ko?'응답 버전은 같지만 실행 이미지가 제공 빌드와 다릅니다. 업데이트 확인이 필요합니다.':'Reported version matches, but running images differ from the included build. Review the update.','muted'));
  if(status==='current'||status==='newer')card.append(element('p',status==='current'?t.latest:t.newer,'muted'));
  if(device.writable&&device.online&&device.phase!=='awaiting-device'&&status!=='newer'){
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
    const install=element('button',device.currentVersion?t.update:t.install);const enabled=()=>{install.disabled=!confirm.checked||snapshot.busy||snapshot.checking;};confirm.addEventListener('change',()=>{confirm.checked?approved.add(key):approved.delete(key);enabled();});enabled();
    install.addEventListener('click',()=>{
      const network=manual.enabled?{ssid:manual.ssid,password:manual.password}:undefined;
      const request={action:'install',port:device.port,version:snapshot.release.version,confirmBoard:true,migrateWifi:importBox?.checked===true&&!network,...(importBox?.checked&&!network?{ssid:snapshot.network.ssid}:{}),...(network?{network}:{})};
      manualNetworks.delete(key);if(network){manual.password='';for(const input of card.querySelectorAll('input[type=password]'))input.value='';}
      void action(request);
    });card.append(install);
  }
  if(device.phase==='awaiting-device'){
    const verify=element('button',ko?'부팅 확인':'Check boot');verify.disabled=snapshot.busy||snapshot.checking;verify.addEventListener('click',()=>action({action:'verify',port:device.port}));card.append(verify);
  }
  if(!['ready',undefined].includes(device.phase)){
    const box=element('div',undefined,'progress');box.setAttribute('role','status');
    const backupPhase=device.component==='runtime'?(ko?'런타임 파티션 전체를 USB로 백업 중…':'Backing up the complete runtime partition over USB…'):(ko?'QMK 앱·설정 영역 전체 백업 중…':'Backing up the complete QMK application/settings region…');
    box.append(element('p',device.phase==='awaiting-device'?(ko?'고급 복구 후 실제 부팅 확인을 기다립니다.':'Waiting for actual boot after advanced recovery.'):device.phase==='backup'?backupPhase:device.phase==='complete'?t.complete:(t.phase[device.phase]??device.phase)));
    if(device.phase==='failed')box.append(element('p',`${t.failed} (${device.code??'device_setup_failed'})`,'error'));
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
window.snowballSetup.subscribe(state=>{accept(state);render();});
window.snowballSetup.snapshot().then(state=>{accept(state);language=state.language==='en'?'en':'ko';$('language').value=language;render();if(snapshot.capabilities?.wifiImport)void action({action:'wifi'});});
