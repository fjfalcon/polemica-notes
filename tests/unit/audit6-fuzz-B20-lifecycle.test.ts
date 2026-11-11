// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// A lifecycle witness for historical B20; not a bug of unmodified HEAD.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const obs = vi.hoisted(() => ({ active: true, safe: false,
  fn: null as null | ((reason: string) => void) }));
vi.mock("@core/env", () => ({ browser: { storage: { local: {
  get: async () => ({}), set: async () => {},
} }, runtime: { id: "audit6-fuzz-B20" } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => obs.active,
  nightSceneSafeForRoleShow: () => !obs.active || obs.safe,
  setRoleSceneGateListener: (fn: typeof obs.fn) => {
    obs.fn = fn; return () => { if (obs.fn === fn) obs.fn = null; };
  },
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { pinOwnRole, releasePins } from "@content/role-pin";
const config = (hide: boolean) => ({ settings: {
  auto_accept_enabled: false, skip_start_screen_enabled: false,
  auto_hide_roles_enabled: hide, role_phase_auto_switch_enabled: false,
  obs_enabled: true, obs_auto_mode_enabled: true,
  hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
} }) as never;
const key = (type: string, code: string) => document.dispatchEvent(new KeyboardEvent(type, {
  code, key: code.slice(3).toLowerCase(), keyCode: code.charCodeAt(3),
  bubbles: true, cancelable: true,
}));
const snap = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_990_000_000_000);
  obs.active = true; obs.safe = false;
  document.body.innerHTML = '<div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
});
afterEach(() => {
  autoStartFeature.disable(); releasePins();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});
test.each([
  [false, true], [true, true], [false, false], [true, false],
])("B20: teardown under pin-only V must not carry sceneHide to next boot, AH=%s OBS-already-active=%s", async (hide, activeAtBoot) => {
  autoStartFeature.enable(config(false)); obs.fn?.("gate"); pinOwnRole("hidden");
  expect(snap()).toEqual([false, false]);
  key("keydown", "KeyD"); key("keyup", "KeyD");
  // Intended day exception: D shows peers, own role remains under OBS pin.
  expect(snap()).toEqual([false, true]);
  key("keydown", "KeyV"); expect(isPeeking()).toBe(true);
  expect(snap()).toEqual([true, true]);
  autoStartFeature.disable(); releasePins(); obs.active = activeAtBoot;
  // New lifetime with unsafe active OBS. Old manual marker is not a decision
  // in the new lifetime; first gate has to hide peers even with AH disabled.
  autoStartFeature.enable(config(hide));
  if (!activeAtBoot || hide) {
    expect(snap(), "sequential feature boot must hide before OBS panel starts").toEqual([false, false]);
  }
  obs.active = true; pinOwnRole("hidden");
  obs.fn?.("gate"); await vi.advanceTimersByTimeAsync(16);
  expect(snap(), "first post-boot unsafe gate must hide the whole table").toEqual([false, false]);
});
