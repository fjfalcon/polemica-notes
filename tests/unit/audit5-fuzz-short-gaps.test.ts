// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Audit-only independent expectations; no imported fuzz Spec.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit5-F", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  nightSceneSafeForRoleShow: () => true, obsAutoScenesActive: () => false,
  setRoleSceneGateListener: () => () => {},
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";

const settings = { auto_accept_enabled: false, skip_start_screen_enabled: false,
  auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false,
  hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV" };
const snap = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
const key = (type: string) => document.dispatchEvent(new KeyboardEvent(type, {
  code: "KeyV", key: "v", keyCode: 86, bubbles: true, cancelable: true,
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_990_000_000_000));
  document.body.innerHTML = '<div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
});
afterEach(() => {
  autoStartFeature.disable();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});

test("audit5-F: active V must actually show both roles at +16 and +40ms, not merely avoid a mirror", async () => {
  autoStartFeature.enable({ settings } as never);
  expect(snap()).toEqual([false, false]);
  key("keydown");
  await vi.advanceTimersByTimeAsync(16);
  expect(isPeeking()).toBe(true);
  expect(snap()).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(24);
  expect(snap()).toEqual([true, true]);
  key("keyup");
  await vi.advanceTimersByTimeAsync(1);
  expect(snap()).toEqual([false, false]);
});

test("audit5-F: no 50ms hidden-table gap may be lost between fuzz +1000 and +1250 samples", async () => {
  autoStartFeature.enable({ settings } as never);
  let at = 0;
  for (const t of [0, 1000, 1049, 1050, 1066, 1099, 1100, 1101, 1250]) {
    await vi.advanceTimersByTimeAsync(t - at); at = t;
    expect(snap(), `hidden at +${t}ms`).toEqual([false, false]);
  }
});
