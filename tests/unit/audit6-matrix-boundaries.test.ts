// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №6, C01: флаг сайта прошлой игры; границы новой игры.
// Audit6 B/E; production unchanged. Real feature owners, observer, CSS cascade.
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {readFileSync} from "node:fs";
const wire=vi.hoisted(()=>({listeners:new Set<any>(), status:null as null|Promise<any>, store:{} as any, commands:[] as any[]}));
vi.mock("@core/env",()=>({browser:{storage:{local:{get:async()=>wire.store,set:async()=>{},remove:async()=>{}},sync:{set:async()=>{}}},runtime:{id:"audit6-matrix",getManifest:()=>({version:"9.68.0"})}}}));
vi.mock("@core/log",()=>({log:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock("@core/toast",()=>({showToast:vi.fn(),clearToasts:vi.fn()}));
vi.mock("@core/messaging",()=>({onMessage:(f:any)=>{wire.listeners.add(f);return()=>wire.listeners.delete(f)},sendRuntime:async(m:any)=>{wire.commands.push(m);return m.command==="get_status"?(wire.status??{success:true,data:{connected:true,sessionId:"a6",currentScene:"night",scenes:[]}}):{success:true,data:{ignored:"not_owner"}}},broadcastToGameTabs:async()=>{},sendToActiveTabStrict:async()=>{}}));
import {autoStartFeature,isPeeking} from "@content/features/auto-start";
import {obsPanelFeature} from "@content/panels/obs-panel";
import {roleFakerFeature,isRoleFaked} from "@content/features/role-faker";
import {resetRolePinForTest} from "@content/role-pin";
const cfg=(ah=false,ps=false,obs=false)=>({settings:{auto_accept_enabled:false,skip_start_screen_enabled:false,disable_webcam_clicks:true,auto_hide_roles_enabled:ah,role_phase_auto_switch_enabled:ps,obs_enabled:obs,obs_auto_mode_enabled:obs,obs_day_scene:"day",obs_night_scene:"night",obs_floating_panel_enabled:false,enable_role_faker:true,hotkey_role_hide:"KeyD",hotkey_role_peek:"KeyV",hotkey_role_fake:"KeyF",hotkey_role_reset:"KeyE"}} as never);
const wait=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
function mount(phase:string|null){document.body.innerHTML=`${phase?`<div class="roller"><div class="stage"><div class="substage current">${phase}</div></div></div>`:""}<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>`;}
function value(el:HTMLElement,p:string){const inline=el.style.getPropertyValue(p);if(el.style.getPropertyPriority(p)==="important")return inline;let result="";for(const s of document.styleSheets)for(const r of Array.from(s.cssRules))if(r instanceof CSSStyleRule&&r.style.getPropertyPriority(p)==="important"&&el.matches(r.selectorText))result=r.style.getPropertyValue(p);return result||inline||getComputedStyle(el).getPropertyValue(p);}
const roles=()=>[...document.querySelectorAll<HTMLElement>(".player__role")];
const bits=()=>roles().map(el=>{for(let p:HTMLElement|null=el;p;p=p.parentElement)if(value(p,"display")==="none"||value(p,"opacity")==="0")return 0;return +(value(el,"visibility")!=="hidden");}).join("");
function key(code:string,type="keydown"){document.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),keyCode:code.charCodeAt(3),bubbles:true,cancelable:true}));}
const tap=(code:string)=>{key(code);key(code,"keyup")};
const rows:any[]=[];
function record(name:string,at:string,expected:string){const actual=bits();rows.push({name,at,expected,actual,path:location.href,peek:isPeeking(),fake:isRoleFaked(),css:!!document.getElementById("polemica-role-hide"),roles:roles().map(el=>({pin:el.getAttribute("data-pn-role-pin"),style:el.getAttribute("style"),href:el.querySelector("use")?.getAttribute("href")}))});return actual;}
let clock=0;
beforeEach(()=>{vi.useFakeTimers();vi.advanceTimersByTime(++clock*1000000);vi.setSystemTime(1900000000000);history.replaceState({},"","/game?game_id=41");document.head.innerHTML="";document.body.className="";wire.store={};wire.status=null;wire.commands=[];vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({width:100,height:100,top:0,left:0,bottom:100,right:100,x:0,y:0,toJSON:()=>({})});vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(100);vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(100);});
afterEach(()=>{window.dispatchEvent(new Event("blur"));roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();resetRolePinForTest();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();document.documentElement.removeAttribute("data-pn-role-faked");document.documentElement.removeAttribute("data-pn-own-role-hidden");});

test.each([false,true])("pending get_status boot across query route must not restore old NIGHT ps=%s",async ps=>{
  mount("Ночь | ход мафии");autoStartFeature.enable(cfg(false,ps,true));
  wire.store={obs_auto_scene_state:{sessionId:"a6",currentTimeOfDay:"night",timestamp:Date.now()}};
  let resolve!:(v:any)=>void;wire.status=new Promise(r=>resolve=r);
  const pending=obsPanelFeature.enable(cfg(false,ps,true));await wait(100);
  history.pushState({},"","/game?game_id=42");mount(null);await wait(16);
  expect(record(`old-status-ps${ps}`,"new route+16","00")).toBe("00");
  resolve({success:true,data:{connected:true,sessionId:"a6",currentScene:"night",scenes:[]}});await pending;await wait(16);
  expect.soft(record(`old-status-ps${ps}`,"old status+16","00")).toBe("00");
  await wait(12000);expect(record(`old-status-ps${ps}`,"old status+12016","00")).toBe("00");
});

test.each([false,true])("transient hidden pregame marker must not reset manual hide obs=%s",async obs=>{
  mount("Ночь | ход мафии");autoStartFeature.enable(cfg(false,true,obs));await obsPanelFeature.enable(cfg(false,true,obs));await wait(8000);
  tap("KeyD");await wait(40);expect(bits()).toBe("00");
  const orphan=document.createElement("div");orphan.className="new-stage";orphan.style.display="none";document.querySelector(".roller")!.append(orphan);await wait(16);
  expect.soft(record(`false-lobby-obs${obs}`,"hidden marker+16","00")).toBe("00");
  orphan.remove();await wait(8000);expect(record(`false-lobby-obs${obs}`,"hidden marker removed+8s","00")).toBe("00");
});

test.each([false,true])("ordinary query changes do not reset a manual hide obs=%s",async obs=>{
 mount("Ночь | ход мафии");autoStartFeature.enable(cfg(false,true,obs));await obsPanelFeature.enable(cfg(false,true,obs));await wait(8000);tap("KeyD");await wait(40);
 history.pushState({},"","/game?game_id=41&view=grid#anchor");document.body.append(document.createElement("i"));await wait(12000);
 expect(record(`same-game-query-obs${obs}`,"settled","00")).toBe("00");
});

test("genuine F orphan plus existing hidden CSS, fresh faker OFF",async()=>{
 mount("День | речь игрока");autoStartFeature.enable(cfg());roleFakerFeature.enable(cfg());await obsPanelFeature.enable(cfg());await wait(8000);tap("KeyD");tap("KeyF");await wait(300);
 const old={head:document.head.innerHTML,body:document.body.innerHTML,fake:document.documentElement.getAttribute("data-pn-role-faked")};
 roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();document.head.innerHTML=old.head;document.body.innerHTML=old.body;if(old.fake!==null)document.documentElement.setAttribute("data-pn-role-faked",old.fake);
 autoStartFeature.enable(cfg());await obsPanelFeature.enable(cfg());await wait(40);
 // A current-version marked F orphan must restore content and peers; CSS can
 // conservatively remain hidden until an explicit D (not a new finding).
 expect(isRoleFaked()).toBe(false);expect(roles()[0].querySelector("use")!.getAttribute("href")).toBe("#sheriff");tap("KeyD");await wait(40);expect(record("orphan-faker-off","explicit D","11")).toBe("11");
});

test.each([0,1,16,40,100,251,500])("same-path exit+return old pending show gap=%d",async gap=>{
 mount("Ночь | ход мафии");autoStartFeature.enable(cfg(true,true,true));await obsPanelFeature.enable(cfg(true,true,true));await wait(2000);key("KeyV");await wait(40);
 history.pushState({},"","/game-search");document.body.innerHTML="<p>search</p>";await wait(gap);
 history.pushState({},"","/game?game_id=41");mount(null);await wait(16);key("KeyV","keyup");await wait(12000);
 expect(record(`same-path-gap${gap}`,"released+12s","00")).toBe("00");
});

test.each(["path","query","repeat-round"])("LIVE F accepted priority: persists until E across new game %s",async kind=>{
 mount("Ночь | ход мафии");autoStartFeature.enable(cfg());roleFakerFeature.enable(cfg());await obsPanelFeature.enable(cfg());await wait(8000);
 tap("KeyF");await wait(300);expect(isRoleFaked()).toBe(true);expect(bits()).toBe("10");
 if(kind==="path")history.pushState({},"","/game/42");
 if(kind==="query")history.pushState({},"","/game?game_id=42");
 if(kind==="repeat-round"){
  document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';await wait(10000);
 }
 mount("Раздача карт");roles()[0].querySelector("use")!.setAttribute("href","#civilian");await wait(16);
 // Explicitly accepted design: audit1 status §7:505 and audit2:425.
 // A new game's auto-role reset does not clear live fake; E is its owner.
 record(`live-F-${kind}`,"new dealing+16","10");
 await wait(8000);
 expect(record(`live-F-${kind}`,"new dealing+8016","10")).toBe("10");
 expect(isRoleFaked(),"accepted F remains until E").toBe(true);
 expect(roles()[0].querySelector("use")!.getAttribute("href"),"accepted fake keeps own real icon hidden").toBe("#godfather");
 await wait(12000);expect(record(`live-F-${kind}`,"new dealing+20016","10")).toBe("10");
 tap("KeyD");await wait(40);expect(record(`live-F-${kind}`,"D cannot clear previous game fake","10")).toBe("10");
 tap("KeyE");await wait(40);expect(record(`live-F-${kind}`,"E control","11")).toBe("11");
 expect(roles()[0].querySelector("use")!.getAttribute("href"),"E restores NEW game's real role, not old sheriff snapshot").toBe("#civilian");
});

test("real initial lobby with no roles is not mistaken for a new round",async()=>{
 document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';
 autoStartFeature.enable(cfg());await obsPanelFeature.enable(cfg());tap("KeyD");
 document.querySelector(".new-stage__name")!.textContent="Готовы: 4/10";await wait(3000);
 mount("Раздача карт");await wait(16);expect(record("initial-lobby-control","fresh first roles+16","00")).toBe("00");
 await wait(8000);expect(record("initial-lobby-control","fresh first roles+8016","00")).toBe("00");
});

test.each(["path","query","repeat-round"])("old accepted NATIVE Hide cannot become first-mount hide of new identity %s",async kind=>{
 mount("Ночь | ход мафии");autoStartFeature.enable(cfg());await obsPanelFeature.enable(cfg());await wait(8000);
 const fixture=readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt","utf8").split("\n").slice(1).join("\n");
 const a=fixture.indexOf('Zd="undefined"'),b=fixture.indexOf("var _h=gh;",a);if(a<0||b<0)throw new Error("fixture changed");
 const hotkeys=new Function("window","document","navigator",`var ${fixture.slice(a,b)};return gh;`)(window,document,navigator);
 let flag=true,toggles=0;
 const flush=()=>{for(const el of roles())el.style.display=flag?"":"none"};
 // Real site's accepted-hotkey wrapper, not just a mocked callback: defaultPrevented
 // is the command receipt that auto-start now uses after audit5.
 hotkeys("ctrl+d,command+d",(e:KeyboardEvent)=>{e.preventDefault();flag=!flag;toggles++;queueMicrotask(flush);return false;});
 try{
  for(const [type,code,keyCode,ctrlKey] of [["keydown","ControlLeft",17,true],["keydown","KeyD",68,true],["keyup","KeyD",68,true],["keyup","ControlLeft",17,false]] as const)
   document.dispatchEvent(new KeyboardEvent(type,{code,key:code==="KeyD"?"d":"Control",keyCode,which:keyCode,ctrlKey,bubbles:true,cancelable:true}));
  await wait(40);expect({flag,toggles,bits:bits()}).toEqual({flag:false,toggles:1,bits:"00"});
  record(`native-hidden-${kind}`,"old accepted native Hide","00");
  if(kind==="path")history.pushState({},"","/game/42");
  if(kind==="query")history.pushState({},"","/game?game_id=42");
  if(kind==="repeat-round"){
   document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';await wait(10000);
  }
  mount("Раздача карт");flush();await wait(16);
  expect.soft(record(`native-hidden-${kind}`,"new dealing+16","11")).toBe("11");
  await wait(12000);expect.soft(record(`native-hidden-${kind}`,"new dealing+12016","11")).toBe("11");
  expect({flag,toggles}).toEqual({flag:false,toggles:1});
  // Positive control: site still hidden, but a new explicit OUR Show is adopted
  // and defeats it via the already-installed display override.
  // FIXED: стол новой игры уже виден — наш D его прячет (обычный переворот).
  tap("KeyD");await wait(40);expect(record(`native-hidden-${kind}`,"new explicit our D control","00")).toBe("00");
 }finally{hotkeys.unbind();window.dispatchEvent(new Event("focus"));}
});
