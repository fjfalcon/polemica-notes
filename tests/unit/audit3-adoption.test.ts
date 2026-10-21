// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { beforeEach, afterEach, test, expect, vi } from "vitest";
vi.mock("@core/log", () => ({ log: {debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()} }));
vi.mock("@core/env", () => ({browser:{storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>{})}},runtime:{id:"audit"}}}));
vi.mock("@core/messaging", () => ({onMessage:vi.fn(()=>()=>{}),sendRuntime:vi.fn(async()=>({success:true})),broadcastToGameTabs:vi.fn()}));
vi.mock("@core/toast", () => ({showToast:vi.fn()}));
vi.mock("@content/features/role-faker", () => ({isRoleFaked:()=>false}));
const obs = vi.hoisted(()=>({auto:false,safe:true,fn:null as null|((reason?:string,info?:{nightSince:number})=>void)}));
vi.mock("@content/panels/obs-panel",()=>({obsAutoScenesActive:()=>obs.auto,nightSceneSafeForRoleShow:()=>!obs.auto||obs.safe,setRoleSceneGateListener:(fn:typeof obs.fn)=>{obs.fn=fn;return()=>{obs.fn=null;}}}));
import { autoStartFeature } from "@content/features/auto-start";
const ctx=(hide=false,phase=false)=>({settings:{auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,auto_hide_roles_enabled:hide,role_phase_auto_switch_enabled:phase,hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV"}} as never);
function table(phase="day",flag=true){
 document.body.innerHTML=`<button id="menu">Скрыть роли</button><div class="stage"><div class="substage current">${phase==="night"?"Ход мафии":"Речь игрока"}</div></div><div class="player my-player"><span class="player__role role my-role mafia"><svg><use href="#mafia"/></svg></span></div><div class="player"><span class="player__role role godfather"><svg><use href="#godfather"/></svg></span></div>`;
 for(const e of roles())e.style.display=flag?"":"none";
}
const roles=()=>[...document.querySelectorAll<HTMLElement>(".player__role")];
const snap=()=>roles().map(e=>!document.getElementById("polemica-role-hide")&&e.style.visibility!=="hidden"&&e.style.opacity!=="0");
const cssState=()=>roles().map(e=>{const s=getComputedStyle(e);return {inlineDisplay:e.style.display,visibility:s.visibility,opacity:s.opacity,css:!!document.getElementById("polemica-role-hide")};});
function key(type:string,code:string){document.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:code.charCodeAt(3),bubbles:true,cancelable:true}));}
const press=(code:string)=>{key("keydown",code);key("keyup",code);};
async function site(flag:boolean,user=true){
 if(user)document.getElementById("menu")!.click();
 queueMicrotask(()=>{for(const e of roles())e.style.display=flag?"":"none";});
 await Promise.resolve(); await Promise.resolve();
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);obs.auto=false;obs.safe=true;document.head.innerHTML="";table();});
afterEach(()=>{autoStartFeature.disable();vi.clearAllTimers();vi.useRealTimers();document.body.className="";});

test("RED phase-only enable hides daytime roles before next frame",async()=>{
 autoStartFeature.enable(ctx(false,true));
 await vi.advanceTimersByTimeAsync(500);
 console.log("phase-only boot +500ms",snap());
 expect(snap()).toEqual([false,false]);
});
test("RED enable phase-only midgame hides day within 300ms",async()=>{
 autoStartFeature.enable(ctx());await vi.advanceTimersByTimeAsync(2500);
 autoStartFeature.update!(ctx(false,true));await vi.advanceTimersByTimeAsync(301);
 console.log("phase-only update +301ms",snap());
 expect(snap()).toEqual([false,false]);
});
test("RED accepted site hide under V is not replayed by night automation",async()=>{
 table("night");autoStartFeature.enable(ctx(true,true));await vi.advanceTimersByTimeAsync(6000);
 // Own D hides without changing the site flag; V removes CSS, menu hides native flag under V.
 press("KeyD");key("keydown","KeyV");await site(false);
 key("keyup","KeyV");await vi.advanceTimersByTimeAsync(12000);
 expect(snap()).toEqual([false,false]);
});
test("RED no auto reveal after new game entered on same document",async()=>{
 autoStartFeature.enable(ctx(true,false));await vi.advanceTimersByTimeAsync(2500);press("KeyD");expect(snap()).toEqual([true,true]);
 history.pushState(null,"","/game/2");table("day",true);
 await vi.advanceTimersByTimeAsync(12000);
 console.log("same-document new game",snap());expect(snap()).toEqual([false,false]);
});
test("RED scene gate release after settings-off under V does not resurrect auto CSS",async()=>{
 obs.auto=true;obs.safe=false;autoStartFeature.enable(ctx(true,false));obs.fn!("gate");
 key("keydown","KeyV");autoStartFeature.update!(ctx(false,false));
 obs.auto=false;obs.safe=true;obs.fn!("gate");key("keyup","KeyV");await vi.advanceTimersByTimeAsync(12000);
 console.log("settings and scene-off under V",snap());expect(snap()).toEqual([true,true]);
});
test("RED disabling phase after stale manual day hide preserves manual origin",async()=>{
 autoStartFeature.enable(ctx(false,true));await vi.advanceTimersByTimeAsync(2500);
 // Site decision upgrades reason to manual, then next phase must not downgrade.
 await site(false);autoStartFeature.update!(ctx(false,false));await vi.advanceTimersByTimeAsync(12000);
 expect(snap()).toEqual([false,false]);
});
test("RED native show under V after automatic hide installed under V wins on release",async()=>{
 table("day",false);autoStartFeature.enable(ctx(false,false));await vi.advanceTimersByTimeAsync(2500);
 key("keydown","KeyV");expect(snap()).toEqual([true,true]);
 autoStartFeature.update!(ctx(true,false)); // auto hide on while peeking
 await site(true);key("keyup","KeyV");await vi.advanceTimersByTimeAsync(12000);
 console.log("menu show after re-hide under V",snap());expect(snap()).toEqual([true,true]);
});
test("RED manual site hide observed only after role-less delay does not auto reveal at night",async()=>{
 table("night",true);autoStartFeature.enable(ctx(true,true));await vi.advanceTimersByTimeAsync(6000);
 const saved=roles().map(e=>e.outerHTML);for(const e of roles())e.remove();await Promise.resolve();
 document.getElementById("menu")!.click(); // native roleDisplay=false while there are no roles
 await vi.advanceTimersByTimeAsync(701);
 document.querySelectorAll(".player").forEach((e,i)=>{e.innerHTML=saved[i];(e.firstElementChild as HTMLElement).style.display="none";});
 await Promise.resolve();key("keydown","KeyV");key("keyup","KeyV");await vi.advanceTimersByTimeAsync(12000);
 console.log("manual hide late mount then V",snap());expect(snap()).toEqual([false,false]);
});
test("RED a single own-D as night phase is first detected does not auto reveal later",async()=>{
 table("night",true);autoStartFeature.enable(ctx(false,true));
 await vi.advanceTimersByTimeAsync(1000); // phase timer queued for 1150; player hides at 1050
 await vi.advanceTimersByTimeAsync(50);press("KeyD");expect(snap()).toEqual([false,false]);
 await vi.advanceTimersByTimeAsync(12000);
 console.log("manual before detected night",snap(),cssState());expect(snap()).toEqual([false,false]);
});
test("RED manual show-hide 50ms after real DOM night begins is respected this night",async()=>{
 table("day",true);autoStartFeature.enable(ctx(true,true));await vi.advanceTimersByTimeAsync(6000);
 document.querySelector(".substage.current")!.textContent="Ход мафии";
 press("KeyD");await vi.advanceTimersByTimeAsync(50);press("KeyD");expect(snap()).toEqual([false,false]);
 await vi.advanceTimersByTimeAsync(12000);
 console.log("D-D before detected night after real day",snap(),cssState());expect(snap()).toEqual([false,false]);
});
test("RED phase-only boot full timing trace",async()=>{
 autoStartFeature.enable(ctx(false,true));
 const trace:unknown[]=[];let at=0;
 for(const t of [0,16,149,300,500,999,1000,1149,1150,1200]){await vi.advanceTimersByTimeAsync(t-at);at=t;trace.push({t,visible:snap()});}
 console.log("PHASE-BOOT-TRACE",JSON.stringify(trace));
 expect(trace).toEqual(expect.arrayContaining([{t:16,visible:[false,false]}]));
});
test("RED site show under V after actual night-to-day CSS survives release",async()=>{
 table("night",false);autoStartFeature.enable(ctx(true,true));await vi.advanceTimersByTimeAsync(6000);
 press("KeyD");key("keydown","KeyV");expect(snap()).toEqual([true,true]);
 document.querySelector(".substage.current")!.textContent="Речь игрока";
 await vi.advanceTimersByTimeAsync(1600);
 await site(true);key("keyup","KeyV");await vi.advanceTimersByTimeAsync(12000);
 console.log("manual show after night->day under V",snap(),cssState());expect(snap()).toEqual([true,true]);
});
test("RED programmed site show near unrelated click is not a player role decision",async()=>{
 table("day",false);autoStartFeature.enable(ctx());await vi.advanceTimersByTimeAsync(2500);
 const other=document.createElement("button");other.textContent="чат";document.body.append(other);
 other.click();await vi.advanceTimersByTimeAsync(50);
 await site(true,false);await vi.advanceTimersByTimeAsync(12000);
 console.log("unrelated input then programmed site show",snap());expect(snap()).toEqual([false,false]);
});
