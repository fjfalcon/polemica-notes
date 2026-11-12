/**
 * fetchQueueCounts (12.11.2026): публичный GET /api/search без куки,
 * never-overlap и короткий кэш, как у fetchActiveGames.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchQueueCounts, resetQueueCountsCacheForTest } from "@core/polemica-api";

const LIVE = { queues: { standard: { available: false, players: 3 }, prime: { available: false, players: 9 } } };

afterEach(() => {
  resetQueueCountsCacheForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchQueueCounts", () => {
  test("публичный запрос без куки; два вызова подряд — один запрос", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = vi.fn(async () => ({ ok: true, json: async () => LIVE }));
    vi.stubGlobal("fetch", f);
    const [a, b] = await Promise.all([fetchQueueCounts(), fetchQueueCounts()]);
    expect(a).toEqual({ standard: 3, prime: 9 });
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]).toEqual([
      "https://game.polemicagame.com/api/search",
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    ]);
    await fetchQueueCounts();
    expect(f, "в пределах TTL — из кэша").toHaveBeenCalledTimes(1);
    await fetchQueueCounts(true);
    expect(f, "↻ сразу после ответа — не чаще раза в 2 с").toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2_500);
    await fetchQueueCounts(true);
    expect(f, "↻ через 2 с — свежий запрос").toHaveBeenCalledTimes(2);
  });

  test("ошибка не кэшируется; мусор в ответе — ошибка, а не нули", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(fetchQueueCounts()).rejects.toThrow("503");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ nope: 1 }) })));
    await expect(fetchQueueCounts()).rejects.toThrow("invalid");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => LIVE })));
    await expect(fetchQueueCounts()).resolves.toEqual({ standard: 3, prime: 9 });
  });
});
