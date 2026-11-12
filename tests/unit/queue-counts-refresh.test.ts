// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
/**
 * Кнопка «↻ Обновить» на странице поиска (12.11.2026): встаёт за «Очередью»,
 * видна только когда можно начать поиск; клик ставит page-скрипт, шлёт
 * команду и возвращает кнопку по ответу или тайм-ауту.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const warn = vi.fn();
vi.mock("@core/env", () => ({
  browser: { runtime: { getURL: (p: string) => `chrome-extension://x/${p}` } },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));

import {
  COUNTS_BUTTON_CLASS,
  RESULT_TIMEOUT_MS,
  apply,
  queueCountsRefreshFeature,
} from "@content/features/queue-counts-refresh";
import { SEARCH_COUNTS_CMD, SEARCH_COUNTS_RESULT } from "@shared/search-counts";

const panel = (state: "idle" | "search" = "idle", queue = true) =>
  `<div class="p-play__profile-panel"><div class="p-play-profile__wr">` +
  (state === "idle"
    ? `<button class="p-play__profile-button">Играть</button>`
    : `<div class="p-play__profile-game p-play__profile-game--search"><span class="p-play__profile-game-search-time">0:12</span></div>`) +
  `</div>` +
  (queue ? `<button class="pn-queue-peek-button">👀 Очередь</button>` : "") +
  `</div>`;

const button = () => document.querySelector<HTMLButtonElement>(`.${COUNTS_BUTTON_CLASS}`);

afterEach(() => {
  queueCountsRefreshFeature.disable();
  document.body.innerHTML = "";
  vi.useRealTimers();
  warn.mockClear();
});

describe("кнопка", () => {
  test("встаёт за «Очередью», один раз", () => {
    document.body.innerHTML = panel();
    queueCountsRefreshFeature.enable({ settings: {} } as never);
    apply();
    apply();
    expect(document.querySelectorAll(`.${COUNTS_BUTTON_CLASS}`)).toHaveLength(1);
    expect(button()!.previousElementSibling?.className).toBe("pn-queue-peek-button");
    expect(button()!.textContent).toBe("↻ Обновить");
  });

  test("без «Очереди» — за блоком с «Играть»", () => {
    document.body.innerHTML = panel("idle", false);
    queueCountsRefreshFeature.enable({ settings: {} } as never);
    expect(button()!.previousElementSibling?.className).toBe("p-play-profile__wr");
  });

  test("идёт поиск — спрятана; не страница поиска или выключили — убрана", () => {
    document.body.innerHTML = panel("search");
    queueCountsRefreshFeature.enable({ settings: {} } as never);
    expect(button()!.style.display).toBe("none");
    window.history.replaceState(null, "", "/profile/1");
    apply();
    expect(button()).toBeNull();
    window.history.replaceState(null, "", "/game-search");
    apply();
    expect(button()).not.toBeNull();
    queueCountsRefreshFeature.disable();
    expect(button()).toBeNull();
  });
});

describe("клик", () => {
  /** Подгрузка page-скрипта: jsdom его не грузит — отыгрываем load сами. */
  const loadScript = () => {
    const s = document.querySelector<HTMLScriptElement>('script[src$="search-counts-page.js"]');
    expect(s, "page-скрипт поставлен").not.toBeNull();
    s!.onload?.(new Event("load"));
  };

  test("ставит page-скрипт, шлёт команду и по ответу возвращает кнопку", async () => {
    document.body.innerHTML = panel();
    queueCountsRefreshFeature.enable({ settings: {} } as never);
    const posted: Array<{ source?: string; id?: string }> = [];
    const spy = vi.spyOn(window, "postMessage").mockImplementation((d: unknown) => {
      posted.push(d as never);
    });
    try {
      button()!.click();
      expect(button()!.disabled).toBe(true);
      loadScript();
      expect(posted).toHaveLength(1);
      expect(posted[0].source).toBe(SEARCH_COUNTS_CMD);
      // Чужой ответ (другой id) кнопку не отпускает.
      window.dispatchEvent(new MessageEvent("message", { data: { source: SEARCH_COUNTS_RESULT, id: "x", ok: true }, source: window }));
      expect(button()!.disabled).toBe(true);
      window.dispatchEvent(
        new MessageEvent("message", { data: { source: SEARCH_COUNTS_RESULT, id: posted[0].id, ok: true, changed: 2 }, source: window }),
      );
      expect(button()!.disabled).toBe(false);
      expect(button()!.textContent).toBe("↻ Обновить");
      expect(warn).not.toHaveBeenCalled();
      // Второй клик — скрипт уже стоит, второй раз не ставится.
      button()!.click();
      expect(posted).toHaveLength(2);
      expect(document.querySelectorAll('script[src$="search-counts-page.js"]'), "после загрузки тег убран, новый не ставится").toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("отказ — причина в лог кодом; без ответа — кнопка возвращается по тайм-ауту", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = panel();
    queueCountsRefreshFeature.enable({ settings: {} } as never);
    const posted: Array<{ id?: string }> = [];
    const spy = vi.spyOn(window, "postMessage").mockImplementation((d: unknown) => {
      posted.push(d as never);
    });
    try {
      button()!.click();
      // page-скрипт мог быть поставлен прошлым тестом (одна загрузка на страницу).
      document.querySelector<HTMLScriptElement>('script[src$="search-counts-page.js"]')?.onload?.(new Event("load"));
      window.dispatchEvent(
        new MessageEvent("message", { data: { source: SEARCH_COUNTS_RESULT, id: posted[0].id, ok: false, reason: "http-503" }, source: window }),
      );
      expect(warn).toHaveBeenCalledWith("queue-counts-refresh", "счётчики не обновлены, причина:", "http-503");
      button()!.click();
      expect(button()!.disabled).toBe(true);
      vi.advanceTimersByTime(RESULT_TIMEOUT_MS);
      expect(button()!.disabled).toBe(false);
      expect(warn).toHaveBeenLastCalledWith("queue-counts-refresh", "счётчики не обновлены, причина:", "timeout");
    } finally {
      spy.mockRestore();
    }
  });
});
