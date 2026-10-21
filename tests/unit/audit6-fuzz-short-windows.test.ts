// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Independent oracle probes, actual immediate observer/router/native hotkeys.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const obs = vi.hoisted(() => ({ active: false, safe: true,
  fn: null as null | ((reason: string, info?: { nightSince?: number }) => void) }));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit6-fuzz", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => obs.active,
  nightSceneSafeForRoleShow: () => !obs.active || obs.safe,
  setRoleSceneGateListener: (fn: typeof obs.fn) => {
    obs.fn = fn;
    return () => { if (obs.fn === fn) obs.fn = null; };
  },
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";

const fixture = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = fixture.indexOf('Zd="undefined"');
const end = fixture.indexOf("var _h=gh;", start);
if (start < 0 || end < 0) throw new Error("native hotkeys fixture changed");
const factory = new Function("window", "document", "navigator", `var ${fixture.slice(start, end)}; return gh;`);
let native: any;
let flag = true;
let toggles = 0;
const roles = () => [...document.querySelectorAll<HTMLElement>(".player__role")];
const writeFlag = () => roles().forEach(el => { el.style.display = flag ? "" : "none"; });
const snap = () => roles().map(el => {
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
function key(type: string, code: string, options: KeyboardEventInit = {}) {
  const kc = code === "Backquote" ? 192 : code.charCodeAt(3);
  return document.dispatchEvent(new KeyboardEvent(type, {
    code, key: code.slice(3).toLowerCase(), keyCode: kc, which: kc,
    bubbles: true, cancelable: true, ...options,
  }));
}
const press = (code: string, opts: KeyboardEventInit = {}) => { key("keydown", code, opts); key("keyup", code); };
const config = (phase = false) => ({ settings: {
  auto_accept_enabled: false, skip_start_screen_enabled: false,
  auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: phase,
  hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
} }) as never;
async function phase(text: "day" | "night") {
  document.querySelector(".substage.current")!.firstChild!.nodeValue = text === "day" ? "Речь игрока" : "Ход мафии";
  await Promise.resolve(); await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_990_000_000_000);
  obs.active = false; obs.safe = true; obs.fn = null;
  flag = true; toggles = 0;
  document.body.innerHTML = '<div class="roller"><div class="stage"><div class="substage current">Ход мафии</div></div></div><div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
  native = factory(window, document, navigator);
  native("ctrl+d,command+d", () => { flag = !flag; toggles++; queueMicrotask(writeFlag); return false; });
});
afterEach(() => {
  autoStartFeature.disable(); native?.unbind(); window.dispatchEvent(new Event("focus"));
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});

test.each([0, 1, 16, 49, 149, 299])("PTT/V/native parity at %dms gaps", async gap => {
  flag = false; writeFlag(); autoStartFeature.enable(config());
  key("keydown", "Backquote");
  key("keydown", "KeyV"); await vi.advanceTimersByTimeAsync(gap);
  expect(isPeeking()).toBe(true); expect(snap()).toEqual([true, true]);
  press("KeyD", { ctrlKey: true }); await vi.advanceTimersByTimeAsync(gap);
  expect(toggles).toBe(0); expect(snap()).toEqual([true, true]);
  key("keyup", "KeyV"); await vi.advanceTimersByTimeAsync(gap);
  expect(snap()).toEqual([false, false]);
  // PTT cannot prevent our own CSS D from showing/hiding.
  press("KeyD"); expect(snap()).toEqual([true, true]);
  press("KeyD"); expect(snap()).toEqual([false, false]);
  key("keyup", "Backquote");
  press("KeyD", { ctrlKey: true }); await vi.advanceTimersByTimeAsync(1);
  expect(toggles).toBe(1); expect(snap()).toEqual([true, true]);
});

test.each([1, 16, 49, 149, 299])("accepted day under V, then transient night at %dms", async gap => {
  autoStartFeature.enable(config(true)); await vi.advanceTimersByTimeAsync(4000);
  press("KeyD"); expect(snap()).toEqual([false, false]);
  key("keydown", "KeyV"); expect(isPeeking()).toBe(true); expect(snap()).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(gap); await phase("day");
  expect(isPeeking()).toBe(true); expect(snap(), "P01, before any frame timer").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(gap); await phase("night");
  key("keyup", "KeyV"); expect(snap()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(3500);
  expect(snap(), "manual choice belongs to same night").toEqual([false, false]);
});

test.each([1999, 2000, 2001])("day confirmation boundary %dms", async duration => {
  autoStartFeature.enable(config(true)); await vi.advanceTimersByTimeAsync(4000);
  press("KeyD"); await vi.advanceTimersByTimeAsync(3000);
  await phase("day"); expect(snap()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(duration); await phase("night");
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "<2s same night, >=2s new night").toEqual(duration < 2000 ? [false, false] : [true, true]);
});

test.each([2499, 2500, 2501])("manual decision %dms before new night respects exact slack", async delta => {
  autoStartFeature.enable(config(true)); await vi.advanceTimersByTimeAsync(4000);
  await phase("day"); await vi.advanceTimersByTimeAsync(3000);
  // Two deliberate actions, ending hidden, exactly delta before recognition.
  press("KeyD"); press("KeyD"); await vi.advanceTimersByTimeAsync(delta);
  await phase("night"); await vi.advanceTimersByTimeAsync(3016);
  expect(snap()).toEqual(delta <= 2500 ? [false, false] : [true, true]);
});

test.each([0, 16, 149, 299])("scene restoration while V held at %dms gaps", async gap => {
  obs.active = true; obs.safe = true;
  autoStartFeature.enable(config());
  const since = Date.now(); obs.fn?.("nightShow", { nightSince: since });
  expect(snap()).toEqual([true, true]);
  obs.safe = false; obs.fn?.("gate"); expect(snap()).toEqual([false, false]);
  key("keydown", "KeyV"); expect(snap()).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(gap);
  obs.safe = true; obs.fn?.("gate"); obs.fn?.("nightShow", { nightSince: since });
  await vi.advanceTimersByTimeAsync(gap);
  key("keyup", "KeyV"); expect(snap()).toEqual([true, true]);
  key("keydown", "KeyV"); // Empty hold does not give an exception to day privacy.
  obs.fn?.("beforeDayScene"); obs.safe = false; obs.fn?.("gate");
  expect(snap()).toEqual([false, false]); key("keyup", "KeyV");
  await vi.advanceTimersByTimeAsync(300);
  expect(snap()).toEqual([false, false]);
});

test("32ms pulse cannot hide between the fuzz's +1000/+1250ms samples", async () => {
  autoStartFeature.enable(config());
  let at = 0;
  for (const t of [1100, 1126, 1127, 1143, 1159, 1160, 1161, 1250]) {
    await vi.advanceTimersByTimeAsync(t - at); at = t;
    expect(snap(), `all hidden at +${t}ms`).toEqual([false, false]);
  }
});
