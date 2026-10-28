/**
 * Ранний флаг режима «Скрыть рейтинг» (content-скрипт, document_start).
 *
 * Весь режим держится на ОДНОМ атрибуте `<html data-pn-hide-rating>`:
 * rating-hide.css (едет в ЭТОМ же content-скрипте — Firefox вставляет CSS в
 * момент run_at, у notes.css это document_end) прячет под ним MMR сайта и
 * наши собственные метки `[data-pn-rating]`.
 * Атрибут ставит и снимает ТОЛЬКО этот файл — одна власть, без гонок с
 * content.js.
 *
 * Почему не content.js: он грузится на document_end, а бандл сайта успевает
 * отрисовать лобби/профиль раньше — рейтинг мелькнул бы, а смысл режима
 * ровно в том, чтобы его не увидеть ни на миг. `storage` асинхронный, поэтому
 * сначала читаем синхронное зеркало в localStorage страницы (как у зонда
 * комнаты), затем сверяемся с настоящей настройкой и обновляем зеркало.
 * Зеркала нет (первый заход на этот origin, очищенные данные, приватное
 * окно) — прячем до ответа storage: миг без рейтинга безвреден, миг с
 * рейтингом ломает сам режим (ревью 28.10.2026).
 *
 * Никаких импортов из core/*: полифилл парсился бы на document_start перед
 * бандлом сайта (см. шапку room-probe-inject.ts).
 */

export const HIDE_RATING_ATTR = "data-pn-hide-rating";
/** Зеркало режима в localStorage сайта: "1" — прятать, "0" — показывать. */
export const HIDE_RATING_MIRROR_KEY = "pn_hide_rating";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Что делать до ответа storage. Показываем рейтинг, только если зеркало
 * ЯВНО говорит «выключено»; нет ключа или localStorage запрещён — прячем.
 */
export function readMirror(store: Store | null): boolean {
  try {
    return store?.getItem(HIDE_RATING_MIRROR_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Зеркало явно говорит «включено» — опора, когда storage не ответит вовсе. */
function mirrorSaysOn(store: Store | null): boolean {
  try {
    return store?.getItem(HIDE_RATING_MIRROR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMirror(store: Store | null, on: boolean): void {
  try {
    store?.setItem(HIDE_RATING_MIRROR_KEY, on ? "1" : "0");
  } catch {
    /* хранилище недоступно — останется только асинхронный путь */
  }
}

/** Режим действует, только пока жив мастер-выключатель расширения. */
export function hideRatingActive(items: { extension_enabled?: unknown; hide_rating?: unknown }): boolean {
  return items.extension_enabled !== false && items.hide_rating === true;
}

/**
 * Идемпотентно: атрибут пишется, только если состояние меняется. Корень на
 * document_start у HTML-страниц уже есть; null — страховка для не-HTML
 * документов сайта (JSON API, открытый во вкладке), падать там незачем.
 */
export function applyRatingFlag(on: boolean, root: Element | null = document.documentElement): void {
  if (!root || root.hasAttribute(HIDE_RATING_ATTR) === on) return;
  if (on) root.setAttribute(HIDE_RATING_ATTR, "");
  else root.removeAttribute(HIDE_RATING_ATTR);
}

interface StorageLike {
  sync: { get(keys: Record<string, unknown>): Promise<Record<string, unknown>> };
  onChanged: {
    addListener(
      cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void,
    ): void;
  };
}

/** Экспорт — тестовый шов: порядок «зеркало → storage → подписка». */
export function bootRatingFlag(storage: StorageLike | undefined, store: Store | null): void {
  applyRatingFlag(readMirror(store));
  // Настройки не прочитать вовсе — «прятать до ответа» стало бы «прятать
  // навсегда» и у тех, кто режим не включал. Верим только явному «1».
  if (!storage) {
    applyRatingFlag(mirrorSaysOn(store));
    return;
  }
  const state: { extension_enabled?: unknown; hide_rating?: unknown } = {};
  const sync = () => {
    const on = hideRatingActive(state);
    applyRatingFlag(on);
    writeMirror(store, on);
  };
  // Подписка — ДО чтения: тумблер, нажатый в окно между get() и его ответом,
  // иначе потерялся бы до перезагрузки страницы.
  let loaded = false;
  storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let touched = false;
    for (const key of ["extension_enabled", "hide_rating"] as const) {
      if (key in changes) {
        state[key] = changes[key].newValue;
        touched = true;
      }
    }
    if (touched && loaded) sync();
  });
  storage.sync
    .get({ extension_enabled: true, hide_rating: false })
    .then((items) => {
      for (const key of ["extension_enabled", "hide_rating"] as const) {
        if (!(key in state)) state[key] = items[key];
      }
      loaded = true;
      sync();
    })
    .catch(() => {
      // storage недоступен (контекст расширения умер) — как без storage.
      if (!loaded) applyRatingFlag(mirrorSaysOn(store));
    });
}

const api = (globalThis as { browser?: { storage?: StorageLike } }).browser?.storage ??
  (globalThis as { chrome?: { storage?: StorageLike } }).chrome?.storage;
let pageStore: Store | null = null;
try {
  pageStore = localStorage;
} catch {
  pageStore = null;
}
bootRatingFlag(api, pageStore);
