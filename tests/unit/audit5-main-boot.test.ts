// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, B04: автосцены защищают стол, пока менеджер ждёт заметки.
import {beforeEach,afterEach,expect,test,vi} from 'vitest';
const seam=vi.hoisted(()=>({notesResolve:null as null|(()=>void),settings:{} as any,notesPending:false,listeners:new Set<any>()}));
vi.mock('@core/env',()=>({browser:{
  storage:{local:{get:async(keys:any)=>{
    if(keys && !Array.isArray(keys) && Object.hasOwn(keys,'playerNotes')) {
      seam.notesPending=true;
      await new Promise<void>(resolve=>{seam.notesResolve=resolve;});
      return {...keys,pn_notes_migrated_v1:true};
    }
    return typeof keys==='object'&&!Array.isArray(keys)?keys:{};
  },set:async()=>{},remove:async()=>{}},sync:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}},
  runtime:{id:'audit5',getManifest:()=>({version:'9.67.0'}),getURL:(p:string)=>p}
}}));
vi.mock('@core/settings',async(importOriginal)=>({...await importOriginal<any>(),getSettings:async()=>seam.settings,onSettingsChanged:()=>()=>{}}));
vi.mock('@core/log',()=>({log:{debug(){},info(){},warn(){},error(){},setPersist(){},setLevel(){}}}));
vi.mock('@core/messaging',()=>({onMessage:(f:any)=>{seam.listeners.add(f);return()=>seam.listeners.delete(f)},sendRuntime:async(m:any)=>m.command==='get_status'?{success:true,data:{connected:false,currentScene:null,scenes:[]}}:{success:true},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
vi.mock('@core/toast',()=>({showToast(){},clearToasts(){}}));
import {DEFAULT_SETTINGS} from '@core/settings';
import {FeatureManager} from '@core/feature';
import {autoStartFeature} from '@content/features/auto-start';
import {playerNotesFeature} from '@content/features/player-notes';
import {obsPanelFeature} from '@content/panels/obs-panel';
let pending:Promise<void>|null=null;
const snap=()=>[...document.querySelectorAll<HTMLElement>('.player__role')].map(el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'});
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(1800000000000);document.head.innerHTML='';
  document.body.innerHTML='<div class="roller"><div class="stage"><div class="substage current">День | речь игрока</div></div></div><div class="player my-player"><span class="player__role role my-role">MAFIA</span></div><div class="player"><span class="player__role role">DON</span></div>';
  seam.notesPending=false;seam.notesResolve=null;
  seam.settings={...DEFAULT_SETTINGS,extension_enabled:true,auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,statistics_enabled:true,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false,obs_enabled:true,obs_auto_mode_enabled:true,obs_floating_panel_enabled:false,obs_day_scene:'DAY',obs_night_scene:'NIGHT'};
});
afterEach(async()=>{seam.notesResolve?.();if(pending)await pending;pending=null;obsPanelFeature.disable();playerNotesFeature.disable();autoStartFeature.disable();vi.clearAllTimers();vi.useRealTimers();});
test('RED OBS-only boot hides roles before awaiting unrelated notes storage',async()=>{
  // Exact relative production order: content/index.ts:58,60,81.
  const manager=new FeatureManager().register(autoStartFeature,playerNotesFeature,obsPanelFeature);
  pending=manager.start();await vi.advanceTimersByTimeAsync(100);
  expect(seam.notesPending).toBe(true);
  expect(snap(),'OBS enabled + non-night Program must hide all while notes storage is pending').toEqual([false,false]);
});
test('CONTROL auto-hide protects the same delayed-notes boot',async()=>{
  seam.settings.auto_hide_roles_enabled=true;
  pending=new FeatureManager().register(autoStartFeature,playerNotesFeature,obsPanelFeature).start();await vi.advanceTimersByTimeAsync(100);
  expect(seam.notesPending).toBe(true);expect(snap()).toEqual([false,false]);
});
test('CONTROL with statistics disabled OBS protection starts without notes await',async()=>{
  seam.settings.statistics_enabled=false;
  pending=new FeatureManager().register(autoStartFeature,playerNotesFeature,obsPanelFeature).start();await vi.advanceTimersByTimeAsync(100);
  expect(seam.notesPending).toBe(false);expect(snap()).toEqual([false,false]);
});
