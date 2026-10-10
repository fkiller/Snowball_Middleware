// Compatibility export; orchestration is shared by every preparation adapter.
import {DeviceSetup,publicDevice as publicStatus} from './device-setup.mjs';
export {firmwareRelation,validUsbPort} from './device-setup.mjs';
export const publicDevice=hello=>publicStatus(hello,{prefix:'m5-',hexLength:12});
export class M5StackSetup extends DeviceSetup {
  constructor(options){super({...options,profile:'m5stack'});if(this.descriptor.id!=='m5stack-core-esp32')throw Error('invalid_preparation_descriptor');}
}
