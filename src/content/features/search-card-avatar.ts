/**
 * Фича: картинка в карточке профиля на странице поиска (просьба владельца
 * 22.10.2026).
 *
 * До отключения Ready Player Me слева от ника в карточке стоял 3D-аватар
 * (`.p-play__profile-avatar`, 162×189). Сайт убрал его из шаблона — карточка
 * осталась с одним текстом. Возвращаем картинку на то же место:
 *  • «Фото с сайта» — аватар из шапки сайта (это тот же пользователь), в
 *    полном размере: сайт отдаёт оригинал, если не просить size=100x;
 *  • «Своя картинка» — изображение из @core/own-avatar (выбирается на
 *    странице расширения avatar.html). Не задана — фото с сайта.
 * Вид — наш класс `.pn-search-avatar` в notes.css (размеры и скругление
 * прежнего блока сайта), а не класс сайта: его CSS может исчезнуть молча.
 * Вставка из onDomChange идемпотентна (инвариант §4): узел помечен адресом.
 */
import { onDomChange } from "@core/dom";
import { SITE } from "@core/selectors";
import { avatarFileFromSrc, userAvatarUrl } from "@core/polemica-api";
import { avatarMark, loadOwnAvatar, onOwnAvatarChanged } from "@core/own-avatar";
import type { Feature, FeatureContext } from "@core/feature";
import type { Settings } from "@shared/types";

export const SEARCH_AVATAR_CLASS = "pn-search-avatar";

let enabled = false;
let unsubDom: (() => void) | null = null;
let unsubAvatar: (() => void) | null = null;
let useCustom = false;
let custom: string | null = null;
/** Поколение включения: поздняя загрузка картинки после disable() не пишет. */
let generation = 0;
/** Адреса, которые не загрузились: без этого битая картинка циклилась бы. */
const failed = new Set<string>();

function isSearchPage(): boolean {
  return location.pathname === "/game-search" || location.pathname.startsWith("/game-search/");
}

function removeAvatar(): void {
  document.querySelectorAll(`.${SEARCH_AVATAR_CLASS}`).forEach((n) => n.remove());
}

/** Что показывать: своя картинка, если выбрана и есть, иначе фото из шапки. */
export function searchAvatarSrc(): string | null {
  if (useCustom && custom) return custom;
  const header = document.querySelector<HTMLImageElement>(SITE.headerAvatarImg);
  const file = avatarFileFromSrc(header?.getAttribute("src"));
  return file ? userAvatarUrl(file) : null;
}

function buildAvatar(src: string): HTMLElement {
  const box = document.createElement("div");
  box.className = SEARCH_AVATAR_CLASS;
  box.dataset.pnSrc = avatarMark(src);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  img.addEventListener("error", () => {
    if (!enabled || !box.isConnected) return;
    // Вердикт — ДО remove: удаление будит onDomChange, вставлять снова нельзя.
    failed.add(src);
    box.remove();
  });
  box.append(img);
  return box;
}

function apply(): void {
  if (!enabled || !isSearchPage()) {
    if (document.querySelector(`.${SEARCH_AVATAR_CLASS}`)) removeAvatar();
    return;
  }
  const host = document.querySelector<HTMLElement>(SITE.searchProfileMain);
  if (!host) return;
  const src = searchAvatarSrc();
  if (!src || failed.has(src)) {
    if (document.querySelector(`.${SEARCH_AVATAR_CLASS}`)) removeAvatar();
    return;
  }
  const mark = avatarMark(src);
  const existing = host.querySelector<HTMLElement>(`:scope > .${SEARCH_AVATAR_CLASS}`);
  if (existing && existing.dataset.pnSrc === mark && existing === host.firstElementChild) return;
  removeAvatar();
  // Первым ребёнком — слева от ника, где стоял 3D-аватар.
  host.insertBefore(buildAvatar(src), host.firstChild);
}

function setCustom(value: string | null): void {
  custom = value;
}

function readSettings(s: Settings): void {
  useCustom = s.own_avatar_source === "custom";
}

export const searchCardAvatarFeature: Feature = {
  id: "search-card-avatar",
  settingKey: "search_card_avatar_enabled",

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
      setCustom(value);
      apply();
    });
    const gen = generation;
    void loadOwnAvatar().then((value) => {
      if (gen !== generation || !enabled) return;
      setCustom(value);
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
    removeAvatar();
    failed.clear();
    setCustom(null);
  },
};
