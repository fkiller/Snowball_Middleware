// Protocol 1 reference: a dependency-free virtual device, never a harness controller.
let initialized=false,closed=false,frame=Buffer.alloc(0);
const ids=['virtual-1','virtual-2'];
const close=()=>{closed=true;process.stdin.destroy();};
const send=value=>{
  const line=JSON.stringify(value)+'\n';
  if(Buffer.byteLength(line)>65536||process.stdout.writableLength>262144)return close();
  process.stdout.write(line);
};
function handle(r){
  if(!r||r.jsonrpc!=='2.0'||typeof r.method!=='string')return close();
  if(r.method==='plugin.cancel')return;
  if(!Number.isSafeInteger(r.id)||r.id<1)return close();
  let result;
  if(r.method==='plugin.initialize'&&!initialized&&r.params?.apiVersion==='1.0.0'&&r.params?.pluginId==='example.virtual-device'){
    initialized=true;result={apiVersion:'1.0.0',pluginId:'example.virtual-device'};
  }else if(initialized&&r.method==='devices.list'){
    result=ids.map(deviceId=>({deviceId,nativeDeviceId:deviceId,label:deviceId,transport:'virtual',supported:true,verifiedIdentity:deviceId,capabilities:['display']}));
  }else if(initialized&&r.method==='devices.render'&&ids.includes(r.params?.deviceId)&&typeof r.params?.text==='string'&&r.params.text.length<=1024){
    result={deviceId:r.params.deviceId,text:r.params.text};
  }else return send({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Unsupported request or initialization'}});
  send({jsonrpc:'2.0',id:r.id,result});
}
process.stdin.on('data',chunk=>{
  let start=0;
  while(!closed&&start<chunk.length){
    const end=chunk.indexOf(10,start),stop=end<0?chunk.length:end;
    if(frame.length+stop-start>65536)return close();
    frame=Buffer.concat([frame,chunk.subarray(start,stop)]);start=stop+(end<0?0:1);
    if(end<0)return;
    try{const r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));frame=Buffer.alloc(0);handle(r);}catch{return close();}
  }
});
process.stdin.on('end',close);process.stdin.on('error',close);process.stdout.on('error',close);
