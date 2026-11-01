// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Independent unsafe-release control with a new OBS-night epoch under V.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const obs = vi.hoisted(() => ({ safe: false,
  fn: null as null | ((reason: string, info?: { nightSince?: number }) => void) }));
vi.mock("@core/env", () => ({ browser: { storage: { local: {
  get: async () => ({}), set: async () => {},
} }, runtime: { id: "audit6-fuzz-B07" } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => true,
  nightSceneSafeForRoleShow: () => obs.safe,
  setRoleSceneGateListener: (fn: typeof obs.fn) => {
    obs.fn = fn; return () => { if (obs.fn === fn) obs.fn = null; };
  },
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { pinOwnRole, releasePins } from "@content/role-pin";
const key = (type: string, code: string) => document.dispatchEvent(new KeyboardEvent(type, {
  code, key: code.slice(3).toLowerCase(), keyCode: code.charCodeAt(3),
  bubbles: true, cancelable: true,
}));
const pressD = () => { key("keydown", "KeyD"); key("keyup", "KeyD"); };
const snap = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_990_000_000_000); obs.safe = false;
  document.body.innerHTML = '<div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
});
afterEach(() => {
  autoStartFeature.disable(); releasePins();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});
test.each([1, 16, 149, 299])("B07: nightShow under V then unsafe scene at %dms before release still restores concealment", async gap => {
  autoStartFeature.enable({ settings: {
    auto_accept_enabled: false, skip_start_screen_enabled: false,
    auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false,
    obs_enabled: true, obs_auto_mode_enabled: true,
    hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
  } } as never);
  obs.fn?.("beforeDayScene"); pinOwnRole("hidden"); expect(snap()).toEqual([false, false]);
  // Player's day decision changes manual mark relative to sceneHide snapshot.
  pressD(); expect(snap()).toEqual([false, true]);
  pressD(); expect(snap()).toEqual([false, false]);
  key("keydown", "KeyV"); expect(isPeeking()).toBe(true); expect(snap()).toEqual([true, true]);
  // A genuinely later OBS night: the prior decision is not this night's.
  await vi.advanceTimersByTimeAsync(3001);
  obs.safe = true; obs.fn?.("nightShow", { nightSince: Date.now() });
  await vi.advanceTimersByTimeAsync(gap);
  obs.safe = false; obs.fn?.("gate");
  await vi.advanceTimersByTimeAsync(gap);
  key("keyup", "KeyV");
  expect(snap(), "unsafe release restores previous CSS even if sceneHide's manual mark is older").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(300);
  expect(snap()).toEqual([false, false]);
});
