/**
 * Общий кэш разбивки по ролям (09.10.2026): статистика на плитках и «Сводка
 * стола» спрашивают одного игрока — один запрос, а не два. Ошибки не кэшируются.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchRoleBreakdown, resetRoleBreakdownCacheForTest } from "@core/polemica-api";

let calls = 0;
let fail = false;

beforeEach(() => {
  calls = 0;
  fail = false;
  resetRoleBreakdownCacheForTest();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls++;
      await Promise.resolve();
      if (fail) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ mafia: { games_count: 3, wins_count: 1 } }) };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchRoleBreakdown", () => {
  test("параллельные вызовы одного игрока — один запрос", async () => {
    const [a, b] = await Promise.all([fetchRoleBreakdown(7), fetchRoleBreakdown("7")]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  test("повтор в пределах срока — из кэша", async () => {
    await fetchRoleBreakdown(7);
    await fetchRoleBreakdown(7);
    expect(calls).toBe(1);
  });

  test("ошибка не кэшируется: следующий вызов идёт в сеть", async () => {
    fail = true;
    await expect(fetchRoleBreakdown(8)).rejects.toThrow("500");
    fail = false;
    await expect(fetchRoleBreakdown(8)).resolves.toHaveProperty("mafia");
    expect(calls).toBe(2);
  });

  test("не-объект в ответе — ошибка, а не кэш мусора", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [1, 2] })));
    await expect(fetchRoleBreakdown(9)).rejects.toThrow("invalid");
  });
});
