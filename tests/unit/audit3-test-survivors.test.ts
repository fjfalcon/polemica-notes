// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const obs = vi.hoisted(() => ({
  safe: true,
  listener: null as null | ((reason: "gate" | "beforeDayScene" | "nightShow", info?: { nightSince: number }) => void),
}));
vi.mock("@core/dom", () => ({
  onDomChange: () => () => {},
  onDomChangeImmediate: (fn: (muts: MutationRecord[]) => void) => {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  },
  safeClick: () => true, isVisible: () => true,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit3", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({ success: true }), broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => true,
  nightSceneSafeForRoleShow: () => obs.safe,
  setRoleSceneGateListener: (fn: typeof obs.listener) => {
    obs.listener = fn;
    const poll = setInterval(() => obs.listener?.("gate"), 2_000);
    return () => { clearInterval(poll); obs.listener = null; };
  },
}));
import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";
const ctx = (autoHide = false) => ({ settings: {
  auto_hide_roles_enabled: autoHide, role_phase_auto_switch_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
} }) as never;
const key = (type: string, code: string) => document.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true }));
const pressD = () => { key("keydown", "KeyD"); key("keyup", "KeyD"); };
const seen = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => getComputedStyle(el).visibility !== "hidden");
let since = 0;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  since = Date.now(); obs.safe = true;
  document.body.innerHTML = `<div class="stage"><div class="substage current">Ход мафии</div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
});
afterEach(() => {
  autoStartFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});

test("AUDIT3 B21: manually hide then show, leave scene, return: restore originally shown roles", async () => {
  autoStartFeature.enable(ctx());
  obs.listener?.("nightShow", { nightSince: since });
  await vi.advanceTimersByTimeAsync(10);
  pressD(); await vi.advanceTimersByTimeAsync(10); pressD();
  expect(seen()).toEqual([true, true]);
  obs.safe = false; obs.listener?.("gate");
  expect(seen()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(3_000);
  obs.safe = true; obs.listener?.("gate");
  obs.listener?.("nightShow", { nightSince: since });
  expect(seen(), "return to safe scene removes scene-only hide, not a manual hide").toEqual([true, true]);
});

test("AUDIT3 B17: last hiding setting off under V, scene leaves under V: release hides immediately", async () => {
  autoStartFeature.enable(ctx(true));
  key("keydown", "KeyV");
  expect(seen()).toEqual([true, true]);
  autoStartFeature.update!(ctx(false));
  obs.safe = false; obs.listener?.("gate");
  key("keyup", "KeyV");
  expect(seen(), "unsafe scene must not expose peers until next 2s heal poll").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(seen()).toEqual([false, false]);
});
