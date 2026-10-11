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
vi.mock("@core/polemica-api", () => ({
  ACTIVE_GAMES_TTL_MS: 15_000,
  fetchActiveGames: vi.fn(async () => [
    { players: [{ username: "Альфа", id: 11, mmr: 2500 }, { username: "Бета", id: 22, mmr: 1900 }] },
  ]),
  findRatingPlayer: vi.fn(async () => undefined),
  fetchRoleBreakdown: vi.fn(async () => ({
    civilian: { games_count: 30, wins_count: 18 },
    mafia: { games_count: 12, wins_count: 6 },
  })),
}));

// ВАЖНО: @core/dom НЕ мокается — конвейер настоящий.
import { domObserver, onDomChange } from "@core/dom";
import { log } from "@core/log";
import { getOwnUserId } from "@core/own-user";
import { profileCrossoverFeature, syncProfileCrossoverRoute } from "@content/features/profile-crossover";
import { profileMmrChartFeature, syncProfileMmrRoute } from "@content/features/profile-mmr-chart";
import { protocolEmojiFeature, symbolId } from "@content/features/protocol-emoji";
import { autoReadyFeature } from "@content/features/auto-ready";
import { tableSummaryFeature } from "@content/panels/table-summary-panel";
import { micSyncFeature } from "@content/features/mic-sync";
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
  test("стол из двух игроков: окно собирается, статистика приходит, DOM затихает", async () => {
    window.history.replaceState(null, "", "/game");
    const tile = (seat0: number, nick: string) =>
      `<div class="player desktop-version"><div class="player__botleftmenu"><div class="player__info">` +
      `<div class="player-number player-${seat0}">${seat0 + 1}</div>` +
      `<div class="info__name">${nick}</div></div></div></div>`;
    document.body.innerHTML = tile(0, "Альфа") + tile(1, "Бета");
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
