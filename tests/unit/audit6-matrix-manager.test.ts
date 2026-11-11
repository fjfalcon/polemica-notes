// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/611" }
// Audit6: exact current production registration prefix, not audit5's old order.
import {afterEach,beforeEach,expect,test,vi} from "vitest";
const seam=vi.hoisted(()=>({settings:{} as any,settingListeners:new Set<any>(),messages:new Set<any>(),notesPending:false,release:null as null|(()=>void)}));
vi.mock("@core/env",()=>({browser:{storage:{local:{get:async(keys:any)=>{if(keys&&!Array.isArray(keys)&&Object.hasOwn(keys,"playerNotes")){seam.notesPending=true;await new Promise<void>(resolve=>seam.release=resolve);return {...keys,pn_notes_migrated_v1:true};}return keys&&typeof keys==="object"&&!Array.isArray(keys)?keys:{};},set:async()=>{},remove:async()=>{}},sync:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}},runtime:{id:"audit6-matrix-manager",getManifest:()=>({version:"9.68.0"}),getURL:(p:string)=>p}}}));
vi.mock("@core/settings",async(original)=>({...await original<any>(),getSettings:async()=>seam.settings,onSettingsChanged:(fn:any)=>{seam.settingListeners.add(fn);return()=>seam.settingListeners.delete(fn)}}));
vi.mock("@core/log",()=>({log:{debug(){},info(){},warn(){},error(){},setPersist(){},setLevel(){}}}));
vi.mock("@core/messaging",()=>({onMessage:(fn:any)=>{seam.messages.add(fn);return()=>seam.messages.delete(fn)},sendRuntime:async(m:any)=>m.command==="get_status"?{success:true,data:{connected:false,currentScene:null,scenes:[]}}:{success:true},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
vi.mock("@core/toast",()=>({showToast(){},clearToasts(){}}));
import {DEFAULT_SETTINGS} from "@core/settings";
import {FeatureManager} from "@core/feature";
import {searchFeature} from "@content/features/search";
import {autoStartFeature} from "@content/features/auto-start";
import {obsPanelFeature,obsAutoScenesActive} from "@content/panels/obs-panel";
import {roleFakerFeature,isRoleFaked} from "@content/features/role-faker";
import {autoReadyFeature} from "@content/features/auto-ready";
import {playerNotesFeature} from "@content/features/player-notes";
const features=[searchFeature,autoStartFeature,obsPanelFeature,roleFakerFeature,autoReadyFeature,playerNotesFeature];
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
let boot:Promise<void>|null=null;
const bits=()=>[...document.querySelectorAll<HTMLElement>(".player__role")].map(el=>{const s=getComputedStyle(el);return +(s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0")}).join("");
function tap(code:string){for(const type of ["keydown","keyup"])document.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:code.charCodeAt(3),bubbles:true,cancelable:true}));}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1900000000000);history.replaceState({},"","/game/611");document.head.innerHTML="";document.body.innerHTML='<div class="roller"><div class="stage"><div class="substage current">День | речь игрока</div></div></div><div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>';seam.settings={...DEFAULT_SETTINGS,extension_enabled:true,auto_accept_enabled:true,skip_start_screen_enabled:false,disable_webcam_clicks:true,auto_ready_enabled:true,statistics_enabled:true,enable_role_faker:true,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false,obs_enabled:true,obs_auto_mode_enabled:true,obs_floating_panel_enabled:false,obs_day_scene:"day",obs_night_scene:"night"};seam.settingListeners.clear();seam.release=null;seam.notesPending=false;});
afterEach(async()=>{seam.release?.();if(boot)await boot;boot=null;await wait(0);for(const f of [...features].reverse())f.disable();seam.settingListeners.clear();vi.clearAllTimers();vi.useRealTimers();});

test.each([false,true])("current manager protects OBS-only before delayed notes boot master-reenable=%s",async reenable=>{
 const manager=new FeatureManager().register(...features);
 if(reenable){seam.settings.extension_enabled=false;await manager.start();for(const fn of seam.settingListeners)fn({extension_enabled:true});await wait(50);}else{boot=manager.start();await wait(100);}
 expect(seam.notesPending).toBe(true);expect(obsAutoScenesActive()).toBe(true);
 expect(manager.activeIds()).toEqual(["auto-ready","auto-start","obs-panel","player-notes","role-faker","search"]);
 expect(bits()).toBe("00");tap("KeyF");await wait(40);expect(isRoleFaked()).toBe(true);expect(bits()).toBe("00");tap("KeyE");
 seam.release!();await wait(100);if(boot)await boot;expect(bits()).toBe("00");
});

test("current manager master OFF and individual faker toggle have no delayed privacy resurrection",async()=>{
 const manager=new FeatureManager().register(...features);boot=manager.start();await wait(100);seam.release!();await boot;
 tap("KeyF");expect(isRoleFaked()).toBe(true);
 for(const fn of seam.settingListeners)fn({enable_role_faker:false});await wait(100);expect(isRoleFaked()).toBe(false);expect(bits()).toBe("00");
 for(const fn of seam.settingListeners)fn({extension_enabled:false});await wait(100);expect(manager.activeIds()).toEqual([]);expect(bits()).toBe("11");await wait(12000);expect(bits()).toBe("11");expect(seam.messages.size).toBe(0);
});
