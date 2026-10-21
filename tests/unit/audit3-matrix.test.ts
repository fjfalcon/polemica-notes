// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
/** Independent audit B. ONLY env and messaging mocked; no production edits. */
import { afterAll, expect, test, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const seam = vi.hoisted(() => ({
  messages: new Set<(m: unknown) => unknown>(), scene: "night" as string | null,
  connected: true, sent: [] as string[], acceptSwitch: false,
  atSend: [] as string[], readSnapshot: () => "",
}));
vi.mock("@core/env", () => ({ browser: {
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  }, runtime: { id: "audit3", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (m: unknown) => unknown) => { seam.messages.add(fn); return () => seam.messages.delete(fn); },
  sendRuntime: async (m: { command?: string; data?: { sceneName?: string } }) => {
    if (m.command === "get_status") return { success: true, data: {
      connected: seam.connected, sessionId: "audit3", currentScene: seam.scene, scenes: [],
    } };
    if (m.command === "set_scene") {
      seam.sent.push(m.data?.sceneName ?? "?");
      seam.atSend.push(seam.readSnapshot());
      if (seam.acceptSwitch) {
        // Successful ACK means OBS has applied the scene. Its independent
        // event channel is deliberately delivered 200ms later, not a fake
        // ACK which claims success while the actual scene stays unchanged.
        seam.scene = m.data!.sceneName!;
        setTimeout(() => {
          for (const fn of seam.messages) fn({ type: "obs_event", eventType: "obs_scene_changed", data: m.data!.sceneName! });
        }, 200);
        return { success: true };
      }
      // Another tab owns automatic switching. Keep phase and scene independent.
      return seam.connected ? { success: true, data: { ignored: "not_owner" } } : { success: false, error: "disconnected" };
    }
    return { success: true };
  }, broadcastToGameTabs: async () => {}, sendToActiveTabStrict: async () => {},
}));

import { autoStartFeature } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { resetRolePinForTest } from "@content/role-pin";
import { log } from "@core/log";
import { clearToasts } from "@core/toast";

type Cell = { ah: boolean; ps: boolean; oe: boolean; oa: boolean; modifier: boolean;
  phase: "day" | "night"; scene: "night" | "day" | "disconnected"; native: boolean };
const cells: Cell[] = [];
for (const ah of [false, true]) for (const ps of [false, true])
for (const oe of [false, true]) for (const oa of [false, true])
for (const modifier of [false, true]) for (const phase of ["day", "night"] as const)
for (const scene of ["night", "day", "disconnected"] as const)
for (const native of [false, true]) cells.push({ ah, ps, oe, oa, modifier, phase, scene, native });
const label = (c: Cell) => `ah${+c.ah}-ps${+c.ps}-oe${+c.oe}-oa${+c.oa}-m${+c.modifier}-${c.phase}-${c.scene}-n${+c.native}`;
const selected = () => process.env.AUDIT3_CELL ? cells.filter(c => label(c).includes(process.env.AUDIT3_CELL!)) : cells;
const settings = (c: Cell) => ({ settings: {
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: c.ah, role_phase_auto_switch_enabled: c.ps,
  obs_enabled: c.oe, obs_auto_mode_enabled: c.oa,
  obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  enable_role_faker: true,
} }) as never;
const roles = () => Array.from(document.querySelectorAll<HTMLElement>(".player__role"));

// CSSOM matching, NOT style-ID presence. jsdom otherwise lets normal inline
// declarations beat stylesheet!important. All important rules competing here
// use equal hidden/0 values; display override must beat the site's inline none.
function property(el: HTMLElement, name: string): string {
  const inline = el.style.getPropertyValue(name);
  if (inline && el.style.getPropertyPriority(name) === "important") return inline;
  let important = "";
  for (const sheet of document.styleSheets) for (const rule of Array.from(sheet.cssRules)) {
    if (rule instanceof CSSStyleRule && rule.style.getPropertyPriority(name) === "important" && el.matches(rule.selectorText)) {
      important = rule.style.getPropertyValue(name);
    }
  }
  return important || inline || getComputedStyle(el).getPropertyValue(name);
}
function visible(el: HTMLElement): boolean {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    if (property(p, "display") === "none" || property(p, "opacity") === "0") return false;
  }
  return property(el, "visibility") !== "hidden";
}
const snap = () => roles().map(el => +visible(el)).join("");
const evidence = () => ({ bits: snap(), css: !!document.getElementById("polemica-role-hide"),
  scene: seam.scene, sent: seam.sent,
  roles: roles().map(el => ({ display: el.style.display, visibility: el.style.visibility,
    priority: el.style.getPropertyPriority("visibility"), opacity: el.style.opacity,
    pin: el.getAttribute("data-pn-role-pin"), href: el.querySelector("use")?.getAttribute("href") })),
});
const room = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
if (start < 0 || end < 0) throw new Error("hotkeys fixture boundaries missing");
const hotkeysFactory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
const hotkeys = hotkeysFactory(window, document, navigator);
// ONE monotonic performance clock for the actual shared observer. Its
// lastFlushAt survives unsubscribe/subscribe; resetting performance.now to 0
// for each cell would artificially postpone later rAF flushes by many seconds.
vi.useFakeTimers();
function nativeSite(c: Cell) {
  let flag = c.native;
  let videos = 0;
  const flush = () => { for (const el of roles()) el.style.display = flag ? "" : "none"; };
  const toggle = () => { flag = !flag; queueMicrotask(flush); return false; }; // как обёртка сайта
  hotkeys(c.modifier ? "ctrl+d,command+d" : "d", toggle);
  hotkeys(c.modifier ? "ctrl+v,command+v" : "v", () => videos++);
  flush();
  return { get flag() { return flag; }, get videos() { return videos; },
    setFlag(next: boolean) { flag = next; queueMicrotask(flush); },
    dispose() { hotkeys.unbind(); window.dispatchEvent(new Event("focus")); },
  };
}
function event(code: string, type: "keydown" | "keyup", init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(),
    keyCode: code.charCodeAt(3), which: code.charCodeAt(3), bubbles: true, cancelable: true, ...init }));
}
const tap = (code: string, init: KeyboardEventInit = {}) => { event(code, "keydown", init); event(code, "keyup", init); };
function mount(own: boolean, native: boolean) {
  const el = document.createElement("span");
  el.className = `player__role role ${own ? "my-role" : "peer"}`;
  el.innerHTML = `<svg><use href="#${own ? "sheriff" : "mafia"}"></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - ${own ? "Шериф" : "Мафия"}</span></div></div>`;
  if (!native) el.style.display = "none";
  return el;
}
let runs = 0;
async function boot(c: Cell) {
  vi.setSystemTime(1_800_000_000_000 + ++runs * 100_000);
  log.setLevel("silent"); log.setPersist(false);
  document.body.className = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">${c.phase === "day" ? "День | речь игрока" : "Ночь | ход мафии"}</div></div></div><div class="player my-player"></div><div class="player"></div><div class="player"></div>`;
  document.querySelectorAll(".player").forEach((holder, i) => holder.append(mount(i === 0, c.native)));
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 24, height: 24, x: 0, y: 0, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => ({}) });
  const site = nativeSite(c);
  seam.scene = c.scene === "disconnected" ? null : c.scene;
  seam.connected = c.scene !== "disconnected"; seam.sent = []; seam.atSend = []; seam.acceptSwitch = false; seam.readSnapshot = snap;
  autoStartFeature.enable(settings(c)); roleFakerFeature.enable(settings(c));
  await obsPanelFeature.enable(settings(c));
  await vi.advanceTimersByTimeAsync(8_000);
  return { site, async close() {
    window.dispatchEvent(new Event("blur"));
    roleFakerFeature.disable(); obsPanelFeature.disable(); autoStartFeature.disable();
    await Promise.resolve(); site.dispose(); resetRolePinForTest(); clearToasts();
    geometry.mockRestore(); vi.clearAllTimers();
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("data-pn-own-role-hidden");
    document.documentElement.removeAttribute("data-pn-role-faked");
    expect(seam.messages.size, "message subscribers cleaned").toBe(0);
  } };
}
type Row = { cell: string; action: string; checkpoint: string; expected: unknown; actual: unknown; detail?: unknown };
const rows: Row[] = [];
function compare(c: Cell, action: string, checkpoint: string, expected: unknown, actual: unknown = snap()) {
  rows.push({ cell: label(c), action, checkpoint, expected, actual,
    ...(JSON.stringify(expected) !== JSON.stringify(actual) ? { detail: evidence() } : {}) });
}
const active = (c: Cell) => c.oe && c.oa;
// Closed-form ONE-AUTHORITY oracle, independently fixed before running:
// OBS auto day/unsafe => all hidden; OBS night+night-scene => all visible.
// Without auto-scenes, phase switching leads; initial native hidden is adopted
// but no longer a separate display gate. Automatic night show supersedes it.
function baseline(c: Cell): string {
  if (active(c)) return c.phase === "night" && c.scene === "night" ? "111" : "000";
  if (c.ps) return c.phase === "night" ? "111" : "000";
  return c.ah || !c.native ? "000" : "111";
}
const withOwnPin = (c: Cell, shown: boolean) => !shown ? "000" : active(c) && !(c.phase === "night" && c.scene === "night") ? "011" : "111";
async function update(c: Cell) { autoStartFeature.update!(settings(c)); obsPanelFeature.update!(settings(c)); await vi.advanceTimersByTimeAsync(6_000); }

test("audit3 baseline: 384 exact closed-form cells + display-override and unchanged site flag", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    compare(c, "baseline", "+8000", baseline(c));
    compare(c, "native", "not toggled by extension", c.native, run.site.flag);
    compare(c, "display", "all matching roles override site display", ["flex", "flex", "flex"], roles().map(el => property(el, "display")));
  } finally { await run.close(); } }
}, 240_000);

test("audit3 D and repeats: site modifier option must not change our D semantics", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    const expected = withOwnPin(c, baseline(c) === "000");
    event("KeyD", "keydown"); await vi.advanceTimersByTimeAsync(120);
    compare(c, "D", "+120", expected);
    for (let i = 0; i < 3; i++) {
      event("KeyD", "keydown", { repeat: true }); await vi.advanceTimersByTimeAsync(20);
      compare(c, "D-repeat", `${i + 1}`, expected);
    }
    event("KeyD", "keyup"); await vi.advanceTimersByTimeAsync(3_000);
    compare(c, "D", "+3180", expected);
    compare(c, "D-native", "site remains unchanged", c.native, run.site.flag);
  } finally { await run.close(); } }
}, 240_000);

test("audit3 V tap/hold/blur: exact expected, not restoration to observed actual", async () => {
  for (const c of selected()) for (const release of ["tap", "up", "blur"] as const) {
    const run = await boot(c); try {
      event("KeyV", "keydown"); await vi.advanceTimersByTimeAsync(40);
      compare(c, `V-${release}`, "hold+40", "111");
      if (release !== "tap") { await vi.advanceTimersByTimeAsync(300); compare(c, `V-${release}`, "hold+340", "111"); }
      if (release === "blur") window.dispatchEvent(new Event("blur")); else event("KeyV", "keyup");
      await vi.advanceTimersByTimeAsync(40); compare(c, `V-${release}`, "released+40", baseline(c));
      await vi.advanceTimersByTimeAsync(3_300); compare(c, `V-${release}`, "released+3340", baseline(c));
      compare(c, `V-native-${release}`, "site unchanged", c.native, run.site.flag);
      event("KeyV", "keyup");
    } finally { await run.close(); }
  }
}, 360_000);

test("audit3 F/V/E: fake changes content, never reveals peers under V", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    const before = baseline(c);
    tap("KeyF"); await vi.advanceTimersByTimeAsync(40);
    compare(c, "F-content", "active", true, isRoleFaked());
    compare(c, "F-content", "icon", true, roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#godfather"));
    compare(c, "F", "+40", `${before[0]}00`);
    event("KeyV", "keydown"); await vi.advanceTimersByTimeAsync(100); compare(c, "F+V", "+100", "100");
    event("KeyV", "keyup"); await vi.advanceTimersByTimeAsync(800); compare(c, "F+Vup", "+800", `${before[0]}00`);
    tap("KeyE"); await vi.advanceTimersByTimeAsync(100);
    compare(c, "E-content", "inactive", false, isRoleFaked());
    compare(c, "E-content", "true icon", true, roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#sheriff"));
    compare(c, "E", "+100", before);
  } finally { await run.close(); } }
}, 240_000);

test("audit3 roots: before observer microtask and after real SharedDomObserver healing", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    for (const [i, el] of roles().entries()) el.replaceWith(mount(i === 0, run.site.flag));
    compare(c, "roots", "synchronous", baseline(c));
    await vi.advanceTimersByTimeAsync(3_500); compare(c, "roots", "+3500", baseline(c));
    compare(c, "roots-native", "unchanged", c.native, run.site.flag);
  } finally { await run.close(); } }
}, 240_000);

test("audit3 fake roots and roleReveal: shields before callback, exact content after healing", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    tap("KeyF"); await vi.advanceTimersByTimeAsync(40);
    for (const [i, el] of roles().entries()) el.replaceWith(mount(i === 0, run.site.flag));
    compare(c, "F-roots", "synchronous shield", "000");
    await vi.advanceTimersByTimeAsync(500);
    compare(c, "F-roots", "+500", `${baseline(c)[0]}00`);
    compare(c, "F-roots-content", "same fake restored", true, roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#godfather"));
    const notice = document.createElement("div"); notice.className = "notification-element roleReveal";
    notice.textContent = "Игрок является мафией";
    const wrapper = document.createElement("div"); wrapper.className = "notifications-block player__notifications-block";
    wrapper.append(notice); document.querySelectorAll(".player")[1].append(wrapper);
    compare(c, "F-notice", "synchronous shield", false, visible(notice));
    tap("KeyE"); await vi.advanceTimersByTimeAsync(100);
    compare(c, "F-roots-E", "+100", baseline(c));
    compare(c, "F-roots-E-content", "true icon restored", true, roles()[0].querySelector("use")!.getAttribute("href")!.endsWith("#sheriff"));
    compare(c, "notice", "after E follows table", baseline(c) === "111", visible(notice));
  } finally { await run.close(); } }
}, 240_000);

test("audit3 settings: disable/enable autoHide and phase; manual hide survives disabling all automation", async () => {
  for (const c of selected()) {
    // A fresh manual hiding decision, then remove ALL automatic settings:
    // accepted native hidden / explicit D remains manual, regardless of gates.
    const run = await boot(c); try {
      if (baseline(c) === "000") tap("KeyD");
      tap("KeyD"); await vi.advanceTimersByTimeAsync(40);
      compare(c, "settings-manual", "explicit hide", "000");
      await update({ ...c, ah: false, ps: false, oe: false, oa: false });
      compare(c, "settings-manual", "all automation OFF", "000");
    } finally { await run.close(); }
    for (const key of ["ah", "ps"] as const) {
      const r = await boot(c); try {
        const off = { ...c, [key]: false };
        await update(off);
        // Switching an already-OFF setting does nothing. Removing the last
        // hiding setting clears AUTO but never the initial native MANUAL hide.
        let expected = baseline(c);
        if (c[key] && !active(c) && !off.ah && !off.ps && expected === "000" && c.native) expected = "111";
        compare(c, `settings-${key}`, "OFF+6000", expected);
        await update({ ...off, [key]: true });
        // autoHide ON midgame explicitly hides for this night; phase ON
        // reinitializes the current phase, unless OBS leads the night show.
        const onExpected = key === "ah" ? "000" : active(c) ? expected : c.phase === "night" ? "111" : "000";
        compare(c, `settings-${key}`, "ON+6000", onExpected);
      } finally { await r.close(); }
    }
  }
}, 360_000);

test("audit3 native flag adoption: programmatic hide always, show only following input", async () => {
  for (const c of selected()) { const run = await boot(c); try {
    // Establish known true; no input, so this cannot open CSS-hidden roles.
    run.site.setFlag(true); await vi.advanceTimersByTimeAsync(800);
    compare(c, "native-program", "unprompted show cannot open roles", baseline(c));
    run.site.setFlag(false); await vi.advanceTimersByTimeAsync(1);
    compare(c, "native-program", "hide accepted before next frame", "000");
    await update({ ...c, ah: false, ps: false, oe: false, oa: false });
    compare(c, "native-program", "site hidden reason survives settings OFF", "000");
    // A real site menu callback toggles its flag after a bubbling click.
    const menu = document.createElement("button"); menu.textContent = "Показать роли"; document.body.append(menu);
    menu.addEventListener("click", () => run.site.setFlag(true)); menu.click();
    await vi.advanceTimersByTimeAsync(1); compare(c, "native-menu", "show accepted", "111");
  } finally { await run.close(); } }
}, 240_000);

function obsEvent(eventType: string, data: unknown) {
  for (const fn of Array.from(seam.messages)) fn({ type: "obs_event", eventType, data });
}
function scene(s: "day" | "night") {
  seam.scene = s; seam.connected = true; obsEvent("obs_scene_changed", s);
}

test("audit3 scene return: +2999ms hidden, +3500ms all together; manual hide this night survives", async () => {
  for (const c of selected().filter(active)) { const run = await boot(c); try {
    scene("day"); await vi.advanceTimersByTimeAsync(50);
    compare(c, "scene-return", "day+50", "000");
    scene("night"); await vi.advanceTimersByTimeAsync(2_999);
    compare(c, "scene-return", "night+2999", "000");
    await vi.advanceTimersByTimeAsync(501);
    compare(c, "scene-return", "night+3500", c.phase === "night" ? "111" : "000");
    if (c.phase === "day") tap("KeyD");
    tap("KeyD"); await vi.advanceTimersByTimeAsync(50);
    compare(c, "scene-manual", "D hide", "000");
    scene("day"); await vi.advanceTimersByTimeAsync(50);
    scene("night"); await vi.advanceTimersByTimeAsync(4_000);
    compare(c, "scene-manual", "return+4000", "000");
  } finally { await run.close(); } }
}, 240_000);

test("audit3 OBS off/on and all automatic settings OFF under V", async () => {
  for (const c of selected()) {
    // Turn ALL automation off while holding V. Initial native hide is manual
    // unless an automatic night show already superseded it.
    const run = await boot(c); try {
      event("KeyV", "keydown"); await vi.advanceTimersByTimeAsync(40);
      await update({ ...c, ah: false, ps: false, oe: false, oa: false });
      event("KeyV", "keyup"); await vi.advanceTimersByTimeAsync(4_000);
      const initialManualStillOwned = !c.native && baseline(c) === "000";
      compare(c, "settings-under-V", "all OFF + Vup+4000", initialManualStillOwned ? "000" : "111");
    } finally { await run.close(); }
    if (!active(c)) continue;
    for (const key of ["oe", "oa"] as const) {
      const r = await boot(c); try {
        const off = { ...c, [key]: false };
        await update(off);
        // History matters: removing OBS does not restore an initial native
        // hidden flag which has already been superseded by a night-show.
        let expected: string;
        if (c.ps && c.phase === "night") expected = "111";
        else if (baseline(c) === "111") expected = "111";
        else expected = c.ps || c.ah || !c.native ? "000" : "111";
        compare(c, `settings-${key}`, "OFF+6000", expected);
        await update(c);
        compare(c, `settings-${key}`, "ON+6000", baseline(c));
      } finally { await r.close(); }
    }
  }
}, 360_000);

test("audit3 counterexample confirmation: auto-scenes re-enable must hide peers before outbound DAY", async () => {
  for (const c of selected().filter(c => !c.ah && !c.ps && active(c) && c.phase === "day" && c.scene === "night" && c.native)) {
    for (const key of ["oe", "oa"] as const) {
      const run = await boot(c); try {
        await update({ ...c, [key]: false });
        compare(c, `confirm-${key}`, "OFF shown", "111");
        seam.atSend = []; seam.acceptSwitch = true;
        autoStartFeature.update!(settings(c)); obsPanelFeature.update!(settings(c));
        compare(c, `confirm-${key}`, "outbound DAY protected", "000", seam.atSend[0]);
        await vi.advanceTimersByTimeAsync(100);
        compare(c, `confirm-${key}`, "+100 before scene event", "000");
        await vi.advanceTimersByTimeAsync(200);
        compare(c, `confirm-${key}`, "+300 healed by scene event", "000");
      } finally { await run.close(); }
    }
  }
}, 240_000);

afterAll(() => {
  const failed = rows.filter(r => JSON.stringify(r.expected) !== JSON.stringify(r.actual));
  const grouped: Record<string, Row[]> = {};
  for (const row of rows) (grouped[row.action] ??= []).push(row);
  const summary = Object.fromEntries(Object.entries(grouped).map(([action, rs]) => [action, { checks: rs.length, failed: rs.filter(r => JSON.stringify(r.expected) !== JSON.stringify(r.actual)).length }]));
  const output = process.env.AUDIT3_OUTPUT;
  if (output) writeFileSync(resolve(process.cwd(), output), JSON.stringify({ cells: selected().length, runs, checks: rows.length, failed: failed.length, summary, rows }, null, 2));
  console.log("AUDIT3_MATRIX", JSON.stringify({ cells: selected().length, runs, checks: rows.length, failed: failed.length, summary, output }));
  vi.useRealTimers();
  expect(failed.length, JSON.stringify(failed.slice(0, 5))).toBe(0);
});
