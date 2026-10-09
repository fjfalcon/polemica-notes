/**
 * Инфраструктура: HTTP-API сайта и его кэши.
 *
 * Выделено из player-notes.ts (арх-ревью 28.08.2026): дедуп запросов, TTL,
 * таймаут, валидация ответа и защита от позднего reject старого промиса —
 * это самостоятельная механика, а не часть UI-фичи. Пока она жила внутри
 * четырёхтысячестрочного файла, у жалобы «тултип странно обновился» было
 * восемь возможных источников сразу; теперь сеть проверяется отдельно от
 * DOM и жизненного цикла.
 *
 * Соседи по слою: @core/crossover (история игр игрока — третий репозиторий
 * того же сайта, со своим общим кэшем своей истории).
 *
 * Здесь НЕТ логики фич: функции ничего не знают ни о плитках, ни о
 * заметках, ни о настройках.
 */

/** Игрок из общего рейтинга (топ-1000). */
export interface RatingPlayer {
  username?: string;
  user_id: number | string;
  /** MMR из рейтинга (живой ответ: число). */
  mmr?: number | string;
}

/**
 * Пока запрос не развязался, TTL не течёт — см. fetchActiveGames.
 * Экспортируется: по этому же сроку player-notes решает, не пора ли
 * перепроверить «игрок сейчас в игре» у записи, взятой из рейтинга.
 */
export const ACTIVE_GAMES_TTL_MS = 15_000;
/** Тот же срок, что у кэша статистики игрока: рейтинг меняется не быстрее. */
const RATING_TTL_MS = 5 * 60 * 1000;
/** Потолок ожидания: висящий запрос не имеет права держать дедуп вечно. */
const ACTIVE_GAMES_TIMEOUT_MS = 20_000;

let activeGamesPromise: Promise<unknown[]> | null = null;
let activeGamesFetchedAt = 0;
let ratingListCache: RatingPlayer[] | null = null;
let ratingListFetchedAt = 0;
let ratingListInFlight: Promise<RatingPlayer[]> | null = null;

/** Тестовый шов перф-бюджета «/api/games never-overlap» (PERF26-8). */
export function resetActiveGamesCacheForTest(): void {
  activeGamesPromise = null;
  activeGamesFetchedAt = 0;
}

/** Тестовый шов: кэш рейтинга живёт 5 минут и переживал бы соседний тест. */
export function resetRatingCacheForTest(): void {
  ratingListCache = null;
  ratingListFetchedAt = 0;
  ratingListInFlight = null;
}

/**
 * Один общий запрос списка активных игр на всех игроков. Раньше in-flight
 * дедуп ключевался ником: вход в игру с 10 игроками давал 10 ПАРАЛЛЕЛЬНЫХ
 * fetch полного /api/games ещё до первого наведения мыши.
 */
export function fetchActiveGames(): Promise<unknown[]> {
  const now = Date.now();
  // Нерешённый запрос не перекрывается НИКОГДА (бюджет «never overlap»,
  // перф-аудит 06.08; дыра PERF26-8): TTL заводится только с момента
  // РАЗВЯЗКИ промиса, а не старта — долгий запрос не порождает второй.
  if (
    activeGamesPromise &&
    (activeGamesFetchedAt === 0 || now - activeGamesFetchedAt < ACTIVE_GAMES_TTL_MS)
  ) {
    return activeGamesPromise;
  }
  activeGamesFetchedAt = 0; // 0 = «в полёте»: TTL стартует по завершении
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACTIVE_GAMES_TIMEOUT_MS);
  const p: Promise<unknown[]> = fetch("https://game.polemicagame.com/api/games", {
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`active games API error: ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("active games API returned invalid data");
      if (activeGamesPromise === p) activeGamesFetchedAt = Date.now(); // TTL — от развязки
      return data as unknown[];
    })
    .catch((e) => {
      // Identity-гейт: поздний reject СТАРОГО запроса не должен стирать
      // маркер нового (PERF26-8: открывал путь третьему параллельному).
      if (activeGamesPromise === p) activeGamesPromise = null; // ошибку не кэшируем
      throw e;
    })
    .finally(() => clearTimeout(timeout));
  activeGamesPromise = p;
  return p;
}

/**
 * Общий рейтинг (топ-1000) — фолбэк резолва игрока по нику.
 *
 * Множественное число и /default/: сайт переехал, старый singular-URL
 * отдаёт 404 — фолбэк был мёртв (аудит устойчивости 01.08.2026, находка 2).
 * Форма ответа прежняя (проверено живым запросом: массив с
 * user_id/username/mmr/total_games).
 */
export function fetchRatingList(): Promise<RatingPlayer[]> {
  if (ratingListCache && Date.now() - ratingListFetchedAt < RATING_TTL_MS) {
    return Promise.resolve(ratingListCache);
  }
  if (ratingListInFlight) return ratingListInFlight;

  const request = fetch("https://polemicagame.com/ratings/default/get-list?limit=1000")
    .then(async (response) => {
      if (!response.ok) throw new Error(`rating API error: ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("rating API returned invalid data");
      ratingListCache = data as RatingPlayer[];
      ratingListFetchedAt = Date.now();
      return ratingListCache;
    })
    .finally(() => {
      if (ratingListInFlight === request) ratingListInFlight = null;
    });
  ratingListInFlight = request;
  return request;
}

/** Найти игрока в рейтинге по нику (регистр не важен). */
export async function findRatingPlayer(username: string): Promise<RatingPlayer | undefined> {
  const key = username.toLowerCase();
  return (await fetchRatingList()).find(
    (player) =>
      player.username?.toLowerCase() === key &&
      player.user_id !== undefined &&
      player.user_id !== null,
  );
}

// ─────────────── разбивка статистики по ролям (get-statistic) ───────────────

/** Сырой ответ get-statistic: объект с разбивкой по ролям. */
export type RoleBreakdownRaw = Record<
  string,
  { wins_count?: unknown; games_count?: unknown } | undefined
>;

/** Тот же срок, что у кэша статистики игрока (STATS_TTL_MS). */
const ROLE_BREAKDOWN_TTL_MS = 5 * 60 * 1000;
/** Потолок ожидания профильного запроса. */
const ROLE_BREAKDOWN_TIMEOUT_MS = 15_000;
/** Ограничитель кэша: за вечер столы сменяются, память не должна расти. */
const ROLE_BREAKDOWN_CACHE_LIMIT = 300;

const roleBreakdownCache = new Map<string, { at: number; data: RoleBreakdownRaw }>();
const roleBreakdownInFlight = new Map<string, Promise<RoleBreakdownRaw>>();

/** Тестовый шов: кэш живёт 5 минут и переживал бы соседний тест. */
export function resetRoleBreakdownCacheForTest(): void {
  roleBreakdownCache.clear();
  roleBreakdownInFlight.clear();
}

/**
 * Разбивка лиговой статистики игрока по ролям (civilian/sheriff/mafia/
 * godfather → wins_count/games_count). ОДИН общий кэш на всех потребителей:
 * статистика на плитках и «Сводка стола» (09.10.2026) запрашивают одного и
 * того же игрока — без общего слоя стол из 10 человек давал бы 20 запросов
 * вместо 10. Дедуп параллельных вызовов, таймаут, ошибки не кэшируются.
 */
export function fetchRoleBreakdown(userId: number | string): Promise<RoleBreakdownRaw> {
  const key = String(userId);
  const cached = roleBreakdownCache.get(key);
  if (cached && Date.now() - cached.at < ROLE_BREAKDOWN_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  const pending = roleBreakdownInFlight.get(key);
  if (pending) return pending;
  const request = fetch(
    `https://polemicagame.com/profile/default/get-statistic?user_id=${encodeURIComponent(key)}&game_type=league&scoring_type=scoring_2%2Cscoring_3`,
    { signal: AbortSignal.timeout(ROLE_BREAKDOWN_TIMEOUT_MS) },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`stats API ${response.status}`);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("stats API returned invalid data");
      }
      if (roleBreakdownCache.size >= ROLE_BREAKDOWN_CACHE_LIMIT) {
        const oldest = roleBreakdownCache.keys().next().value;
        if (oldest !== undefined) roleBreakdownCache.delete(oldest);
      }
      roleBreakdownCache.set(key, { at: Date.now(), data: data as RoleBreakdownRaw });
      return data as RoleBreakdownRaw;
    })
    .finally(() => {
      if (roleBreakdownInFlight.get(key) === request) roleBreakdownInFlight.delete(key);
    });
  roleBreakdownInFlight.set(key, request);
  return request;
}
