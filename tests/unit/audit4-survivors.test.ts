// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Внешний аудит №4, §F: мутанты, пережившие весь набор (C04, C06, D01), —
 * закрепляем их гарантии напрямую.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const faked = vi.hoisted(() => ({ on: false }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => {} }, sync: { set: async () => {} } }, runtime: { id: "audit4" } },
}));
const bus = vi.hoisted(() => ({ handlers: [] as Array<(m: unknown) => void> }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (m: unknown) => void) => {
    bus.handlers.push(fn);
    return () => (bus.handlers = bus.handlers.filter((h) => h !== fn));
  },
  sendRuntime: async () => ({}),
  broadcastToGameTabs: vi.fn(),
  sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@core/dom", async (orig) => ({ ...(await orig<object>()), isVisible: () => true }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => faked.on }));

import { autoStartFeature } from "@content/features/auto-start";
import { setRoleSceneGateListener, obsPanelFeature } from "@content/panels/obs-panel";

const ctx = {
  settings: {
    auto_accept_enabled: false,
    skip_start_screen_enabled: false,
    auto_hide_roles_enabled: false,
    role_phase_auto_switch_enabled: false,
    hotkey_role_hide: "KeyD",
    hotkey_role_peek: "KeyV",
  },
} as never;

const obsCtx = {
  settings: { obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false },
} as never;
const obsEvent = (eventType: string, data: unknown = null) =>
  bus.handlers.forEach((fn) => fn({ type: "obs_event", eventType, data }));

beforeEach(() => {
  vi.useFakeTimers();
  faked.on = false;
  document.body.innerHTML = `<div class="player my-player"><span class="player__role role my-role"></span></div>`;
});
afterEach(() => {
  autoStartFeature.disable();
  obsPanelFeature.disable();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

test("C04: под подменой Ctrl+D сайту не доходит (его тумблер ролей не трогает стол)", () => {
  autoStartFeature.enable(ctx);
  const seen: boolean[] = [];
  const site = (e: KeyboardEvent) => seen.push(e.ctrlKey);
  document.addEventListener("keydown", site); // как hotkeys-js сайта — всплытие на document
  faked.on = true;
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true }));
  faked.on = false;
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true }));
  document.removeEventListener("keydown", site);
  expect(seen, "без подмены Ctrl+D — сайту; под подменой — нет").toEqual([true]);
});

test("C06: запоздалая отписка прежнего слушателя гейта не снимает более новый", async () => {
  await obsPanelFeature.enable(obsCtx);
  const first = vi.fn();
  const second = vi.fn();
  const offFirst = setRoleSceneGateListener(first);
  const offSecond = setRoleSceneGateListener(second);
  offFirst();
  obsEvent("obs_disconnected");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalled();
  offSecond();
});

test("D01: упавший слушатель гейта не срывает скрытие своей роли при разрыве OBS", async () => {
  await obsPanelFeature.enable(obsCtx);
  const off = setRoleSceneGateListener(() => {
    throw new Error("listener failed");
  });
  obsEvent("obs_disconnected");
  off();
  expect(getComputedStyle(document.querySelector<HTMLElement>(".my-role")!).visibility).toBe("hidden");
});
