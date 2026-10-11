/**
 * Справочник «кого встречал за столом» (09.10.2026): слияние, переименование,
 * потолок и склейка записей.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

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
