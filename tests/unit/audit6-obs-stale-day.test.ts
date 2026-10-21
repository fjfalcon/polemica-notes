// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Внешний аудит №6, B03 — сторона автосцен. Застрявшая подпись роллера
 * (current — старый день, next — ночь, игра ночная) не должна уводить эфир на
 * DAY и начинать «новую ночь»: настоящие obs-panel и auto-start вместе.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: unknown) => void>,
  scene: "night",
  sent: [] as string[],
}));
vi.mock("@core/env", () => ({
  browser: {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { set: async () => {} } },
    runtime: { id: "audit6", getManifest: () => ({ version: "9.67.0" }) },
  },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (msg: unknown) => void) => {
    seam.messages.push(fn);
    return () => (seam.messages = seam.messages.filter((x) => x !== fn));
  },
  sendRuntime: async (msg: { command: string; data?: { sceneName?: string } }) => {
    if (msg.command === "get_status") {
      return { success: true, data: { connected: true, sessionId: "s", currentScene: seam.scene, scenes: [] } };
    }
    if (msg.command === "set_scene") {
      const name = msg.data!.sceneName!;
      seam.sent.push(name);
      setTimeout(() => {
        seam.scene = name;
        seam.messages.forEach((fn) => fn({ type: "obs_event", eventType: "obs_scene_changed", data: name }));
      }, 200);
    }
    return { success: true };
  },
  broadcastToGameTabs: vi.fn(),
  sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));

import { autoStartFeature } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";

const ctx = {
  settings: {
    obs_enabled: true,
    obs_auto_mode_enabled: true,
    obs_day_scene: "day",
    obs_night_scene: "night",
    obs_floating_panel_enabled: false,
    auto_accept_enabled: false,
    skip_start_screen_enabled: false,
    disable_webcam_clicks: true,
    auto_hide_roles_enabled: false,
    role_phase_auto_switch_enabled: false,
  },
} as never;
const snap = () =>
  [...document.querySelectorAll<HTMLElement>(".player__role")].map((el) => getComputedStyle(el).visibility !== "hidden");
const stage = (current: string, next: string) => {
  document.querySelector(".substage.current")!.textContent = current;
  document.querySelector(".substage.next")!.textContent = next;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_900_000_000_000);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {},
  });
  seam.scene = "night";
  seam.sent = [];
  document.body.innerHTML = `<div class="roller"><div class="stage">
      <div class="substage current">Ночь | ход мафии</div><div class="substage next">Ночь | Стрельба</div>
    </div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role"></span></div>`;
});
afterEach(() => {
  autoStartFeature.disable();
  obsPanelFeature.disable();
  resetRolePinForTest();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
});

test("застрявшая подпись дня после ночи: эфир остаётся на NIGHT, ночь та же", async () => {
  autoStartFeature.enable(ctx);
  await obsPanelFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(6000);
  expect(snap(), "ночь, ночная сцена — стол виден").toEqual([true, true]);
  stage("День | Речь игрока", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(5000);
  expect(seam.sent, "дневная сцена по застрявшей подписи не включается").not.toContain("day");
  expect(seam.scene).toBe("night");
  stage("Ночь | Стрельба", "День | Речь игрока");
  await vi.advanceTimersByTimeAsync(5000);
  expect(snap()).toEqual([true, true]);
});

test("контроль: однозначный день уводит эфир на DAY", async () => {
  autoStartFeature.enable(ctx);
  await obsPanelFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(6000);
  stage("День | Речь игрока", "День | Голосование");
  await vi.advanceTimersByTimeAsync(3000);
  expect(seam.sent).toContain("day");
  expect(snap()).toEqual([false, false]);
});
