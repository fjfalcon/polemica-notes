/**
 * Кэш статистики игрока: TTL, дедуп, бэкофф и гейт живости.
 *
 * Слой выделили ради «пяти карт состояния», а тестами закрыли только чистую
 * сборку цифр — то есть ровно то, что и раньше было чистой функцией
 * (adversarial 28.08.2026). Здесь проверяется сама механика.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  games: [] as unknown[],
  gamesFails: false,
  rating: [] as Array<{ username?: string; user_id: number | string }>,
  profileCalls: 0,
  profileFails: false,
}));

vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/polemica-api", () => ({
  ACTIVE_GAMES_TTL_MS: 15_000,
  fetchActiveGames: vi.fn(async () => {
    if (h.gamesFails) throw new Error("сеть");
    return h.games;
  }),
  findRatingPlayer: vi.fn(async (username: string) =>
    h.rating.find((p) => p.username?.toLowerCase() === username.toLowerCase()),
  ),
}));

import { PlayerStatsStore, STATS_ERROR_BACKOFF_MS, STATS_TTL_MS } from "@content/features/player-notes/player-stats";

/** Профильные ответы: три запроса на игрока. */
function serveProfile(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      h.profileCalls++;
      if (h.profileFails) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        json: async () => [{ games_count: 10, wins_count: 5, first_killed_count: 1 }],
      };
    }),
  );
}

function make(alive = { v: true }, enabled = { v: true }) {
  const loaded: string[] = [];
  const store = new PlayerStatsStore({
    isActive: () => alive.v,
    isEnabled: () => enabled.v,
    onLoaded: (u) => loaded.push(u),
  });
  return { store, loaded };
}

/** Одна активная игра, в которой сидит игрок с этим id и MMR. */
function gameWith(username: string, id: number, mmr: number): unknown {
  return { players: [{ username, id, mmr }] };
}

beforeEach(() => {
  h.games = [];
  h.gamesFails = false;
  h.rating = [{ username: "Аня", user_id: 42 }];
  h.profileCalls = 0;
  h.profileFails = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 28, 20, 0, 0));
  serveProfile();
  vi.clearAllMocks();
});

describe("кэш и дедуп", () => {
  test("второе наведение в пределах TTL сети не касается", async () => {
    const { store } = make();
    await store.load("Аня");
    const after = h.profileCalls;
    expect(after).toBeGreaterThan(0);
    await store.load("Аня");
    expect(h.profileCalls, "повторный запрос не ушёл").toBe(after);
  });

  test("после TTL данные перезапрашиваются: MMR за вечер меняется", async () => {
    const { store } = make();
    await store.load("Аня");
    const after = h.profileCalls;
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    await store.load("Аня");
    expect(h.profileCalls).toBeGreaterThan(after);
  });

  test("две плитки одного игрока не гонят два запроса", async () => {
    // Дедуп по ключу: пересборка плитки при мутациях DOM иначе дублировала
    // три профильных запроса (аудит 01.08.2026, находка 7).
    const { store } = make();
    await Promise.all([store.load("Аня"), store.load("аня"), store.load("АНЯ")]);
    expect(h.profileCalls).toBe(3); // ровно один заход = три профильных ответа
  });
});

describe("бэкофф после ошибки", () => {
  test("упавший API не долбится на каждый hover", async () => {
    h.profileFails = true;
    const { store } = make();
    await store.load("Аня");
    const afterFail = h.profileCalls;
    await store.load("Аня");
    expect(h.profileCalls, "повтор заблокирован бэкоффом").toBe(afterFail);
  });

  test("после паузы попытка повторяется", async () => {
    h.profileFails = true;
    const { store } = make();
    await store.load("Аня");
    const afterFail = h.profileCalls;
    h.profileFails = false;
    vi.setSystemTime(new Date(Date.now() + STATS_ERROR_BACKOFF_MS + 1000));
    await store.load("Аня");
    expect(h.profileCalls).toBeGreaterThan(afterFail);
  });
});

describe("гейты", () => {
  test("выключенная настройка не ходит в сеть вовсе", async () => {
    const { store } = make({ v: true }, { v: false });
    await store.load("Аня");
    expect(h.profileCalls).toBe(0);
  });

  test("мёртвая фича не пишет в кэш и не зовёт перерисовку", async () => {
    const alive = { v: true };
    const { store, loaded } = make(alive);
    const p = store.load("Аня");
    alive.v = false; // фичу выключили, пока ехали ответы
    await p;
    expect(loaded, "перерисовку мёртвой фичи не заказываем").toEqual([]);
    expect(store.get("Аня"), "в кэш мёртвой жизни не пишем").toBeUndefined();
  });

  test("игрока нет в рейтинге — запись «данных нет», а не выдуманные нули", async () => {
    h.rating = [];
    const { store, loaded } = make();
    await store.load("Некто");
    expect(store.get("Некто")?.ratingUnavailable).toBe(true);
    expect(store.get("Некто")?.mmr).toBe("—");
    expect(loaded, "тултипы всё равно обновляем: заглушка тоже ответ").toEqual(["Некто"]);
  });
});

describe("сброс", () => {
  test("reset() чистит и кэш, и бэкофф", async () => {
    h.profileFails = true;
    const { store } = make();
    await store.load("Аня");
    store.reset();
    h.profileFails = false;
    const before = h.profileCalls;
    await store.load("Аня");
    expect(h.profileCalls, "бэкофф сброшен вместе с кэшем").toBeGreaterThan(before);
    expect(store.get("Аня")).toBeDefined();
  });

  test("idOf отдаёт id для резолва ключа заметки", async () => {
    const { store } = make();
    await store.load("Аня");
    expect(store.idOf("аня")).toBe(42);
  });

  test("reset() забывает и известные id", async () => {
    h.games = [gameWith("Борис", 777, 1900)];
    h.rating = [];
    const { store } = make();
    await store.load("Борис");
    store.reset();
    expect(store.idOf("борис")).toBeUndefined();
    h.games = [];
    await store.load("Борис");
    expect(store.get("Борис")?.ratingUnavailable, "ничего не знаем — заглушка").toBe(true);
  });
});

describe("известный id игрока вне игры и вне рейтинга", () => {
  test("цифры перезапрашиваются по id, а не затираются заглушкой", async () => {
    h.games = [gameWith("Борис", 777, 1900)];
    h.rating = [];
    const { store } = make();
    await store.load("Борис");
    expect(store.get("Борис")?.mmr).toBe(1900);

    h.games = [];
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    const before = h.profileCalls;
    await store.load("Борис");
    const entry = store.get("Борис");
    expect(h.profileCalls, "профиль перезапрошен по id").toBe(before + 3);
    expect(entry?.ratingUnavailable, "заглушки нет").toBeUndefined();
    expect(entry?.id).toBe(777);
    expect(entry?.mmr, "последний MMR сохранён").toBe(1900);
    expect(entry?.mmrStale).toBe(true);
    expect(entry?.fromRating).toBe(false);
    expect(entry?.generalStats.gamesCount, "цифры на месте").toBe(10);
    expect(store.idOf("борис")).toBe(777);
  });

  test("id из прохода по столу спасает первую же загрузку", async () => {
    h.rating = [];
    const { store } = make();
    store.rememberId("вера", "31", 1500);
    await store.load("Вера");
    const entry = store.get("Вера");
    expect(entry?.ratingUnavailable).toBeUndefined();
    expect(entry?.id).toBe("31");
    expect(entry?.mmr).toBe(1500);
    expect(entry?.mmrStale).toBe(true);
  });

  test("ник сначала неизвестен, потом сел в игру — заглушка больше не возвращается", async () => {
    h.rating = [];
    const { store } = make();
    await store.load("Вера");
    expect(store.get("Вера")?.ratingUnavailable).toBe(true);

    h.games = [gameWith("Вера", 31, 1500)];
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    await store.load("Вера");
    expect(store.get("Вера")?.id).toBe(31);

    h.games = [];
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    await store.load("Вера");
    expect(store.get("Вера")?.id).toBe(31);
    expect(store.get("Вера")?.ratingUnavailable).toBeUndefined();
    expect(store.get("Вера")?.mmrStale).toBe(true);
  });

  test("вернулся в игру до конца TTL — свежий MMR по короткому интервалу", async () => {
    h.games = [gameWith("Борис", 777, 1900)];
    h.rating = [];
    const { store } = make();
    await store.load("Борис");
    h.games = [];
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    await store.load("Борис");
    expect(store.get("Борис")?.mmrStale).toBe(true);

    h.games = [gameWith("Борис", 777, 2000)];
    vi.setSystemTime(new Date(Date.now() + 16_000));
    await store.load("Борис");
    expect(store.get("Борис")?.mmr, "свежий MMR из игры").toBe(2000);
    expect(store.get("Борис")?.mmrStale).toBeUndefined();
  });

  test("упавший перезапрос не трогает собранные цифры", async () => {
    h.games = [gameWith("Борис", 777, 1900)];
    h.rating = [];
    const { store } = make();
    await store.load("Борис");
    h.games = [];
    h.profileFails = true;
    vi.setSystemTime(new Date(Date.now() + STATS_TTL_MS + 1000));
    await store.load("Борис");
    const entry = store.get("Борис");
    expect(entry?.ratingUnavailable).toBeUndefined();
    expect(entry?.mmr).toBe(1900);
    expect(entry?.generalStats.gamesCount).toBe(10);
  });

  test("id из активной игры запоминается до профильных запросов", async () => {
    h.games = [gameWith("Борис", 777, 1900)];
    h.rating = [];
    h.profileFails = true;
    const { store } = make();
    await store.load("Борис");
    expect(store.idOf("борис"), "профиль упал, id остался").toBe(777);

    h.games = [];
    h.profileFails = false;
    vi.setSystemTime(new Date(Date.now() + STATS_ERROR_BACKOFF_MS + 1000));
    await store.load("Борис");
    expect(store.get("Борис")?.id).toBe(777);
    expect(store.get("Борис")?.mmrStale).toBe(true);
  });

  test.each([[0], [-5], [1.5], ["0"], ["007"], ["unknown"], [""], [null]])(
    "негодный id %j не запоминается",
    (bad) => {
      const { store } = make();
      store.rememberId("гоша", bad, 1500);
      expect(store.idOf("гоша")).toBeUndefined();
    },
  );
});
