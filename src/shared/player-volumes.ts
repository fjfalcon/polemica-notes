/**
 * Запомненная громкость игроков (просьба владельца 09.11.2026): ползунок
 * «Громкость игрока» сайта живёт в компоненте плитки и с каждой новой игрой
 * сбрасывается на значение по умолчанию.
 *
 * storage.local, ключ pn_player_volumes: { "<userId>": 0…100 }. Ключ — id
 * пользователя сайта (playerView.user.id): ник меняется, id — нет. Значение —
 * ровно то, что показывает ползунок сайта (его шкала 0…100).
 *
 * Общий для content и page-скрипта: чистая логика, без browser.* и DOM.
 */

export const PLAYER_VOLUMES_KEY = "pn_player_volumes";
/** Команда content → page-скрипт: { source, volumes }. */
export const PLAYER_VOLUME_CMD_SOURCE = "pn-player-volume-cmd";
/** Потолок записей: старые (давно не трогали) уходят первыми. */
export const MAX_PLAYER_VOLUMES = 1000;

/**
 * Карта id → громкость в порядке свежести (старые первыми). Map, а не объект:
 * у объекта ключи-числа (а id — числа) идут по возрастанию, не по вставке, и
 * потолок резал бы не самые старые, а самые маленькие id. В хранилище —
 * списком пар [[id, громкость], …] в том же порядке.
 */
export type PlayerVolumes = Map<string, number>;
export type StoredPlayerVolumes = Array<[string, number]>;

const ID_RE = /^\d{1,12}$/;

/** Значение ползунка: целое 0…100, иначе null. */
export function normalizeVolume(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** id пользователя из `/profile/<id>`; null — не id. */
export function userIdFromProfileHref(href: string | null | undefined): string | null {
  const m = /^\/profile\/(\d{1,12})(?:[/?#]|$)/.exec(href ?? "");
  return m ? m[1] : null;
}

/**
 * Разбор списка из хранилища или из сообщения. Мусор отбрасывается поштучно,
 * повтор id — побеждает поздний (он свежее); потолок режет самые старые.
 */
export function sanitizePlayerVolumes(raw: unknown): PlayerVolumes {
  const out: PlayerVolumes = new Map();
  if (!Array.isArray(raw)) return out;
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [id, value] = pair as [unknown, unknown];
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    const v = normalizeVolume(value);
    if (v === null) continue;
    out.delete(id);
    out.set(id, v);
  }
  return trim(out);
}

function trim(map: PlayerVolumes): PlayerVolumes {
  for (const id of map.keys()) {
    if (map.size <= MAX_PLAYER_VOLUMES) break;
    map.delete(id);
  }
  return map;
}

/** Новая карта с громкостью игрока; запись переезжает в конец (свежая). */
export function withPlayerVolume(map: PlayerVolumes, id: string, volume: number): PlayerVolumes {
  const out: PlayerVolumes = new Map(map);
  out.delete(id);
  out.set(id, volume);
  return trim(out);
}

/** В хранилище и в сообщение page-скрипту — списком пар. */
export function serializePlayerVolumes(map: PlayerVolumes): StoredPlayerVolumes {
  return Array.from(map.entries());
}
