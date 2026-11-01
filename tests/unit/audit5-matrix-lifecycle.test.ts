// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, B/E: матрица 576 клеток + маршруты OBS и новые игры (0/10014).
/** External audit 4 B/E. Only transport/env mocked. Production is read-only.
 * Harness CSSOM/native dispatcher borrowed from audit3; assertions below are
 * user-operation contracts, not the production Spec state machine.
 */
import { afterAll, expect, test, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
const seam = vi.hoisted(() => ({ messages: new Set<(m: unknown) => unknown>(),
  scene: "night" as string | null, connected: true, sent: [] as string[] }));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {}, removeListener: () => {} } },
  runtime: { id: "audit4", getManifest: () => ({ version: "9.68.0" }) },
} }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (m: unknown) => unknown) => { seam.messages.add(fn); return () => seam.messages.delete(fn); },
  sendRuntime: async (m: { command?: string; data?: { sceneName?: string } }) => {
    if (m.command === "get_status") return { success: true, data: {
      connected: seam.connected, sessionId: "audit4", currentScene: seam.scene, scenes: [] } };
    if (m.command === "set_scene") { seam.sent.push(m.data?.sceneName ?? "?");
      return seam.connected ? { success: true, data: { ignored: "not_owner" } } : { success: false, error: "disconnected" }; }
    return { success: true };
  }, broadcastToGameTabs: async () => {}, sendToActiveTabStrict: async () => {},
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { resetRolePinForTest } from "@content/role-pin";
import { log } from "@core/log";
import { clearToasts } from "@core/toast";

type Cell = { ah: boolean; ps: boolean; oe: boolean; oa: boolean; modifier: boolean;
  phase: "day" | "night" | "bootNight"; scene: "night" | "day" | "disconnected"; native: boolean };
const cells: Cell[] = [];
for (const ah of [false,true]) for (const ps of [false,true])
for (const oe of [false,true]) for (const oa of [false,true]) for (const modifier of [false,true])
for (const phase of ["day","night","bootNight"] as const) for (const scene of ["night","day","disconnected"] as const)
for (const native of [false,true]) cells.push({ ah,ps,oe,oa,modifier,phase,scene,native });
const label = (c: Cell) => `ah${+c.ah}-ps${+c.ps}-oe${+c.oe}-oa${+c.oa}-m${+c.modifier}-${c.phase}-${c.scene}-n${+c.native}`;
const selected = () => process.env.AUDIT4_CELL ? cells.filter(c => label(c).includes(process.env.AUDIT4_CELL!)) : cells;
const settings = (c: Cell) => ({ settings: {
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: c.ah, role_phase_auto_switch_enabled: c.ps,
  obs_enabled: c.oe, obs_auto_mode_enabled: c.oa,
  obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  enable_role_faker: true,
} }) as never;
const roles = () => Array.from(document.querySelectorAll<HTMLElement>(".player__role"));
// jsdom omits stylesheet !important precedence against ordinary inline styles.
// Existing sheets have only noncompeting hidden/0 rules, except display:flex.
function property(el: HTMLElement, name: string): string {
  const inline = el.style.getPropertyValue(name);
  if (inline && el.style.getPropertyPriority(name) === "important") return inline;
  let important = "";
  for (const sheet of document.styleSheets) for (const rule of Array.from(sheet.cssRules)) {
    if (rule instanceof CSSStyleRule && rule.style.getPropertyPriority(name) === "important" && el.matches(rule.selectorText)) important = rule.style.getPropertyValue(name);
  }
  return important || inline || getComputedStyle(el).getPropertyValue(name);
}
function visible(el: HTMLElement): boolean {
  for (let p: HTMLElement | null = el; p; p = p.parentElement)
    if (property(p,"display") === "none" || property(p,"opacity") === "0") return false;
  return property(el,"visibility") !== "hidden";
}
const snap = () => roles().map(el => +visible(el)).join("");
const evidence = () => ({ bits: snap(), css: !!document.getElementById("polemica-role-hide"),
  peek: isPeeking(), fake: isRoleFaked(), path: location.pathname, scene: seam.scene,
  stage: document.querySelector(".substage")?.textContent, sent: [...seam.sent],
  roles: roles().map(el => ({ display: el.style.display, vis: el.style.visibility,
    opacity: el.style.opacity, pin: el.getAttribute("data-pn-role-pin"), href: el.querySelector("use")?.getAttribute("href") })) });
const fixture = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const a = fixture.indexOf('Zd="undefined"'), b = fixture.indexOf("var _h=gh;", a);
if (a < 0 || b < 0) throw new Error("fixture changed");
const hotkeys = new Function("window","document","navigator",`var ${fixture.slice(a,b)}; return gh;`)(window,document,navigator);
vi.useFakeTimers(); // monotonic performance clock shared by all cells
function nativeSite(c: Cell) {
  let flag = c.native;
  const flush = () => { for (const el of roles()) el.style.display = flag ? "" : "none"; };
  hotkeys(c.modifier ? "ctrl+d,command+d" : "d", () => { flag = !flag; queueMicrotask(flush); });
  hotkeys(c.modifier ? "ctrl+v,command+v" : "v", () => {});
  flush();
  return { get flag() { return flag; }, setFlag(next: boolean) { flag = next; queueMicrotask(flush); },
    dispose() { hotkeys.unbind(); window.dispatchEvent(new Event("focus")); } };
}
function event(code: string, type: "keydown" | "keyup", init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(),
    keyCode: code.charCodeAt(3), which: code.charCodeAt(3), bubbles: true, cancelable: true, ...init }));
}
const tap = (code: string) => { event(code,"keydown"); event(code,"keyup"); };
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
function mount(own: boolean, native: boolean) {
  const el = document.createElement("span"); el.className = `player__role role ${own ? "my-role" : "peer"}`;
  el.innerHTML = `<svg><use href="#${own ? "sheriff" : "mafia"}"></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - ${own ? "Шериф" : "Мафия"}</span></div></div>`;
  if (!native) el.style.display = "none";
  return el;
}
function table(native: boolean, phase: "day" | "night" | null) {
  document.body.innerHTML = `${phase ? `<div class="roller"><div class="stage"><div class="substage current">${phase === "day" ? "День | речь игрока" : "Ночь | ход мафии"}</div></div></div>` : ""}<div class="player my-player"></div><div class="player"></div><div class="player"></div>`;
  document.querySelectorAll(".player").forEach((holder,i) => holder.append(mount(i===0,native)));
}
function setPhase(phase: "day" | "night") { document.querySelector(".substage")!.textContent = phase === "day" ? "День | речь игрока" : "Ночь | ход мафии"; }
let runs = 0;
async function boot(c: Cell, opts: { path?: string; noStage?: boolean; noRoots?: boolean; settle?: number } = {}) {
  vi.setSystemTime(1_800_000_000_000 + ++runs * 100_000);
  history.replaceState({},"",opts.path ?? `/game/${runs * 10}`);
  log.setLevel("silent"); log.setPersist(false); document.body.className = "";
  table(c.native,opts.noStage ? null : c.phase === "bootNight" ? "night" : "day");
  if(opts.noRoots) document.body.innerHTML="<div>search</div>";
  const geometry = vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({ width:24,height:24,x:0,y:0,top:0,left:0,right:24,bottom:24,toJSON:()=>({}) });
  const width = vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(24);
  const height = vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(24);
  const site = nativeSite(c); seam.scene = c.scene === "disconnected" ? null : c.scene;
  seam.connected = c.scene !== "disconnected"; seam.sent = [];
  autoStartFeature.enable(settings(c)); roleFakerFeature.enable(settings(c)); await obsPanelFeature.enable(settings(c));
  await wait(opts.settle ?? 8000);
  if (c.phase === "night" && !opts.noStage) { setPhase("night"); await wait(8000); }
  return { site, async close() {
    window.dispatchEvent(new Event("blur")); roleFakerFeature.disable(); obsPanelFeature.disable(); autoStartFeature.disable();
    await Promise.resolve(); site.dispose(); resetRolePinForTest(); clearToasts(); geometry.mockRestore(); width.mockRestore(); height.mockRestore(); vi.clearAllTimers();
    document.head.innerHTML = ""; document.documentElement.removeAttribute("data-pn-own-role-hidden"); document.documentElement.removeAttribute("data-pn-role-faked");
    expect(seam.messages.size).toBe(0);
  } };
}
type Row = { cell:string; action:string; time:string; expected:unknown; actual:unknown; detail?:unknown };
const rows: Row[] = [];
function compare(c: Cell, action: string, time: string, expected: unknown, actual: unknown = snap()) {
  rows.push({ cell:label(c),action,time,expected,actual,...(JSON.stringify(expected)!==JSON.stringify(actual)?{detail:evidence()}:{}) });
}
const active = (c: Cell) => c.oe && c.oa;
const isNight = (c: Cell) => c.phase !== "day";
// Declarative priority contract: safe automatic night opens; day/unsafe hides;
// without phase authority, start hidden only if setting or native hide requests it.
function baseline(c: Cell) {
  if (active(c)) return isNight(c) && c.scene === "night" ? "111" : "000";
  if (c.ps) return isNight(c) ? "111" : "000";
  return c.ah || !c.native ? "000" : "111";
}
function update(c: Cell) { autoStartFeature.update!(settings(c)); obsPanelFeature.update!(settings(c)); }
const ref: Cell = { ah:true,ps:false,oe:false,oa:false,modifier:false,phase:"day",scene:"night",native:true };

test("audit4 576 cells: steady, D, V/blur, F/E, roots",async()=>{
  for (const c of selected()) { const r = await boot(c); try {
    const expected = baseline(c);
    compare(c,"baseline","settled",expected); compare(c,"baseline-native","unchanged",c.native,r.site.flag);
    event("KeyV","keydown"); await wait(40); compare(c,"V","held+40","111");
    window.dispatchEvent(new Event("blur")); await wait(40); compare(c,"V-blur","+40",expected); event("KeyV","keyup");
    tap("KeyF"); await wait(40); compare(c,"F","+40",`${expected[0]}00`);
    compare(c,"F-content","+40",true,isRoleFaked() && roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#godfather"));
    event("KeyV","keydown"); await wait(40); compare(c,"F-V","+40","100");
    event("KeyV","keyup"); await wait(40); compare(c,"F-Vup","+40",`${expected[0]}00`);
    tap("KeyE"); await wait(40); compare(c,"E","+40",expected);
    compare(c,"E-content","+40",true,!isRoleFaked() && roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#sheriff"));
    for (const [i,el] of roles().entries()) el.replaceWith(mount(i===0,r.site.flag));
    compare(c,"remount","sync",expected); await wait(3500); compare(c,"remount","+3500",expected);
    tap("KeyD"); await wait(100);
    const afterD = expected === "111" ? "000" : active(c) && !(isNight(c)&&c.scene==="night") ? "011" : "111";
    compare(c,"D","+100",afterD); await wait(4000); compare(c,"D","+4100",afterD);
  } finally { await r.close(); } }
},240000);

// Cross-route oracle: a new game is a new privacy decision, irrespective of
// previous manual show/hide/peek. No permission for old night timers or snapshots
// to authorize a new game's roles. Missing markers must not postpone day privacy.
test("audit4 SPA reset: first room, changed room, return same room, no stage",async()=>{
  for (const kind of ["first","changed","same"] as const) for (const psOnly of [false,true])
  for (const peek of [false,true]) for (const stage of [false,true]) {
    const c = {...ref, ah:!psOnly,ps:psOnly}; const r = await boot(c,{path:kind==="first"?"/game-search":"/game/701",noRoots:kind==="first"});
    try {
      tap("KeyD"); await wait(40); // Explicit old-game Show.
      if (peek) { tap("KeyD"); await wait(40); event("KeyV","keydown"); await wait(40); }
      history.pushState({},"","/game-search"); document.body.innerHTML="<div>search</div>"; await wait(40);
      history.pushState({},"",kind==="changed"?"/game/702":"/game/701"); table(true,stage?"day":null);
      await wait(1); const action=`SPA-${kind}-${psOnly?"phaseOnly":"autoHide"}-${peek?"peek":"show"}-${stage?"stage":"noStage"}`;
      compare(c,action,"new roots +1 (before paint)","000");
      if (peek) { event("KeyV","keyup"); await wait(1); compare(c,action,"Vup+1","000"); }
      await wait(350); compare(c,action,`new roots +${peek?352:351}`,"000"); await wait(5000); compare(c,action,`settled+${peek?5352:5351}`,"000");
    } finally { await r.close(); }
  }
},120000);

test("audit4 route reset discards old manual reason before settings OFF",async()=>{
  for (const peek of [false,true]) for (const native of [true,false]) {
    const c={...ref,native}; const r=await boot(c); try {
      tap("KeyD"); tap("KeyD"); await wait(40); // Explicit manual Hide, both native flags.
      if (peek) { event("KeyV","keydown"); await wait(40); }
      // With native=false, old CSS is explicitly manual; new native true has no
      // new hide command. New game reset must not retain old manual ownership.
      history.pushState({},"",`/game/${runs*10+1}`); table(true,"day"); await wait(1);
      update({...c,ah:false}); if(peek) event("KeyV","keyup"); await wait(4000);
      compare(c,`SPA-reason-${peek?"peek":"plain"}`,"new game, last hide setting OFF +4000","111");
    } finally { await r.close(); }
  }
},120000);

// Individual settings under V: explicit operations and retained authorities.
// Native=true avoids treating initial native-hidden as both manual and auto.
test("audit4 each setting OFF under V: day/night and before/after show delay",async()=>{
  for (const key of ["ah","ps","oe","oa"] as const) for (const ps of [false,true])
  for (const ah of [false,true]) for (const obs of [false,true]) for (const phase of ["day","bootNight"] as const)
  for (const elapsed of [2000,6000]) {
    const c={...ref,ah,ps,oe:obs,oa:obs,phase}; if(!c[key]) continue;
    const r=await boot(c,{settle:elapsed}); try {
      event("KeyV","keydown"); await wait(40);
      const off={...c,[key]:false}; update(off); await wait(40); event("KeyV","keyup"); await wait(6000);
      // A night already opened is not rehidden by disabling a setting. Remaining
      // autoHide still owns an initial not-yet-shown hide; phase/OBS may open it.
      let expected: string;
      if(active(off)) expected=isNight(off)&&off.scene==="night"?"111":"000";
      else if(off.ps) expected=isNight(off)?"111":"000";
      else if(!isNight(c)) expected=off.ah?"000":"111";
      else expected=elapsed===6000?"111":off.ah?"000":"111";
      compare(c,`OFF-V-${key}-${elapsed}`,"Vup+6000",expected);
      event("KeyV","keydown"); await wait(40); update(c); await wait(40); event("KeyV","keyup"); await wait(6000);
      const reenabled=key==="ah"?"000":baseline(c);
      compare(c,`ON-after-V-${key}-${elapsed}`,"ON+6000",reenabled);
    } finally { await r.close(); }
  }
},120000);

test("audit4 new enable cleans marked orphan pin/fake shields, preserves new auto hiding",async()=>{
  for (const hidden of [false,true]) for (const native of [false,true]) for(const ah of [false,true]) {
    const c={...ref,ah,native}; const r=await boot(c); try {
      roleFakerFeature.disable(); obsPanelFeature.disable(); autoStartFeature.disable();
      const own=roles()[0]; own.setAttribute("data-pn-role-pin",hidden?"hidden":"visible");
      own.style.setProperty("visibility",hidden?"hidden":"visible","important"); own.style.setProperty("opacity",hidden?"0":"1","important");
      document.documentElement.setAttribute("data-pn-own-role-hidden",""); document.documentElement.setAttribute("data-pn-role-faked","");
      const shields=document.createElement("style"); shields.textContent='html[data-pn-own-role-hidden] .my-role {visibility:hidden!important;opacity:0!important} html[data-pn-role-faked] .player__role:not([data-original-role]) {visibility:hidden!important}'; document.head.append(shields);
      const peer=roles()[1]; peer.style.setProperty("visibility","hidden","important"); peer.setAttribute("data-pn-fake-hidden","");
      own.setAttribute("data-original-role","sheriff"); own.setAttribute("data-original-role-name","Шериф"); own.querySelector("use")!.setAttribute("href","#godfather");
      autoStartFeature.enable(settings(c)); roleFakerFeature.enable(settings(c)); await obsPanelFeature.enable(settings(c)); await wait(40);
      compare(c,`orphan-${hidden}`,"new enable +40",baseline(c));
      compare(c,`orphan-content-${hidden}`,"original icon",true,roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#sheriff"));
      event("KeyV","keydown"); await wait(40); compare(c,`orphan-V-${hidden}`,"+40","111"); event("KeyV","keyup"); await wait(40); compare(c,`orphan-up-${hidden}`,"+40",baseline(c));
    } finally { await r.close(); }
  }
},120000);

test("audit4 new game night after previous night: no old OBS phase/epoch authorizes or starves show",async()=>{
  for(const ps of [false,true]) for(const oldPhase of ["day","bootNight"] as const)
  for(const gap of [0,40,500,2500]) for(const peek of [false,true]) {
    const c={...ref,ps,oe:true,oa:true,phase:oldPhase}; const r=await boot(c); try {
      if(peek) { if(oldPhase==="bootNight") tap("KeyD"); event("KeyV","keydown"); await wait(40); }
      history.pushState({},"",`/game/${runs*10+1}`); document.body.innerHTML="<div>loading next game</div>"; await wait(gap);
      table(true,"night"); await wait(1);
      if(peek) event("KeyV","keyup");
      const action=`SPA-night-old${oldPhase}-gap${gap}-${peek?"V":"plain"}`;
      compare(c,action,"new roots +1","000");
      await wait(8000); compare(c,action,"new NIGHT+8001","111");
    } finally { await r.close(); }
  }
},120000);

test("audit4 individual feature teardown under V and delayed callbacks",async()=>{
  for(const ah of [false,true]) for(const ps of [false,true]) for(const phase of ["day","bootNight"] as const)
  for(const native of [false,true]) for(const owner of ["auto","obs","faker","all"] as const) {
    const c={...ref,ah,ps,phase,native,oe:true,oa:true}; const r=await boot(c); try {
      if(owner==="faker") { tap("KeyF"); await wait(40); }
      event("KeyV","keydown"); await wait(40);
      if(owner==="auto"||owner==="all") autoStartFeature.disable();
      if(owner==="obs"||owner==="all") obsPanelFeature.disable();
      if(owner==="faker"||owner==="all") roleFakerFeature.disable();
      event("KeyV","keyup"); await wait(6000);
      let expected:string;
      if(owner==="all") expected=native?"111":"000";
      else if(owner==="auto") expected=!native?"000":phase==="day"?"011":"111";
      else if(owner==="faker") expected=baseline(c);
      else if(ps) expected=phase==="day"?"000":"111";
      else if(phase==="bootNight") expected="111";
      else expected=ah||!native?"000":"111";
      compare(c,`teardown-${owner}`,"Vup+6000",expected);
      await wait(6000); compare(c,`teardown-${owner}`,"Vup+12000",expected);
    } finally { await r.close(); }
  }
},120000);

test("audit4 timed witnesses: inserted stage subtree and stale OBS night callback",async()=>{
  for(const ps of [false,true]) for(const elapsed of [2000,6000]) for(const nextPhase of [null,"day"] as const) {
    const c={...ref,ps,oe:true,oa:true,phase:"bootNight" as const}; const r=await boot(c,{settle:elapsed}); try {
      history.pushState({},"",`/game/${runs*10+1}`); table(true,nextPhase);
      const action=`SPA-old-night-timer-ps${+ps}-old${elapsed}-${nextPhase??"unknown"}`;
      let at=0;
      for(const checkpoint of [1,16,100,300,600,1000,2000,3500,6000,12000]) {
        await wait(checkpoint-at); at=checkpoint;
        compare(c,action,`new room +${checkpoint}`,"000");
      }
    } finally { await r.close(); }
  }
  const c={...ref,ah:false,ps:true}; const r=await boot(c); try {
    tap("KeyD"); await wait(40);
    history.pushState({},"",`/game/${runs*10+1}`); table(true,"day");
    let at=0; for(const checkpoint of [1,16,40,100,149,150,200,250,300,350,500,1000]) {
      await wait(checkpoint-at); at=checkpoint; compare(c,"SPA-phase-only-timing",`new room +${checkpoint}`,"000");
    }
  } finally { await r.close(); }
},120000);

test("audit4 new route resets manual hide even when no automatic settings are enabled",async()=>{
  for(const peek of [false,true]) {
    const c={...ref,ah:false}; const r=await boot(c); try {
      tap("KeyD"); await wait(40); if(peek) {event("KeyV","keydown");await wait(40);}
      history.pushState({},"",`/game/${runs*10+1}`); table(true,"day"); await wait(1);
      if(peek) event("KeyV","keyup"); await wait(6000);
      compare(c,`SPA-unconfigured-manual-${peek?"V":"plain"}`,"new game +6001","111");
    } finally {await r.close();}
  }
},120000);

test("audit5 OBS lifecycle matrix: first/changed/back room, no AH, all timing boundaries",async()=>{
  for(const kind of ["first","changed","same"] as const) for(const ps of [false,true])
  for(const next of [null,"day","night"] as const) for(const held of [false,true])
  for(const scene of ["night","day","disconnected"] as const) {
    const c={...ref,ah:false,ps,oe:true,oa:true,phase:"bootNight" as const,scene};
    const r=await boot(c,{path:kind==="first"?"/game-search":"/game/901",noRoots:kind==="first"});
    try {
      if(held) { if(kind!=="first") tap("KeyD"); event("KeyV","keydown"); await wait(40); }
      if(kind!=="changed") {history.pushState({},"","/game-search");document.body.innerHTML="<div>search</div>";await wait(40);}
      history.pushState({},"",kind==="changed"?"/game/902":"/game/901");table(true,next);
      let at=0;
      for(const t of [1,16,100,251,501,1001,2001]) {await wait(t-at);at=t;
        compare(c,`A5-OBS-route-${kind}-${next??"unknown"}-V${+held}`,`+${t}`,"000");}
      if(held) event("KeyV","keyup");
      await wait(8000);
      compare(c,`A5-OBS-route-${kind}-${next??"unknown"}-V${+held}`,"settled",next==="night"&&scene==="night"?"111":"000");
    } finally {await r.close();}
  }
},120000);

test("audit5 route discards legacy inline V snapshot (new roots and retained roots)",async()=>{
  for(const ah of [false,true]) for(const retained of [false,true]) for(const kind of ["changed","same"] as const) {
    const c={...ref,ah};const r=await boot(c,{path:"/game/991"});try {
      const own=roles()[0];own.style.visibility="hidden";own.style.opacity="0";own.style.pointerEvents="none";
      event("KeyV","keydown");await wait(40);
      const old=roles();history.pushState({},"","/game-search");document.body.innerHTML="<div>search</div>";await wait(40);
      history.pushState({},"",kind==="same"?"/game/991":"/game/992");table(true,"day");
      if(retained) roles().forEach((el,i)=>el.replaceWith(old[i]));
      await wait(1);event("KeyV","keyup");await wait(1);
      compare(c,`A5-legacy-route-${kind}-retain${+retained}`,"Vup+1",ah?"000":"111");
      await wait(8000);compare(c,`A5-legacy-route-${kind}-retain${+retained}`,"Vup+8001",ah?"000":"111");
    } finally {await r.close();}
  }
},120000);

test("audit5 old pending nightly phase timeout cannot reenter a new route",async()=>{
  for(const obs of [false,true]) for(const ah of [false,true]) for(const held of [false,true])
  for(const kind of ["first","changed","same"] as const) {
    const c={...ref,ah,ps:true,oe:obs,oa:obs,phase:"bootNight" as const};
    const r=await boot(c,{settle:2000,path:kind==="first"?"/game-search":"/game/951",noRoots:kind==="first"});try {
      if(held) {event("KeyV","keydown");await wait(40);}
      if(kind!=="changed"){history.pushState({},"","/game-search");document.body.innerHTML="<div>search</div>";await wait(40);}
      history.pushState({},"",kind==="changed"?"/game/952":"/game/951");table(true,null);
      let at=0;for(const t of [1,16,150,500,1000,2000,3500,6000,12000]){
        await wait(t-at);at=t;compare(c,`A5-pending-route-${kind}-obs${+obs}-V${+held}`,`+${t}`,"000");}
      if(held) event("KeyV","keyup");await wait(1);
      compare(c,`A5-pending-route-${kind}-obs${+obs}-V${+held}`,"release","000");
    }finally{await r.close();}
  }
},120000);

test("audit5 return same pathname with observed exit: old OBS pending under V cannot reopen new day",async()=>{
  for(const gap of [1,16,40,100,251,500,1000,2500]) for(const next of [null,"day"] as const)
  for(const ah of [false,true]) {
    const c={...ref,ah,ps:true,oe:true,oa:true,phase:"bootNight" as const};
    const r=await boot(c,{settle:2000,path:"/game/961"});try {
      event("KeyV","keydown");await wait(40);
      history.pushState({},"","/game-search");document.body.innerHTML="<div>observed search</div>";await wait(gap);
      history.pushState({},"","/game/961");table(true,next);await wait(1);
      compare(c,`A5-same-pending-gap${gap}-${next??"unknown"}`,"new roots+1","000");
      await wait(12000);compare(c,`A5-same-pending-gap${gap}-${next??"unknown"}`,"before release","000");
      event("KeyV","keyup");await wait(1);compare(c,`A5-same-pending-gap${gap}-${next??"unknown"}`,"release+1","000");
      await wait(12000);compare(c,`A5-same-pending-gap${gap}-${next??"unknown"}`,"release+12001","000");
    }finally{await r.close();}
  }
},120000);

test("audit5 new runtime over genuine saved F DOM with faker disabled vs enabled",async()=>{
  for(const ah of [false,true]) for(const native of [false,true]) for(const enableFaker of [false,true]) {
    const c={...ref,ah,native};const r=await boot(c);try {
      tap("KeyF");await wait(300);
      const saved={head:document.head.innerHTML,body:document.body.innerHTML,
        fake:document.documentElement.getAttribute("data-pn-role-faked")};
      roleFakerFeature.disable();obsPanelFeature.disable();autoStartFeature.disable();
      // The old JS context is gone, but DOM survives. Serialize actual output,
      // rather than inventing orphan markers. A full F5 does NOT preserve this.
      document.head.innerHTML=saved.head;document.body.innerHTML=saved.body;
      if(saved.fake!==null)document.documentElement.setAttribute("data-pn-role-faked",saved.fake);
      autoStartFeature.enable(settings(c));if(enableFaker)roleFakerFeature.enable(settings(c));await obsPanelFeature.enable(settings(c));await wait(40);
      compare(c,`A5-orphan-faker${+enableFaker}`,"fake state",false,isRoleFaked());
      compare(c,`A5-orphan-faker${+enableFaker}`,"icon restored",true,roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#sheriff"));
      compare(c,`A5-orphan-faker${+enableFaker}`,"baseline",baseline(c));
      event("KeyV","keydown");await wait(40);compare(c,`A5-orphan-faker${+enableFaker}`,"V+40","111");
      event("KeyV","keyup");await wait(40);compare(c,`A5-orphan-faker${+enableFaker}`,"Vup+40",baseline(c));
      await wait(12000);compare(c,`A5-orphan-faker${+enableFaker}`,"settled+12000",baseline(c));
    }finally{await r.close();}
  }
},120000);

test("audit5 identity is not pathname: query game_id and repeat-round pregame/dealing",async()=>{
  const configs=[{name:"none",ah:false,ps:false,oe:false,oa:false},
    {name:"AH",ah:true,ps:false,oe:false,oa:false},
    {name:"AH-PS",ah:true,ps:true,oe:false,oa:false},
    {name:"OBS",ah:false,ps:false,oe:true,oa:true}];
  for(const kind of ["query","repeat-round"] as const) for(const end of [false,true])
  for(const cfg of configs) for(const action of ["show","hide","V"] as const) {
    const c={...ref,...cfg,phase:"bootNight" as const};const r=await boot(c,{path:"/game?game_id=410"});try {
      // Force an explicit manual operation, not merely an initial state.
      tap("KeyD");if(snap()!==(action==="show"?"111":"000"))tap("KeyD");await wait(40);
      if(action==="V"){event("KeyV","keydown");await wait(40);}
      if(end){document.querySelector(".roller")!.innerHTML='<div class="ended ended-civilian"><div class="ended__title">Победа мирных</div></div>';await wait(4000);}
      document.body.innerHTML='<div class="roller"><div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div></div>';
      await wait(10000); // Not a 700ms command/slack artefact.
      if(kind==="query")history.pushState({},"","/game?game_id=411");
      table(true,"night");document.querySelector(".substage")!.textContent="Раздача карт";await wait(1);
      const name=`A5-identity-${kind}-end${+end}-${cfg.name}-${action}`;
      if(c.ah)compare(c,name,"new dealing+1","000");
      await wait(8000);if(action==="V")event("KeyV","keyup");await wait(1);
      const expected=c.ps||active(c)||!c.ah?"111":"000";
      compare(c,name,"new dealing+8002/released",expected);await wait(8000);compare(c,name,"new dealing+16002",expected);
    }finally{await r.close();}
  }
},120000);

afterAll(()=>{
  const failed=rows.filter(r=>JSON.stringify(r.expected)!==JSON.stringify(r.actual));
  const grouped:Record<string,Row[]>={}; for(const r of rows) (grouped[r.action]??=[]).push(r);
  const summary=Object.fromEntries(Object.entries(grouped).map(([k,v])=>[k,{checks:v.length,failed:v.filter(r=>JSON.stringify(r.expected)!==JSON.stringify(r.actual)).length}]));
  if (process.env.AUDIT4_OUTPUT) writeFileSync(process.env.AUDIT4_OUTPUT,JSON.stringify({cells:selected().length,runs,checks:rows.length,failed:failed.length,summary,rows},null,2));
  vi.useRealTimers(); expect(failed,JSON.stringify(failed.slice(0,6))).toHaveLength(0);
});
