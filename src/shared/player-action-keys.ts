/**
 * Клавиши «Действия по цифрам» — общее для content и попапа.
 *
 * Игроки 1…10 — десять переназначаемых клавиш, хранятся одной строкой через
 * запятую (KeyboardEvent.code). Нумпад — отдельной галочкой, раскладка как у
 * сайта: NumpadN — игрок N, Numpad0 — игрок 10.
 */

export const PLAYER_SLOTS = 10;

const seatDigit = (i: number) => (i === 9 ? 0 : i + 1);

export const DEFAULT_PLAYER_ACTION_KEYS = Array.from({ length: PLAYER_SLOTS }, (_, i) => `Digit${seatDigit(i)}`).join(",");

export const NUMPAD_PLAYER_KEYS: readonly string[] = Array.from({ length: PLAYER_SLOTS }, (_, i) => `Numpad${seatDigit(i)}`);

/**
 * Клавиши комнаты, которые сайт держит за собой (hotkeys-js в room/bundle,
 * сверено 04.11.2026): v m l g d k r и F1…F10 у владельца стола. Слоту игрока
 * их не даём: клавиша игрока, пока на столе кнопки действий, сайту не
 * отдаётся — и камера/микрофон/роли сайта на ней молча перестали бы работать.
 */
export const SITE_ROOM_KEYS: readonly string[] = [
  "KeyV",
  "KeyM",
  "KeyL",
  "KeyG",
  "KeyD",
  "KeyK",
  "KeyR",
  ...Array.from({ length: 10 }, (_, i) => `F${i + 1}`),
];

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

/**
 * Десять клавиш по местам. Мусор, дубли и клавиши сайта (чужой бэкап,
 * ручная правка хранилища) не назначаются: "" — у места клавиши нет. Дубль
 * достаётся первому месту: роутер держит ОДИН обработчик на код.
 */
export function parsePlayerActionKeys(raw: unknown): string[] {
  const parts = typeof raw === "string" ? raw.split(",") : DEFAULT_PLAYER_ACTION_KEYS.split(",");
  const seen = new Set<string>();
  return Array.from({ length: PLAYER_SLOTS }, (_, i) => {
    const code = (parts[i] ?? "").trim();
    if (!CODE_RE.test(code) || seen.has(code) || SITE_ROOM_KEYS.includes(code)) return "";
    seen.add(code);
    return code;
  });
}

export function serializePlayerActionKeys(codes: readonly string[]): string {
  return Array.from({ length: PLAYER_SLOTS }, (_, i) => codes[i] ?? "").join(",");
}
