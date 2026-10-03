import {createHash,randomUUID} from 'node:crypto';
import {ControllerStore,ControllerContext,type ControllerSelection} from './context.js';
import {parseControllerId,parsePluginId,parseInstanceId,parseSessionKey,type PersistedController} from './identity.js';

export interface ControllerPreferences {
  model?: string; effort?: string; language?: 'en'|'ko'; skinId?: string;
  view?: string; workspaceId?: string; projectName?: string;
  cursor?: number; scroll?: number; crumb?: number; focus?: 'top'|'content';
}
export interface ControllerState {
  controllerId: string; revision: number; selection: ControllerSelection;
  preferences: ControllerPreferences;
  draft?: {destinationKey:string;text:string};
}
type Entry={revision:number;preferences:ControllerPreferences;draft?:{destinationKey:string;text:string}};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function deviceControllerId(pluginId:string,instanceId:string,verifiedIdentity:string):string {
  parsePluginId(pluginId);parseInstanceId(instanceId);
  if(!verifiedIdentity||verifiedIdentity.length>256||/[\r\n]/.test(verifiedIdentity))throw Error('invalid_device_identity');
  return 'ctl_'+createHash('sha256').update(`snowball.controller.v1\n${pluginId}\n${instanceId}\n${verifiedIdentity}`).digest('hex').slice(0,16);
}
function preferences(raw:unknown):ControllerPreferences {
  if(!object(raw))throw Error('invalid_controller_preferences');
  const result:Record<string,unknown>={};
  for(const [key,value] of Object.entries(raw)) {
    if(['model','effort','view','workspaceId','projectName'].includes(key)){if(typeof value!=='string'||Buffer.byteLength(value)>256||/[\x00-\x1f]/.test(value))throw Error('invalid_controller_preferences');}
    else if(key==='language'){if(!['en','ko'].includes(String(value)))throw Error('invalid_controller_preferences');}
    else if(key==='skinId'){if(typeof value!=='string'||! /^[a-z0-9][a-z0-9_-]{1,31}$/.test(value))throw Error('invalid_controller_preferences');}
    else if(['cursor','scroll','crumb'].includes(key)){if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>(key==='crumb'?3:1000000))throw Error('invalid_controller_preferences');}
    else if(key==='focus'){if(!['top','content'].includes(String(value)))throw Error('invalid_controller_preferences');}
    else throw Error('invalid_controller_preferences');
    result[key]=value;
  }
  return result as ControllerPreferences;
}
/** Canonical contexts are shared with DeviceRegistry; UI values remain per controller.
 * These preferences/drafts never authorize dispatch or prove native execution.
 */
export class ControllerStateStore {
  readonly contexts:ControllerStore;
  private readonly entries=new Map<string,Entry>();
  private readonly listeners=new Set<()=>void>();
  constructor(contexts=new ControllerStore()){this.contexts=contexts;}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private entry(id:string):Entry {
    parseControllerId(id);let entry=this.entries.get(id);
    if(!entry){if(this.entries.size>=256)throw Error('controller_capacity');this.contexts.getOrCreate(id);entry={revision:0,preferences:{}};this.entries.set(id,entry);}
    return entry;
  }
  get(id:string):ControllerState {
    const entry=this.entry(id);return structuredClone({controllerId:id,...entry,selection:this.contexts.getOrCreate(id).getSelection()});
  }
  update(id:string,revision:number,patch:unknown):ControllerState {
    const entry=this.entry(id),context=this.contexts.getOrCreate(id);
    if(revision!==entry.revision)throw Error('stale_controller_revision');
    if(!object(patch)||Object.keys(patch).some(k=>!['selection','preferences','draft'].includes(k)))throw Error('invalid_controller_patch');
    const prefs=patch.preferences===undefined?entry.preferences:{...entry.preferences,...preferences(patch.preferences)};
    // Validate selection before changing the live context/draft.
    const candidate=new ControllerContext(id);candidate.selectScope(context.getSelection());
    if(patch.selection===null)candidate.clearScope();
    else if(patch.selection!==undefined){if(!object(patch.selection)||Object.keys(patch.selection).some(k=>!['harnessPluginId','harnessInstanceId','projectId','sessionKey'].includes(k)))throw Error('invalid_controller_selection');candidate.clearScope();candidate.selectScope(patch.selection as ControllerSelection);}
    let draft=entry.draft;
    if(patch.draft===null)draft=undefined;
    else if(patch.draft!==undefined){
      const raw=patch.draft;
      if(!object(raw)||Object.keys(raw).sort().join(',')!=='destinationKey,text'||typeof raw.destinationKey!=='string'||typeof raw.text!=='string'||Buffer.byteLength(raw.text)>8192)throw Error('invalid_controller_draft');
      parseSessionKey(raw.destinationKey);
      if(draft&&draft.destinationKey!==raw.destinationKey)throw Error('draft_destination_locked');
      draft={destinationKey:raw.destinationKey,text:raw.text};
    }
    if(patch.draft!==undefined){
      if(!draft)context.clearDraft();
      else if(!entry.draft){context.clearDraft();context.beginDraft(randomUUID(),draft.destinationKey);context.updateDraftPhase('review');}
    }
    context.clearScope();context.selectScope(candidate.getSelection());
    this.entries.set(id,{revision:entry.revision+1,preferences:prefs,...(draft?{draft}:{})});
    for(const listener of this.listeners){try{listener();}catch{/* Persistence observers never change committed authority. */}}return this.get(id);
  }
  snapshot():{schema:1;states:Array<Entry&{controllerId:string;context:PersistedController}>} {
    return {schema:1,states:[...this.entries].map(([controllerId,entry])=>structuredClone({controllerId,...entry,context:this.contexts.getOrCreate(controllerId).snapshot()}))};
  }
  restore(raw:unknown):void {
    if(!object(raw)||raw.schema!==1||!Array.isArray(raw.states)||raw.states.length>256)throw Error('invalid_controller_store');
    const seen=new Set<string>();
    for(const state of raw.states){
      if(!object(state)||typeof state.controllerId!=='string'||seen.has(state.controllerId)||!Number.isSafeInteger(state.revision)||Number(state.revision)<0||!object(state.context))throw Error('invalid_controller_store');
      parseControllerId(state.controllerId);seen.add(state.controllerId);
      const context=this.contexts.getOrCreate(state.controllerId);context.restore(state.context as unknown as PersistedController);
      let draft:Entry['draft'];
      if(state.draft!==undefined){if(!object(state.draft)||typeof state.draft.destinationKey!=='string'||typeof state.draft.text!=='string'||Buffer.byteLength(state.draft.text)>8192||context.getDraft()?.destinationKey!==state.draft.destinationKey)throw Error('invalid_controller_store');parseSessionKey(state.draft.destinationKey);draft={destinationKey:state.draft.destinationKey,text:state.draft.text};}
      this.entries.set(state.controllerId,{revision:Number(state.revision),preferences:preferences(state.preferences),...(draft?{draft}:{})});
    }
  }
}
