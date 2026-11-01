// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, §4.3: F сразу после смены настоящей роли в том же узле.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id:"audit5-fake" }, storage: { local: { get:async()=>({}),set:async()=>{} } } } }));
vi.mock("@core/log", () => ({ log:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()} }));
vi.mock("@core/toast", () => ({ showToast:vi.fn() }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive:()=>false,nightSceneSafeForRoleShow:()=>true,setRoleSceneGateListener:()=>()=>{} }));
import { autoStartFeature } from "@content/features/auto-start";
import { roleFakerFeature } from "@content/features/role-faker";
const ns="http://www.w3.org/1999/xlink";
let epoch=0;
const own=()=>document.querySelector<HTMLElement>(".my-role")!;
const use=()=>own().querySelector("use")!;
const tip=()=>own().querySelector(".tooltip span")!;
const tick=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
function press(code:string) { for(const type of ["keydown","keyup"]) document.dispatchEvent(new KeyboardEvent(type,{code,keyCode:code.charCodeAt(3),bubbles:true,cancelable:true})); }
beforeEach(()=>{
 vi.useFakeTimers(); vi.advanceTimersByTime(++epoch*100000); vi.setSystemTime(1_900_000_000_000);
 document.head.replaceChildren(); document.body.className="";
 document.body.innerHTML='<div class="stage"><div class="substage current">Речь игрока</div></div><div class="player my-player"><span class="player__role role my-role sheriff"><svg><use></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>';
 use().setAttributeNS(ns,"xlink:href","/sprite.svg#sheriff");
 const settings={auto_accept_enabled:false,skip_start_screen_enabled:false,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false,hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV",hotkey_role_fake:"KeyF",hotkey_role_reset:"KeyE"};
 autoStartFeature.enable({settings} as never); roleFakerFeature.enable({settings} as never);
});
afterEach(async()=>{
 roleFakerFeature.disable(); autoStartFeature.disable(); window.dispatchEvent(new Event("blur"));
 await Promise.resolve(); vi.clearAllTimers();vi.useRealTimers();document.head.replaceChildren();document.body.replaceChildren();
});
test.each(["direct-E", "F-after-1ms", "F-after-600ms", "new-root-F"])("conditional real role change: %s",async mode=>{
 press("KeyF"); await tick(600);
 expect(use().getAttribute("href")).toBe("/sprite.svg#godfather");
 expect(own().getAttribute("data-original-role")).toBe("sheriff");
 // A truthy-to-truthy Vue update can retain role-root and patch its real xlink.
 // New civilian != original sheriff, current fake godfather, or next fake mafia.
 use().setAttributeNS(ns,"xlink:href","/sprite.svg#civilian");
 tip().textContent="Ваша роль - Мирный"; own().classList.replace("sheriff","civilian");
 if(mode === "new-root-F") {
  const fresh=own().cloneNode(true) as HTMLElement;
  for(const attr of ["data-original-role","data-original-role-name","data-original-sprite-base"]) fresh.removeAttribute(attr);
  fresh.querySelector("use")!.removeAttribute("href"); own().replaceWith(fresh);
 }
 if(mode !== "direct-E") { await tick(mode === "F-after-600ms" ? 600 : 1); press("KeyF"); await tick(600); }
 press("KeyE"); await tick(600);
 expect({href:use().getAttribute("href"),name:tip().textContent}).toEqual({href:"/sprite.svg#civilian",name:"Ваша роль - Мирный"});
});
