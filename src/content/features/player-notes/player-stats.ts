/**
 * Статистика игрока: загрузка, кэш и СБОРКА ЦИФР.
 *
 * Вынесено из player-notes.ts (арх-ревью 28.08.2026). Кластер владеет пятью
 * картами состояния (значение, время загрузки, запрос в полёте, бэкофф после
 * ошибки, отметка проверки «сейчас в игре») — по картам его и отделили: они
 * не нужны больше никому.
 *
 * Отдельная ценность — `buildStatsEntry`: это ЧИСЛА, которые расширение
 * говорит про человека («винрейт 63%», «ПУ 12%»). Пока сборка жила внутри
 * четырёхтысячестрочного файла, проверить деление на ноль и мусор из API
 * можно было только через живой стол.
 */
import { log } from "@core/log";
import { redactNick } from "@shared/redact";
import {
  ACTIVE_GAMES_TTL_MS,
  fetchActiveGames,
  findRatingPlayer,
} from "@core/polemica-api";

export interface RoleWinrate {
  winrate: string;
}

export interface PlayerStatsEntry {
  ratingUnavailable?: boolean;
  fromRating?: boolean;
  /** MMR последний известный, не свежий: игрока нет ни в /api/games, ни в рейтинге. */
  mmrStale?: boolean;
  mmr: number | string;
  totalGames: number | string;
  id: number | string;
  generalStats: {
    gamesCount: number;
    winsCount: number;
    firstKilledCount: number;
    killpercent: number;
    winrate: string;
  };
  roleStats: {
    civilian: RoleWinrate;
    sheriff: RoleWinrate;
    mafia: RoleWinrate;
    godfather: RoleWinrate;
  };
}

/** Кэш статистики: пять минут — компромисс свежести и нагрузки на сайт. */
export const STATS_TTL_MS = 5 * 60 * 1000;
/**
 * Пауза после ошибки. Без неё каждый повторный hover заново гнал три
 * профильных запроса по игроку с падающим API (аудит 01.08.2026).
 */
export const STATS_ERROR_BACKOFF_MS = 30 * 1000;
/** Потолок ожидания профильных запросов. */
const STATS_TIMEOUT_MS = 15_000;

/** Заглушка «рейтинг недоступен»: цифр не знаем и не выдумываем. */
export function unavailablePlayerStats(): PlayerStatsEntry {
  return {
    ratingUnavailable: true,
    fromRating: true,
    mmr: "—",
    totalGames: "—",
    id: "—",
    generalStats: {
      gamesCount: 0,
      winsCount: 0,
      firstKilledCount: 0,
      killpercent: 0,
      winrate: "—",
    },
    roleStats: {
      civilian: { winrate: "—" },
      sheriff: { winrate: "—" },
      mafia: { winrate: "—" },
      godfather: { winrate: "—" },
    },
  };
}

/** Процент побед строкой. Ноль игр — «0.0», а не NaN и не деление на ноль. */
export function calcWinrate(wins: unknown, total: unknown): string {
  const w = Number(wins) || 0;
  const t = Number(total) || 0;
  if (t === 0) return "0.0";
  return ((w / t) * 100).toFixed(1);
}

interface StatsApiPayload {
  /** Ответ get-role-statistic без роли: массив с одной общей записью. */
  general: Array<Record<string, unknown>>;
  /** Ответ get-statistic: объект с разбивкой по ролям. */
  roles: Record<string, { wins_count?: unknown; games_count?: unknown } | undefined>;
  /** Ответ get-role-statistic по мирным+шерифу: первый убитый. */
  killcount: Array<Record<string, unknown>>;
}

/**
 * Собрать запись статистики из трёх ответов API. Чистая функция: сеть, кэш и
 * DOM сюда не заходят — только арифметика того, что мы утверждаем про игрока.
 */
export function buildStatsEntry(
  payload: StatsApiPayload,
  meta: { userId: number | string; mmr: number | string; fromRating: boolean },
): PlayerStatsEntry {
  const generalData = payload.general[0] || {};
  const killcounter = payload.killcount[0] || {};
  const roles = payload.roles ?? {};
  return {
    fromRating: meta.fromRating,
    mmr: meta.mmr,
    // «?» вместо 0: ноль игр и неизвестное число — разные утверждения.
    totalGames: Number(generalData.games_count) || "?",
    id: meta.userId,
    generalStats: {
      gamesCount: Number(generalData.games_count) || 0,
      winsCount: Number(generalData.wins_count) || 0,
      firstKilledCount: Number(killcounter.first_killed_count) || 0,
      // `|| 0` гасит и NaN от деления на ноль, и Infinity от битого ответа.
      killpercent:
        Number(
          Math.trunc(
            (Number(killcounter.first_killed_count) / Number(killcounter.games_count)) * 100,
          ),
        ) || 0,
      winrate: calcWinrate(generalData.wins_count, generalData.games_count),
    },
    roleStats: {
      civilian: { winrate: calcWinrate(roles.civilian?.wins_count, roles.civilian?.games_count) },
      sheriff: { winrate: calcWinrate(roles.sheriff?.wins_count, roles.sheriff?.games_count) },
      mafia: { winrate: calcWinrate(roles.mafia?.wins_count, roles.mafia?.games_count) },
      godfather: {
        winrate: calcWinrate(roles.godfather?.wins_count, roles.godfather?.games_count),
      },
    },
  };
}

/** id игрока, если он положительное целое (число или строка цифр без ведущих нулей). */
export function validPlayerId(id: unknown): number | string | undefined {
  if (typeof id === "number") return Number.isInteger(id) && id > 0 ? id : undefined;
  if (typeof id === "string" && /^[1-9]\d*$/.test(id)) return id;
  return undefined;
}

export interface PlayerStatsContext {
  /** Фича ещё жива: поздний ответ мёртвой фичи не пишет в кэш и не красит DOM. */
  isActive(): boolean;
  /** Настройка «статистика игроков» включена. */
  isEnabled(): boolean;
  /** Статистика игрока обновилась — перерисовать его тултипы, мигрировать заметку. */
  onLoaded(username: string): void;
}

/**
 * Кэш статистики по нику (lowercase) — не дёргаем API повторно на hover.
 */
export class PlayerStatsStore {
  private readonly byNick = new Map<string, PlayerStatsEntry>();
  private readonly fetchedAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly errorAt = new Map<string, number>();
  /** Когда последний раз проверяли «игрок сейчас в активной игре». */
  private readonly activeCheckedAt = new Map<string, number>();
  /** Известные id ников: переживают TTL статистики, чистятся только reset(). */
  private readonly knownIds = new Map<string, number | string>();
  /** Последний числовой MMR ника — показывается, пока свежего нет. */
  private readonly lastMmr = new Map<string, number>();

  constructor(private readonly ctx: PlayerStatsContext) {}

  get(username: string): PlayerStatsEntry | undefined {
    return this.byNick.get(username.toLowerCase());
  }

  /** id игрока по нику — вход в резолв ключа заметки. */
  idOf(lowerNick: string): number | string | undefined {
    return this.knownIds.get(lowerNick) ?? this.byNick.get(lowerNick)?.id;
  }

  /** Запомнить id (и MMR) ника; негодный id не запоминается. */
  rememberId(lowerNick: string, id: unknown, mmr?: unknown): void {
    const valid = validPlayerId(id);
    if (valid === undefined) return;
    this.knownIds.set(lowerNick, valid);
    if (typeof mmr === "number" && Number.isFinite(mmr)) this.lastMmr.set(lowerNick, mmr);
  }

  reset(): void {
    this.byNick.clear();
    this.fetchedAt.clear();
    this.inFlight.clear();
    this.errorAt.clear();
    this.activeCheckedAt.clear();
    this.knownIds.clear();
    this.lastMmr.clear();
  }

  /** Сбросить только бэкофф ошибок (например, сеть вернулась). */
  clearErrorBackoff(): void {
    this.errorAt.clear();
  }

  async load(username: string): Promise<void> {
    if (!this.ctx.isActive() || !this.ctx.isEnabled()) return;
    const key = username.toLowerCase();
    const fetchedAt = this.fetchedAt.get(key) ?? 0;
    const cached = this.byNick.get(key);
    const now = Date.now();
    const needsActiveRecheck =
      (cached?.fromRating === true || cached?.mmrStale === true) &&
      now - (this.activeCheckedAt.get(key) ?? 0) >= ACTIVE_GAMES_TTL_MS;
    if (cached && now - fetchedAt < STATS_TTL_MS && !needsActiveRecheck) return;
    if (this.inFlight.has(key)) return; // запрос уже в полёте
    if (now - (this.errorAt.get(key) ?? 0) < STATS_ERROR_BACKOFF_MS) return;
    this.inFlight.add(key);

    try {
      let games: unknown[] = [];
      try {
        games = await fetchActiveGames();
      } catch (e) {
        log.warn("player-notes", "active games lookup failed, using rating", e);
      }

      let player: { id: number | string; mmr?: number | string } | null = null;
      for (const game of games as Array<{ players?: Array<Record<string, unknown>> }>) {
        const found = game.players?.find(
          (p) =>
            String(p.username ?? "").toLowerCase() === key && validPlayerId(p.id) !== undefined,
        );
        if (found) {
          player = found as unknown as { id: number | string; mmr?: number | string };
          break;
        }
      }

      let userId: number | string;
      let mmr: number | string = "—";
      let mmrStale = false;
      if (player) {
        userId = player.id;
        mmr = player.mmr ?? "—";
        this.rememberId(key, player.id, player.mmr);
      } else {
        this.activeCheckedAt.set(key, Date.now());
        const fallbackFresh = cached?.fromRating || cached?.mmrStale;
        if (fallbackFresh && Date.now() - fetchedAt < STATS_TTL_MS) return;
        log.debug("player-notes", `player ${username} not found in active games, using rating`);
        const ratingPlayer = await findRatingPlayer(username);
        const ratingId = validPlayerId(ratingPlayer?.user_id);
        const knownId = this.knownIds.get(key);
        if (ratingId !== undefined) {
          userId = ratingId;
          this.rememberId(key, ratingId);
        } else if (knownId !== undefined) {
          userId = knownId;
          mmr = this.lastMmr.get(key) ?? "—";
          mmrStale = true;
        } else {
          if (!this.ctx.isActive()) return;
          if (!cached) this.byNick.set(key, unavailablePlayerStats());
          this.fetchedAt.set(key, Date.now());
          this.ctx.onLoaded(username);
          return;
        }
      }

      // ok-чек и таймаут: раньше не-2xx молча парсился, а зависший запрос
      // висел вечно (аудит 01.08.2026, находка 4).
      const getJson = (url: string): Promise<any> =>
        fetch(url, { signal: AbortSignal.timeout(STATS_TIMEOUT_MS) }).then((r) => {
          if (!r.ok) throw new Error(`stats API ${r.status}`);
          return r.json();
        });
      const uid = encodeURIComponent(String(userId));
      const [general, roles, killcount] = (await Promise.all([
        getJson(
          `https://polemicagame.com/profile/default/get-role-statistic?user_id=${uid}&role=&game_type=league&scoring_type=scoring_2%2Cscoring_3`,
        ),
        getJson(
          `https://polemicagame.com/profile/default/get-statistic?user_id=${uid}&game_type=league&scoring_type=scoring_2%2Cscoring_3`,
        ),
        getJson(
          `https://polemicagame.com/profile/default/get-role-statistic?user_id=${uid}&role=civilian%2Csheriff&game_type=league&scoring_type=scoring_2%2Cscoring_3`,
        ),
      ])) as [StatsApiPayload["general"], StatsApiPayload["roles"], StatsApiPayload["killcount"]];

      if (!this.ctx.isActive()) return;
      const entry = buildStatsEntry(
        { general, roles, killcount },
        { userId, mmr, fromRating: !player && !mmrStale },
      );
      if (mmrStale) entry.mmrStale = true;
      this.byNick.set(key, entry);
      this.rememberId(key, userId, mmr);
      this.fetchedAt.set(key, Date.now());
      if (player) this.activeCheckedAt.delete(key);
      this.ctx.onLoaded(username);
    } catch (e) {
      this.errorAt.set(key, Date.now());
      log.error("player-notes", `loadPlayerStats failed for ${redactNick(username)}`, e);
    } finally {
      this.inFlight.delete(key);
    }
  }
}
