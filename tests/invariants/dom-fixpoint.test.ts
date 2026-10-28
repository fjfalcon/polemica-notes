// @vitest-environment jsdom
/**
 * Исполняемый страж инварианта §4: «запись в DOM из подписчика onDomChange —
 * только идемпотентная» (решение владельца 26.08.2026).
 *
 * До этого файла инвариант был доктриной: блокер профильных карточек
 * (вечный цикл «вставка → самоудаление → мутация → вставка») прошёл мимо
 * ручных тестов, потому что они НЕ доигрывали мутацию, порождённую
 * самим обработчиком. Здесь конвейер настоящий: НЕмокнутый @core/dom с
 * живым MutationObserver — всё, что фича пишет в DOM, возвращается ей же
 * мутацией, как в бою.
 *
 * Механика: вкладка «скрыта» (document.hidden=true) — планирование в
 * @core/dom идёт чистыми setTimeout, и фейковые таймеры прокручивают
 * конвейер детерминированно. Фикспоинт = четыре тихих раунда подряд
 * (раунд ≈ 600 мс: больше и дросселя 250, и hidden-таймера 500).
 *
 * Канарейка в конце — страж самого стража: нарочно неидемпотентный
 * подписчик ОБЯЗАН детектироваться. Если харнес «зеленеет» на канарейке,
 * он сломан сам.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: "test" },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn(() => () => undefined),
  sendRuntime: vi.fn(async () => ({ success: true })),
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/own-user", () => ({ getOwnUserId: vi.fn(async () => 13509) }));
vi.mock("@core/crossover", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@core/crossover")>();
  return {
    ...orig,
    releaseOwnHistory: vi.fn(),
    getOwnHistory: vi.fn(async () => ({
      rows: [{ id: 10, role: "civilian", win: true, mmrAfter: 100, mmrDiff: 5 }],
      truncated: false,
    })),
    fetchFirstPage: vi.fn(async () => ({
      rows: [
        { id: 10, role: "mafia", win: false, mmrAfter: 90, mmrDiff: -5 },
        { id: 11, role: "civilian", win: true, mmrAfter: 95, mmrDiff: 5 },
      ],
      total: 2,
    })),
    completeHistory: vi.fn(async (_id: unknown, first: { rows: unknown[] }) => ({
      rows: first.rows,
      truncated: false,
    })),
  };
});

// Сеть «Сводки стола»: харнес не имеет права ходить на живой сайт.
vi.mock("@core/polemica-api", async (importOriginal) => {
  // Настоящие — ТОЛЬКО чистые помощники адресов аватара, поимённо: подмешанный
  // целиком модуль сделал бы настоящим любой будущий сетевой экспорт.
  const { avatarFileFromSrc, userAvatarUrl } = await importOriginal<typeof import("@core/polemica-api")>();
  return {
    avatarFileFromSrc,
    userAvatarUrl,
    fetchProfileCard: vi.fn(async (id: string) =>
      id === "11" ? { id: "11", username: "Альфа", avatar: "11/avatar.webp" } : null,
    ),
    ACTIVE_GAMES_TTL_MS: 15_000,
    fetchActiveGames: vi.fn(async () => [
      { players: [{ username: "Альфа", id: 11, mmr: 2500 }, { username: "Бета", id: 22, mmr: 1900 }] },
    ]),
    findRatingPlayer: vi.fn(async () => undefined),
    fetchRoleBreakdown: vi.fn(async () => ({
      civilian: { games_count: 30, wins_count: 18 },
      mafia: { games_count: 12, wins_count: 6 },
    })),
  };
});

// ВАЖНО: @core/dom НЕ мокается — конвейер настоящий.
import { domObserver, onDomChange } from "@core/dom";
import { log } from "@core/log";
import { getOwnUserId } from "@core/own-user";
import { fetchRoleBreakdown } from "@core/polemica-api";
import { profileCrossoverFeature, syncProfileCrossoverRoute } from "@content/features/profile-crossover";
import { profileMmrChartFeature, syncProfileMmrRoute } from "@content/features/profile-mmr-chart";
import { protocolEmojiFeature, symbolId } from "@content/features/protocol-emoji";
import { autoReadyFeature } from "@content/features/auto-ready";
import { tableSummaryFeature } from "@content/panels/table-summary-panel";
import { micSyncFeature } from "@content/features/mic-sync";
import { profilePhotoFeature } from "@content/features/profile-photo";
import { searchAvatarsFeature } from "@content/features/search-avatars";
import { searchCardAvatarFeature } from "@content/features/search-card-avatar";
import { hideRatingFeature } from "@content/features/hide-rating";
import type { FeatureContext } from "@core/feature";

const ROUND_MS = 600;
const MAX_ROUNDS = 60;
const QUIET_ROUNDS = 4;

/**
 * Крутит конвейер до фикспоинта. Возвращает {settled, rounds} — ассерты
 * снаружи, чтобы канарейка могла утверждать ОБРАТНОЕ.
 */
async function driveToFixpoint(): Promise<{ settled: boolean; rounds: number }> {
  let seen = 0;
  const counter = new MutationObserver((m) => {
    seen += m.length;
  });
  counter.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  try {
    let quiet = 0;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const before = seen;
      await vi.advanceTimersByTimeAsync(ROUND_MS);
      await Promise.resolve(); // микротаски MutationObserver
      if (seen === before) {
        quiet++;
        if (quiet >= QUIET_ROUNDS) return { settled: true, rounds: round };
      } else {
        quiet = 0;
      }
    }
    return { settled: false, rounds: MAX_ROUNDS };
  } finally {
    counter.disconnect();
  }
}

function mountProfileDom(): void {
  document.body.innerHTML =
    '<div class="profile__right">' +
    '<div class="profile__right-info"></div>' +
    '<div class="profile__right-tabs"></div>' +
    "</div>";
}

beforeEach(() => {
  vi.useFakeTimers();
  // Скрытая вкладка: @core/dom планирует чистыми setTimeout — конвейер
  // полностью под фейковыми таймерами.
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  document.body.innerHTML = "";
  (getOwnUserId as ReturnType<typeof vi.fn>).mockResolvedValue(13509);
});

afterEach(() => {
  profileCrossoverFeature.disable();
  profileMmrChartFeature.disable();
  protocolEmojiFeature.disable();
  autoReadyFeature.disable();
  tableSummaryFeature.disable();
  micSyncFeature.disable();
  profilePhotoFeature.disable();
  searchAvatarsFeature.disable();
  searchCardAvatarFeature.disable();
  hideRatingFeature.disable();
  syncProfileCrossoverRoute(null);
  syncProfileMmrRoute(null);
  vi.useRealTimers();
});

describe("§4 fixpoint: профильные карточки", () => {
  test("чужой профиль: «Вместе с вами» рисуется и DOM затихает", async () => {
    mountProfileDom();
    window.history.replaceState(null, "", "/profile/993");
    const before = domObserver.subscriberCount();
    profileCrossoverFeature.enable({ settings: {} } as unknown as FeatureContext);
    // «Покрыт» в enrollment значит «сценарий гоняет ЖИВУЮ подписку»: импорт
    // без подписки — фикция покрытия (ревью 26.08.2026).
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    expect(document.querySelector(".pn-profile-crossover")?.textContent).toContain(
      "Совместных игр",
    );
  });

  test("СЦЕНАРИЙ БЛОКЕРА: свой профиль — карточка самоудаляется БЕЗ вечного цикла", async () => {
    // Ровно тот случай, что прошёл мимо ручных тестов: самоудаление рождает
    // мутацию, и старый apply() вставлял карточку заново — навсегда.
    mountProfileDom();
    window.history.replaceState(null, "", "/profile/13509");
    profileCrossoverFeature.enable({ settings: {} } as unknown as FeatureContext);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — вечный цикл вернулся`).toBe(true);
    expect(document.querySelector(".pn-profile-crossover")).toBeNull();
  });

  test("разлогин: обе карточки самоудаляются и затихают ВМЕСТЕ", async () => {
    (getOwnUserId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mountProfileDom();
    window.history.replaceState(null, "", "/profile/993");
    profileCrossoverFeature.enable({ settings: {} } as unknown as FeatureContext);
    profileMmrChartFeature.enable({ settings: {} } as unknown as FeatureContext);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов`).toBe(true);
    expect(document.querySelector(".pn-profile-crossover")).toBeNull();
    expect(document.querySelector(".pn-mmr-chart")).toBeNull();
  });

  test("свой профиль: график рисуется, кроссовер уходит — фикспоинт при обеих фичах", async () => {
    mountProfileDom();
    window.history.replaceState(null, "", "/profile/13509");
    const before = domObserver.subscriberCount();
    profileCrossoverFeature.enable({ settings: {} } as unknown as FeatureContext);
    profileMmrChartFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "обе фичи реально подписались").toBe(before + 2);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов`).toBe(true);
    expect(document.querySelector(".pn-mmr-chart")?.textContent).toContain("Путь MMR");
    expect(document.querySelector(".pn-profile-crossover")).toBeNull();
  });
});

describe("§4 fixpoint: единороги вместо сердец", () => {
  test("комната с протоколом ПУ: подмена один раз, чужие метки целы, DOM затихает", async () => {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const XLINK_NS = "http://www.w3.org/1999/xlink";
    const makeUse = (href: string) => {
      const svg = document.createElementNS(SVG_NS, "svg");
      const use = document.createElementNS(SVG_NS, "use");
      use.setAttributeNS(XLINK_NS, "xlink:href", href);
      svg.appendChild(use);
      document.body.appendChild(svg);
      return use;
    };
    const heart = makeUse("/room/bundle/f59bacbc2885635c4d91.svg#guess-civ");
    const pistol = makeUse("/room/bundle/f59bacbc2885635c4d91.svg#guess-maf");
    const img = document.createElement("img");
    img.setAttribute("src", "/room/bundle/8bd3b0d043b384ffb24e.svg");
    document.body.appendChild(img);

    const before = domObserver.subscriberCount();
    void protocolEmojiFeature.enable({
      settings: { protocol_emoji_civ: "🦄", protocol_emoji_maf: "", protocol_emoji_vice: "" },
    } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    // Сама подмена пишет в DOM (href, контейнер символа) — эти мутации
    // возвращаются подписчику; фикспоинт докажет, что второй проход тих.
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    expect(heart.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    expect(pistol.getAttributeNS(XLINK_NS, "href")).toContain("#guess-maf");
    expect(img.getAttribute("src")).toContain("data:image/svg+xml");
  });
});

describe("§4 fixpoint: автонажатие «Готов»", () => {
  test("лобби с кнопкой: автоклик не рождает мутаций и DOM затихает", async () => {
    window.history.replaceState(null, "", "/game");
    document.body.innerHTML =
      '<div class="controls"><div class="button">Готов</div>' +
      '<div class="button active">Микрофон</div></div>';
    // Харнес НЕ мокает @core/dom (в этом его смысл), а jsdom не считает
    // вёрстку — честному isVisible нужна «геометрия» на самом узле.
    const readyBtn = document.querySelector<HTMLElement>(".controls .button")!;
    readyBtn.getBoundingClientRect = () => ({ width: 80, height: 32 }) as DOMRect;
    const before = domObserver.subscriberCount();
    void autoReadyFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    // Выдержка прошла; подписчика будит ПОСТОРОННЯЯ мутация (в бою лобби
    // мутирует постоянно — счётчик готовности, таймеры).
    await vi.advanceTimersByTimeAsync(1300);
    document.body.appendChild(document.createElement("i"));
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    // Клик реально ушёл (фича не просто промолчала всю выдержку).
    expect(vi.mocked(log.info).mock.calls.join(" ")).toContain("автоклик «Готов» отправлен");
  });
});

describe("§4 fixpoint: «Сводка стола»", () => {
  const summaryTile = (seat0: number, nick: string) =>
    `<div class="player desktop-version"><div class="player__botleftmenu"><div class="player__info">` +
    `<div class="player-number player-${seat0}">${seat0 + 1}</div>` +
    `<div class="info__name">${nick}</div></div></div></div>`;
  const summaryText = () => document.querySelector(".pn-table-summary-panel")?.textContent ?? "";
  const clearTable = () => {
    for (const el of Array.from(document.querySelectorAll(".player.desktop-version"))) el.remove();
  };

  test("стол из двух игроков: окно собирается, статистика приходит, DOM затихает", async () => {
    window.history.replaceState(null, "", "/game");
    document.body.innerHTML = summaryTile(0, "Альфа") + summaryTile(1, "Бета");
    const before = domObserver.subscriberCount();
    void tableSummaryFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    // Окно и асинхронная загрузка пишут в DOM — всё в СВОЁМ контейнере;
    // фикспоинт доказывает, что подписчик не зацикливается на собственных записях.
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    const panelText = document.querySelector(".pn-table-summary-panel")?.textContent ?? "";
    expect(panelText).toContain("Альфа");
    expect(panelText).toContain("2500");
    expect(panelText, "винрейт за красных 18/30").toContain("60%");
    // Скрыть рейтинг: заголовок и ячейки MMR помечены, винрейт — нет.
    const marked = [...document.querySelectorAll(".pn-table-summary-panel [data-pn-rating]")];
    expect(marked.map((e) => e.textContent)).toContain("MMR");
    expect(marked.map((e) => e.textContent)).toContain("2500");
    expect(marked.some((e) => e.textContent?.includes("%"))).toBe(false);
  });

  test("стол опустел в комнате: окно показывает пустой стол, а не старый состав", async () => {
    window.history.replaceState(null, "", "/game");
    document.body.innerHTML = summaryTile(0, "Альфа") + summaryTile(1, "Бета");
    void tableSummaryFeature.enable({ settings: {} } as unknown as FeatureContext);
    await driveToFixpoint();
    expect(summaryText()).toContain("Альфа");
    clearTable();
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    expect(summaryText(), "пустой стол").toContain("За столом пока никого");
    expect(summaryText(), "старый состав ушёл").not.toContain("Альфа");
  });

  test("поздний ответ статистики не возвращает строки опустевшего стола", async () => {
    const api = vi.mocked(fetchRoleBreakdown);
    const original = api.getMockImplementation();
    let release: (v: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    api.mockImplementation(() => held as ReturnType<typeof fetchRoleBreakdown>);
    try {
      window.history.replaceState(null, "", "/game");
      document.body.innerHTML = summaryTile(0, "Альфа") + summaryTile(1, "Бета");
      void tableSummaryFeature.enable({ settings: {} } as unknown as FeatureContext);
      await driveToFixpoint();
      expect(summaryText(), "статистика ещё грузится").toContain("…");
      clearTable();
      await driveToFixpoint();
      release({
        civilian: { games_count: 30, wins_count: 18 },
        mafia: { games_count: 12, wins_count: 6 },
      });
      const r = await driveToFixpoint();
      expect(r.settled, `DOM не затих за ${r.rounds} раундов`).toBe(true);
      expect(summaryText(), "старый состав не вернулся").not.toContain("Альфа");
      expect(summaryText(), "поздний винрейт не нарисован").not.toContain("60%");
      expect(summaryText()).toContain("За столом пока никого");
    } finally {
      if (original) api.mockImplementation(original);
    }
  });

  test("стол ещё не отрисован: окно не появляется", async () => {
    window.history.replaceState(null, "", "/game");
    void tableSummaryFeature.enable({ settings: {} } as unknown as FeatureContext);
    document.body.appendChild(document.createElement("i"));
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов`).toBe(true);
    expect(document.querySelector(".pn-table-summary-panel")).toBeNull();
  });
});

describe("§4 fixpoint: «Микрофон: OBS и игра»", () => {
  test("комната с кнопкой микрофона: плашка рисуется один раз и DOM затихает", async () => {
    window.history.replaceState(null, "", "/game");
    document.body.innerHTML =
      '<div class="controls"><div class="button preset-1 small desktop-version">' +
      '<img class="button__icon" src="/room/bundle/652f9184e845e10a12e5.svg"></div></div>';
    const before = domObserver.subscriberCount();
    void micSyncFeature.enable({
      settings: { mic_sync_enabled: true, obs_enabled: true, mic_sync_input: "Mic/Aux", mic_sync_hotkey: "" },
    } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    // sendRuntime харнеса отвечает success без данных → OBS «вкл», игра «вкл».
    expect(document.querySelector(".pn-mic-pill")?.textContent).toContain("OBS + игра");
  });
});

describe("§4 fixpoint: фото в профиле", () => {
  const mountLevelCard = (avatarSrc: string) => {
    document.body.innerHTML =
      `<img class="profileinfo__main-info-avatar" src="${avatarSrc}">` +
      '<div class="avatarlvl"><div class="avatarlvl__container">' +
      '<div class="avatarlvl__info">32 lvl</div><div class="avatarlvl__ellipse"></div>' +
      "</div></div>";
  };

  test("профиль с фото: фото встаёт один раз над уровнем и DOM затихает", async () => {
    window.history.replaceState(null, "", "/profile");
    mountLevelCard("/image/user-avatar?file_name=13509%2Favatar.webp&size=100x");
    const before = domObserver.subscriberCount();
    profilePhotoFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    // Посторонняя мутация будит подписчика повторно — вставка не повторяется.
    document.body.appendChild(document.createElement("i"));
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    const photos = document.querySelectorAll(".pn-profile-photo");
    expect(photos.length).toBe(1);
    expect(document.querySelector(".avatarlvl__container")?.firstElementChild).toBe(photos[0]);
  });

  test("профиль без фото (заглушка сайта): ничего не вставляется, DOM тих", async () => {
    window.history.replaceState(null, "", "/profile/993");
    mountLevelCard("/image/user-avatar?size=100x");
    profilePhotoFeature.enable({ settings: {} } as unknown as FeatureContext);
    document.body.appendChild(document.createElement("i"));
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов`).toBe(true);
    expect(document.querySelector(".pn-profile-photo")).toBeNull();
  });
});

describe("§4 fixpoint: аватарки в «Участниках»", () => {
  test("очередь: настоящий аватар подставлен один раз, строка без ника цела, DOM тих", async () => {
    window.history.replaceState(null, "", "/game-search");
    document.body.innerHTML =
      '<label class="p-play__profile-modes-item"><div class="p-play__participants">' +
      '<div class="participants"><div class="participants-items">' +
      '<a class="participants-item" href="/profile/11"><img class="participants-image" src="/image/user-avatar?size=100x">' +
      '<div class="participants-name"><span>Альфа</span></div></a>' +
      '<a class="participants-item" href="/profile/2"><img class="participants-image" src="/image/user-avatar?size=100x">' +
      '<div class="participants-name"><span></span></div></a>' +
      "</div></div></div></label>";
    const before = domObserver.subscriberCount();
    searchAvatarsFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    const [real, fake] = Array.from(document.querySelectorAll("img.participants-image"));
    expect(real.getAttribute("src")).toContain("file_name=11%2Favatar.webp");
    expect(fake.getAttribute("src")).toBe("/image/user-avatar?size=100x");
  });
});

describe("§4 fixpoint: картинка в карточке поиска", () => {
  test("карточка поиска: фото из шапки встаёт один раз слева от ника, DOM тих", async () => {
    window.history.replaceState(null, "", "/game-search");
    document.body.innerHTML =
      '<img class="p-header__userCont-user-avatar" src="/image/user-avatar?file_name=13509%2Favatar.webp&size=100x">' +
      '<div class="p-play__profile-content"><div class="p-play__profile-main">' +
      '<div class="p-play__profile-info"><div class="p-play__profile-name">fj</div></div>' +
      "</div></div>";
    const before = domObserver.subscriberCount();
    searchCardAvatarFeature.enable({ settings: { own_avatar_source: "site" } } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    document.body.appendChild(document.createElement("i"));
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    const nodes = document.querySelectorAll(".pn-search-avatar");
    expect(nodes.length).toBe(1);
    expect(document.querySelector(".p-play__profile-main")?.firstElementChild).toBe(nodes[0]);
  });
});

describe("§4 fixpoint: скрыть рейтинг", () => {
  test("колонка MMR истории игр и строка MMR разбора помечаются один раз, DOM тих", async () => {
    const head = ["Дата", "Тип игры", "Роль", "MMR", "Результат"]
      .map((t) => `<div class="profileGames__table-head-row-item">${t}</div>`)
      .join("");
    const bodyRow =
      '<div class="profileGames__table-body-row">' +
      Array.from({ length: 5 }, (_, i) => `<div class="profileGames__table-body-row-item">${i}</div>`).join("") +
      "</div>";
    document.body.innerHTML =
      `<div class="profileGames__table-head-row">${head}</div>` +
      `<div class="profileGames__table-body">${bodyRow}${bodyRow}</div>` +
      '<div class="game-stats-table"><div class="row"><div class="cell title">Итог</div></div>' +
      '<div class="row"><div class="cell title">MMR</div><div class="cell positive-mmr">+25</div></div></div>';
    const before = domObserver.subscriberCount();
    hideRatingFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(domObserver.subscriberCount(), "фича реально подписалась").toBe(before + 1);
    // Сайт дорисовал страницу истории — новая строка тоже получает метку.
    document.querySelector(".profileGames__table-body")?.insertAdjacentHTML("beforeend", bodyRow);
    const r = await driveToFixpoint();
    expect(r.settled, `DOM не затих за ${r.rounds} раундов — цикл подписчика`).toBe(true);
    expect(document.querySelectorAll("[data-pn-rating-site]").length).toBe(1 + 3 + 1);
  });
});

describe("рантайм-сторож шторма (живой лог, не только тесты)", () => {
  test("минута безостановочных проходов вне комнаты — одна warn-строка", async () => {
    window.history.replaceState(null, "", "/profile/1");
    // Управляемые часы для performance.now: реальное время в фейк-таймерах
    // не течёт, а сторожу нужно «прожить» минуту.
    let clock = 0;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const off = onDomChange(() => {
      document.body.appendChild(document.createElement("div")); // шторм
    });
    try {
      document.body.appendChild(document.createElement("span"));
      for (let i = 0; i < 130; i++) {
        clock += 600;
        await vi.advanceTimersByTimeAsync(600);
        await Promise.resolve();
      }
      const warns = (log.warn as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c.join(" "))
        .filter((line) => line.includes("не затихает"));
      expect(warns.length, "предупреждение о шторме — ровно одно (латч)").toBe(1);
    } finally {
      off();
      perfSpy.mockRestore();
    }
  });

  test("в игровой комнате шторм легитимен — сторож молчит", async () => {
    window.history.replaceState(null, "", "/game/123");
    let clock = 0;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const off = onDomChange(() => {
      document.body.appendChild(document.createElement("div"));
    });
    try {
      document.body.appendChild(document.createElement("span"));
      for (let i = 0; i < 130; i++) {
        clock += 600;
        await vi.advanceTimersByTimeAsync(600);
        await Promise.resolve();
      }
      const warns = (log.warn as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c.join(" "))
        .filter((line) => line.includes("не затихает"));
      expect(warns).toHaveLength(0);
    } finally {
      off();
      perfSpy.mockRestore();
    }
  });
});

describe("канарейка: харнес обязан УМЕТЬ падать", () => {
  test("нарочно неидемпотентный подписчик детектируется как нефикспоинт", async () => {
    // Тот же класс, что блокер: каждая пачка мутаций — новая запись в DOM.
    const off = onDomChange(() => {
      document.body.appendChild(document.createElement("div"));
    });
    try {
      document.body.appendChild(document.createElement("span")); // затравка
      const r = await driveToFixpoint();
      expect(r.settled, "харнес «озеленил» вечный цикл — страж сломан").toBe(false);
    } finally {
      off();
    }
  });
});
