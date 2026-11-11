// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const seam = vi.hoisted(() => ({ messages: [] as Array<(msg: unknown) => void> }));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { set: async () => {} } },
  runtime: { id: "audit3", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (msg: unknown) => void) => {
    seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); };
  },
  sendRuntime: async (msg: { command: string; data?: { sceneName: string } }) => {
    if (msg.command === "get_status") return { success: true, data: { connected: true, sessionId: "s", currentScene: "night", scenes: [] } };
    if (msg.command === "set_scene") setTimeout(() => scene(msg.data!.sceneName), 200);
    return { success: true };
  },
  broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn(),
}));
import { autoStartFeature } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";
const ctx = (hide = false) => ({ settings: {
  obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: hide, role_phase_auto_switch_enabled: false,
} }) as never;
const scene = (name: string) => seam.messages.forEach(fn => fn({ type: "obs_event", eventType: "obs_scene_changed", data: name }));
const key = (type: string, code: string) => document.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true }));
const pressD = () => { key("keydown", "KeyD"); key("keyup", "KeyD"); };
const seen = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => getComputedStyle(el).visibility !== "hidden");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 20, height: 20 } as DOMRect);
});
afterEach(() => {
  autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.head.innerHTML = "";
});

test("AUDIT3 real OBS B17: disable last setting under V, unsafe scene, release cannot await heal", async () => {
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  autoStartFeature.update!(ctx(true));
  key("keydown", "KeyV");
  expect(seen()).toEqual([true, true]);
  autoStartFeature.update!(ctx(false));
  scene("day");
  key("keyup", "KeyV");
  expect(seen(), "actual OBS channel, no mocked gate/DOM/router/faker").toEqual([false, false]);
});

test("AUDIT3 real OBS B21: manual shown state restores after scene round-trip", async () => {
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  expect(seen()).toEqual([true, true]);
  pressD(); await vi.advanceTimersByTimeAsync(10); pressD();
  expect(seen()).toEqual([true, true]);
  scene("day");
  expect(seen()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(10);
  scene("night");
  await vi.advanceTimersByTimeAsync(4_000);
  expect(seen()).toEqual([true, true]);
});

test("AUDIT3 real OBS B22: disabled auto-start is not called by later scene events", async () => {
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  autoStartFeature.disable();
  expect(document.getElementById("polemica-role-hide")).toBeNull();
  scene("day");
  expect(document.getElementById("polemica-role-hide"), "disabled consumer must not revive its table CSS").toBeNull();
  expect(getComputedStyle(document.querySelector(".peer")!).visibility).not.toBe("hidden");
});
