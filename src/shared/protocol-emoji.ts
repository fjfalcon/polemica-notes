/**
 * Эмодзи-подмена меток протокола ПУ: общий словарь для фичи и попапа.
 *
 * Три метки протокола (кодировка — имена символов спрайта комнаты):
 * civ — сердце (мирный), maf — пистолет (мафия), vice — корона.
 * Пустая строка в настройке = метка не подменяется (родная иконка сайта).
 */

export const PROTOCOL_MARKS = ["civ", "maf", "vice"] as const;
export type ProtocolMark = (typeof PROTOCOL_MARKS)[number];

/** Ключ настройки для каждой метки. */
export const PROTOCOL_EMOJI_SETTING = {
  civ: "protocol_emoji_civ",
  maf: "protocol_emoji_maf",
  vice: "protocol_emoji_vice",
} as const;

/**
 * Дефолты: сердце → 🦄 (фича 9.63.0 так и родилась — «единороги вместо
 * сердец», поведение включивших её сохраняется), остальные метки нетронуты.
 */
export const DEFAULT_PROTOCOL_EMOJI: Record<ProtocolMark, string> = {
  civ: "🦄",
  maf: "",
  vice: "",
};

/**
 * Палитра пикалки в попапе. Первый ряд — заказ владельца 01.10.2026:
 * «100% в пикере должны быть единорожки, клоуны и какашки».
 */
export const PROTOCOL_EMOJI_PALETTE = [
  "🦄", "🤡", "💩", "❤️", "👑", "🔫", "😈", "👹",
  "💀", "☠️", "🌚", "🐍", "🐺", "🦊", "🐸", "🔥",
  "⭐", "✨", "🎩", "🗡️", "🧿", "🌹", "🫠", "🥒",
] as const;

/**
 * Нормализация значения из настройки/поля ввода: обрезаем до ПЕРВОГО
 * графемного кластера (эмодзи с ZWJ/модификаторами — один кластер), чтобы в
 * символ 24×24 не уехала строка текста. Без Intl.Segmenter (старый движок) —
 * грубый срез по кодовым точкам.
 */
export function normalizeProtocolEmoji(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(s)[Symbol.iterator]().next();
    if (first.done) return "";
    return first.value.segment.slice(0, 16);
  } catch {
    return [...s].slice(0, 2).join("");
  }
}
