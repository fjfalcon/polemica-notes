/**
 * Фича: большое фото в левой карточке профиля (просьба владельца 22.10.2026).
 *
 * До отключения Ready Player Me сайт показывал в левой карточке профиля
 * 3D-аватар во весь рост. Сервис закрылся, сайт убрал картинку из шаблона —
 * карточка сжалась до уровня и MMR. Возвращаем «лицо» профиля: ставим туда
 * обычное фото игрока из квадратика рядом с ником, в полном размере
 * (сервер отдаёт оригинал, если не просить size=100x).
 *
 * Сети нет: имя файла берём из адреса маленького аватара на этой же
 * странице. Нет фото (на его месте случайная заглушка сайта) — ничего не
 * вставляем. На СВОЁМ профиле при выбранной «своей картинке» (настройка
 * own_avatar_source, @core/own-avatar) показываем её. Вставка из onDomChange
 * идемпотентна (инвариант §4): узел помечен меткой картинки.
 */
import { onDomChange } from "@core/dom";
import { SITE } from "@core/selectors";
import { avatarFileFromSrc, userAvatarUrl } from "@core/polemica-api";
import { avatarMark, loadOwnAvatar, onOwnAvatarChanged } from "@core/own-avatar";
import { readOwnIdFromDom } from "@core/own-user";
import { profileIdFromPath } from "./profile-crossover";
import type { Feature, FeatureContext } from "@core/feature";
import type { Settings } from "@shared/types";

export const PHOTO_CLASS = "pn-profile-photo";
/**
 * Цвет, в который фото затухает снизу: верхний край градиента
 * `.avatarlvl__info` (#404f51 → #2b4059) — шов не виден.
 */
const FADE_TO = "#404f51";
/** Пауза перед новой попыткой после ошибки загрузки: разовый сбой сети не навсегда. */
const RETRY_AFTER_MS = 60_000;

let enabled = false;
let unsubDom: (() => void) | null = null;
let unsubAvatar: (() => void) | null = null;
let useCustom = false;
let custom: string | null = null;
/** Поколение включения: поздняя загрузка своей картинки после disable() не пишет. */
let generation = 0;
/**
 * Адрес → когда не загрузился. Без этой паузы битая картинка жила бы
 * циклом «вставка → ошибка → удаление → onDomChange → вставка».
 */
const failed = new Map<string, number>();

function isProfilePath(pathname: string): boolean {
  return pathname === "/profile" || pathname.startsWith("/profile/");
}

function removePhoto(): void {
  document.querySelectorAll(`.${PHOTO_CLASS}`).forEach((n) => n.remove());
}

/**
 * Свой ли это профиль: «/profile» без id — всегда свой (так сайт открывает
 * собственный), «/profile/<id>» — когда id совпал со ссылкой на себя в шапке.
 */
function isOwnProfile(): boolean {
  if (location.pathname === "/profile" || location.pathname === "/profile/") return true;
  const id = profileIdFromPath(location.pathname);
  const own = readOwnIdFromDom();
  return id !== null && own !== null && id === String(own);
}

/** Что показывать: своя картинка на своём профиле, иначе фото с сайта; null — нечего. */
export function profilePhotoUrl(): string | null {
  if (useCustom && custom && isOwnProfile()) return custom;
  const small = document.querySelector<HTMLImageElement>(SITE.profileAvatarImg);
  const file = avatarFileFromSrc(small?.getAttribute("src"));
  return file ? userAvatarUrl(file) : null;
}

function buildPhoto(url: string): HTMLElement {
  // Своя картинка (data:) — без ссылки: браузеры не открывают data: во вкладке.
  const box = document.createElement(url.startsWith("data:") ? "div" : "a");
  box.className = PHOTO_CLASS;
  box.dataset.pnSrc = avatarMark(url);
  if (box instanceof HTMLAnchorElement) {
    box.href = url;
    box.target = "_blank";
    box.rel = "noopener";
    box.title = "Открыть фото целиком";
  }
  box.style.cssText =
    "display:block;position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;z-index:2;";
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.decoding = "async";
  img.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
  img.addEventListener("error", () => {
    // Узел, снятый disable() или заменой фото, вердиктов не выносит.
    if (!enabled || !box.isConnected) return;
    // Вердикт — ДО remove: удаление будит onDomChange, вставлять снова нельзя.
    failed.set(url, Date.now());
    box.remove();
  });
  const fade = document.createElement("div");
  fade.style.cssText =
    `position:absolute;left:0;right:0;bottom:0;height:35%;pointer-events:none;` +
    `background:linear-gradient(to bottom,rgba(64,79,81,0),${FADE_TO});`;
  box.append(img, fade);
  return box;
}

function apply(): void {
  if (!enabled || !isProfilePath(location.pathname)) {
    if (document.querySelector(`.${PHOTO_CLASS}`)) removePhoto();
    return;
  }
  const card = document.querySelector<HTMLElement>(SITE.profileLevelCard);
  if (!card) return;
  const url = profilePhotoUrl();
  const existing = card.querySelector<HTMLElement>(`:scope > .${PHOTO_CLASS}`);
  const failedAt = url ? failed.get(url) : undefined;
  if (failedAt !== undefined && Date.now() - failedAt >= RETRY_AFTER_MS) failed.delete(url as string);
  if (!url || failed.has(url)) {
    if (document.querySelector(`.${PHOTO_CLASS}`)) removePhoto();
    return;
  }
  if (existing && existing.dataset.pnSrc === avatarMark(url) && existing === card.firstElementChild) return;
  removePhoto();
  // Первым ребёнком — над уровнем и MMR, как стоял 3D-аватар.
  card.insertBefore(buildPhoto(url), card.firstChild);
}

function readSettings(s: Settings): void {
  useCustom = s.own_avatar_source === "custom";
}

export const profilePhotoFeature: Feature = {
  id: "profile-photo",
  settingKey: "profile_photo_enabled",

  enable(ctx: FeatureContext) {
    enabled = true;
    generation++;
    readSettings(ctx.settings);
    unsubDom = onDomChange((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          apply();
          return;
        }
      }
    });
    unsubAvatar = onOwnAvatarChanged((value) => {
      custom = value;
      apply();
    });
    const gen = generation;
    void loadOwnAvatar().then((value) => {
      if (gen !== generation || !enabled) return;
      custom = value;
      apply();
    });
    apply();
  },

  update(ctx: FeatureContext) {
    readSettings(ctx.settings);
    apply();
  },

  disable() {
    enabled = false;
    generation++;
    if (unsubDom) {
      unsubDom();
      unsubDom = null;
    }
    if (unsubAvatar) {
      unsubAvatar();
      unsubAvatar = null;
    }
    removePhoto();
    failed.clear();
    custom = null;
  },
};
