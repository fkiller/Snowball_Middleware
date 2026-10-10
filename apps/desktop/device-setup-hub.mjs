import {EventEmitter} from 'node:events';
import {DeviceSetup} from './device-setup.mjs';

/** One host-owned preparation journey and one USB operation across adapters. */
export class DeviceSetupHub extends EventEmitter {
  constructor({adapters,backupDirectory,uart=async()=>{}}){
    super();this.setups=new Map();
    for(const {profile,device} of adapters){
      if(profile==='mk20'||this.setups.has(profile))throw Error('invalid_preparation_profile');
      const setup=new DeviceSetup({device,profile,backupDirectory,uart:(action,port)=>uart(profile,action,port)});
      this.setups.set(profile,setup);
      setup.on('change',()=>this.emit('change',this.view()));
      setup.on('attached',record=>this.emit('attached',{profile,record}));
    }
  }
  get job(){return [...this.setups.values()].find(s=>s.job)?.job;}
  view(){return {profiles:[...this.setups.values()].map(s=>s.view()),busy:!!this.job,checking:!!this.scanning};}
  async scan(force=false){
    if(this.closed||this.scanning||this.job)return;
    this.scanning=true;
    try{for(const setup of this.setups.values()){if(this.closed)break;await setup.scan(force);}}
    finally{this.scanning=false;this.emit('change',this.view());}
  }
  start(){void this.scan();this.timer=setInterval(()=>void this.scan(),3000);this.timer.unref();}
  async action(request){
    if(this.closed||!request||typeof request!=='object'||Array.isArray(request))throw Error('invalid_setup_action');
    const {profile,...action}=request,setup=this.setups.get(profile);
    if(!setup)throw Error('unknown_preparation_profile');
    if(this.job||(this.scanning&&action.action!=='wifi'))throw Error('usb_setup_busy');
    if(action.action==='install'&&[...this.setups.values()].some(s=>s!==setup&&s.records.get(action.port)?.hello))throw Error('device_type_conflict');
    // A refresh uses the common scan lease, so two adapters never open one UART together.
    if(action.action==='refresh'){
      if(Object.keys(action).some(k=>k!=='action'))throw Error('invalid_setup_action');
      await this.scan(true);
    }else await setup.action(action);
    return this.view();
  }
  async close(){this.closed=true;clearInterval(this.timer);await Promise.allSettled([...this.setups.values()].map(s=>s.close()));}
}
