/**
 * Справочник «кого встречал за столом»: ник → id профиля (09.10.2026).
 *
 * Питает «Поиск игрока» в попапе. Рейтинг сайта — только топ-1000, а
 * «кто играет сейчас» — только идущие игры; без своего справочника игрок вне
 * топа, с которым вы сыграли вчера, не находился бы вовсе.
 *
 * Только storage.local, НЕ sync (как заметки): справочник растёт, а у sync
 * лимит 8 КБ на элемент. Потолок MAX_ENTRIES — самые старые встречи
 * вытесняются. Данные публичные (ники и id видны всем за столом), наружу не
 * уходят.
 */
import { browser } from "./env";
import { log } from "./log";

export const SEEN_PLAYERS_KEY = "pn_seen_players";
/** Потолок записей: ~3000 × ~60 байт ≈ 180 КБ — мелочь для storage.local. */
export const MAX_ENTRIES = 3000;
/** Склейка записей: стол из 10 игроков — одна запись на диск, не десять. */
const FLUSH_DELAY_MS = 2000;

export interface SeenPlayer {
  /** Ник в исходном регистре (последний виденный). */
  nick: string;
  id: string;
  /** Когда видели последний раз (ms). */
  at: number;
}

export type SeenMap = Record<string, SeenPlayer>;

/**
 * Слить новые встречи в справочник и обрезать до потолка. Чистая функция.
 * Ключ — ник в нижнем регистре. Тот же id под НОВЫМ ником вытесняет старую
 * запись: человек переименовался, а старый ник скоро займёт кто-то другой.
 */
export function mergeSeen(
  current: SeenMap,
  incoming: ReadonlyArray<{ nick: string; id: string }>,
  now: number,
  max = MAX_ENTRIES,
): SeenMap {
  const out: SeenMap = { ...current };
  for (const { nick, id } of incoming) {
    const clean = nick.trim();
    if (!clean || !id) continue;
    const key = clean.toLowerCase();
    for (const [k, v] of Object.entries(out)) {
      if (v.id === id && k !== key) delete out[k];
    }
    out[key] = { nick: clean, id, at: now };
  }
  const keys = Object.keys(out);
  if (keys.length <= max) return out;
  keys
    .sort((a, b) => out[a].at - out[b].at)
    .slice(0, keys.length - max)
    .forEach((k) => delete out[k]);
  return out;
}

/** Прочитать справочник. Битое содержимое — пустой справочник, не исключение. */
export async function readSeenPlayers(): Promise<SeenMap> {
  try {
    const res = (await browser.storage.local.get({ [SEEN_PLAYERS_KEY]: {} })) as Record<
      string,
      unknown
    >;
    const raw = res[SEEN_PLAYERS_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: SeenMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as Partial<SeenPlayer> | null;
      if (e && typeof e.nick === "string" && typeof e.id === "string" && typeof e.at === "number") {
        out[k] = { nick: e.nick, id: e.id, at: e.at };
      }
    }
    return out;
  } catch (e) {
    log.warn("seen-players", "справочник не прочитан", e);
    return {};
  }
}

let pending: Array<{ nick: string; id: string }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;
  try {
    // Чтение прямо перед записью: другая вкладка могла дописать своё.
    const merged = mergeSeen(await readSeenPlayers(), batch, Date.now());
    await browser.storage.local.set({ [SEEN_PLAYERS_KEY]: merged });
  } catch (e) {
    log.warn("seen-players", "справочник не сохранён", e);
  }
}

/** Запомнить игроков стола. Запись склеивается и уходит одним set(). */
export function rememberSeenPlayers(entries: ReadonlyArray<{ nick: string; id: string }>): void {
  if (entries.length === 0) return;
  pending.push(...entries);
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

/** Тестовый шов: немедленно записать накопленное. */
export function flushSeenPlayersForTest(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  return flush();
}
