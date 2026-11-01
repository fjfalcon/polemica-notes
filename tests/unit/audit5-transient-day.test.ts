// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Внешний аудит №5, B01 и §4.2. Настоящий DesktopRoller при `nightAction=null`
 * на мгновение возвращает в `.substage.current` старую подпись дня (Text-узел)
 * при уже ночной игре. Немедленный детектор видел «день», заканчивал ночь, и
 * следующая ночная подпись начинала «новую» — ручное скрытие этой ночи
 * считалось вчерашним, ночной показ открывал стол.
 *
 * Замысел: день прячет сразу (fail-safe), но заканчивает ночь, только
 * продержавшись DAY_CONFIRM_MS (2 с).
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const obs = vi.hoisted(() => ({
  active: false,
  listener: null as null | ((reason: string, info?: { nightSince?: number }) => void),
}));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { id: "audit5" } },
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
const label = () => document.querySelector(".substage.current")!.firstChild as Text;
const press = (code: string) => {
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
};
/** Переходная разметка: старая подпись дня на один проход Vue, потом ночь. */
async function transientDay(): Promise<void> {
  label().nodeValue = "День | Речь игрока";
  await vi.advanceTimersByTimeAsync(0);
  label().nodeValue = "Ночь | Стрельба";
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_900_000_000_000);
  obs.active = false;
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role"></span></div>`;
});
afterEach(() => {
  autoStartFeature.disable();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

test("B01: ручное скрытие этой ночи переживает переходную подпись дня", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  expect(snap(), "ночной показ").toEqual([true, true]);
  press("KeyD");
  await vi.advanceTimersByTimeAsync(3000);
  expect(snap(), "игрок спрятал этой ночью").toEqual([false, false]);
  await transientDay();
  expect(snap()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "та же ночь — показа нет").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(12000);
  expect(snap()).toEqual([false, false]);
});

test("B01: без ручного решения переходный «день» не отменяет показ этой ночи", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  await transientDay();
  expect(snap(), "день прячет сразу (fail-safe)").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "ночь продолжилась — стол снова виден").toEqual([true, true]);
});

test("контроль: настоящий день (дольше 2 с) заканчивает ночь — следующая показывает", async () => {
  autoStartFeature.enable(ctx);
  await vi.advanceTimersByTimeAsync(4000);
  press("KeyD");
  await vi.advanceTimersByTimeAsync(3000);
  label().nodeValue = "День | Речь игрока";
  await vi.advanceTimersByTimeAsync(10_000);
  expect(snap()).toEqual([false, false]);
  label().nodeValue = "Ночь | ход мафии";
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "D прошлой ночи не решает за новую").toEqual([true, true]);
});

test("B01 с автосценами: переходный «день» не теряет показ ночи — нового nightShow не будет", async () => {
  obs.active = true;
  autoStartFeature.enable(ctx);
  obs.listener?.("nightShow", { nightSince: Date.now() });
  await vi.advanceTimersByTimeAsync(100);
  expect(snap(), "nightShow открыл стол").toEqual([true, true]);
  await transientDay();
  expect(snap()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(3016);
  expect(snap(), "ночь продолжилась — стол снова виден").toEqual([true, true]);
});

test("§4.2: nightShow, запланированный ночью, днём автосмены стол не открывает", async () => {
  obs.active = true;
  autoStartFeature.enable(ctx);
  label().nodeValue = "День | Речь игрока";
  await vi.advanceTimersByTimeAsync(0);
  expect(snap()).toEqual([false, false]);
  obs.listener?.("nightShow", { nightSince: Date.now() - 2900 });
  await vi.advanceTimersByTimeAsync(116);
  expect(snap(), "панель ещё не знает о дне — показ не применяется").toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(snap()).toEqual([false, false]);
});

test("уход эфира на дневную сцену прячет стол и под удерживаемой V (fail-safe, P01)", async () => {
  obs.active = true;
  autoStartFeature.enable({ settings: { ...(ctx as { settings: object }).settings, role_phase_auto_switch_enabled: false } } as never);
  obs.listener?.("nightShow", { nightSince: Date.now() });
  await vi.advanceTimersByTimeAsync(100);
  press("KeyD");
  expect(snap()).toEqual([false, false]);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", bubbles: true, cancelable: true }));
  expect(snap(), "V показывает").toEqual([true, true]);
  obs.listener?.("beforeDayScene");
  expect(snap(), "дневная сцена — скрыто и под V").toEqual([false, false]);
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", bubbles: true }));
  expect(snap()).toEqual([false, false]);
});

test("C05: другой game_id в query без смены пути — новая игра", async () => {
  history.replaceState(null, "", "/game?game_id=410");
  autoStartFeature.enable({ settings: { ...(ctx as { settings: object }).settings, role_phase_auto_switch_enabled: false } } as never);
  expect(snap(), "авто-скрытие").toEqual([false, false]);
  press("KeyD");
  expect(snap(), "игрок показал").toEqual([true, true]);
  history.pushState(null, "", "/game?game_id=411");
  document.querySelectorAll(".player").forEach((p) => p.replaceWith(p.cloneNode(true)));
  await vi.advanceTimersByTimeAsync(0);
  expect(snap(), "новая игра — авто-скрытие снова").toEqual([false, false]);
  history.replaceState(null, "", "/game/1");
});
