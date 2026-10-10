const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('snowballSetup',Object.freeze({
  snapshot:()=>ipcRenderer.invoke('m5-setup-snapshot'),
  action:request=>ipcRenderer.invoke('m5-setup-action',request),
  subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('m5-setup-state',listener);return()=>ipcRenderer.removeListener('m5-setup-state',listener);}
}));
