// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, §4.1: SPA/новая игра/легаси-инлайн/следы подмены.
// Audit5 B/E: small independently booted witnesses, production unmodified.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const wire = vi.hoisted(() => ({listeners:new Set<(m:unknown)=>unknown>()}));
vi.mock("@core/env",()=>({browser:{storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}},sync:{set:async()=>{}}},runtime:{id:"a5-witness",getManifest:()=>({version:"9.68.0"})}}}));
vi.mock("@core/log",()=>({log:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock("@core/toast",()=>({showToast:vi.fn(),clearToasts:vi.fn()}));
vi.mock("@core/messaging",()=>({
  onMessage:(f:(m:unknown)=>unknown)=>{wire.listeners.add(f);return()=>wire.listeners.delete(f);},
  sendRuntime:async(m:{command?:string})=>m.command==="get_status"
    ?{success:true,data:{connected:true,sessionId:"w",currentScene:wireScene,scenes:[]}}
    :{success:true,data:{ignored:"not_owner"}},
  broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{},
}));
import {autoStartFeature,isPeeking} from "@content/features/auto-start";
import {obsPanelFeature} from "@content/panels/obs-panel";
import {roleFakerFeature,isRoleFaked} from "@content/features/role-faker";
import {resetRolePinForTest} from "@content/role-pin";
let wireScene="night";
let clockEpoch=0;
const settings=(ah=false,ps=false,obs=false)=>({settings:{
  auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,
  auto_hide_roles_enabled:ah,role_phase_auto_switch_enabled:ps,
  obs_enabled:obs,obs_auto_mode_enabled:obs,obs_day_scene:"day",obs_night_scene:"night",obs_floating_panel_enabled:false,
  hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV",hotkey_role_fake:"KeyF",hotkey_role_reset:"KeyE",enable_role_faker:true,
}} as never);
function mount(phase:string|null){document.body.innerHTML=`${phase?`<div class="roller"><div class="stage"><div class="substage current">${phase}</div></div></div>`:""}<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>`;}
function value(el:HTMLElement,p:string){const inline=el.style.getPropertyValue(p);if(el.style.getPropertyPriority(p)==="important")return inline;let result="";for(const s of document.styleSheets)for(const r of Array.from(s.cssRules))if(r instanceof CSSStyleRule&&r.style.getPropertyPriority(p)==="important"&&el.matches(r.selectorText))result=r.style.getPropertyValue(p);return result||inline||getComputedStyle(el).getPropertyValue(p);}
const roles=()=>[...document.querySelectorAll<HTMLElement>(".player__role")];
const bits=()=>roles().map(el=>{for(let p:HTMLElement|null=el;p;p=p.parentElement)if(value(p,"display")==="none"||value(p,"opacity")==="0")return 0;return +(value(el,"visibility")!=="hidden");}).join("");
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
function key(code:string,type="keydown"){document.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:code.charCodeAt(3),bubbles:true,cancelable:true}));}
async function enable(c:never,faker=true){autoStartFeature.enable(c);if(faker)roleFakerFeature.enable(c);await obsPanelFeature.enable(c);}
beforeEach(()=>{vi.useFakeTimers();vi.advanceTimersByTime(++clockEpoch*1000000);vi.setSystemTime(1900000000000);history.replaceState({},"","/game/41");document.head.innerHTML="";document.body.className="";wireScene="night";vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({width:100,height:100,top:0,left:0,bottom:100,right:100,x:0,y:0,toJSON:()=>({})});});
afterEach(()=>{window.dispatchEvent(new Event("blur"));roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();resetRolePinForTest();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();document.documentElement.removeAttribute("data-pn-role-faked");document.documentElement.removeAttribute("data-pn-own-role-hidden");});
beforeEach(()=>{vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(100);vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(100);});

test.each([[false,false],[true,false],[false,true]])("unsafe DAY new room before first paint ah=%s ps=%s",async(ah,ps)=>{
  wireScene="day";mount("Ночь | ход мафии");await enable(settings(ah,ps,true));await wait(8000);
  // A genuine preceding DOM batch makes the regular subscriber respect its
  // 250ms throttle. Immediate safety must not depend on coincidental rAF phase.
  document.body.append(document.createElement("i"));await wait(16);
  const before=bits();history.pushState({},"","/game/42");mount("День | речь игрока");await wait(16);
  const firstFrame=bits();await wait(1000);
  expect({before,firstFrame,settled:bits()}).toEqual({before:"00",firstFrame:"00",settled:"00"});
});
test.each([40,500])("observed exit/back same route under pending V gap=%d",async gap=>{
  mount("Ночь | ход мафии");await enable(settings(true,true,true));await wait(2000);key("KeyV");await wait(40);
  history.pushState({},"","/game-search");document.body.innerHTML="<p>search mutation delivered</p>";await wait(gap);
  history.pushState({},"","/game/41");mount(null);await wait(12000);
  const beforeRelease=bits();key("KeyV","keyup");await wait(16);const afterRelease=bits();await wait(12000);
  expect({beforeRelease,afterRelease,later:bits(),peek:isPeeking()}).toEqual({beforeRelease:"00",afterRelease:"00",later:"00",peek:false});
});
test.each([false,true])("old legacy inline V snapshot cannot attach to fresh own role legacy=%s",async legacy=>{
  mount("День | речь игрока");await enable(settings());await wait(8000);
  if(legacy){roles()[0].style.visibility="hidden";roles()[0].style.opacity="0";}
  else {key("KeyD");key("KeyD","keyup");}
  key("KeyV");await wait(40);history.pushState({},"","/game/42");mount("День | речь игрока");await wait(1);
  key("KeyV","keyup");await wait(16);const after=bits();await wait(8000);
  expect({after,later:bits()}).toEqual({after:"11",later:"11"});
});
test.each([false,true])("conditional new runtime over F DOM, faker enabled=%s",async faker=>{
  mount("День | речь игрока");await enable(settings());await wait(8000);key("KeyF");key("KeyF","keyup");await wait(300);
  const head=document.head.innerHTML,body=document.body.innerHTML;
  roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();
  document.head.innerHTML=head;document.body.innerHTML=body;document.documentElement.setAttribute("data-pn-role-faked","");
  await enable(settings(),faker);await wait(40);key("KeyV");await wait(40);
  expect({bits:bits(),fake:isRoleFaked(),href:roles()[0].querySelector("use")!.getAttribute("href")}).toEqual({bits:"11",fake:false,href:"#sheriff"});
});

test.each(["query","repeat-round"])("new identity without pathname change: auto-hide re-arms after old manual show (%s)",async kind=>{
  history.replaceState({},"","/game?game_id=410");mount("Ночь | ход мафии");await enable(settings(true));await wait(8000);
  key("KeyD");key("KeyD","keyup");
  document.querySelector(".roller")!.innerHTML='<div class="ended ended-civilian"><div class="ended__title">Победа мирных</div></div>';await wait(4000);
  document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';await wait(10000);
  if(kind==="query")history.pushState({},"","/game?game_id=411");
  mount("Раздача карт");await wait(16);const after=bits();await wait(12000);
  expect({after,later:bits()}).toEqual({after:"00",later:"00"});
});
test.each(["query","repeat-round"])("new identity without pathname change: old manual hide does not follow next game (%s)",async kind=>{
  history.replaceState({},"","/game?game_id=410");mount("Ночь | ход мафии");await enable(settings());await wait(8000);
  key("KeyD");key("KeyD","keyup");
  document.querySelector(".roller")!.innerHTML='<div class="ended ended-civilian"><div class="ended__title">Победа мирных</div></div>';await wait(4000);
  document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';await wait(10000);
  if(kind==="query")history.pushState({},"","/game?game_id=411");
  mount("Раздача карт");await wait(16);const after=bits();await wait(12000);
  expect({after,later:bits()}).toEqual({after:"11",later:"11"});
});
