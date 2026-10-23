// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №4, B01/§2.2: «Промах» (замена роллера), Text-узел этапа,
// замена этапа целиком — день скрывает роли до первого кадра.
import { beforeEach, afterEach, test, expect, vi } from "vitest";
vi.mock("@core/log", () => ({ log: {debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()} }));
vi.mock("@core/env", () => ({browser:{storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>{})}},runtime:{id:"audit"}}}));
vi.mock("@core/messaging", () => ({onMessage:vi.fn(()=>()=>{}),sendRuntime:vi.fn(async()=>({success:true})),broadcastToGameTabs:vi.fn()}));
vi.mock("@core/toast", () => ({showToast:vi.fn()}));
vi.mock("@content/features/role-faker", () => ({isRoleFaked:()=>false}));
vi.mock("@content/panels/obs-panel",()=>({obsAutoScenesActive:()=>false,nightSceneSafeForRoleShow:()=>true,setRoleSceneGateListener:()=>()=>{}}));
import { autoStartFeature } from "@content/features/auto-start";
// roles_reveal_on_game_end:false — прежняя политика «экран итога = день»: этот
// аудит пинит скорость скрытия. Открытие стола в конце матча (23.10.2026) —
// отдельные тесты ниже.
const ctx=(reveal=false)=>({settings:{auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,auto_hide_roles_enabled:true,role_phase_auto_switch_enabled:true,roles_reveal_on_game_end:reveal,hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV"}} as never);
const snap=()=>[...document.querySelectorAll<HTMLElement>(".player__role")].map(e=>{const s=getComputedStyle(e);return s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0";});
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);document.head.innerHTML="";document.body.className="";
 Object.defineProperty(HTMLElement.prototype,"offsetWidth",{configurable:true,get:()=>100});
 Object.defineProperty(HTMLElement.prototype,"offsetHeight",{configurable:true,get:()=>100});
 document.body.innerHTML=`<div class="roller"><div class="stage"><div class="substage current">Ход мафии</div></div></div><div class="player my-player"><span class="player__role role my-role mafia"><svg><use href="#mafia"/></svg></span></div><div class="player"><span class="player__role role godfather"><svg><use href="#godfather"/></svg></span></div>`;
});
afterEach(()=>{autoStartFeature.disable();vi.clearAllTimers();vi.useRealTimers();});
test.each(["ended-mafia-missed","ended-civilian","replace-stage","replace-text-node","body-day"])("day %s is hidden by first frame",async(kind)=>{
 autoStartFeature.enable(ctx());await vi.advanceTimersByTimeAsync(8251);expect(snap()).toEqual([true,true]);
 if(kind.startsWith("ended"))document.querySelector(".roller")!.innerHTML=`<div class="ended ${kind}"><div class="ended__title">${kind==="ended-mafia-missed"?"Промах":"Победа мирных"}</div></div>`;
 else if(kind==="replace-stage")document.querySelector(".roller")!.innerHTML='<div class="stage"><div class="substage current">Речь игрока</div></div>';
 else if(kind==="replace-text-node")document.querySelector(".substage.current")!.firstChild!.nodeValue="Речь игрока";
 else document.body.classList.add("day");
 const trace:unknown[]=[];let at=0;
 for(const t of [0,16,100,301,500,1000,1300]){await vi.advanceTimersByTimeAsync(t-at);at=t;trace.push({t,snap:snap()});}
 expect(trace[1]).toEqual({t:16,snap:[false,false]});
});
test("control textContent childList inside retained stage hides before frame",async()=>{
 autoStartFeature.enable(ctx());await vi.advanceTimersByTimeAsync(8100);
 document.querySelector(".substage.current")!.textContent="Речь игрока";
 await vi.advanceTimersByTimeAsync(16);expect(snap()).toEqual([false,false]);
});

test("конец матча (победа) с «Открывать роли в конце игры» — стол открыт с первого кадра и не прячется дальше",async()=>{
 autoStartFeature.enable(ctx(true));await vi.advanceTimersByTimeAsync(8251);
 document.body.classList.add("day");await vi.advanceTimersByTimeAsync(3000);expect(snap(),"день прячет").toEqual([false,false]);
 document.querySelector(".roller")!.innerHTML='<div class="ended ended-civilian"><div class="ended__title">Победа мирных</div></div>';
 await vi.advanceTimersByTimeAsync(16);expect(snap(),"первый кадр итога").toEqual([true,true]);
 await vi.advanceTimersByTimeAsync(10000);expect(snap(),"фаза «итог = день» больше не прячет").toEqual([true,true]);
});
test("промах мафии — НЕ конец матча: и с открытием в конце стол прячется",async()=>{
 autoStartFeature.enable(ctx(true));await vi.advanceTimersByTimeAsync(8251);expect(snap()).toEqual([true,true]);
 document.querySelector(".roller")!.innerHTML='<div class="ended ended-mafia-missed"><div class="ended__title">Промах</div></div>';
 await vi.advanceTimersByTimeAsync(16);expect(snap()).toEqual([false,false]);
});
test("конец матча: D после открытия прячет, и стол остаётся спрятанным (решение игрока)",async()=>{
 autoStartFeature.enable(ctx(true));await vi.advanceTimersByTimeAsync(8251);
 document.querySelector(".roller")!.innerHTML='<div class="ended ended-mafia"><div class="ended__title">Победа мафии</div></div>';
 await vi.advanceTimersByTimeAsync(100);expect(snap()).toEqual([true,true]);
 document.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyD",key:"d",keyCode:68,bubbles:true,cancelable:true}));
 document.dispatchEvent(new KeyboardEvent("keyup",{code:"KeyD",key:"d",keyCode:68,bubbles:true,cancelable:true}));
 await vi.advanceTimersByTimeAsync(5000);expect(snap()).toEqual([false,false]);
});
