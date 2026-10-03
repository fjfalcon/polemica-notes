// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * Автонажатие «Готов» в лобби (запрос пользователей 03.10.2026).
 *
 * Фича жмёт toggle-кнопку за игрока — сторожим предохранители:
 *  - ровно один автоклик на лобби (повтор — только после неподтверждённого,
 *    и только один);
 *  - active-кнопку не трогаем, после снятой игроком готовности не трогаем
 *    (лишний клик по toggle = переигранное чужое решение);
 *  - «Не готов» не матчится (точное совпадение текста, §4 п.2);
 *  - хук noteIntentClick уходит ДО клика (полный автоматизм — решение
 *    владельца 03.10.2026: автоклик приравнен к клику игрока; иначе requeue
 *    засчитать DOM-готовность как подтверждение присутствия);
 *  - смена страницы = новое лобби: латчи умирают.
 */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

let domSubscriber: (() => void) | null = null;
const calls: string[] = [];

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    domSubscriber = cb;
    return () => {
      domSubscriber = null;
    };
  }),
  safeClick: vi.fn(() => {
    calls.push("click");
    return true;
  }),
  // В jsdom вёрстки нет — видимость подменяем, важна логика предохранителей.
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@content/features/queue-requeue", () => ({
  noteIntentClick: vi.fn(() => calls.push("note")),
}));

import { CLICK_DELAY_MS, autoReadyFeature, findReadyButton } from "@content/features/auto-ready";
import { noteIntentClick } from "@content/features/queue-requeue";
import { safeClick } from "@core/dom";
import { log } from "@core/log";
import type { FeatureContext } from "@core/feature";

const ctx = { settings: { auto_ready_enabled: true } } as unknown as FeatureContext;

function pregame(opts: { active?: boolean; label?: string; disabled?: boolean } = {}): void {
  const { active = false, label = "Готов", disabled = false } = opts;
  document.body.innerHTML = `
    <div class="controls">
      <div class="button preset-1 medium desktop-version${active ? " active" : ""}${disabled ? " disabled" : ""}">${label}</div>
      <div class="button preset-1 medium desktop-version active">Микрофон</div>
    </div>`;
}

/** Прогнать подписчика с дросселем 250 мс. */
function pass(): void {
  domSubscriber?.();
  vi.advanceTimersByTime(260);
}

function clicks(): number {
  return calls.filter((c) => c === "click").length;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/game");
  document.body.innerHTML = "";
  domSubscriber = null;
  calls.length = 0;
});

afterEach(() => {
  autoReadyFeature.disable();
  vi.useRealTimers();
});

describe("автоклик с выдержкой", () => {
  test("кликает один раз после выдержки; хук requeue — ДО клика", () => {
    pregame();
    void autoReadyFeature.enable(ctx);
    // Два ранних прохода (~520 мс): без проверки времени второй проход уже
    // кликнул бы (мутация «выдержка снята», 03.10.2026).
    pass();
    pass();
    expect(clicks(), "до выдержки клика нет").toBe(0);
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    expect(clicks()).toBe(1);
    // Синхронно ДО клика: развал в ту же секунду не должен потерять намерение.
    expect(calls.slice(0, 2), "намерение фиксируется раньше клика").toEqual(["note", "click"]);
    expect(vi.mocked(noteIntentClick)).toHaveBeenCalledTimes(1);
    // Передаётся САМА кнопка: classifyIntentTarget опознаёт её как room-ready.
    expect(vi.mocked(noteIntentClick).mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  test("кнопка active (готовность уже стоит) — не кликаем вовсе", () => {
    pregame({ active: true });
    void autoReadyFeature.enable(ctx);
    vi.advanceTimersByTime(CLICK_DELAY_MS * 3);
    pass();
    expect(clicks()).toBe(0);
  });

  test("игрок снял готовность — его волю не переигрываем", () => {
    pregame({ active: true });
    void autoReadyFeature.enable(ctx);
    pass();
    // Игрок кликнул «Готов» ещё раз — сайт снял active.
    pregame({ active: false });
    // Два прохода с выдержкой между ними: без гейта seenActive первый проход
    // взвёл бы выдержку, а второй — КЛИКНУЛ (вакуумная версия этого теста
    // давала один проход и зеленела без гейта — мутация 03.10.2026).
    pass();
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    expect(clicks()).toBe(0);
  });

  test("«Не готов» не матчится: точное совпадение, не подстрока", () => {
    pregame({ label: "Не готов" });
    void autoReadyFeature.enable(ctx);
    expect(findReadyButton()).toBeNull();
    vi.advanceTimersByTime(CLICK_DELAY_MS * 3);
    pass();
    expect(clicks()).toBe(0);
  });

  test("disabled-кнопку не жмём", () => {
    pregame({ disabled: true });
    void autoReadyFeature.enable(ctx);
    vi.advanceTimersByTime(CLICK_DELAY_MS * 3);
    pass();
    expect(clicks()).toBe(0);
  });
});

describe("бюджет: один клик на лобби (плюс одна проверочная попытка)", () => {
  test("сервер молчит: ровно один повтор, затем терминальный warn и тишина", () => {
    pregame();
    void autoReadyFeature.enable(ctx);
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    expect(clicks()).toBe(1);
    // active так и не появился → verify делает одну повторную попытку.
    vi.advanceTimersByTime(1600);
    expect(clicks()).toBe(2);
    // И снова тишина от сервера → терминальная строка, больше не кликаем.
    vi.advanceTimersByTime(1600);
    expect(vi.mocked(log.warn).mock.calls.join(" ")).toContain("не подтвердилась");
    vi.advanceTimersByTime(CLICK_DELAY_MS * 5);
    pass();
    pass();
    expect(clicks()).toBe(2);
  });

  test("готовность встала — повторных кликов нет", () => {
    pregame();
    void autoReadyFeature.enable(ctx);
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    expect(clicks()).toBe(1);
    pregame({ active: true }); // сервер подтвердил
    vi.advanceTimersByTime(1600);
    pass();
    vi.advanceTimersByTime(CLICK_DELAY_MS * 3);
    pass();
    expect(clicks()).toBe(1);
  });

  test("смена страницы = новое лобби: латч умирает, в новом лобби кликаем", () => {
    pregame();
    void autoReadyFeature.enable(ctx);
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    pregame({ active: true });
    vi.advanceTimersByTime(1600);
    expect(clicks()).toBe(1);
    // Ушли в поиск и вернулись в новое лобби.
    window.history.replaceState(null, "", "/game-search");
    document.body.innerHTML = "";
    pass();
    window.history.replaceState(null, "", "/game");
    pregame();
    pass();
    vi.advanceTimersByTime(CLICK_DELAY_MS + 50);
    pass();
    expect(clicks()).toBe(2);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(2);
  });
});
