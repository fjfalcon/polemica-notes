/**
 * Справочник «кого встречал за столом» (09.10.2026): слияние, переименование,
 * потолок, склейка записей и сбои хранилища.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown>, sets: 0 }));
vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (defaults: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(defaults)) out[k] = k in store.data ? store.data[k] : v;
          return out;
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          store.sets++;
          Object.assign(store.data, patch);
        }),
      },
    },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { browser } from "@core/env";
import { log } from "@core/log";
import {
  SEEN_PLAYERS_KEY,
  flushSeenPlayersForTest,
  mergeSeen,
  readSeenPlayers,
  rememberSeenPlayers,
} from "@core/seen-players";

beforeEach(() => {
  store.data = {};
  store.sets = 0;
});

describe("mergeSeen", () => {
  test("ключ — ник в нижнем регистре, ник хранится как видели", () => {
    const m = mergeSeen({}, [{ nick: " Лиса ", id: "5" }], 100);
    expect(m).toEqual({ лиса: { nick: "Лиса", id: "5", at: 100 } });
  });

  test("тот же id под новым ником вытесняет старый ник", () => {
    const m = mergeSeen({ старый: { nick: "Старый", id: "5", at: 1 } }, [{ nick: "Новый", id: "5" }], 2);
    expect(Object.keys(m)).toEqual(["новый"]);
  });

  test("потолок: вытесняются самые давние встречи", () => {
    const cur = {
      a: { nick: "a", id: "1", at: 1 },
      b: { nick: "b", id: "2", at: 2 },
    };
    const m = mergeSeen(cur, [{ nick: "c", id: "3" }], 3, 2);
    expect(Object.keys(m).sort()).toEqual(["b", "c"]);
  });

  test("пустой ник или id — пропуск", () => {
    expect(mergeSeen({}, [{ nick: "", id: "1" }, { nick: "x", id: "" }], 1)).toEqual({});
  });
});

describe("rememberSeenPlayers", () => {
  test("стол из нескольких вызовов уходит на диск ОДНОЙ записью", async () => {
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    rememberSeenPlayers([{ nick: "B", id: "2" }]);
    await flushSeenPlayersForTest();
    expect(store.sets).toBe(1);
    expect(Object.keys(await readSeenPlayers()).sort()).toEqual(["a", "b"]);
  });

  test("битое содержимое хранилища читается как пустой справочник", async () => {
    store.data[SEEN_PLAYERS_KEY] = { x: { nick: 5 }, y: "мусор" };
    expect(await readSeenPlayers()).toEqual({});
  });
});

describe("сбои записи справочника", () => {
  const getMock = vi.mocked(browser.storage.local.get);
  const setMock = vi.mocked(browser.storage.local.set);
  const seed = { старый: { nick: "Старый", id: "9", at: 1 } };
  const keys = async () => Object.keys(await readSeenPlayers()).sort();
  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await flushSeenPlayersForTest();
    vi.useRealTimers();
  });

  test("чтение упало — записи нет, справочник на диске цел", async () => {
    store.data[SEEN_PLAYERS_KEY] = { ...seed };
    getMock.mockRejectedValueOnce(new Error("storage"));
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.sets).toBe(0);
    expect(store.data[SEEN_PLAYERS_KEY]).toEqual(seed);
  });

  test("после сбоя чтения таймер сам повторяет запись без нового ввода", async () => {
    store.data[SEEN_PLAYERS_KEY] = { ...seed };
    getMock.mockRejectedValueOnce(new Error("storage"));
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await keys()).toEqual(["a", "старый"]);
  });

  test("встреча во время сбоя новее отложенной и побеждает при повторе", async () => {
    store.data[SEEN_PLAYERS_KEY] = { ...seed };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    getMock.mockImplementationOnce(async () => {
      await gate;
      throw new Error("storage");
    });
    rememberSeenPlayers([{ nick: "Лиса", id: "5" }]);
    await vi.advanceTimersByTimeAsync(2000);
    rememberSeenPlayers([{ nick: "Лиса", id: "7" }]);
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await readSeenPlayers()).toEqual({
      ...seed,
      лиса: { nick: "Лиса", id: "7", at: expect.any(Number) },
    });
  });

  test("запись упала — пачка не теряется и уходит при повторе", async () => {
    store.data[SEEN_PLAYERS_KEY] = { ...seed };
    setMock.mockRejectedValueOnce(new Error("quota"));
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.data[SEEN_PLAYERS_KEY]).toEqual(seed);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await keys()).toEqual(["a", "старый"]);
  });

  test("два наложившихся сброса в одной вкладке — обе пачки на диске", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    getMock.mockImplementationOnce(async () => {
      await gate;
      return { [SEEN_PLAYERS_KEY]: {} };
    });
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    await vi.advanceTimersByTimeAsync(2000);
    rememberSeenPlayers([{ nick: "B", id: "2" }]);
    await vi.advanceTimersByTimeAsync(2000);
    release();
    await settle();
    expect(await keys()).toEqual(["a", "b"]);
  });

  test("отклонённый сброс не блокирует следующий", async () => {
    setMock.mockRejectedValueOnce(new Error("quota"));
    vi.mocked(log.warn).mockImplementationOnce(() => {
      throw new Error("log");
    });
    rememberSeenPlayers([{ nick: "A", id: "1" }]);
    await expect(flushSeenPlayersForTest()).rejects.toThrow("log");
    rememberSeenPlayers([{ nick: "B", id: "2" }]);
    await flushSeenPlayersForTest();
    expect(await keys()).toEqual(["a", "b"]);
  });
});
