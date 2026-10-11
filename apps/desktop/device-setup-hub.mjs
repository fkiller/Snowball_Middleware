import {EventEmitter} from 'node:events';
import {DeviceSetup} from './device-setup.mjs';
import {ComponentSetup} from './component-setup.mjs';
import {readPreparation} from '../../scripts/device-preparation.mjs';

/** One host-owned preparation journey and one USB operation across adapters. */
export class DeviceSetupHub extends EventEmitter {
  constructor({adapters,backupDirectory,uart=async()=>{}}){
    super();this.setups=new Map();
    for(const {profile,device} of adapters){
      if(!/^[-a-z0-9]{1,64}$/.test(profile??'')||this.setups.has(profile))throw Error('invalid_preparation_profile');
      const Setup=readPreparation(device).descriptor.version===2?ComponentSetup:DeviceSetup;
      const setup=new Setup({device,profile,backupDirectory,uart:(action,port)=>uart(profile,action,port)});
      this.setups.set(profile,setup);
      setup.on('change',()=>this.emit('change',this.view()));
      setup.on('attached',record=>this.emit('attached',{profile,record}));
    }
  }
  get job(){return [...this.setups.values()].find(s=>s.job)?.job;}
  observe(observation){
    const setup=this.setups.get(observation?.profile);
    if(this.closed||!(setup instanceof ComponentSetup))return;
    if(setup.observe(observation))void this.scan();
  }
  view(){return {profiles:[...this.setups.values()].map(s=>s.view()),busy:!!this.job,checking:!!this.scanning};}
  scan(force=false){
    if(this.closed||this.job)return Promise.resolve();
    if(this.scanPromise){
      // Coalesce manual checks into one forced pass after an ordinary scan.
      // Joining a forced pass never opens a second helper on the same UART.
      if(force&&!this.scanForced)this.refreshPending=true;
      return this.scanPromise;
    }
    this.scanning=true;this.scanForced=force;this.refreshPending=false;
    this.scanPromise=Promise.resolve().then(async()=>{
      try{
        do{
          for(const setup of this.setups.values()){if(this.closed)break;await setup.scan(this.scanForced);}
          if(!this.refreshPending||this.closed||this.job)break;
          this.refreshPending=false;this.scanForced=true;
        }while(true);
      }finally{
        this.scanning=false;this.scanPromise=null;this.refreshPending=false;
        this.emit('change',this.view());
      }
    });
    this.emit('change',this.view());
    return this.scanPromise;
  }
  start(){
    if(this.started||this.closed)return;this.started=true;
    const poll=async()=>{
      try{await this.scan();}
      finally{if(!this.closed){this.timer=setTimeout(poll,3000);this.timer.unref();}}
    };void poll();
  }
  async action(request){
    if(this.closed||!request||typeof request!=='object'||Array.isArray(request))throw Error('invalid_setup_action');
    const {profile,...action}=request,setup=this.setups.get(profile);
    if(!setup)throw Error('unknown_preparation_profile');
    if(this.job||(this.scanning&&!['wifi','refresh'].includes(action.action)))throw Error('usb_setup_busy');
    if(action.action==='install'&&[...this.setups.values()].some(s=>s!==setup&&(s.records.get(action.port)?.hello||s.records.get(action.port)?.writable===true)))throw Error('device_type_conflict');
    // A refresh uses the common scan lease, so two adapters never open one UART together.
    if(action.action==='refresh'){
      if(Object.keys(action).some(k=>k!=='action'))throw Error('invalid_setup_action');
      await this.scan(true);
    }else await setup.action(action);
    return this.view();
  }
  async close(){this.closed=true;clearInterval(this.timer);await Promise.allSettled([...this.setups.values()].map(s=>s.close()));await this.scanPromise;}
}
