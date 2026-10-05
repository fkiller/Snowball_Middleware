import {Worker} from 'node:worker_threads';
// Coalesce concurrent reads only. A new explicit read observes native sources
// again; no static/simulated catalog and no cache that changes UI selection.
export class NativeSourceService {
  #workers=[];#queue=[];#pending=new Map();#next=0;#closed=false;
  constructor({concurrency=2,timeout=45000}={}) {
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4||timeout<1000||timeout>120000)throw Error('invalid_source_limits');
    this.timeout=timeout;this.concurrency=concurrency;
  }
  read(kind,pluginId) {
    if(this.#closed)return Promise.reject(Error('sources_closed'));
    if(!['catalog','catalogs','sessions','projects','installations'].includes(kind)||kind==='catalog'&&!['snowball.codex','snowball.antigravity','snowball.opencode'].includes(pluginId))return Promise.reject(Error('unknown_observation'));
    const key=kind+':'+(pluginId??'');if(this.#pending.has(key))return this.#pending.get(key).promise;
    if(this.#pending.size>=32)return Promise.reject(Error('source_capacity'));
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    const job={id:++this.#next,key,kind,pluginId,promise,resolve,reject};this.#pending.set(key,job);this.#queue.push(job);this.#drain();return promise;
  }
  #slot() {
    // Windows workers have case-sensitive env lookup unlike the main thread.
    // Preserve native CLI discovery when the OS supplies "Path" rather than "PATH".
    const env={...process.env,PATH:process.env.PATH??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',APPDATA:process.env.APPDATA??'',USERPROFILE:process.env.USERPROFILE??''};
    const worker=new Worker(new URL('./source-worker.mjs',import.meta.url),{env,execArgv:[]}),slot={worker,job:null,timer:null};
    worker.on('message',message=>{
      const job=slot.job;if(!job||message.id!==job.id)return;
      this.#finish(slot,message.error?new Error(message.error):null,message.value);
    });
    worker.on('error',error=>this.#retire(slot,error));
    worker.on('exit',()=>{if(this.#workers.includes(slot))this.#retire(slot,Error('source_worker_exited'));});
    this.#workers.push(slot);return slot;
  }
  #finish(slot,error,value) {
    clearTimeout(slot.timer);const job=slot.job;slot.job=null;
    if(job){this.#pending.delete(job.key);error?job.reject(error):job.resolve(value);}this.#drain();
  }
  #retire(slot,error) {
    const index=this.#workers.indexOf(slot);if(index<0)return;
    this.#workers.splice(index,1);clearTimeout(slot.timer);const job=slot.job;slot.job=null;
    if(job){this.#pending.delete(job.key);job.reject(error);}void slot.worker.terminate();this.#drain();
  }
  #drain() {
    if(this.#closed)return;
    while(this.#queue.length){
      let slot=this.#workers.find(slot=>!slot.job);
      if(!slot){if(this.#workers.length>=this.concurrency)return;try{slot=this.#slot();}catch(error){const failed=this.#queue.shift();this.#pending.delete(failed.key);failed.reject(error);continue;}}
      const job=this.#queue.shift();slot.job=job;slot.timer=setTimeout(()=>this.#retire(slot,Error('native_observation_timeout')),this.timeout);
      slot.worker.postMessage({id:job.id,kind:job.kind,pluginId:job.pluginId});
    }
  }
  async close() {
    this.#closed=true;for(const job of this.#pending.values())job.reject(Error('sources_closed'));
    this.#pending.clear();this.#queue=[];
    const workers=this.#workers.splice(0);for(const slot of workers)clearTimeout(slot.timer);
    await Promise.allSettled(workers.map(slot=>slot.worker.terminate()));
  }
}
