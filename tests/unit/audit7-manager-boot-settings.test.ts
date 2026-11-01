// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/711" }
// Внешний аудит №7, B02: настройка, сохранённая во время первого запуска, применяется.
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const seam=vi.hoisted(()=>({disk:{} as Record<string,unknown>, listeners:new Set<any>(),messages:new Set<any>(),pending:false,release:null as null|(()=>void)}));
vi.mock('@core/env',()=>({browser:{storage:{
 local:{get:async(keys:any)=>{if(keys&&!Array.isArray(keys)&&Object.hasOwn(keys,'playerNotes')){seam.pending=true;await new Promise<void>(r=>seam.release=r);return {...keys,pn_notes_migrated_v1:true};}return keys&&typeof keys==='object'&&!Array.isArray(keys)?{...keys}:{};},set:async()=>{},remove:async()=>{}},
 sync:{get:async(keys:any)=>({...keys,...seam.disk}),set:async(patch:any)=>storagePatch(patch)},
 onChanged:{addListener:(fn:any)=>seam.listeners.add(fn),removeListener:(fn:any)=>seam.listeners.delete(fn)}},
 runtime:{id:'audit7-manager',getManifest:()=>({version:'9.67.0'}),getURL:(p:string)=>p}}}));
vi.mock('@core/log',()=>({log:{debug(){},info(){},warn(){},error(){},setPersist(){},setLevel(){}}}));
vi.mock('@core/messaging',()=>({onMessage:(fn:any)=>{seam.messages.add(fn);return()=>seam.messages.delete(fn)},sendRuntime:async(m:any)=>m.command==='get_status'?{success:true,data:{connected:false,currentScene:null,scenes:[]}}:{success:true},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
vi.mock('@core/toast',()=>({showToast(){},clearToasts(){}}));
import {DEFAULT_SETTINGS,setSettings} from '@core/settings';
import {FeatureManager} from '@core/feature';
import {searchFeature} from '@content/features/search';
import {autoStartFeature} from '@content/features/auto-start';
import {obsPanelFeature} from '@content/panels/obs-panel';
import {roleFakerFeature} from '@content/features/role-faker';
import {autoReadyFeature} from '@content/features/auto-ready';
import {playerNotesFeature} from '@content/features/player-notes';
const features=[searchFeature,autoStartFeature,obsPanelFeature,roleFakerFeature,autoReadyFeature,playerNotesFeature];
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
const bits=()=>[...document.querySelectorAll<HTMLElement>('.player__role')].map(el=>{const s=getComputedStyle(el);return +(s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0')}).join('');
let boot:Promise<void>|null=null;
function storagePatch(patch:Record<string,unknown>){const changes:Record<string,any>={};for(const [k,v] of Object.entries(patch)){changes[k]={oldValue:seam.disk[k],newValue:v};seam.disk[k]=v;}for(const fn of [...seam.listeners])fn(changes,'sync');}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1900000000000);history.replaceState({},'','/game/711');document.head.innerHTML='';document.body.innerHTML='<div class="roller"><div class="stage"><div class="substage current">День | речь игрока</div></div></div><div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>';seam.disk={...DEFAULT_SETTINGS,auto_accept_enabled:true,skip_start_screen_enabled:false,statistics_enabled:true,auto_ready_enabled:true,enable_role_faker:true,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false,obs_enabled:true,obs_auto_mode_enabled:false,obs_floating_panel_enabled:false,obs_day_scene:'day',obs_night_scene:'night'};seam.listeners.clear();seam.pending=false;seam.release=null;});
afterEach(async()=>{seam.release?.();if(boot)await boot;boot=null;await wait(0);for(const f of [...features].reverse())f.disable();seam.listeners.clear();vi.clearAllTimers();vi.useRealTimers();});
test.each(['auto_hide_roles_enabled','role_phase_auto_switch_enabled','obs_auto_mode_enabled'])('persisted %s enabled during real notes await must hide immediately and remain applied after boot',async key=>{
 const manager=new FeatureManager().register(...features);boot=manager.start();await wait(100);
 expect(seam.pending).toBe(true);expect(bits()).toBe('11');
 storagePatch({[key]:true});await wait(400);
 expect.soft(bits(),'saved privacy setting must apply within 300ms').toBe('00');
 seam.release!();await boot;await wait(12000);
 expect.soft(bits(),'missed onChanged must not leave old configuration permanently after boot').toBe('00');
 // Positive control: an unrelated later event finally wakes the manager and adopts the disk setting?
 // It only merges that unrelated patch; the lost privacy patch is still missing.
 storagePatch({show_id:true});await wait(400);
 expect.soft(bits(),'unrelated settings event must not be required, nor remain insufficient').toBe('00');
});
test('disabling last auto hide during pending boot must restore automatic hide',async()=>{
 seam.disk.auto_hide_roles_enabled=true;const manager=new FeatureManager().register(...features);boot=manager.start();await wait(100);expect(bits()).toBe('00');
 storagePatch({auto_hide_roles_enabled:false});await wait(400);seam.release!();await boot;await wait(12000);
 expect(bits()).toBe('11');
});
test('CONTROL same persisted setting after completed boot is applied',async()=>{
 const manager=new FeatureManager().register(...features);boot=manager.start();await wait(100);seam.release!();await boot;expect(bits()).toBe('11');storagePatch({auto_hide_roles_enabled:true});await wait(100);expect(bits()).toBe('00');
});
test.each(['auto_hide_roles_enabled','obs_auto_mode_enabled'])('real setSettings and popup broadcast cannot repair lost %s',async key=>{
 const manager=new FeatureManager().register(...features);boot=manager.start();await wait(100);expect(seam.pending).toBe(true);
 await setSettings({[key]:true});for(const fn of [...seam.messages])await fn({type:'updateNotesSettings',settings:{...seam.disk}});
 await wait(400);expect.soft(bits(),'privacy patch persisted with real settings writer').toBe('00');
 seam.release!();await boot;await wait(12000);
 for(const fn of [...seam.messages])await fn({type:'updateNotesSettings',settings:{...seam.disk}});await wait(100);
 expect(bits(),'post-boot popup delivery must not leave old privacy config').toBe('00');
});
