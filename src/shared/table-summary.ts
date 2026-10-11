/**
 * «Сводка стола» — чистая модель (09.10.2026).
 *
 * Сеть, DOM и кэш сюда не заходят: только арифметика того, что панель
 * утверждает про игроков за столом. Красные = мирный + шериф, чёрные =
 * мафия + дон — так считает и профиль сайта.
 */

/** Сырой ответ get-statistic — разбивка по ролям. */
export type RoleBreakdown = Record<
  string,
  { wins_count?: unknown; games_count?: unknown } | undefined
>;

export interface RoleTotals {
  civGames: number;
  civWins: number;
  mafGames: number;
  mafWins: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Суммы по сторонам: красные (мирный + шериф) и чёрные (мафия + дон). */
export function roleTotals(raw: RoleBreakdown | null | undefined): RoleTotals {
  const r = raw ?? {};
  return {
    civGames: num(r.civilian?.games_count) + num(r.sheriff?.games_count),
    civWins: num(r.civilian?.wins_count) + num(r.sheriff?.wins_count),
    mafGames: num(r.mafia?.games_count) + num(r.godfather?.games_count),
    mafWins: num(r.mafia?.wins_count) + num(r.godfather?.wins_count),
  };
}

/** Процент побед; null — игр нет (ноль игр ≠ ноль процентов). */
export function winratePct(wins: number, games: number): number | null {
  if (!(games > 0)) return null;
  return Math.round((Math.min(wins, games) / games) * 1000) / 10;
}

export interface SummaryRow {
  /** Место за столом, 1..10. */
  seat: number;
  nick: string;
  /** id профиля; null — не нашли ни в идущих играх, ни в рейтинге. */
  id: string | null;
  mmr: number | null;
  /** null — статистика ещё не загружена или недоступна. */
  totals: RoleTotals | null;
  status: "loading" | "ok" | "unavailable";
}

export type MmrTier = "top" | "bottom" | "mid";

/** Сколько игроков с известным MMR нужно, чтобы делить на «тройки». */
export const MIN_KNOWN_FOR_TIERS = 6;

/**
 * Три самых высоких и три самых низких MMR стола. Меньше шести известных —
 * деления нет: «тройка сверху» и «тройка снизу» пересеклись бы. Равные MMR
 * разводятся местом — порядок детерминирован.
 */
export function mmrTiers(rows: readonly SummaryRow[]): Map<number, MmrTier> {
  const known = rows
    .filter((r) => r.mmr !== null)
    .sort((a, b) => (b.mmr as number) - (a.mmr as number) || a.seat - b.seat);
  const out = new Map<number, MmrTier>();
  if (known.length < MIN_KNOWN_FOR_TIERS) return out;
  known.forEach((r, i) => {
    out.set(r.seat, i < 3 ? "top" : i >= known.length - 3 ? "bottom" : "mid");
  });
  return out;
}

/**
 * Режимы сортировки:
 *  - seat — по месту (как за столом);
 *  - maf  — «сильные чёрные»: по винрейту за мафию (играю красным — ищу их);
 *  - civ  — «сильные красные»: по винрейту за мирных (играю чёрным).
 */
export type SortMode = "seat" | "maf" | "civ";
export const SORT_MODES: readonly SortMode[] = ["seat", "maf", "civ"];

/**
 * Порог выборки для ранжирования. Винрейт с трёх игр — шум: 100% после двух
 * побед поставило бы новичка выше ветерана. Игроки с меньшим числом игр за
 * сторону идут ПОСЛЕ набравших порог (между собой — тоже по винрейту).
 */
export const MIN_GAMES_FOR_RANK = 10;

export function sortRows(rows: readonly SummaryRow[], mode: SortMode): SummaryRow[] {
  const copy = rows.slice();
  if (mode === "seat") return copy.sort((a, b) => a.seat - b.seat);
  const side = (r: SummaryRow) => {
    const t = r.totals;
    if (!t) return { games: 0, wr: null as number | null };
    return mode === "maf"
      ? { games: t.mafGames, wr: winratePct(t.mafWins, t.mafGames) }
      : { games: t.civGames, wr: winratePct(t.civWins, t.civGames) };
  };
  return copy.sort((a, b) => {
    const sa = side(a);
    const sb = side(b);
    // 0 — нет данных, 1 — мало игр, 2 — выборка достаточна.
    const band = (s: { games: number; wr: number | null }) =>
      s.wr === null ? 0 : s.games < MIN_GAMES_FOR_RANK ? 1 : 2;
    return (
      band(sb) - band(sa) ||
      (sb.wr ?? -1) - (sa.wr ?? -1) ||
      sb.games - sa.games ||
      a.seat - b.seat
    );
  });
}

/** Подпись режима для кнопки и подсказки. */
export function sortModeLabel(mode: SortMode): { short: string; title: string } {
  switch (mode) {
    case "maf":
      return { short: "⚫", title: "Сильные чёрные сверху (винрейт за мафию и дона)" };
    case "civ":
      return { short: "🔴", title: "Сильные красные сверху (винрейт за мирного и шерифа)" };
    default:
      return { short: "№", title: "По месту за столом" };
  }
}
