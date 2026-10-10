/**
 * «Поиск игрока» в попапе: ник → id профиля, MMR, ссылка (09.10.2026).
 *
 * У сайта нет поиска по нику, поэтому собираем справочник из того, что
 * знаем:
 *  - сейчас играет  — идущие игры (game.polemicagame.com/api/games);
 *  - рейтинг        — топ-1000 сайта;
 *  - встречал       — справочник «кого видел за столом» (@core/seen-players);
 *  - заметка        — ваши заметки, включая ПРЕЖНИЕ ники игрока.
 * Запрос из одних цифр — это id: ссылка на профиль работает всегда.
 */
import { browser } from "@core/env";
import { log } from "@core/log";
import { NOTES_KEY, isIdKey, ID_KEY_PREFIX, type NotesMap } from "@core/notes-store";
import { fetchActiveGames, fetchRatingList } from "@core/polemica-api";
import { readSeenPlayers } from "@core/seen-players";

export type SearchSource = "live" | "rating" | "seen" | "note";

export const SOURCE_LABEL: Record<SearchSource, string> = {
  live: "сейчас играет",
  rating: "рейтинг",
  seen: "встречал",
  note: "заметка",
};

/** Кандидат из одного источника. */
export interface Candidate {
  nick: string;
  id: string;
  mmr?: number | null;
  source: SearchSource;
  /** Прежние ники (из заметок) — тоже ищутся. */
  oldNicks?: string[];
}

/** Итоговая строка выдачи (кандидаты одного id слиты). */
export interface SearchHit {
  nick: string;
  id: string;
  mmr: number | null;
  sources: SearchSource[];
  /** Совпало по прежнему нику — показываем, по какому. */
  matchedOldNick?: string;
  score: number;
}

export const MIN_QUERY = 2;
export const MAX_HITS = 20;
/** Порядок доверия к нику: живые данные свежее справочников. */
const SOURCE_ORDER: SearchSource[] = ["live", "rating", "seen", "note"];

function matchScore(nick: string, q: string): number | null {
  const n = nick.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return null;
}

/**
 * Ранжировать кандидатов по запросу. Чистая функция.
 * Порядок: совпадение по id → точный ник → начало ника → подстрока →
 * прежний ник; внутри — по MMR. Один id — одна строка, источники слиты.
 */
export function rankPlayerMatches(query: string, candidates: readonly Candidate[]): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY && !/^\d+$/.test(q)) return [];
  const byId = new Map<string, SearchHit>();
  const sorted = candidates
    .slice()
    .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
  for (const c of sorted) {
    let score: number | null = c.id === q ? -1 : matchScore(c.nick, q);
    let matchedOldNick: string | undefined;
    if (score === null) {
      for (const old of c.oldNicks ?? []) {
        const s = matchScore(old, q);
        if (s !== null) {
          score = 3 + s / 10;
          matchedOldNick = old;
          break;
        }
      }
    }
    const prev = byId.get(c.id);
    if (prev) {
      if (!prev.sources.includes(c.source)) prev.sources.push(c.source);
      if (prev.mmr === null && typeof c.mmr === "number") prev.mmr = c.mmr;
      if (score !== null && score < prev.score) {
        prev.score = score;
        prev.matchedOldNick = matchedOldNick;
      }
      continue;
    }
    // Кандидат без совпадения тоже заводится (Infinity): его источник может
    // принести совпадение через другой ник того же id.
    byId.set(c.id, {
      nick: c.nick,
      id: c.id,
      mmr: typeof c.mmr === "number" ? c.mmr : null,
      sources: [c.source],
      matchedOldNick,
      score: score ?? Infinity,
    });
  }
  return [...byId.values()]
    .filter((h) => Number.isFinite(h.score))
    .sort((a, b) => a.score - b.score || (b.mmr ?? -1) - (a.mmr ?? -1) || a.nick.localeCompare(b.nick))
    .slice(0, MAX_HITS);
}

/** Кандидаты из заметок: ключи `u:<id>` с последним ником и историей. */
export function candidatesFromNotes(notes: NotesMap): Candidate[] {
  const out: Candidate[] = [];
  for (const [key, rec] of Object.entries(notes)) {
    if (!isIdKey(key) || !rec || typeof rec !== "object") continue;
    const id = key.slice(ID_KEY_PREFIX.length);
    if (!/^\d+$/.test(id) || typeof rec.nick !== "string" || !rec.nick) continue;
    out.push({
      nick: rec.nick,
      id,
      source: "note",
      oldNicks: Array.isArray(rec.nicks) ? rec.nicks.filter((n) => typeof n === "string") : [],
    });
  }
  return out;
}

/** Собрать кандидатов из всех источников. Сбой источника не валит поиск. */
export async function gatherCandidates(): Promise<{ candidates: Candidate[]; failed: string[] }> {
  const failed: string[] = [];
  const candidates: Candidate[] = [];

  const [live, rating, seen, notes] = await Promise.allSettled([
    fetchActiveGames(),
    fetchRatingList(),
    readSeenPlayers(),
    browser.storage.local.get({ [NOTES_KEY]: {} }),
  ]);

  if (live.status === "fulfilled") {
    for (const g of live.value as Array<{ players?: Array<Record<string, unknown>> }>) {
      for (const p of g.players ?? []) {
        if (typeof p.username !== "string" || p.id === undefined || p.id === null) continue;
        const mmr = Number(p.mmr);
        candidates.push({
          nick: p.username,
          id: String(p.id),
          mmr: Number.isFinite(mmr) ? mmr : null,
          source: "live",
        });
      }
    }
  } else failed.push("идущие игры");

  if (rating.status === "fulfilled") {
    for (const p of rating.value) {
      if (typeof p.username !== "string" || p.user_id === undefined || p.user_id === null) continue;
      const mmr = Number(p.mmr);
      candidates.push({
        nick: p.username,
        id: String(p.user_id),
        mmr: Number.isFinite(mmr) ? mmr : null,
        source: "rating",
      });
    }
  } else failed.push("рейтинг");

  if (seen.status === "fulfilled") {
    for (const e of Object.values(seen.value)) {
      candidates.push({ nick: e.nick, id: e.id, source: "seen" });
    }
  }

  if (notes.status === "fulfilled") {
    const map = (notes.value as Record<string, unknown>)[NOTES_KEY];
    if (map && typeof map === "object") candidates.push(...candidatesFromNotes(map as NotesMap));
  }

  return { candidates, failed };
}

const PROFILE_URL = (id: string) => `https://polemicagame.com/profile/${encodeURIComponent(id)}`;

/** Подключить поиск к разметке попапа. Без разметки — тихо ничего. */
export function setupPlayerSearch(): void {
  const input = document.getElementById("player_search_input") as HTMLInputElement | null;
  const button = document.getElementById("player_search_btn") as HTMLButtonElement | null;
  const status = document.getElementById("player_search_status");
  const results = document.getElementById("player_search_results");
  if (!input || !button || !status || !results) return;

  let cache: Promise<{ candidates: Candidate[]; failed: string[] }> | null = null;
  let runId = 0;

  const run = async () => {
    const q = input.value.trim();
    const my = ++runId;
    results.replaceChildren();
    if (q.length < MIN_QUERY && !/^\d+$/.test(q)) {
      status.textContent = `Введите хотя бы ${MIN_QUERY} символа ника или id`;
      return;
    }
    status.textContent = "Ищем…";
    // Источники собираются один раз на открытие попапа: повторный поиск —
    // мгновенный, без новых запросов к сайту.
    cache ??= gatherCandidates();
    let data: { candidates: Candidate[]; failed: string[] };
    try {
      data = await cache;
    } catch (e) {
      cache = null;
      log.warn("player-search", "поиск не удался", e);
      if (my === runId) status.textContent = "Поиск не удался — попробуйте ещё раз";
      return;
    }
    if (my !== runId) return;
    const hits = rankPlayerMatches(q, data.candidates);
    renderHits(results, hits, q);
    const note = data.failed.length ? ` (недоступно: ${data.failed.join(", ")})` : "";
    status.textContent = hits.length
      ? `Найдено: ${hits.length}${note}`
      : `Не найдено${note}. Игрок вне топ-1000 найдётся, если вы встречали его за столом`;
  };

  button.addEventListener("click", () => void run());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void run();
  });
}

function renderHits(container: HTMLElement, hits: readonly SearchHit[], q: string): void {
  container.replaceChildren();
  // Цифры — это id: ссылка на профиль работает, даже если ника не знаем.
  if (/^\d+$/.test(q) && !hits.some((h) => h.id === q)) {
    container.appendChild(hitRow({ nick: `Профиль #${q}`, id: q, mmr: null, sources: [], score: -1 }));
  }
  for (const h of hits) container.appendChild(hitRow(h));
}

function hitRow(h: SearchHit): HTMLElement {
  const row = document.createElement("a");
  row.className = "row search-hit";
  row.href = PROFILE_URL(h.id);
  row.target = "_blank";
  row.rel = "noopener noreferrer";
  const left = document.createElement("span");
  const nick = document.createElement("b");
  nick.textContent = h.nick;
  left.appendChild(nick);
  const hint = document.createElement("span");
  hint.className = "hint";
  const parts = [`id ${h.id}`];
  if (h.matchedOldNick) parts.push(`раньше: ${h.matchedOldNick}`);
  if (h.sources.length) parts.push(h.sources.map((s) => SOURCE_LABEL[s]).join(", "));
  hint.textContent = parts.join(" · ");
  left.appendChild(hint);
  const right = document.createElement("span");
  right.className = "search-mmr";
  right.textContent = h.mmr === null ? "" : `${h.mmr} MMR`;
  row.append(left, right);
  return row;
}
