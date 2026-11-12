// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
/**
 * «↻ Обновить» счётчиков столов (12.11.2026): page-скрипт перечитывает
 * GET /api/search и пишет в столы ТОЛЬКО count — доступность и выбранные
 * галочки не трогает (анонимный ответ отдаёт available:false у всех).
 */
import { afterEach, describe, expect, test, vi } from "vitest";

import { safeReason, safeServiceOrigin, sanitizeQueueCounts } from "@shared/search-counts";
import { applyCounts, findSearch, refreshCounts, type SearchProxy } from "../../src/content/page/search-counts-page";

/** Ответ сервера, снятый 12.11.2026 (аноним). */
const LIVE = {
  queues: {
    standard: { available: false, players: 3 },
    polite: { available: false, players: 1 },
    prime: { available: false, players: 9 },
  },
};

describe("разбор ответа", () => {
  test("живой ответ → числа по столам", () => {
    expect(sanitizeQueueCounts(LIVE)).toEqual({ standard: 3, polite: 1, prime: 9 });
  });
  test("состав очереди массивом — длина, как у сайта", () => {
    expect(sanitizeQueueCounts({ queues: { polite: { players: [{}, {}] } } })).toEqual({ polite: 2 });
  });
  test("мусор и чужие значения отбрасываются", () => {
    expect(sanitizeQueueCounts(null)).toBeNull();
    expect(sanitizeQueueCounts({ queues: { standard: { players: -1 }, prime: { players: 1e9 } } })).toBeNull();
    expect(sanitizeQueueCounts({ queues: { "<x>": { players: 1 }, standard: { players: 2.5 } } })).toBeNull();
  });
  test("адрес сервиса — только https и только наш домен", () => {
    expect(safeServiceOrigin("https://game.polemicagame.com")).toBe("https://game.polemicagame.com");
    expect(safeServiceOrigin("http://game.polemicagame.com")).toBeNull();
    expect(safeServiceOrigin("https://polemicagame.com.evil.example")).toBeNull();
    expect(safeServiceOrigin(42)).toBeNull();
  });
  test("причина — короткий служебный код", () => {
    expect(safeReason("http-500")).toBe("http-500");
    expect(safeReason("user 13509 token=abc")).toBeNull();
  });
});

const modes = () => [
  { mode: "standard", count: 8, countTarget: 10, participants: undefined, available: true },
  { mode: "polite", count: 6, countTarget: 10, participants: undefined, available: true },
  { mode: "prime", count: 1, countTarget: 10, participants: [{ id: 1 }], available: true },
];

function mount(extra: Partial<SearchProxy> = {}): SearchProxy & { selectedCensorshipModes: string[] } {
  const comp = {
    censorshipModes: modes(),
    getSearchState: vi.fn(),
    newGameService: { httpUrl: "https://game.polemicagame.com" },
    isSearching: false,
    isFoundGame: false,
    isIniSearch: false,
    selectedCensorshipModes: ["polite"],
    ...extra,
  };
  document.body.innerHTML = '<div id="app"></div>';
  (document.getElementById("app") as Element & { __vue__?: unknown }).__vue__ = {
    $children: [{ $children: [comp] }],
  };
  return comp as never;
}

const okFetch = (body: unknown = LIVE) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("page-скрипт", () => {
  test("находит компонент поиска в дереве Vue", () => {
    const comp = mount();
    expect(findSearch(document)).toBe(comp);
  });

  test("обновляет count и снимает устаревший состав; доступность и галочки не трогает", async () => {
    const comp = mount();
    const f = okFetch();
    expect(await refreshCounts(document, f)).toEqual({ ok: true, changed: 3 });
    expect(await refreshCounts(document, okFetch())).toEqual({ ok: true, changed: 0 });
    expect(f).toHaveBeenCalledWith("https://game.polemicagame.com/api/search", {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    const [standard, polite, prime] = comp.censorshipModes!;
    expect([standard.count, polite.count, prime.count]).toEqual([3, 1, 9]);
    // Состав Pro-очереди от сокета после выхода из поиска никто не сбрасывает —
    // вне поиска он устарел; сайт при числовом ответе делает то же.
    expect(prime.participants).toBeUndefined();
    expect(comp.censorshipModes!.every((m) => (m as { available?: boolean }).available === true)).toBe(true);
    expect(comp.selectedCensorshipModes).toEqual(["polite"]);
    expect(comp.getSearchState, "метод сайта не зовём").not.toHaveBeenCalled();
  });

  test("идёт поиск — не лезем, запроса нет", async () => {
    mount({ isSearching: true });
    const f = okFetch();
    expect(await refreshCounts(document, f)).toEqual({ ok: false, reason: "searching" });
    expect(f).not.toHaveBeenCalled();
  });

  test("игрок нажал «Играть», пока шёл запрос, — числа не пишем", async () => {
    const comp = mount();
    const f = vi.fn(async () => {
      comp.isSearching = true;
      return { ok: true, status: 200, json: async () => LIVE } as unknown as Response;
    });
    expect(await refreshCounts(document, f)).toEqual({ ok: false, reason: "searching" });
    expect(comp.censorshipModes![0].count).toBe(8);
  });

  test("чужой адрес сервиса — запроса нет; ошибки сети и HTTP — код причины", async () => {
    mount({ newGameService: { httpUrl: "https://evil.example" } });
    const f = okFetch();
    expect(await refreshCounts(document, f)).toEqual({ ok: false, reason: "no-service" });
    expect(f).not.toHaveBeenCalled();
    mount();
    expect(await refreshCounts(document, vi.fn(async () => ({ ok: false, status: 503 }) as Response))).toEqual({
      ok: false,
      reason: "http-503",
    });
    expect(
      await refreshCounts(
        document,
        vi.fn(async () => {
          throw new TypeError("fail");
        }),
      ),
    ).toEqual({ ok: false, reason: "network" });
    expect(await refreshCounts(document, okFetch({ nope: 1 }))).toEqual({ ok: false, reason: "shape" });
  });

  test("нет компонента — честный отказ", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    expect(await refreshCounts(document, okFetch())).toEqual({ ok: false, reason: "no-component" });
  });

  test("те же числа — ничего не пишем (Vue не дёргаем зря)", () => {
    const comp = mount();
    expect(applyCounts(comp, { standard: 8, polite: 6 })).toBe(0);
  });
});
