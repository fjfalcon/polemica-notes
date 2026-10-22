// @vitest-environment jsdom
/**
 * «Моя картинка» (просьба владельца 22.10.2026): своя картинка в карточке
 * страницы поиска и большим фото СВОЕГО профиля.
 *
 * Главные стражи:
 *  • читатель принимает только растровую data:-строку под потолком длины;
 *  • своя картинка появляется только на своём профиле — на чужом остаётся
 *    фото того игрока;
 *  • не выбрана или источник «сайт» — фото с сайта; смена картинки или
 *    источника применяется сразу, без перезагрузки;
 *  • метка узла различает две картинки одного формата (иначе вставка
 *    «идемпотентно» оставляла бы старую).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  domSub: null as null | ((m: MutationRecord[]) => void),
  store: {} as Record<string, unknown>,
  listeners: new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>(),
}));

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((fn: (m: MutationRecord[]) => void) => {
    h.domSub = fn;
    return () => {
      h.domSub = null;
    };
  }),
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in h.store ? { [key]: h.store[key] } : {})),
        set: vi.fn(async (o: Record<string, unknown>) => {
          Object.assign(h.store, o);
          for (const [k, v] of Object.entries(o)) h.listeners.forEach((l) => l({ [k]: { newValue: v } }, "local"));
        }),
        remove: vi.fn(async (k: string) => {
          delete h.store[k];
          h.listeners.forEach((l) => l({ [k]: { newValue: undefined } }, "local"));
        }),
      },
      onChanged: {
        addListener: vi.fn((l: never) => h.listeners.add(l)),
        removeListener: vi.fn((l: never) => h.listeners.delete(l)),
      },
    },
  },
}));

import {
  OWN_AVATAR_KEY,
  OWN_AVATAR_MAX_CHARS,
  avatarMark,
  clearOwnAvatar,
  isValidOwnAvatar,
  saveOwnAvatar,
} from "@core/own-avatar";
import { SEARCH_AVATAR_CLASS, searchCardAvatarFeature } from "@content/features/search-card-avatar";
import { PHOTO_CLASS, profilePhotoFeature } from "@content/features/profile-photo";
import { fitSize } from "../../src/avatar/index";
import type { FeatureContext } from "@core/feature";

const IMG_A = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAETAAA/vW4f/6aR40jxpHxcP/ugT90CfugT/3NoAAA";
const IMG_B = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAETAAA/vW4f/6aR40jxpHxcP/ugT90CfugT/3NoAAB";
const SITE_SMALL = "/image/user-avatar?file_name=13509%2Favatar.webp&size=100x";
const SITE_FULL = "https://polemicagame.com/image/user-avatar?file_name=13509%2Favatar.webp";
const ctx = (source: string) => ({ settings: { own_avatar_source: source } }) as unknown as FeatureContext;
const childList = [{ type: "childList" } as MutationRecord];
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  h.store = {};
  h.listeners.clear();
});

describe("проверка картинки", () => {
  test("принимается только растровая base64 data:-строка", () => {
    expect(isValidOwnAvatar(IMG_A)).toBe(true);
    expect(isValidOwnAvatar("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isValidOwnAvatar("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isValidOwnAvatar("data:text/html;base64,PGI+")).toBe(false);
    expect(isValidOwnAvatar("https://evil.example/x.png")).toBe(false);
    expect(isValidOwnAvatar('data:image/png;base64,AAAA" onerror="x')).toBe(false);
    expect(isValidOwnAvatar(`data:image/png;base64,${"A".repeat(OWN_AVATAR_MAX_CHARS)}`)).toBe(false);
    expect(isValidOwnAvatar(null)).toBe(false);
  });

  test("сохранение отвергает негодную строку", async () => {
    await expect(saveOwnAvatar("data:image/svg+xml;base64,PHN2Zz4=")).rejects.toThrow();
    expect(h.store[OWN_AVATAR_KEY]).toBeUndefined();
  });

  test("метка различает картинки одного формата и не трогает обычные адреса", () => {
    expect(avatarMark(IMG_A)).not.toBe(avatarMark(IMG_B));
    expect(avatarMark(IMG_A)).toBe(avatarMark(IMG_A));
    expect(avatarMark(IMG_A).length).toBeLessThan(40);
    expect(avatarMark(SITE_FULL)).toBe(SITE_FULL);
  });

  test("ужатие держит пропорции и длинную сторону ≤ 600", () => {
    expect(fitSize(3000, 2000)).toEqual({ w: 600, h: 400 });
    expect(fitSize(1000, 4000)).toEqual({ w: 150, h: 600 });
    expect(fitSize(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitSize(5000, 1)).toEqual({ w: 600, h: 1 });
  });
});

describe("картинка в карточке поиска", () => {
  const mount = (headerSrc = SITE_SMALL) => {
    document.body.innerHTML =
      `<header><img class="p-header__userCont-user-avatar" src="${headerSrc}"></header>` +
      '<div class="p-play__profile-content"><div class="p-play__profile-main">' +
      '<div class="p-play__profile-info"><div class="p-play__profile-name">fj</div></div>' +
      '<button class="p-play__profile-btn">Профиль</button></div></div>';
  };
  const box = () => document.querySelector<HTMLElement>(`.${SEARCH_AVATAR_CLASS}`);
  const src = () => box()?.querySelector("img")?.getAttribute("src");

  beforeEach(() => {
    searchCardAvatarFeature.disable();
    window.history.replaceState(null, "", "/game-search");
  });
  afterEach(() => searchCardAvatarFeature.disable());

  test("фото с сайта: оригинал из шапки, первым в ряду карточки", async () => {
    mount();
    searchCardAvatarFeature.enable(ctx("site"));
    await settle();
    expect(src()).toBe(SITE_FULL);
    expect(document.querySelector(".p-play__profile-main")?.firstElementChild).toBe(box());
  });

  test("своя картинка показывается при источнике «своя»; не задана — фото с сайта", async () => {
    mount();
    searchCardAvatarFeature.enable(ctx("custom"));
    await settle();
    expect(src(), "своей нет — фото с сайта").toBe(SITE_FULL);
    await saveOwnAvatar(IMG_A);
    expect(src(), "сохранили — сразу видна").toBe(IMG_A);
    await saveOwnAvatar(IMG_B);
    expect(src(), "сменили на другую того же формата — заменилась").toBe(IMG_B);
    await clearOwnAvatar();
    expect(src(), "убрали — снова фото с сайта").toBe(SITE_FULL);
  });

  test("источник «сайт» игнорирует сохранённую свою; переключение — без перезагрузки", async () => {
    h.store[OWN_AVATAR_KEY] = IMG_A;
    mount();
    searchCardAvatarFeature.enable(ctx("site"));
    await settle();
    expect(src()).toBe(SITE_FULL);
    searchCardAvatarFeature.update?.(ctx("custom"));
    expect(src()).toBe(IMG_A);
    searchCardAvatarFeature.update?.(ctx("site"));
    expect(src()).toBe(SITE_FULL);
  });

  test("битая строка в хранилище не показывается", async () => {
    h.store[OWN_AVATAR_KEY] = "data:image/svg+xml;base64,PHN2Zz4=";
    mount();
    searchCardAvatarFeature.enable(ctx("custom"));
    await settle();
    expect(src()).toBe(SITE_FULL);
  });

  test("нет фото на сайте и нет своей — ничего не вставляется", async () => {
    mount("/image/user-avatar?size=100x");
    searchCardAvatarFeature.enable(ctx("custom"));
    await settle();
    expect(box()).toBeNull();
  });

  test("повторные проходы не пересоздают узел", async () => {
    h.store[OWN_AVATAR_KEY] = IMG_A;
    mount();
    searchCardAvatarFeature.enable(ctx("custom"));
    await settle();
    const first = box();
    h.domSub?.(childList);
    h.domSub?.(childList);
    expect(box()).toBe(first);
    expect(document.querySelectorAll(`.${SEARCH_AVATAR_CLASS}`).length).toBe(1);
  });

  test("битая картинка не вставляется снова", async () => {
    mount();
    searchCardAvatarFeature.enable(ctx("site"));
    await settle();
    box()!.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(box()).toBeNull();
    h.domSub?.(childList);
    expect(box()).toBeNull();
  });

  test("вне страницы поиска и после выключения — картинки нет, подписки сняты", async () => {
    mount();
    searchCardAvatarFeature.enable(ctx("site"));
    await settle();
    window.history.replaceState(null, "", "/profile");
    h.domSub?.(childList);
    expect(box()).toBeNull();
    window.history.replaceState(null, "", "/game-search");
    h.domSub?.(childList);
    expect(box()).not.toBeNull();
    searchCardAvatarFeature.disable();
    expect(box()).toBeNull();
    expect(h.domSub).toBeNull();
    expect(h.listeners.size).toBe(0);
  });

  test("поздняя загрузка своей картинки после выключения в DOM не пишет", async () => {
    h.store[OWN_AVATAR_KEY] = IMG_A;
    mount();
    searchCardAvatarFeature.enable(ctx("custom"));
    searchCardAvatarFeature.disable();
    await settle();
    expect(box()).toBeNull();
  });
});

describe("своя картинка большим фото профиля", () => {
  const mount = (ownId = 13509) => {
    document.body.innerHTML =
      `<header><div class="p-header__userCont"><a href="/profile/${ownId}"></a></div></header>` +
      `<img class="profileinfo__main-info-avatar" src="/image/user-avatar?file_name=993%2Favatar.webp&size=100x">` +
      '<div class="avatarlvl"><div class="avatarlvl__container"><div class="avatarlvl__info">32 lvl</div></div></div>';
  };
  const photo = () => document.querySelector<HTMLElement>(`.${PHOTO_CLASS}`);
  const src = () => photo()?.querySelector("img")?.getAttribute("src");
  const OTHER_FULL = "https://polemicagame.com/image/user-avatar?file_name=993%2Favatar.webp";

  beforeEach(() => {
    profilePhotoFeature.disable();
    h.store[OWN_AVATAR_KEY] = IMG_A;
  });
  afterEach(() => profilePhotoFeature.disable());

  test("свой профиль «/profile» — своя картинка, без ссылки на data:", async () => {
    window.history.replaceState(null, "", "/profile");
    mount();
    profilePhotoFeature.enable(ctx("custom"));
    await settle();
    expect(src()).toBe(IMG_A);
    expect(photo()?.tagName).toBe("DIV");
  });

  test("свой профиль по id из шапки — своя картинка", async () => {
    window.history.replaceState(null, "", "/profile/13509");
    mount(13509);
    profilePhotoFeature.enable(ctx("custom"));
    await settle();
    expect(src()).toBe(IMG_A);
  });

  test("ЧУЖОЙ профиль — фото того игрока, своя картинка не подставляется", async () => {
    window.history.replaceState(null, "", "/profile/993");
    mount(13509);
    profilePhotoFeature.enable(ctx("custom"));
    await settle();
    expect(src()).toBe(OTHER_FULL);
    expect(photo()?.tagName).toBe("A");
  });

  test("источник «сайт» — на своём профиле фото с сайта; переключение сразу", async () => {
    window.history.replaceState(null, "", "/profile");
    mount();
    profilePhotoFeature.enable(ctx("site"));
    await settle();
    expect(src()).toBe(OTHER_FULL);
    profilePhotoFeature.update?.(ctx("custom"));
    expect(src()).toBe(IMG_A);
    await clearOwnAvatar();
    expect(src()).toBe(OTHER_FULL);
  });
});
