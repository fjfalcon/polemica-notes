/**
 * «Моя картинка»: своё изображение вместо фото с сайта (просьба владельца
 * 22.10.2026) — в карточке страницы поиска и большим фото своего профиля.
 *
 * Хранится в storage.local (не sync: картинка весит десятки килобайт, а у
 * sync лимит 8 КБ на ключ) одной data:-строкой, ужатой страницей выбора до
 * OWN_AVATAR_MAX_SIDE. Сайт её не видит — это только наш показ.
 *
 * Строка приходит из хранилища, куда пишут только наши контексты, но
 * читатель всё равно проверяет её СТРОГО: растровый тип из короткого списка,
 * base64, потолок длины. SVG не принимаем — в <img> он скрипты не исполняет,
 * но разбирать его незачем.
 */
import { browser } from "./env";

/** Ключ хранилища. Не настройка — данные пользователя, живут локально. */
export const OWN_AVATAR_KEY = "pn_own_avatar";
/** Длинная сторона после ужатия: карточка поиска 162×189, фото профиля ~300. */
export const OWN_AVATAR_MAX_SIDE = 600;
/** Потолок длины data:-строки (~600 КБ байт картинки) — с запасом на PNG. */
export const OWN_AVATAR_MAX_CHARS = 800_000;

const DATA_URL_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Годится ли строка как «моя картинка». Чистая функция — тестовый шов. */
export function isValidOwnAvatar(value: unknown): value is string {
  return typeof value === "string" && value.length <= OWN_AVATAR_MAX_CHARS && DATA_URL_RE.test(value);
}

/** Сохранённая картинка; null — не задана, битая или хранилище недоступно. */
export async function loadOwnAvatar(): Promise<string | null> {
  try {
    const got = await browser.storage.local.get(OWN_AVATAR_KEY);
    const value = (got as Record<string, unknown>)[OWN_AVATAR_KEY];
    return isValidOwnAvatar(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveOwnAvatar(dataUrl: string): Promise<void> {
  if (!isValidOwnAvatar(dataUrl)) throw new Error("картинка не подходит");
  await browser.storage.local.set({ [OWN_AVATAR_KEY]: dataUrl });
}

export async function clearOwnAvatar(): Promise<void> {
  await browser.storage.local.remove(OWN_AVATAR_KEY);
}

/**
 * Подписка на смену картинки (страница выбора сохранила/убрала). Колбэк
 * получает уже проверенное значение или null. Возвращает отписку.
 */
export function onOwnAvatarChanged(cb: (value: string | null) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local" || !(OWN_AVATAR_KEY in changes)) return;
    const value = changes[OWN_AVATAR_KEY].newValue;
    cb(isValidOwnAvatar(value) ? value : null);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

let memoSrc: string | null = null;
let memoMark = "";

/**
 * Метка картинки для идемпотентной вставки (§4): data:-строку целиком в
 * атрибут не кладём (сотни килобайт), а префикс у всех картинок одного
 * формата одинаков — для data: берётся хеш всей строки. Последний результат
 * запоминается: подписчики onDomChange зовут это на каждой мутации, а
 * сравнение той же строки по ссылке мгновенно.
 */
export function avatarMark(src: string): string {
  if (!src.startsWith("data:")) return src;
  if (src === memoSrc) return memoMark;
  // FNV-1a, 32 бита: различать две картинки, а не защищаться от подбора.
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  memoSrc = src;
  memoMark = `data#${(h >>> 0).toString(16)}:${src.length}`;
  return memoMark;
}
