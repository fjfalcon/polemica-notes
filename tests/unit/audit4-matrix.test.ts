// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
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
  hotkeys(c.modifier ? "ctrl+d,command+d" : "d", () => { flag = !flag; queueMicrotask(flush); return false; });
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
  const site = nativeSite(c); seam.scene = c.scene === "disconnected" ? null : c.scene;
  seam.connected = c.scene !== "disconnected"; seam.sent = [];
  autoStartFeature.enable(settings(c)); roleFakerFeature.enable(settings(c)); await obsPanelFeature.enable(settings(c));
  await wait(opts.settle ?? 8000);
  if (c.phase === "night" && !opts.noStage) { setPhase("night"); await wait(8000); }
  return { site, async close() {
    window.dispatchEvent(new Event("blur")); roleFakerFeature.disable(); obsPanelFeature.disable(); autoStartFeature.disable();
    await Promise.resolve(); site.dispose(); resetRolePinForTest(); clearToasts(); geometry.mockRestore(); vi.clearAllTimers();
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

afterAll(()=>{
  const failed=rows.filter(r=>JSON.stringify(r.expected)!==JSON.stringify(r.actual));
  const grouped:Record<string,Row[]>={}; for(const r of rows) (grouped[r.action]??=[]).push(r);
  const summary=Object.fromEntries(Object.entries(grouped).map(([k,v])=>[k,{checks:v.length,failed:v.filter(r=>JSON.stringify(r.expected)!==JSON.stringify(r.actual)).length}]));
  if (process.env.AUDIT4_OUTPUT) writeFileSync(process.env.AUDIT4_OUTPUT,JSON.stringify({cells:selected().length,runs,checks:rows.length,failed:failed.length,summary,rows},null,2));
  vi.useRealTimers(); expect(failed,JSON.stringify(failed.slice(0,6))).toHaveLength(0);
});
