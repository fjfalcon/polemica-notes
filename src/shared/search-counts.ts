/**
 * Счётчики столов на странице поиска («Обычный 8/10», «Рейтинг 6/10»,
 * «Prime 1/10»). Сайт берёт их из GET <httpUrl>/api/search только при
 * открытии страницы, дальше их обновляет лишь поисковый сокет — то есть
 * когда игрок сам стоит в поиске. Кнопка «Обновить» (просьба владельца
 * 12.11.2026) перечитывает числа тем же запросом.
 *
 * Общие константы и разбор ответа — для page-скрипта и контент-фичи.
 */

export const SEARCH_COUNTS_CMD = "pn-search-counts-cmd";
export const SEARCH_COUNTS_RESULT = "pn-search-counts-result";

/** Разумный потолок: очередь — десятки людей, не тысячи. */
const MAX_PLAYERS = 10_000;

/**
 * {"queues":{"standard":{"available":false,"players":3},...}} → {standard:3,...}.
 * players бывает числом (аноним, без Pro) и массивом (состав очереди) —
 * берём длину, как сам сайт (censorshipModesUpdate). Чужое — null.
 */
export function sanitizeQueueCounts(raw: unknown): Record<string, number> | null {
  const queues = (raw as { queues?: unknown } | null)?.queues;
  if (!queues || typeof queues !== "object") return null;
  const out: Record<string, number> = {};
  for (const [mode, q] of Object.entries(queues as Record<string, unknown>)) {
    if (!/^[a-z_]{1,24}$/.test(mode) || !q || typeof q !== "object") continue;
    const players = (q as { players?: unknown }).players;
    const n = Array.isArray(players) ? players.length : players;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_PLAYERS) out[mode] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** Адрес поискового сервиса из данных страницы — только https и только наш домен. */
export function safeServiceOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "polemicagame.com" && !url.hostname.endsWith(".polemicagame.com")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Причина отказа — короткий служебный код, без данных пользователя. */
export function safeReason(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z0-9-]{1,32}$/.test(raw) ? raw : null;
}
