// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
// Восьмой аудит, F01: OFF (мастер или фича) исполняется сразу, не ожидая чужого enable (заметки).
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const seam=vi.hoisted(()=>({disk:{} as Record<string,unknown>, listeners:new Set<any>(),messages:new Set<any>(),pending:false,release:null as null|(()=>void),commands:[] as string[],writes:[] as any[]}));
vi.mock('@core/env',()=>({browser:{storage:{
 local:{get:async(keys:any)=>{if(keys&&!Array.isArray(keys)&&Object.hasOwn(keys,'playerNotes')){seam.pending=true;await new Promise<void>(r=>seam.release=r);return {...keys,playerNotes:{'u:7':{text:'sentinel note',updated:1900000000000,nick:'Sentinel'}},pn_notes_migrated_v1:true};}return keys&&typeof keys==='object'&&!Array.isArray(keys)?{...keys}:{};},set:async(p:any)=>{seam.writes.push(p);},remove:async()=>{}},
 sync:{get:async(keys:any)=>({...keys,...seam.disk}),set:async(patch:any)=>storagePatch(patch)},
 onChanged:{addListener:(fn:any)=>seam.listeners.add(fn),removeListener:(fn:any)=>seam.listeners.delete(fn)}},
 runtime:{id:'audit8-ordinary',getManifest:()=>({version:'9.67.0'}),getURL:(p:string)=>p}}}));
vi.mock('@core/log',()=>({log:{debug(){},info(){},warn(){},error(){},setPersist(){},setLevel(){}}}));
vi.mock('@core/messaging',()=>({onMessage:(fn:any)=>{seam.messages.add(fn);return()=>seam.messages.delete(fn)},sendRuntime:async(m:any)=>{seam.commands.push(m.command);return m.command==='get_status'?{success:true,data:{connected:false,currentScene:null,scenes:[]}}:{success:true}},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
vi.mock('@core/toast',()=>({showToast(){},clearToasts(){}}));
import {DEFAULT_SETTINGS} from '@core/settings';
import {FeatureManager} from '@core/feature';
import {domObserver} from '@core/dom';
import {autoStartFeature} from '@content/features/auto-start';
import {obsPanelFeature} from '@content/panels/obs-panel';
import {roleFakerFeature} from '@content/features/role-faker';
import {playerNotesFeature} from '@content/features/player-notes';
import {queueRequeueFeature} from '@content/features/queue-requeue';
import {obsRecordFeature,syncObsRecordRoute} from '@content/features/obs-record';
const features=[autoStartFeature,obsPanelFeature,roleFakerFeature,playerNotesFeature,queueRequeueFeature,obsRecordFeature];
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
let boot:Promise<void>|null=null;
function storagePatch(patch:Record<string,unknown>){const changes:Record<string,any>={};for(const [k,v] of Object.entries(patch)){changes[k]={oldValue:seam.disk[k],newValue:v};seam.disk[k]=v;}for(const fn of [...seam.listeners])fn(changes,'sync');}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1900000000000);Object.assign(domObserver,{lastFlushAt:0,lastSlowLog:0});history.replaceState({},'','/game-search');document.head.innerHTML='';document.body.innerHTML='';seam.disk={...DEFAULT_SETTINGS,extension_enabled:true,statistics_enabled:false,auto_accept_enabled:false,skip_start_screen_enabled:false,enable_role_faker:false,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false,obs_enabled:true,obs_auto_mode_enabled:false,obs_floating_panel_enabled:false,requeue_after_lobby_fail_enabled:true,obs_auto_record_enabled:true};seam.listeners.clear();seam.commands=[];seam.writes=[];seam.pending=false;seam.release=null;vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:100,height:100,top:0,left:0,bottom:100,right:100,toJSON(){}});});
afterEach(async()=>{seam.release?.();if(boot)await boot;boot=null;await wait(0);for(const f of [...features].reverse())f.disable();syncObsRecordRoute(false);seam.listeners.clear();vi.clearAllTimers();vi.useRealTimers();});
async function stalledPass(){const manager=new FeatureManager().register(...features);boot=manager.start();await boot;storagePatch({statistics_enabled:true});await wait(100);expect(seam.pending).toBe(true);return manager;}

test.each(['extension_enabled','obs_auto_record_enabled'])('%s OFF while real notes enable pending must stop existing OBS recording promptly',async offKey=>{
 history.replaceState({},'','/game/711');syncObsRecordRoute(true);await stalledPass();expect(seam.commands).toContain('record_start');seam.commands=[];
 storagePatch({[offKey]:false});await wait(12000);
 
 expect.soft(seam.commands,'OFF must stop our record without waiting for unrelated notes storage').toContain('record_stop');
 seam.release!();await wait(100);expect(seam.commands).toContain('record_stop');
});
test.each(['extension_enabled','requeue_after_lobby_fail_enabled'])('%s OFF while real notes enable pending must not requeue after lobby disappears',async offKey=>{
 document.body.innerHTML='<div class="p-play__profile-panel"><div class="p-play-profile__wr"><div class="p-play__profile-game p-play__profile-accept">Готовы: 7/10</div></div></div>';
 const manager=await stalledPass();storagePatch({[offKey]:false});await wait(400);
 document.body.innerHTML='<div class="p-play__profile-panel"><div class="p-play-profile__wr"><button class="p-play__profile-button cursor-pointer">Играть</button></div></div>';
 const play=document.querySelector('.cursor-pointer')!;const click=vi.fn(()=>play.classList.remove('cursor-pointer'));play.addEventListener('click',click);
 await wait(1500);
 expect.soft(click,'no autonomous search while extension master is OFF').not.toHaveBeenCalled();
 const count=click.mock.calls.length;seam.release!();await wait(12000);expect(manager.activeIds()).not.toContain('queue-requeue');expect(click.mock.calls.length).toBe(count);
});
test('CONTROL master OFF with no pending notes disables queue and stops record',async()=>{
 history.replaceState({},'','/game/711');syncObsRecordRoute(true);const manager=new FeatureManager().register(...features);boot=manager.start();await boot;seam.commands=[];
 storagePatch({extension_enabled:false});await wait(100);expect(seam.commands).toContain('record_stop');expect(manager.activeIds()).toEqual([]);
});
test('CONTROL duplicate early/queued updates do not duplicate subscriptions',async()=>{
 // Use a real delayed notes-enable, patch an already-ready role owner twice;
 // repeated identical updates must not create additional message subscriptions.
 const manager=await stalledPass();const before=seam.messages.size;
 storagePatch({auto_hide_roles_enabled:true});await wait(100);expect(document.getElementById('polemica-role-hide')).not.toBeNull();
 storagePatch({auto_hide_roles_enabled:true});await wait(100);expect(seam.messages.size).toBe(before);
 seam.release!();await wait(100);expect(manager.activeIds()).toContain('player-notes');
 expect(seam.writes.some(p=>Object.hasOwn(p,'playerNotes')||Object.hasOwn(p,'tagCustomColors'))).toBe(false);
});
test('CONTROL OFF/ON and statistics OFF during real notes await converge with no duplicate record start or residual notes listener',async()=>{
 history.replaceState({},'','/game/711');syncObsRecordRoute(true);const manager=await stalledPass();
 storagePatch({extension_enabled:false});await wait(400);storagePatch({extension_enabled:true,statistics_enabled:false});await wait(400);
 seam.release!();await wait(400);
 expect(manager.activeIds()).not.toContain('player-notes');expect(manager.activeIds()).toContain('obs-record');
 // OFF теперь исполняется сразу (F01): мастер OFF→ON — стоп и новый старт записи, без дублей.
 expect(seam.commands).toEqual(['record_start','record_stop','record_start']);
 expect(seam.messages.size).toBe(1); // obs-panel only; the notes listener was torn down
 expect(seam.writes.some(p=>Object.hasOwn(p,'playerNotes')||Object.hasOwn(p,'tagCustomColors'))).toBe(false);
});
