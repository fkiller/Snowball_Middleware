// Only the owning native tray can perform OS settings effects. No HTTP endpoint
// accepts executable paths or substitutes a successful setting response.
export function desktopBridge() {
  const enabled=process.env.SNOWBALL_DESKTOP==='1'&&typeof process.send==='function';
  let sequence=0;const pending=new Map();
  process.on('message',message=>{
    if(message?.kind!=='native-result')return;
    const call=pending.get(message.id);if(!call)return;
    pending.delete(message.id);clearTimeout(call.timer);
    message.ok?call.resolve(message.value):call.reject(Error('Native setting failed'));
  });
  return {enabled,request(action,value){
    if(!enabled||!process.connected||!['get-autostart','set-autostart'].includes(action)||pending.size>=4)return Promise.reject(Error('Native setting unavailable'));
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native setting timed out'));},10000);
      pending.set(id,{resolve,reject,timer});process.send({kind:'native',id,action,value});
    });
  }};
}
