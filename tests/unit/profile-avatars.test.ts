// @vitest-environment jsdom
/**
 * Фото в профиле и аватарки в «Участниках» (просьба владельца 22.10.2026).
 *
 * Главные стражи:
 *  • разбор карточки профиля берёт СТРОГО :profile-user, а не :current-user
 *    (иначе каждому игроку достался бы свой собственный аватар);
 *  • трогаются только строки ОЧЕРЕДИ: тот же список стоит в поповерах
 *    витрины лобби, где аватары у сайта уже есть (adversarial 22.10.2026);
 *  • строка без ника не трогается — сверять не с чем;
 *  • ник карточки обязан совпасть с ником строки;
 *  • ответ, пришедший после выключения, в DOM не пишет; disable() возвращает
 *    сайту его адреса.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  domSub: null as null | ((m: MutationRecord[]) => void),
}));

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((fn: (m: MutationRecord[]) => void) => {
    h.domSub = fn;
    return () => {
      h.domSub = null;
    };
  }),
}));
vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  avatarFileFromSrc,
  fetchProfileCard,
  parseProfileCard,
  resetProfileCardCacheForTest,
  userAvatarUrl,
} from "@core/polemica-api";
import { PHOTO_CLASS, profilePhotoFeature } from "@content/features/profile-photo";
import { searchAvatarsFeature } from "@content/features/search-avatars";
import { ORIG_SRC_ATTR as EMOJI_ORIG_SRC_ATTR } from "@content/features/protocol-emoji";
import type { FeatureContext } from "@core/feature";

const ctx = { settings: {} } as unknown as FeatureContext;
const PLACEHOLDER = "/image/user-avatar?size=100x";
const childList = [{ type: "childList" } as MutationRecord];

function profileHtml(user: Record<string, unknown>, current = { id: "13509", username: "fj", avatar: "13509/me.webp" }): string {
  // :current-user стоит РАНЬШЕ :profile-user — как на живой странице: разбор
  // по первому попавшемуся объекту взял бы самого пользователя.
  return (
    `<div :current-user='${JSON.stringify(current)}'></div>` +
    `<profile :profile-user='${JSON.stringify(user)}'></profile>`
  );
}

describe("адрес аватара", () => {
  test("имя файла берётся из адреса сайта, заглушка — null", () => {
    expect(avatarFileFromSrc("/image/user-avatar?file_name=993%2Favatar.webp&size=100x")).toBe("993/avatar.webp");
    expect(avatarFileFromSrc("https://polemicagame.com/image/user-avatar?file_name=91209/1785595510.webp")).toBe(
      "91209/1785595510.webp",
    );
    expect(avatarFileFromSrc(PLACEHOLDER)).toBeNull();
    expect(avatarFileFromSrc("/image/user-avatar?file_name=undefined&size=100x")).toBeNull();
    expect(avatarFileFromSrc("/image/user-avatar?file_name=&size=100x")).toBeNull();
    expect(avatarFileFromSrc("/images/user_mmr/7.svg?file_name=x")).toBeNull();
    expect(avatarFileFromSrc(null)).toBeNull();
  });

  test("без size — оригинал, с size — превью; имя файла экранируется", () => {
    expect(userAvatarUrl("993/avatar.webp")).toBe(
      "https://polemicagame.com/image/user-avatar?file_name=993%2Favatar.webp",
    );
    expect(userAvatarUrl("993/a&b.webp", "100x")).toBe(
      "https://polemicagame.com/image/user-avatar?file_name=993%2Fa%26b.webp&size=100x",
    );
    expect(avatarFileFromSrc(userAvatarUrl("993/a&b.webp", "100x"))).toBe("993/a&b.webp");
  });
});

describe("карточка профиля", () => {
  test("берётся :profile-user, а не :current-user", () => {
    expect(parseProfileCard(profileHtml({ id: "993", username: "Neo", avatar: "993/avatar.webp" }))).toEqual({
      id: "993",
      username: "Neo",
      avatar: "993/avatar.webp",
    });
  });

  test("без фото — avatar null; без атрибута или ника — null", () => {
    expect(parseProfileCard(profileHtml({ id: 5, username: "x", avatar: null }))?.avatar).toBeNull();
    expect(parseProfileCard(profileHtml({ id: 5, username: "x", avatar: "  " }))?.avatar).toBeNull();
    expect(parseProfileCard("<div :current-user='{\"id\":1,\"username\":\"me\"}'></div>")).toBeNull();
    expect(parseProfileCard(profileHtml({ id: 5, username: "" }))).toBeNull();
    expect(parseProfileCard(profileHtml({ id: "abc", username: "x" }))).toBeNull();
  });

  test("энтити декодируются только фолбэком", () => {
    const html = `<profile :profile-user='{&quot;id&quot;:&quot;7&quot;,&quot;username&quot;:&quot;A&amp;B&quot;,&quot;avatar&quot;:&quot;7/a.webp&quot;}'></profile>`;
    expect(parseProfileCard(html)).toEqual({ id: "7", username: "A&B", avatar: "7/a.webp" });
  });

  describe("сеть", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      resetProfileCardCacheForTest();
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    test("дедуп параллельных вызовов и кэш", async () => {
      fetchMock.mockResolvedValue(new Response(profileHtml({ id: "993", username: "Neo", avatar: "993/avatar.webp" })));
      const [a, b] = await Promise.all([fetchProfileCard(993), fetchProfileCard("993")]);
      expect(a?.avatar).toBe("993/avatar.webp");
      expect(b).toEqual(a);
      await fetchProfileCard("993");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe("https://polemicagame.com/profile/993");
    });

    test("чужой id в ответе — null и без кэша; мусорный id — без запроса", async () => {
      fetchMock.mockImplementation(async () => new Response(profileHtml({ id: "1", username: "Другой" })));
      expect(await fetchProfileCard("993")).toBeNull();
      expect(await fetchProfileCard("993")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await fetchProfileCard("../x")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("HTTP-ошибка — reject, не кэшируется", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
      await expect(fetchProfileCard("993")).rejects.toThrow("502");
      fetchMock.mockResolvedValueOnce(new Response(profileHtml({ id: "993", username: "Neo", avatar: null })));
      expect(await fetchProfileCard("993")).toEqual({ id: "993", username: "Neo", avatar: null });
    });
  });
});

describe("фото в профиле", () => {
  const mount = (avatarSrc: string) => {
    document.body.innerHTML =
      `<div class="profileinfo__main-info-header"><img class="profileinfo__main-info-avatar" src="${avatarSrc}"></div>` +
      '<div class="avatarlvl"><div class="avatarlvl__container">' +
      '<div class="avatarlvl__info">32 lvl</div><div class="avatarlvl__ellipse"></div></div></div>';
  };
  const photo = () => document.querySelector<HTMLAnchorElement>(`.${PHOTO_CLASS}`);

  beforeEach(() => {
    profilePhotoFeature.disable();
    window.history.replaceState(null, "", "/profile");
  });

  test("фото в полном размере встаёт первым в карточку уровня", () => {
    mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    profilePhotoFeature.enable(ctx);
    const el = photo();
    const full = "https://polemicagame.com/image/user-avatar?file_name=13509%2Favatar.webp";
    expect(el?.parentElement?.className).toBe("avatarlvl__container");
    expect(el?.parentElement?.firstElementChild).toBe(el);
    expect(el?.querySelector("img")?.getAttribute("src")).toBe(full);
    expect(el?.getAttribute("href")).toBe(full);
  });

  test("повторный проход не пересоздаёт узел (идемпотентность)", () => {
    mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    profilePhotoFeature.enable(ctx);
    const first = photo();
    h.domSub?.(childList);
    h.domSub?.(childList);
    expect(photo()).toBe(first);
    expect(document.querySelectorAll(`.${PHOTO_CLASS}`).length).toBe(1);
  });

  test("нет фото (заглушка) — ничего; фото сменилось — узел заменён", () => {
    mount(PLACEHOLDER);
    profilePhotoFeature.enable(ctx);
    expect(photo()).toBeNull();
    document.querySelector("img.profileinfo__main-info-avatar")!.setAttribute(
      "src",
      "/image/user-avatar?file_name=13509%2Fnew.webp&size=100x",
    );
    h.domSub?.(childList);
    expect(photo()?.dataset.pnSrc).toContain("13509%2Fnew.webp");
  });

  test("битая картинка не вставляется снова (нет цикла вставка→ошибка)", () => {
    mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    profilePhotoFeature.enable(ctx);
    photo()!.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(photo()).toBeNull();
    h.domSub?.(childList);
    expect(photo()).toBeNull();
  });

  test("разовая ошибка загрузки — новая попытка через минуту", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_900_000_000_000);
      mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
      profilePhotoFeature.enable(ctx);
      photo()!.querySelector("img")!.dispatchEvent(new Event("error"));
      vi.setSystemTime(1_900_000_000_000 + 30_000);
      h.domSub?.(childList);
      expect(photo(), "через 30 с — ещё пауза").toBeNull();
      vi.setSystemTime(1_900_000_000_000 + 61_000);
      h.domSub?.(childList);
      expect(photo(), "через минуту — снова").not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("ошибка картинки после выключения ничего не запоминает", () => {
    mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    profilePhotoFeature.enable(ctx);
    const img = photo()!.querySelector("img")!;
    profilePhotoFeature.disable();
    img.dispatchEvent(new Event("error"));
    profilePhotoFeature.enable(ctx);
    expect(photo()).not.toBeNull();
  });

  test("вне профиля и после выключения — фото нет", () => {
    mount("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    profilePhotoFeature.enable(ctx);
    window.history.replaceState(null, "", "/game-search");
    h.domSub?.(childList);
    expect(photo()).toBeNull();
    window.history.replaceState(null, "", "/profile");
    h.domSub?.(childList);
    expect(photo()).not.toBeNull();
    profilePhotoFeature.disable();
    expect(photo()).toBeNull();
    expect(h.domSub).toBeNull();
  });
});

describe("аватарки в «Участниках»", () => {
  const fetchMock = vi.fn();
  const row = (id: number | string, nick: string, src = PLACEHOLDER) =>
    `<a class="participants-item" href="/profile/${id}" target="_blank">` +
    `<img class="participants-image" src="${src}" alt="avatar">` +
    `<div class="participants-name"><span>${nick}</span><img class="participants-subscription"></div></a>`;
  /** Список очереди — как на сайте: внутри галочки режима поиска. */
  const queueList = (rows: string) =>
    `<label class="p-play__profile-modes-item"><div class="p-play__participants"><div class="participants">${rows}</div></div></label>`;
  const imgs = () => Array.from(document.querySelectorAll<HTMLImageElement>("img.participants-image"));
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const cards: Record<string, Record<string, unknown>> = {
    "11": { id: "11", username: "Igolka", avatar: "11/avatar.webp" },
    "22": { id: "22", username: "Outland", avatar: "22/1785595510.webp" },
    "33": { id: "33", username: "Безфото", avatar: null },
    "44": { id: "44", username: "НовыйНик", avatar: "44/avatar.webp" },
  };

  beforeEach(() => {
    searchAvatarsFeature.disable();
    resetProfileCardCacheForTest();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const id = String(url).split("/").pop() as string;
      return cards[id] ? new Response(profileHtml(cards[id])) : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/game-search");
  });
  afterEach(() => {
    searchAvatarsFeature.disable();
    vi.unstubAllGlobals();
  });

  test("строки с ником получают свои аватары; без фото — заглушка остаётся", async () => {
    document.body.innerHTML = queueList(`${row(11, "Igolka")}${row(22, "Outland")}${row(33, "Безфото")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    const [a, b, c] = imgs();
    expect(a.getAttribute("src")).toBe(userAvatarUrl("11/avatar.webp", "100x"));
    expect(b.getAttribute("src")).toBe(userAvatarUrl("22/1785595510.webp", "100x"));
    expect(c.getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("строки без ника не запрашиваются и не меняются", async () => {
    document.body.innerHTML = queueList(`${row(1, "")}${row(2, "")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imgs().map((i) => i.getAttribute("src"))).toEqual([PLACEHOLDER, PLACEHOLDER]);
  });

  test("ник карточки не совпал с ником строки — аватар не ставится", async () => {
    document.body.innerHTML = queueList(`${row(44, "СтарыйНик")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("аватар, присланный сайтом, не трогается", async () => {
    const siteSrc = "/image/user-avatar?file_name=11%2Fsite.webp&size=100x";
    document.body.innerHTML = queueList(`${row(11, "Igolka", siteSrc)}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imgs()[0].getAttribute("src")).toBe(siteSrc);
  });

  test("повторные проходы не ходят в сеть заново и не переписывают src", async () => {
    document.body.innerHTML = queueList(`${row(11, "Igolka")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    const img = imgs()[0];
    const spy = vi.spyOn(img, "setAttribute");
    h.domSub?.(childList);
    h.domSub?.(childList);
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("неудача сети — пауза перед повтором, а не запрос на каждую мутацию", async () => {
    document.body.innerHTML = queueList(`${row(99, "Нет")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    h.domSub?.(childList);
    h.domSub?.(childList);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("не больше трёх запросов профиля одновременно", async () => {
    const pending: Array<() => void> = [];
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          const id = String(url).split("/").pop() as string;
          pending.push(() => resolve(new Response(profileHtml({ id, username: `n${id}`, avatar: `${id}/a.webp` }))));
        }),
    );
    document.body.innerHTML = queueList(`${[1, 2, 3, 4, 5].map((i) => row(100 + i, `n${100 + i}`)).join("")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    pending.shift()?.();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    while (pending.length) {
      pending.shift()?.();
      await settle();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(imgs().every((i) => avatarFileFromSrc(i.getAttribute("src")) !== null)).toBe(true);
  });

  test("ответ после выключения в DOM не пишет; disable возвращает адреса сайта", async () => {
    document.body.innerHTML = queueList(`${row(11, "Igolka")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(imgs()[0].getAttribute("src")).not.toBe(PLACEHOLDER);
    searchAvatarsFeature.disable();
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
    expect(imgs()[0].hasAttribute("data-pn-avatar-orig")).toBe(false);
    expect(imgs()[0].hasAttribute("data-pn-avatar-set")).toBe(false);

    let release: () => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Response(profileHtml(cards["22"])));
        }),
    );
    document.body.innerHTML = queueList(`${row(22, "Outland")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    searchAvatarsFeature.disable();
    release();
    await settle();
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("поздняя ошибка запроса прошлого включения не ставит паузу новому", async () => {
    let fail: () => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("network"));
        }),
    );
    document.body.innerHTML = queueList(`${row(11, "Igolka")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    searchAvatarsFeature.disable();
    fail();
    await settle();
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(imgs()[0].getAttribute("src")).toBe(userAvatarUrl("11/avatar.webp", "100x"));
  });

  test("поповеры витрины «Открытые лобби» не трогаются и в сеть не ходят (блокер ревью)", async () => {
    // Тот же ParticipantsList стоит в ячейке игроков каждой строки витрины.
    document.body.innerHTML =
      `<div class="p-play__lobby-table"><div class="p-play__lobby-table-cell-players">` +
      `<div class="p-play__participants"><div class="participants">${row(11, "Igolka")}${row(22, "Outland")}</div></div>` +
      `</div></div>`;
    searchAvatarsFeature.enable(ctx);
    h.domSub?.(childList);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imgs().map((i) => i.getAttribute("src"))).toEqual([PLACEHOLDER, PLACEHOLDER]);
  });

  test("метку отката не снимает protocol-emoji: выключение возвращает заглушку", async () => {
    document.body.innerHTML = queueList(row(11, "Igolka"));
    searchAvatarsFeature.enable(ctx);
    await settle();
    // Сверка protocol-emoji снимает СВОЙ атрибут с любой картинки. Имя
    // берём из самой фичи: переименуй её в наше — тест это поймает.
    const ours = Array.from(imgs()[0].attributes, (a) => a.name).filter((n) => n.startsWith("data-pn-"));
    expect(ours.length).toBeGreaterThan(0);
    expect(ours, "метки не пересекаются с protocol-emoji").not.toContain(EMOJI_ORIG_SRC_ATTR);
    imgs()[0].removeAttribute(EMOJI_ORIG_SRC_ATTR);
    h.domSub?.(childList);
    searchAvatarsFeature.disable();
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("сайт переписал src после нас — значение сайта, мы отступаем", async () => {
    document.body.innerHTML = queueList(row(11, "Igolka"));
    searchAvatarsFeature.enable(ctx);
    await settle();
    const siteSrc = "/image/user-avatar?file_name=11%2Ffresh.webp&size=100x";
    imgs()[0].setAttribute("src", siteSrc);
    h.domSub?.(childList);
    expect(imgs()[0].getAttribute("src")).toBe(siteSrc);
    searchAvatarsFeature.disable();
    expect(imgs()[0].getAttribute("src"), "выключение не трогает чужое").toBe(siteSrc);
  });

  test("ник строки сменился или пропал — заглушка сайта возвращается", async () => {
    document.body.innerHTML = queueList(row(11, "Igolka"));
    searchAvatarsFeature.enable(ctx);
    await settle();
    const span = document.querySelector(".participants-name span")!;
    span.textContent = "Другой";
    h.domSub?.(childList);
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
    span.textContent = "Igolka";
    h.domSub?.(childList);
    expect(imgs()[0].getAttribute("src")).toBe(userAvatarUrl("11/avatar.webp", "100x"));
    span.textContent = "";
    h.domSub?.(childList);
    expect(imgs()[0].getAttribute("src")).toBe(PLACEHOLDER);
  });

  test("через полчаса знание перепроверяется, старое фото держится до ответа", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_900_000_000_000);
      document.body.innerHTML = queueList(row(11, "Igolka"));
      searchAvatarsFeature.enable(ctx);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      cards["11"] = { id: "11", username: "Igolka", avatar: "11/new.webp" };
      vi.setSystemTime(1_900_000_000_000 + 31 * 60_000);
      h.domSub?.(childList);
      expect(imgs()[0].getAttribute("src"), "до ответа — старое фото").toBe(userAvatarUrl("11/avatar.webp", "100x"));
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(imgs()[0].getAttribute("src")).toBe(userAvatarUrl("11/new.webp", "100x"));
    } finally {
      cards["11"] = { id: "11", username: "Igolka", avatar: "11/avatar.webp" };
      vi.useRealTimers();
    }
  });

  test("быстрое выключение-включение не пробивает предел параллельности", async () => {
    const pending: Array<() => void> = [];
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          const id = String(url).split("/").pop() as string;
          pending.push(() => resolve(new Response(profileHtml({ id, username: `n${id}`, avatar: `${id}/a.webp` }))));
        }),
    );
    document.body.innerHTML = queueList([1, 2, 3, 4, 5, 6].map((i) => row(200 + i, `n${200 + i}`)).join(""));
    searchAvatarsFeature.enable(ctx);
    await settle();
    searchAvatarsFeature.disable();
    resetProfileCardCacheForTest();
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // Развязываются запросы ПРОШЛОГО включения — новых сверх трёх быть не должно.
    for (const release of pending.splice(0, 3)) release();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  test("вне страницы поиска не работает", async () => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = queueList(`${row(11, "Igolka")}`);
    searchAvatarsFeature.enable(ctx);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
