const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('snowballSetup',Object.freeze({
  snapshot:()=>ipcRenderer.invoke('device-setup-snapshot'),
  action:request=>ipcRenderer.invoke('device-setup-action',request),
  subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('device-setup-state',listener);return()=>ipcRenderer.removeListener('device-setup-state',listener);}
}));
