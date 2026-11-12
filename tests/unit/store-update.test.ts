/**
 * Обновление из магазина «сейчас» (12.11.2026): браузер скачал версию —
 * без вкладок Полемики перезапускаемся сразу, с вкладкой ждём кнопки или
 * закрытия последней вкладки; потерянное обновление не крутит кнопку вхолостую.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store: Record<string, unknown> = {};
let tabs: Array<{ id: number; url: string }> = [];
let version = "9.83.0";

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (defaults: Record<string, unknown>) => {
          const out: Record<string, unknown> = { ...defaults };
          for (const k of Object.keys(defaults)) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (o: Record<string, unknown>) => Object.assign(store, o)),
        remove: vi.fn(async (k: string) => {
          delete store[k];
        }),
      },
    },
    runtime: {
      getManifest: () => ({ version }),
      reload: vi.fn(),
      onUpdateAvailable: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => tabs),
      onRemoved: { addListener: vi.fn() },
    },
  },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { browser } from "@core/env";
import {
  RELOAD_DELAY_MS,
  handleTabClosed,
  handleUpdateAvailable,
  reconcileStoreUpdate,
  requestStoreUpdate,
} from "../../src/background/store-update";
import { STORE_UPDATE_READY_KEY, readyFrom, versionNewer } from "@shared/store-update";

const reload = browser.runtime.reload as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  tabs = [];
  version = "9.83.0";
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Перезапуск отложен (ответ кнопке должен уйти) — прокручиваем паузу. */
const reloaded = () => {
  vi.advanceTimersByTime(RELOAD_DELAY_MS);
  return reload.mock.calls.length;
};

describe("версии и флаг", () => {
  test("сравнение по числам, не по строкам", () => {
    expect(versionNewer("9.100.0", "9.83.0")).toBe(true);
    expect(versionNewer("9.83.0", "9.83.0")).toBe(false);
    expect(versionNewer("9.82.9", "9.83.0")).toBe(false);
  });
  test("мусор во флаге — нет флага", () => {
    expect(readyFrom({ version: "<script>" })).toBeNull();
    expect(readyFrom("9.84.0")).toBeNull();
    expect(readyFrom({ version: "9.84.0", extra: 1 })).toEqual({ version: "9.84.0", attempted: false });
  });
});

describe("браузер скачал обновление", () => {
  test("вкладок Полемики нет — перезапуск сразу", async () => {
    await handleUpdateAvailable("9.84.0");
    expect(reloaded()).toBe(1);
    expect(store[STORE_UPDATE_READY_KEY]).toEqual({ version: "9.84.0", attempted: true });
  });

  test("вкладка открыта — ждём, перезапуска нет", async () => {
    tabs = [{ id: 7, url: "https://polemicagame.com/game-search" }];
    await handleUpdateAvailable("9.84.0");
    expect(reloaded()).toBe(0);
    expect(store[STORE_UPDATE_READY_KEY]).toEqual({ version: "9.84.0" });
  });

  test("та же или старая версия — ничего", async () => {
    await handleUpdateAvailable("9.83.0");
    expect(reloaded()).toBe(0);
    expect(store[STORE_UPDATE_READY_KEY]).toBeUndefined();
  });

  test("закрыли последнюю вкладку — применяем; осталась ещё — нет", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0" };
    tabs = [{ id: 8, url: "https://polemicagame.com/" }];
    await handleTabClosed();
    expect(reloaded()).toBe(0);
    tabs = [];
    await handleTabClosed();
    expect(reloaded()).toBe(1);
  });
});

describe("кнопка «Обновить» в попапе", () => {
  test("обновление встало — новый фон снимает флаг", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0", attempted: true };
    version = "9.84.0";
    await reconcileStoreUpdate();
    expect(store[STORE_UPDATE_READY_KEY]).toBeUndefined();
  });

  test("перезапуск — ПОСЛЕ ответа: до паузы фон жив и ответ уходит", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0" };
    tabs = [{ id: 7, url: "https://polemicagame.com/game-search" }];
    expect(await requestStoreUpdate()).toEqual({ ok: true });
    expect(reload).not.toHaveBeenCalled();
    expect(reloaded()).toBe(1);
  });

  test("в соседней вкладке идёт игра — отказ in_game, перезапуска нет", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0" };
    tabs = [
      { id: 7, url: "https://polemicagame.com/game-search" },
      { id: 9, url: "https://polemicagame.com/game/4242" },
    ];
    expect(await requestStoreUpdate()).toEqual({ ok: false, reason: "in_game" });
    expect(reloaded()).toBe(0);
    expect(store[STORE_UPDATE_READY_KEY]).toEqual({ version: "9.84.0" });
  });

  test("скачанной версии нет — отказ без перезапуска", async () => {
    expect(await requestStoreUpdate()).toEqual({ ok: false, reason: "no_update" });
    store[STORE_UPDATE_READY_KEY] = { version: "9.83.0" };
    expect(await requestStoreUpdate()).toEqual({ ok: false, reason: "no_update" });
    expect(reloaded()).toBe(0);
  });

  test("перезапуск не применил обновление — флаг снят, кнопка не крутится вхолостую", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0", attempted: true };
    await reconcileStoreUpdate();
    expect(store[STORE_UPDATE_READY_KEY]).toBeUndefined();
  });

  test("пока шла сверка, пришёл свежий флаг — его не стираем", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0", attempted: true };
    const get = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const real = get.getMockImplementation() as (d: Record<string, unknown>) => Promise<Record<string, unknown>>;
    let first = true;
    get.mockImplementation(async (d: Record<string, unknown>) => {
      const out = await real(d);
      if (first) {
        first = false;
        store[STORE_UPDATE_READY_KEY] = { version: "9.85.0" }; // onUpdateAvailable вклинился
      }
      return out;
    });
    try {
      await reconcileStoreUpdate();
    } finally {
      get.mockImplementation(real);
    }
    expect(store[STORE_UPDATE_READY_KEY]).toEqual({ version: "9.85.0" });
  });

  test("ждущий флаг без попытки обычное пробуждение фона не снимает", async () => {
    store[STORE_UPDATE_READY_KEY] = { version: "9.84.0" };
    await reconcileStoreUpdate();
    expect(store[STORE_UPDATE_READY_KEY]).toEqual({ version: "9.84.0" });
  });
});
