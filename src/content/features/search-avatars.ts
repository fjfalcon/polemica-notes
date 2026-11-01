/**
 * Фича: настоящие аватарки в списке «Участники» очереди на странице поиска
 * (просьба владельца 22.10.2026).
 *
 * ПОЧЕМУ У ВСЕХ ОДНА ЗАГЛУШКА. Список очереди сайт рисует прямо из
 * `queues[mode].players` поискового сокета и берёт картинку из поля
 * `avatar_url`, а в этих объектах поле называется иначе (сайт и сам
 * переименовывает `avatar` → `avatar_url`, но в мёртвом computed). Без
 * file_name `/image/user-avatar` отдаёт случайную заглушку, а адрес у всех
 * строк одинаковый — браузер берёт её из кэша, и весь список одинаков.
 *
 * КАК ЧИНИМ. У строки есть ссылка `/profile/<id>`: по ней берём карточку
 * профиля (@core/polemica-api, кэш полчаса, дедуп) и подставляем адрес
 * настоящего аватара. Гейты:
 *  • только строки ОЧЕРЕДИ (SITE.queueParticipantsItem): тот же компонент
 *    стоит в поповерах витрины лобби, где аватары у сайта уже есть;
 *  • ник карточки обязан совпасть с ником строки — иначе это не тот игрок;
 *    строка без ника не трогается — сверять не с чем;
 *  • если сайт сам прислал аватар (file_name есть) или переписал src после
 *    нас — строка его, мы отступаем.
 * Запись src идемпотентна (инвариант §4): пишем, только если адрес другой.
 * disable() возвращает картинкам адрес сайта.
 */
import { onDomChange } from "@core/dom";
import { SITE } from "@core/selectors";
import { log } from "@core/log";
import { avatarFileFromSrc, fetchProfileCard, userAvatarUrl } from "@core/polemica-api";
import type { Feature } from "@core/feature";

const SCOPE = "search-avatars";
/**
 * Адрес сайта до нашей подмены — для отката. Имя своё: `data-pn-orig-src`
 * занят protocol-emoji, и его сверка снимала бы нашу метку (ревью 22.10.2026).
 */
const ORIG_ATTR = "data-pn-avatar-orig";
/** Адрес, который записали МЫ: другой src в строке значит «сайт переписал». */
const SET_ATTR = "data-pn-avatar-set";
/** Параллельных запросов профиля не больше этого: в трёх очередях до ~27 человек. */
const MAX_PARALLEL = 3;
/** Пауза перед повтором после неудачи: сеть могла лечь, долбить незачем. */
const RETRY_COOLDOWN_MS = 60_000;
/** Срок знания «id → аватар» — как у кэша карточек: новое фото за вечер подтянется. */
const KNOWN_TTL_MS = 30 * 60_000;
/** Потолок памяти: за вечер через поиск проходят десятки людей, не тысячи. */
const KNOWN_LIMIT = 300;

let enabled = false;
let unsubDom: (() => void) | null = null;
/** id → ник и файл аватара (null — фото нет). Только то, что уже выяснено. */
const known = new Map<string, { at: number; username: string; avatar: string | null }>();
const failedAt = new Map<string, number>();
const queue: string[] = [];
const active = new Set<string>();
/** Поколение включения: ответ, пришедший после disable(), не пишет в DOM. */
let generation = 0;
/** Карточка профиля не разобралась — в файл лога один раз, а не на каждого. */
let parseWarned = false;

function isSearchPage(): boolean {
  return location.pathname === "/game-search" || location.pathname.startsWith("/game-search/");
}

/** id из ссылки строки; null — ссылки нет или она не на профиль. */
function rowUserId(item: Element): string | null {
  return (item.getAttribute("href") || "").match(/\/profile\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
}

/** Ник строки — первый span в .participants-name (рядом иконки twitch/подписки). */
function rowNick(item: Element): string {
  const wrap = item.querySelector(SITE.participantsName);
  const el = wrap?.querySelector("span") || wrap;
  return el?.textContent?.trim() ?? "";
}

function request(id: string): void {
  if (active.has(id) || queue.includes(id)) return;
  const failed = failedAt.get(id);
  if (failed !== undefined && Date.now() - failed < RETRY_COOLDOWN_MS) return;
  queue.push(id);
  pump();
}

function pump(): void {
  while (active.size < MAX_PARALLEL && queue.length > 0) {
    const id = queue.shift() as string;
    active.add(id);
    const gen = generation;
    fetchProfileCard(id)
      .then((card) => {
        if (gen !== generation) return;
        if (!card) {
          failedAt.set(id, Date.now());
          if (!parseWarned) {
            parseWarned = true;
            // null — и смена формы :profile-user, и редирект на чужую
            // страницу (удалённый игрок): причину здесь не различить.
            log.warn(SCOPE, "карточка профиля не разобралась (формат :profile-user или редирект)");
          }
          return;
        }
        known.delete(id); // свежая запись — в конец порядка вытеснения
        if (known.size >= KNOWN_LIMIT) {
          const oldest = known.keys().next().value;
          if (oldest !== undefined) known.delete(oldest);
        }
        known.set(id, { at: Date.now(), username: card.username, avatar: card.avatar });
        apply();
      })
      .catch((e) => {
        if (gen !== generation) return;
        failedAt.set(id, Date.now());
        log.debug(SCOPE, "профиль не загрузился", id, e);
      })
      .finally(() => {
        // Запрос прошлого поколения не трогает учёт нового: иначе быстрое
        // выключение-включение пробивало предел параллельности.
        if (gen !== generation) return;
        active.delete(id);
        pump();
      });
  }
}

/** Снять наши метки; src вернуть сайту, только если в нём всё ещё наш адрес. */
function restore(img: HTMLImageElement): void {
  const orig = img.getAttribute(ORIG_ATTR);
  const set = img.getAttribute(SET_ATTR);
  img.removeAttribute(ORIG_ATTR);
  img.removeAttribute(SET_ATTR);
  if (orig !== null && set !== null && img.getAttribute("src") === set) img.setAttribute("src", orig);
}

function apply(): void {
  if (!enabled || !isSearchPage()) return;
  const items = document.querySelectorAll(SITE.queueParticipantsItem);
  items.forEach((item) => {
    const img = item.querySelector<HTMLImageElement>(SITE.participantsImage);
    if (!img) return;
    const src = img.getAttribute("src");
    let ours = img.hasAttribute(SET_ATTR);
    if (ours && src !== img.getAttribute(SET_ATTR)) {
      // Сайт переписал картинку после нас (Vue пишет src только при смене
      // значения) — новое значение его, наше устарело.
      img.removeAttribute(ORIG_ATTR);
      img.removeAttribute(SET_ATTR);
      ours = false;
    }
    // Сайт прислал настоящий аватар сам — это его строка, не наша.
    if (!ours && avatarFileFromSrc(src)) return;
    const id = rowUserId(item);
    const nick = rowNick(item);
    if (!id || !nick) {
      if (ours) restore(img);
      return;
    }
    const info = known.get(id);
    // Устаревшее знание перепроверяем, но до ответа показываем его, а не
    // заглушку: мигание аватара раз в полчаса хуже, чем полчаса старого фото.
    if (!info || Date.now() - info.at >= KNOWN_TTL_MS) request(id);
    if (!info) {
      if (ours) restore(img);
      return;
    }
    if (info.username !== nick || !info.avatar) {
      if (ours) restore(img);
      return;
    }
    const want = userAvatarUrl(info.avatar, "100x");
    if (src === want) return;
    if (!ours) img.setAttribute(ORIG_ATTR, src ?? "");
    img.setAttribute(SET_ATTR, want);
    img.setAttribute("src", want);
  });
}

export const searchAvatarsFeature: Feature = {
  id: "search-avatars",
  settingKey: "search_avatars_enabled",

  enable() {
    enabled = true;
    unsubDom = onDomChange((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          apply();
          return;
        }
      }
    });
    apply();
  },

  disable() {
    enabled = false;
    generation++;
    if (unsubDom) {
      unsubDom();
      unsubDom = null;
    }
    document.querySelectorAll<HTMLImageElement>(`img[${SET_ATTR}]`).forEach(restore);
    queue.length = 0;
    active.clear();
    failedAt.clear();
    known.clear();
  },
};
