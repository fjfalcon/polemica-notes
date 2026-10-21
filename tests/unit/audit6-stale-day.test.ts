// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Внешний аудит №6, B03/H01. На `toNight` с отсчётом сайт после отсчёта не
 * вызывает setStage: до следующего пакета `current` — старый день, `next` —
 * ночь, игра уже ночная, и это может длиться дольше двух секунд. Такая
 * подпись прячет стол (fail-safe), но ночь не заканчивает: ручные решения
 * этой ночи остаются, а виденный до неё стол возвращается.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const obs = vi.hoisted(() => ({
  active: false,
  listener: null as null | ((reason: string, info?: { nightSince?: number }) => void),
}));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { id: "audit6" } },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => obs.active,
  nightSceneSafeForRoleShow: () => true,
  setRoleSceneGateListener: (fn: typeof obs.listener) => {
    obs.listener = fn;
    return () => (obs.listener = null);
  },
}));

import { autoStartFeature } from "@content/features/auto-start";

const ctx = {
  settings: {
    auto_accept_enabled: false,
    skip_start_screen_enabled: false,
    auto_hide_roles_enabled: true,
    role_phase_auto_switch_enabled: true,
    hotkey_role_hide: "KeyD",
    hotkey_role_peek: "KeyV",
  },
} as never;
const snap = () =>
  [...document.querySelectorAll<HTMLElement>(".player__role")].map((el) => getComputedStyle(el).visibility !== "hidden");
const press = () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
};
const stage = (current: string, next: string) => {
  (document.querySelector(".substage.current")!.firstChild as Text).nodeValue = current;
  (document.querySelector(".substage.next")!.firstChild as Text).nodeValue = next;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_900_000_000_000);
  obs.active = false;
  document.body.innerHTML = `<div class="roller"><div class="stage">
      <div class="substage current">Ночь | ход мафии</div><div class="substage next">Ночь | Стрельба</div>
    </div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role"></span></div>`;
});
afterEach(() => {
  autoStartFeature.disable();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

test("B03: застрявшая подпись дня дольше 2 с не отменяет ручное скрытие этой ночи", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  expect(snap()).toEqual([true, true]);
  press();
  await vi.advanceTimersByTimeAsync(500);
  expect(snap()).toEqual([false, false]);
  stage("День | Речь игрока", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(5000);
  expect(snap(), "подпись прячет").toEqual([false, false]);
  stage("Ночь | Стрельба", "День | Речь игрока");
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "та же ночь — скрытие игрока держится").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(snap()).toEqual([false, false]);
});

test("H01: ручной показ этой ночи возвращается после застрявшей подписи", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  press();
  await vi.advanceTimersByTimeAsync(100);
  press();
  expect(snap(), "игрок показал").toEqual([true, true]);
  stage("День | Речь игрока", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(1000);
  expect(snap()).toEqual([false, false]);
  stage("Ночь | Стрельба", "День | Речь игрока");
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "стол как был — без D/F5").toEqual([true, true]);
});

test("контроль: однозначный день (следующий этап — день) заканчивает ночь", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  press();
  await vi.advanceTimersByTimeAsync(500);
  stage("День | Речь игрока", "День | Голосование");
  await vi.advanceTimersByTimeAsync(3000);
  stage("Ночь | ход мафии", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "новая ночь показывает").toEqual([true, true]);
});

test("B03 с автосценами: pre-day панели по застрявшей подписи не стирает эпоху этой ночи", async () => {
  obs.active = true;
  autoStartFeature.enable(ctx);
  obs.listener?.("nightShow", { nightSince: Date.now() });
  await vi.advanceTimersByTimeAsync(100);
  expect(snap()).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(3000);
  press();
  expect(snap()).toEqual([false, false]);
  stage("День | Речь игрока", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(500);
  obs.listener?.("beforeDayScene"); // панель подтвердила свой «день» за ~0,5 с
  await vi.advanceTimersByTimeAsync(5000); // подпись держится дольше запаса 2,5 с
  stage("Ночь | Стрельба", "День | Речь игрока");
  await vi.advanceTimersByTimeAsync(100);
  obs.listener?.("nightShow", { nightSince: Date.now() }); // новая «ночь» панели
  await vi.advanceTimersByTimeAsync(12_000);
  expect(snap(), "скрытие этой ночи держится").toEqual([false, false]);
});

test("однозначность наступила позже: день, начатый с ночным следующим этапом, всё же заканчивает ночь", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  press();
  await vi.advanceTimersByTimeAsync(500);
  stage("День | Речь игрока", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(1000);
  stage("День | Речь игрока", "День | Голосование");
  await vi.advanceTimersByTimeAsync(3000);
  stage("Ночь | ход мафии", "Ночь | Стрельба");
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "это был настоящий день — новая ночь показывает").toEqual([true, true]);
});
