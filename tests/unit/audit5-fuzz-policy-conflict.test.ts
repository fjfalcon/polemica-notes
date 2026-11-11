// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Audit-only policy conflict: one intentional strict-oracle failure, plus a
// passing witness of the previously documented fail-safe day priority.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit5-F-policy", getManifest: () => ({ version: "9.67.0" }) },
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

const snap = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
const event = (type: string, code: string) => document.dispatchEvent(new KeyboardEvent(type, {
  code, key: code.slice(3).toLowerCase(), keyCode: code === "KeyD" ? 68 : 86,
  bubbles: true, cancelable: true,
}));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_990_000_000_000));
  document.body.innerHTML = '<div class="stage"><div class="substage current">Ход мафии</div></div><div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
});
afterEach(() => {
  autoStartFeature.disable();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});

// P01: выбран fail-safe «день прячет и под V» (буквальное «под V видно всё» — вне замысла).
test.each(["documented-day-fail-safe"] as const)(
  "audit5-F policy: %s through actual immediate Text-node day transition while V held",
  async policy => {
    autoStartFeature.enable({ settings: {
      auto_accept_enabled: false, skip_start_screen_enabled: false,
      auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: true,
      hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
    } } as never);
    await vi.advanceTimersByTimeAsync(4000);
    expect(snap(), "night auto-show settled").toEqual([true, true]);
    event("keydown", "KeyD"); event("keyup", "KeyD");
    await vi.advanceTimersByTimeAsync(100);
    expect(snap(), "manual hide this night").toEqual([false, false]);
    event("keydown", "KeyV");
    await vi.advanceTimersByTimeAsync(16);
    expect(isPeeking()).toBe(true);
    expect(snap(), "actual active V shows everything before day").toEqual([true, true]);
    const label = document.querySelector(".substage.current")!.firstChild!;
    label.nodeValue = "Речь игрока"; // retained Text vnode, not element.textContent
    await Promise.resolve(); await Promise.resolve();
    const immediate = { peeking: isPeeking(), css: !!document.getElementById("polemica-role-hide"), visible: snap() };
    await vi.advanceTimersByTimeAsync(16);
    const nextFrameTime = { peeking: isPeeking(), visible: snap() };
    expect(immediate.peeking).toBe(true);
    expect(nextFrameTime.peeking).toBe(true);
    // Both expectations are explicit: the contradiction is not silently
    // resolved by replacing the user oracle with production behavior.
    const expected = policy === "documented-day-fail-safe" ? [false, false] : [true, true];
    expect(immediate.visible, "same MO turn while V still held").toEqual(expected);
    expect(nextFrameTime.visible, "+16ms while V still held").toEqual(expected);
    event("keyup", "KeyV");
    await vi.advanceTimersByTimeAsync(1);
    expect(snap(), "day remains hidden after release").toEqual([false, false]);
  },
);
