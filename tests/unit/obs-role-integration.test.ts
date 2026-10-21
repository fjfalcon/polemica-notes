// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * obs-panel + auto-start ВМЕСТЕ на настоящем распознавании фаз (внешний аудит
 * 21.10.2026). Пин своей роли — obs-panel, сокомандники — CSS auto-start;
 * между ними канал сцены. OBS отвечает обратным событием через 200 мс, как
 * транспорт (ACK команды — НЕ барьер: событие может прийти и раньше, и позже).
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: unknown) => void>,
  scene: "night",
  sent: [] as Array<{ command: string; data?: { sceneName?: string } }>,
  persisted: false,
  /** Видимость в момент отправки set_scene — до того, как OBS что-либо сделал. */
  atSend: [] as Array<{ scene: string; own: string; peer: string }>,
  /** OBS отказывает в смене сцены (вкладка не владелец) — сцена не меняется. */
  refuse: false,
}));
vi.mock("@core/dom", () => ({
  onDomChangeImmediate: (fn: (muts: MutationRecord[]) => void) => {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  },
 onDomChange: () => () => {}, safeClick: () => true, isVisible: () => true }));
vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: {
        get: async () =>
          seam.persisted
            ? { obs_auto_scene_state: { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() } }
            : {},
        set: async () => {},
        remove: async () => {},
      },
      sync: { set: async () => {} },
    },
    runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) },
  },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (msg: unknown) => void) => {
    seam.messages.push(fn);
    return () => {
      seam.messages = seam.messages.filter((x) => x !== fn);
    };
  },
  sendRuntime: async (msg: { command: string; data?: { sceneName?: string } }) => {
    seam.sent.push(msg);
    if (msg.command === "get_status") {
      return { success: true, data: { connected: true, sessionId: "s", currentScene: seam.scene, scenes: [] } };
    }
    if (msg.command === "set_scene") {
      if (seam.refuse) return { ignored: "not_owner" };
      seam.atSend.push({
        scene: msg.data!.sceneName!,
        own: getComputedStyle(own()).visibility,
        peer: getComputedStyle(peer()).visibility,
      });
      setTimeout(() => event("obs_scene_changed", msg.data!.sceneName), 200);
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

const settings = {
  obs_enabled: true,
  obs_auto_mode_enabled: true,
  obs_day_scene: "day",
  obs_night_scene: "night",
  obs_floating_panel_enabled: false,
  auto_accept_enabled: false,
  skip_start_screen_enabled: false,
  disable_webcam_clicks: true,
  auto_hide_roles_enabled: false,
  role_phase_auto_switch_enabled: true,
};
const ctx = (over: Partial<typeof settings> = {}) => ({ settings: { ...settings, ...over } }) as never;
const own = () => document.querySelector<HTMLElement>(".my-role")!;
const peer = () => document.querySelector<HTMLElement>(".peer")!;
const vis = (el: HTMLElement) => getComputedStyle(el).visibility;
function event(eventType: string, data: unknown) {
  seam.messages.forEach((fn) => fn({ type: "obs_event", eventType, data }));
}
const stage = (text: string) => (document.querySelector(".substage.current")!.textContent = text);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  document.body.innerHTML = `
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>
    <div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>`;
  seam.scene = "night";
  seam.sent = [];
  seam.atSend = [];
  seam.persisted = false;
  seam.refuse = false;
});
afterEach(() => {
  autoStartFeature.disable();
  obsPanelFeature.disable();
  resetRolePinForTest();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

test("H02: 2с-опрос heal не сбрасывает 3с-задержку ночного показа своей роли", async () => {
  seam.scene = "day";
  stage("День | речь игрока");
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(2_000);
  expect(own().style.visibility).toBe("hidden");
  stage("Ночь | ход мафии");
  await vi.advanceTimersByTimeAsync(15_000);
  expect(vis(own()), "ночью на ночной сцене своя роль показана").toBe("visible");
  expect(vis(peer()), "и напарник — вместе с ней (одна власть)").toBe("visible");
});

test("B05: перед командой дневной сцены напарники УЖЕ скрыты, хотя current ещё ночь", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  expect(vis(peer())).not.toBe("hidden");
  // current ещё ночной, next уже дневной: obs-panel видит день, auto-start — ночь.
  document
    .querySelector(".stage")!
    .insertAdjacentHTML("beforeend", '<div class="substage next">День | речь игрока</div><div>До смены этапа 5 сек</div>');
  await vi.advanceTimersByTimeAsync(600);
  const day = seam.atSend.find((x) => x.scene === "day");
  expect(day, "команда дневной сцены отправлена").toBeTruthy();
  expect(day, "в момент отправки своя и напарник скрыты").toEqual({ scene: "day", own: "hidden", peer: "hidden" });
});

test("B06: разрыв OBS не отменяет свежее защитное скрытие своей роли", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_600);
  expect(vis(own())).toBe("visible");
  event("obs_disconnected", null);
  expect(vis(own()), "скрыта синхронно — ни одного кадра").toBe("hidden");
  await vi.advanceTimersByTimeAsync(500);
  expect(vis(own())).toBe("hidden");
  expect(vis(peer()), "и напарник — сцена неизвестна").toBe("hidden");
});

test("H04: выключили автосцены — сценовое скрытие напарников снимается", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  // Ручное решение этой ночью через меню сайта (скрыть → показать).
  const button = document.createElement("button");
  document.body.append(button);
  button.textContent = "Скрыть роли";
  button.click();
  button.textContent = "Показать роли";
  button.click();
  button.remove();
  await vi.advanceTimersByTimeAsync(150);
  expect(vis(peer())).toBe("visible");
  event("obs_scene_changed", "day");
  await vi.advanceTimersByTimeAsync(50);
  expect(vis(peer()), "ушли с ночной сцены — напарник скрыт").toBe("hidden");
  obsPanelFeature.update!(ctx({ obs_auto_mode_enabled: false }));
  await vi.advanceTimersByTimeAsync(100);
  expect(vis(peer()), "автосцен нет — сценового скрытия тоже, сразу, не опросом").toBe("visible");
});

test("B07: одни автосцены (без автосмены фаз) — уход с ночной сцены прячет и напарников", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx({ role_phase_auto_switch_enabled: false }));
  await obsPanelFeature.enable(ctx({ role_phase_auto_switch_enabled: false }));
  await vi.advanceTimersByTimeAsync(6_000);
  expect(vis(own())).toBe("visible");
  expect(vis(peer())).toBe("visible");
  event("obs_scene_changed", "day");
  await vi.advanceTimersByTimeAsync(50);
  expect(vis(own())).toBe("hidden");
  expect(vis(peer()), "без зеркала: напарник тоже").toBe("hidden");
});

test("выключили автосцены ночью, эфир был на дневной сцене — ночной показ автосмены открывает роли", async () => {
  seam.persisted = true;
  seam.scene = "day";
  seam.refuse = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  expect([vis(own()), vis(peer())], "не ночная сцена — скрыто всё").toEqual(["hidden", "hidden"]);
  obsPanelFeature.update!(ctx({ obs_auto_mode_enabled: false }));
  await vi.advanceTimersByTimeAsync(4_000);
  expect([vis(own()), vis(peer())]).toEqual(["visible", "visible"]);
});

test("одна власть: ночью игрок спрятал D — своя роль скрыта вместе с напарником (пин OBS не держит её)", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_000);
  expect([vis(own()), vis(peer())]).toEqual(["visible", "visible"]);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
  await vi.advanceTimersByTimeAsync(3_000);
  expect([vis(own()), vis(peer())], "прежний visible-пин оставлял свою роль в эфире").toEqual(["hidden", "hidden"]);
});

test("реконнект OBS через 5 с после ручного скрытия — та же ночь, роли остаются скрыты", async () => {
  seam.persisted = true;
  autoStartFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6_600);
  expect([vis(own()), vis(peer())]).toEqual(["visible", "visible"]);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
  await vi.advanceTimersByTimeAsync(5_000); // дальше запаса распознавания
  event("obs_disconnected", null);
  await vi.advanceTimersByTimeAsync(500);
  event("obs_connected", null);
  event("obs_scenes_updated", { scenes: [{ sceneName: "day" }, { sceneName: "night" }], currentScene: "night" });
  await vi.advanceTimersByTimeAsync(10_000);
  expect([vis(own()), vis(peer())], "реконнект — не новая ночь").toEqual(["hidden", "hidden"]);
});
