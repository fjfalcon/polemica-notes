// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Внешний аудит №4, B02: «подсмотреть» переназначено на F5, фикс F5 включён
 * (по умолчанию). stopPropagation роутера соседний listener на том же window
 * не останавливает — фикс F5 перезагружал страницу посреди удержания, и
 * отпускание уже некому было возвращать ручное скрытие: роли оставались в
 * эфире. Фикс F5 зарегистрирован РАНЬШЕ роутера — худший порядок.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { id: "audit4" } },
}));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => false,
  nightSceneSafeForRoleShow: () => true,
  setRoleSceneGateListener: () => () => {},
}));

import { log } from "@core/log";
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { f5RefreshFeature } from "@content/features/f5-refresh";

const hidden = () => !!document.getElementById("polemica-role-hide");
const key = (type: string, code: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
};
/**
 * Перезагрузка — по самому переходу: jsdom сообщает о любой навигации
 * событием jsdomError виртуальной консоли («Not implemented: navigation»), кто
 * бы ни вызвал reload. Одна запись в лог фичи не годилась: тихий
 * location.reload её обходил (восьмой аудит, §2.1).
 */
let navigations = 0;
(globalThis as { jsdom?: { virtualConsole: { on(ev: string, fn: (e: Error) => void): void } } }).jsdom!.virtualConsole.on(
  "jsdomError",
  (e) => {
    if (String(e.message).includes("navigation")) navigations++;
  },
);
const reloaded = () => navigations > 0 || vi.mocked(log.info).mock.calls.some((c) => c[0] === "f5-refresh");
const ctx = (peek: string) =>
  ({
    settings: {
      auto_accept_enabled: false,
      skip_start_screen_enabled: false,
      auto_hide_roles_enabled: false,
      role_phase_auto_switch_enabled: false,
      hotkey_role_hide: "KeyD",
      hotkey_role_peek: peek,
    },
  }) as never;

beforeEach(() => {
  navigations = 0;
  vi.useFakeTimers();
  vi.mocked(log.info).mockClear();
  document.body.innerHTML = `<div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role"></span></div>`;
});
afterEach(() => {
  window.dispatchEvent(new Event("blur"));
  autoStartFeature.disable();
  f5RefreshFeature.disable();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
});

test("peek=F5: hold reveals, release restores the manual hide — no reload in between", async () => {
  f5RefreshFeature.enable({ settings: {} } as never);
  autoStartFeature.enable(ctx("F5"));
  key("keydown", "KeyD");
  key("keyup", "KeyD");
  expect(hidden(), "D скрыл стол").toBe(true);
  const down = key("keydown", "F5");
  expect(isPeeking()).toBe(true);
  expect(hidden()).toBe(false);
  expect(reloaded(), "F5 — клавиша «подсмотреть», не перезагрузка").toBe(false);
  expect(down.defaultPrevented).toBe(true);
  key("keyup", "F5");
  expect(isPeeking()).toBe(false);
  expect(hidden(), "отпускание вернуло ручное скрытие").toBe(true);
});

test("control: F5 not bound by us — the F5 fix still reloads", () => {
  f5RefreshFeature.enable({ settings: {} } as never);
  autoStartFeature.enable(ctx("KeyV"));
  key("keydown", "F5");
  expect(navigations, "настоящая навигация видна тесту").toBeGreaterThan(0);
});

test("control: modified F5 (hard reload) is never touched", () => {
  f5RefreshFeature.enable({ settings: {} } as never);
  key("keydown", "F5", { ctrlKey: true });
  expect(reloaded()).toBe(false);
});
