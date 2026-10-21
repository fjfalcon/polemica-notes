// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №7: двойная застрявшая подпись (C01) и матрица принятых сайтом команд (288 клеток).
// Audit7: actual role owners/observer/router. Only extension I/O mocked.
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {readFileSync} from "node:fs";
const wire=vi.hoisted(()=>({listeners:new Set<any>(),scene:"night" as string|null,connected:true,commands:[] as any[]}));
vi.mock("@core/env",()=>({browser:{storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}},sync:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}},runtime:{id:"audit7-matrix",getManifest:()=>({version:"9.68.0"})}}}));
vi.mock("@core/log",()=>({log:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock("@core/toast",()=>({showToast:vi.fn(),clearToasts:vi.fn()}));
vi.mock("@core/messaging",()=>({onMessage:(f:any)=>{wire.listeners.add(f);return()=>wire.listeners.delete(f)},sendRuntime:async(m:any)=>{wire.commands.push(m);return m.command==="get_status"?{success:true,data:{connected:wire.connected,sessionId:"a7",currentScene:wire.scene,scenes:[]}}:{success:true,data:{ignored:"not_owner"}}},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
import {autoStartFeature,isPeeking} from "@content/features/auto-start";
import {obsPanelFeature} from "@content/panels/obs-panel";
import {roleFakerFeature,isRoleFaked} from "@content/features/role-faker";
import {resetRolePinForTest} from "@content/role-pin";
type Cell={ah:boolean;obs:boolean;modifier:boolean;native:boolean};
const cfg=(c:Cell,ps=true)=>({settings:{auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,auto_hide_roles_enabled:c.ah,role_phase_auto_switch_enabled:ps,obs_enabled:c.obs,obs_auto_mode_enabled:c.obs,obs_day_scene:"day",obs_night_scene:"night",obs_floating_panel_enabled:false,enable_role_faker:true,hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV",hotkey_role_fake:"KeyF",hotkey_role_reset:"KeyE"}} as never);
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
function mount(native=true){document.body.innerHTML=`<div class="roller"><div class="stage"><div class="substage current">Ночь | Ход мафии</div><div class="substage next">Ночь | Стрельба</div></div></div><div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>`;for(const el of roles())el.style.display=native?"":"none";}
const roles=()=>[...document.querySelectorAll<HTMLElement>(".player__role")];
function value(el:HTMLElement,p:string){const inline=el.style.getPropertyValue(p);if(el.style.getPropertyPriority(p)==="important")return inline;let result="";for(const s of document.styleSheets)for(const r of Array.from(s.cssRules))if(r instanceof CSSStyleRule&&r.style.getPropertyPriority(p)==="important"&&el.matches(r.selectorText))result=r.style.getPropertyValue(p);return result||inline||getComputedStyle(el).getPropertyValue(p);}
const bits=()=>roles().map(el=>{for(let p:HTMLElement|null=el;p;p=p.parentElement)if(value(p,"display")==="none"||value(p,"opacity")==="0")return 0;return +(value(el,"visibility")!=="hidden");}).join("");
function key(code:string,type="keydown",extra:KeyboardEventInit={}){document.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:code.charCodeAt(3),which:code.charCodeAt(3),bubbles:true,cancelable:true,...extra}));}
const tap=(code:string)=>{key(code);key(code,"keyup")};
function stage(current:string,next:string){(document.querySelector(".current")!.firstChild as Text).nodeValue=current;(document.querySelector(".next")!.firstChild as Text).nodeValue=next;}
const stale=()=>stage("День | Речь игрока","Ночь | Стрельба");
const night=()=>stage("Ночь | Стрельба","День | Речь игрока");
const clearDay=()=>stage("День | Речь игрока","День | Голосование");
const rows:any[]=[];
function check(name:string,at:string,expected:string){const actual=bits();rows.push({name,at,expected,actual,time:Date.now(),peek:isPeeking(),fake:isRoleFaked(),scene:wire.scene,commands:wire.commands.filter(m=>m.command==="set_scene"),css:!!document.getElementById("polemica-role-hide"),roles:roles().map(el=>({pin:el.getAttribute("data-pn-role-pin"),style:el.getAttribute("style")}))});expect.soft(actual,`${name} ${at}`).toBe(expected);}
const fixture=readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt","utf8").split("\n").slice(1).join("\n");
const a=fixture.indexOf('Zd="undefined"'),b=fixture.indexOf("var _h=gh;",a);
const hotkeys=new Function("window","document","navigator",`var ${fixture.slice(a,b)};return gh;`)(window,document,navigator);
let nativeState=true;
function nativeSite(c:Cell){nativeState=c.native;hotkeys(c.modifier?"ctrl+d,command+d":"d",(e:KeyboardEvent)=>{e.preventDefault();nativeState=!nativeState;queueMicrotask(()=>{for(const el of roles())el.style.display=nativeState?"":"none"});return false;});}
async function boot(c:Cell){mount(c.native);nativeSite(c);autoStartFeature.enable(cfg(c));await obsPanelFeature.enable(cfg(c));roleFakerFeature.enable(cfg(c));await wait(8000);}
async function decision(show:boolean){tap("KeyD");await wait(100);if(show)tap("KeyD");await wait(100);expect(bits()).toBe(show?"11":"00");}
let run=0;
beforeEach(()=>{vi.useFakeTimers();vi.advanceTimersByTime(++run*100000);vi.setSystemTime(1900000000000);history.replaceState({},"","/game/1");document.head.innerHTML="";document.body.className="";wire.scene="night";wire.connected=true;wire.commands=[];vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({width:100,height:100,top:0,left:0,bottom:100,right:100,x:0,y:0,toJSON:()=>({})});vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(100);vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(100);});
afterEach(()=>{window.dispatchEvent(new Event("blur"));roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();hotkeys.unbind();window.dispatchEvent(new Event("focus"));resetRolePinForTest();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();document.documentElement.removeAttribute("data-pn-role-faked");document.documentElement.removeAttribute("data-pn-own-role-hidden");expect(wire.listeners.size).toBe(0);});
const cells:Cell[]=[];for(const ah of [false,true])for(const obs of [false,true])for(const modifier of [false,true])for(const native of [false,true])cells.push({ah,obs,modifier,native});
const repeats=cells.flatMap(c=>[false,true].flatMap(show=>[100,600,3000].map(gap=>({...c,show,gap}))));
test.each(repeats)("double transient ah=$ah obs=$obs m=$modifier native=$native show=$show gap=$gap",async c=>{
 await boot(c);await decision(c.show);const name=`double-${JSON.stringify(c)}`;
 stale();await wait(600);check(name,"first stale","00");night();await wait(c.gap);
 stale();await wait(600);check(name,"second stale","00");night();await wait(3016);check(name,"recovery+3016",c.show?"11":"00");await wait(12000);check(name,"recovery+15016",c.show?"11":"00");
 if(c.show){if(bits()==="00")tap("KeyD");await wait(100);check(name,"explicit D recovery control","11");}
});
const reversals=[false,true].flatMap(ah=>[false,true].flatMap(obs=>[false,true].flatMap(show=>[100,600,1999].map(gap=>({ah,obs,show,gap,modifier:true,native:true})))));
const automaticRepeats=cells.flatMap(c=>[100,600,3000].map(gap=>({...c,gap})));
test.each(automaticRepeats)("double automatic transient ah=$ah obs=$obs m=$modifier native=$native gap=$gap",async c=>{
 await boot(c);expect(bits()).toBe("11");const name=`automatic-${JSON.stringify(c)}`;
 stale();await wait(600);night();await wait(c.gap);stale();await wait(600);night();await wait(6016);check(name,"recovery+6016","11");await wait(12000);check(name,"recovery+18016","11");
 if(bits()==="00")tap("KeyD");await wait(100);check(name,"explicit D recovery control","11");
});
test.each(reversals)("clear-day confirmation reversed ah=$ah obs=$obs show=$show gap=$gap",async c=>{
 await boot(c);await decision(c.show);const name=`reverse-${JSON.stringify(c)}`;stale();await wait(3000);clearDay();await wait(c.gap);stale();await wait(3000);night();await wait(6016);check(name,"recovery+6016",c.show?"11":"00");await wait(12000);check(name,"recovery+18016",c.show?"11":"00");
});
test.each([100,600,3000])("new identity while transient CSS under V gap=%d",async gap=>{
 const c={ah:false,obs:false,modifier:false,native:true};await boot(c);tap("KeyD");key("KeyV");await wait(100);expect(bits()).toBe("11");stale();await wait(gap);expect(bits()).toBe("00");
 // Turn phase authority off; manual snapshot must not transfer across identity.
 autoStartFeature.update!(cfg(c,false));history.pushState({},"","/game/2");mount();await wait(16);check(`new-V-${gap}`,"new roots+16","11");key("KeyV","keyup");await wait(12000);check(`new-V-${gap}`,"released+12s","11");
});
type NativeCell=Cell&{ps:boolean;phase:"day"|"night"|"entryNight";scene:"night"|"other"|"disconnected"};
const nativeCells:NativeCell[]=[];
for(const c of cells)for(const ps of [false,true])for(const phase of ["day","night","entryNight"] as const)for(const scene of ["night","other","disconnected"] as const)nativeCells.push({...c,ps,phase,scene});
function nativeTap(modifier:boolean){if(modifier)key("ControlLeft","keydown",{key:"Control",keyCode:17,which:17,ctrlKey:true});key("KeyD","keydown",{ctrlKey:modifier});key("KeyD","keyup",{ctrlKey:modifier});if(modifier)key("ControlLeft","keyup",{key:"Control",keyCode:17,which:17});}
test.each(nativeCells)("native matrix ah=$ah ps=$ps obs=$obs m=$modifier phase=$phase scene=$scene native=$native",async c=>{
 const name=`native-${JSON.stringify(c)}`;
 mount(c.native);if(c.phase!=="entryNight")clearDay();wire.scene=c.scene==="disconnected"?null:c.scene;wire.connected=c.scene!=="disconnected";nativeSite(c);
 const context=cfg(c,c.ps) as any;context.settings.hotkey_role_hide="KeyH";
 autoStartFeature.enable(context);await obsPanelFeature.enable(context);roleFakerFeature.enable(context);await wait(8000);
 if(c.phase==="night"){night();await wait(8000);}
 const safeNight=c.obs&&c.phase!=="day"&&c.scene==="night";
 const baseline=c.obs?(safeNight?"11":"00"):c.ps?(c.phase!=="day"?"11":"00"):c.ah||!c.native?"00":"11";
 check(name,"baseline",baseline);
 // Explicit genuine native command receipt: defaultPrevented AND propagation stopped.
 if(nativeState){nativeTap(c.modifier);await wait(40);check(name,"native Hide","00");}
 nativeTap(c.modifier);await wait(40);check(name,"native Show",c.obs&&!safeNight?"01":"11");
 nativeTap(c.modifier);await wait(40);check(name,"native Hide again","00");
 for(const [i,el] of roles().entries()){const fresh=document.createElement("span");fresh.className=`player__role role ${i===0?"my-role":""}`;fresh.innerHTML=`<svg><use href="#${i===0?"sheriff":"mafia"}"></use></svg>`;fresh.style.display="none";el.replaceWith(fresh);}await wait(100);check(name,"hidden roots rerender","00");
 key("KeyV");await wait(100);check(name,"V held","11");key("KeyV","keyup");await wait(100);check(name,"V released","00");
 tap("KeyF");await wait(100);check(name,"F hidden","00");key("KeyV");await wait(100);check(name,"F V held","10");key("KeyV","keyup");tap("KeyE");await wait(100);check(name,"E hidden","00");
 const off={settings:{...context.settings,auto_hide_roles_enabled:false,role_phase_auto_switch_enabled:false}} as never;
 autoStartFeature.update!(off);obsPanelFeature.update!(off);await wait(600);check(name,"privacy settings off preserve manual Hide","00");
 autoStartFeature.update!(context);obsPanelFeature.update!(context);await wait(3000);check(name,"settings on preserve manual Hide","00");
 window.dispatchEvent(new Event("blur"));roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();await wait(3000);check(name,"teardown returns native Hide","00");
});
