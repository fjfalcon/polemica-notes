// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
/**
 * Скорость автовозврата на СТРАНИЦЕ ПОИСКА (9.75.0): частый опрос кнопки
 * «Играть», чтение моста на активации предзагрузки и одна перезагрузка на
 * эпизод, если сайт застрял в «игрок ещё в игре».
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let domSubscriber: (() => void) | null = null;

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    domSubscriber = cb;
    return () => {
      domSubscriber = null;
    };
  }),
  safeClick: vi.fn(() => true),
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));

import { noteTrustedInput, queueRequeueFeature, setDirectRequeuePort } from "@content/features/queue-requeue";
import { serializeMark } from "@content/features/requeue-pending";
import { safeClick } from "@core/dom";
import { log } from "@core/log";
import type { Settings } from "@shared/types";

const PENDING_KEY = "pn_requeue_pending";
const RELOAD_KEY = "pn_requeue_reload";
const ctx = { settings: { requeue_after_lobby_fail_enabled: true } as Settings };

const reloadSpy = vi.fn();
const jsdomLocation = location;
vi.stubGlobal("location", {
  get pathname() {
    return jsdomLocation.pathname;
  },
  origin: jsdomLocation.origin,
  assign: vi.fn(),
  reload: reloadSpy,
});

const infoHas = (needle: string) =>
  vi.mocked(log.info).mock.calls.some((args) => args.some((a) => String(a).includes(needle)));

function freshBridge(): void {
  sessionStorage.setItem(
    PENDING_KEY,
    serializeMark({ issuedAt: Date.now() - 5_000, refreshedAt: Date.now() - 1_000 }),
  );
}

function playButton(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play-profile__wr"><button class="p-play__profile-button">Играть</button></div>
    </div>`;
}

/** Сайт считает игрока ещё в игре: вместо «Играть» — «Продолжить/Покинуть». */
function decideBlock(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play__profile-game p-play__profile-game--decide">
        <button>Продолжить игру</button><button class="p-play__profile-quit">Покинуть игру</button>
      </div>
    </div>`;
}

/** Крутилка на месте «Играть» (isSearchBtnLoading). */
function searchLoader(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play__profile-game p-play__profile-game--search p-play__profile-game-loader-gradient"></div>
    </div>`;
}

/** В jsdom нет раскладки: модалку сайта «открытой» делает только размер. */
function giveSize(el: Element | null): void {
  if (!el) throw new Error("нет узла");
  Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 300 });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 200 });
}

function setPrerendering(on: boolean): void {
  Object.defineProperty(document, "prerendering", { configurable: true, get: () => on });
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_800_000_000_000));
  vi.mocked(safeClick).mockClear();
  vi.mocked(log.info).mockClear();
  reloadSpy.mockClear();
  setPrerendering(false);
});

afterEach(() => {
  queueRequeueFeature.disable();
  domSubscriber = null;
  vi.useRealTimers();
  setPrerendering(false);
});

describe("кнопка «Играть» по пути из комнаты", () => {
  test("появилась без мутации-тика — клик через шаг опроса, а не через 250-мс дроссель", () => {
    freshBridge();
    document.body.innerHTML = `<div class="p-play__profile-panel"></div>`; // скелетон
    queueRequeueFeature.enable(ctx);
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();

    playButton(); // наблюдатель ещё не отдал тик — будит собственный опрос
    vi.advanceTimersByTime(110);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
    expect(infoHas("мс после прихода из комнаты")).toBe(true);
  });

  test("обычный поиск (не из комнаты) частым опросом не крутится", () => {
    // Скелетон без моста: машина не взведена, опрос не нужен вовсе.
    document.body.innerHTML = `<div class="p-play__profile-panel"></div>`;
    queueRequeueFeature.enable(ctx);
    playButton();
    vi.advanceTimersByTime(500);
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
  });
});

describe("застрявший сайт: одна перезагрузка на эпизод", () => {
  test("решающий блок на приходе из комнаты — перезагрузка с перевзведённым мостом", () => {
    freshBridge();
    decideBlock();
    queueRequeueFeature.enable(ctx);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY), "мост обязан пережить перезагрузку").not.toBeNull();
  });

  test("вторая перезагрузка подряд запрещена — машина доживает окно и сдаётся вслух", () => {
    freshBridge();
    decideBlock();
    queueRequeueFeature.enable(ctx);
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // «Перезагруженная» страница: модуль живёт заново, мост на месте.
    queueRequeueFeature.disable();
    vi.advanceTimersByTime(1_500);
    queueRequeueFeature.enable(ctx);
    vi.advanceTimersByTime(9_000);
    expect(reloadSpy, "перезагрузка — одна на эпизод, не цикл").toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(log.warn).mock.calls.some((a) => String(a[1]).includes("автовозврат остановлен: за")),
    ).toBe(true);
  });

  test("крутилка после клика — НЕ перезагружаем: медленный ответ очереди нормален", () => {
    // В час роспуска очередь нагружена; перезагрузка порвала бы сокет поиска
    // и могла бы выбросить уже выданное место (ревью 29.10.2026).
    freshBridge();
    playButton();
    queueRequeueFeature.enable(ctx);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
    searchLoader();
    domSubscriber?.();
    vi.advanceTimersByTime(6_000);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test("модалка «вы ещё в игре» после нашего клика — одна перезагрузка", () => {
    freshBridge();
    playButton();
    queueRequeueFeature.enable(ctx);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
    document.body.insertAdjacentHTML("beforeend", '<div class="modal modal-game-in-progress">Вы уже в игре</div>');
    giveSize(document.querySelector(".modal"));
    domSubscriber?.();
    expect(reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test("модалка ДО нашего клика — решает игрок, как и раньше", () => {
    freshBridge();
    document.body.innerHTML = '<div class="modal">Подтвердите почту</div>';
    giveSize(document.querySelector(".modal"));
    queueRequeueFeature.enable(ctx);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test("перезагрузка уступает живому вводу игрока (§4 п.2) и случается после бэкоффа", () => {
    freshBridge();
    document.body.innerHTML = '<div class="p-play__profile-panel"></div>';
    queueRequeueFeature.enable(ctx);
    noteTrustedInput(); // игрок тянется к «Покинуть игру» сам
    decideBlock();
    domSubscriber?.();
    expect(reloadSpy, "поперёк клика игрока — нельзя").not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_200);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test("мусор и время из будущего в ключе перезагрузки не запрещают её", () => {
    for (const junk of ["abc", String(Date.now() + 60_000)]) {
      reloadSpy.mockClear();
      sessionStorage.clear();
      sessionStorage.setItem(RELOAD_KEY, junk);
      freshBridge();
      decideBlock();
      queueRequeueFeature.enable(ctx);
      expect(reloadSpy, junk).toHaveBeenCalledTimes(1);
      queueRequeueFeature.disable();
    }
  });

  test("перезагрузка продолжает ТОТ ЖЕ эпизод: issuedAt не обнуляется", () => {
    const issuedAt = Date.now() - 5_000;
    sessionStorage.setItem(PENDING_KEY, serializeMark({ issuedAt, refreshedAt: Date.now() - 1_000 }));
    decideBlock();
    queueRequeueFeature.enable(ctx);
    const mark = JSON.parse(sessionStorage.getItem(PENDING_KEY) as string) as { issuedAt: number };
    expect(mark.issuedAt).toBe(issuedAt);
  });

  test("успех (секундомер) снимает запрет перезагрузки для следующего роспуска", () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 1_000));
    freshBridge();
    document.body.innerHTML = `
      <div class="p-play__profile-game p-play__profile-game--search">
        <span class="p-play__profile-game-search-time">00:01</span>
      </div>`;
    queueRequeueFeature.enable(ctx);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });
});

describe("тонкости клика по пути из комнаты", () => {
  const disabledPlay = () => {
    document.body.innerHTML =
      '<div class="p-play-profile__wr"><button class="p-play__profile-button" disabled>Играть</button></div>';
  };

  test("«Играть» ненадолго недоступна при загрузке — не сдаёмся, жмём, когда очереди восстановились", () => {
    freshBridge();
    disabledPlay();
    queueRequeueFeature.enable(ctx);
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
    playButton();
    vi.advanceTimersByTime(110);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
  });

  test("недоступна дольше грейса — честная сдача «не выбраны очереди»", () => {
    freshBridge();
    disabledPlay();
    queueRequeueFeature.enable(ctx);
    vi.advanceTimersByTime(1_700);
    expect(infoHas("кнопка «Играть» недоступна")).toBe(true);
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
  });

  test("готовая кнопка нажимается без искусственной паузы после ухода из комнаты", () => {
    sessionStorage.setItem(
      PENDING_KEY,
      serializeMark({ issuedAt: Date.now() - 5_000, refreshedAt: Date.now() }),
    );
    playButton();
    queueRequeueFeature.enable(ctx);
    // Готовая страница не ждёт прежние 300 мс.
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
  });

  test("новое лобби на поиске не наследует путь из комнаты", () => {
    freshBridge();
    document.body.innerHTML = '<div class="p-play__profile-panel"></div>';
    queueRequeueFeature.enable(ctx);
    // Сразу нашлось новое лобби и игрок его принял (cursor-pointer снят)…
    document.body.innerHTML = '<div class="p-play__profile-game p-play__profile-accept"></div>';
    domSubscriber?.();
    // …а потом оно развалилось с решающим блоком: перезагрузка — только для
    // пути из комнаты, здесь её быть не должно.
    decideBlock();
    domSubscriber?.();
    vi.advanceTimersByTime(500);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe("активация предзагрузки", () => {
  test("устаревшая предзагрузка с решающим блоком — перезагрузка ВНЕ бюджета", () => {
    setPrerendering(true);
    freshBridge();
    decideBlock();
    queueRequeueFeature.enable(ctx);
    setPrerendering(false);
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY), "разовый бюджет цел для настоящего рассинхрона").toBeNull();
  });

  test("во время предзагрузки вкладка скрыта, показ приходит двумя событиями — ровно один клик", () => {
    for (const order of ["prerender-first", "visibility-first"] as const) {
      vi.mocked(safeClick).mockClear();
      sessionStorage.clear();
      setPrerendering(true);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      freshBridge();
      playButton();
      queueRequeueFeature.enable(ctx);
      setPrerendering(false);
      const showPrerender = () => document.dispatchEvent(new Event("prerenderingchange"));
      const showVisible = () => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      if (order === "prerender-first") {
        showPrerender();
        showVisible();
      } else {
        showVisible();
        showPrerender();
      }
      vi.advanceTimersByTime(1_000);
      expect(vi.mocked(safeClick), order).toHaveBeenCalledTimes(1);
      queueRequeueFeature.disable();
    }
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  test("мост читается на показе страницы, не во время предзагрузки", () => {
    setPrerendering(true);
    freshBridge();
    playButton();
    queueRequeueFeature.enable(ctx);
    expect(vi.mocked(safeClick), "страница ещё не показана игроку").not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY), "мост не тронут до активации").not.toBeNull();

    // Прошло время отсчёта — окно ARM_WINDOW_MS не должно было начаться.
    vi.advanceTimersByTime(20_000);
    setPrerendering(false);
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
    expect(infoHas("(страница была предзагружена)")).toBe(true);
  });

  test("выключение до активации снимает слушатель (§4 п.7)", () => {
    setPrerendering(true);
    freshBridge();
    playButton();
    queueRequeueFeature.enable(ctx);
    queueRequeueFeature.disable();
    setPrerendering(false);
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
  });
});

describe("сквозной замер и восстановление раннего клика", () => {
  test("замер от сигнала до очереди включает загрузку страницы, успех не равен клику", () => {
    const stoppedAt = Date.now();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      issuedAt: stoppedAt - 5000, refreshedAt: stoppedAt, roomStoppedAt: stoppedAt,
    }));
    vi.advanceTimersByTime(150);
    playButton();
    queueRequeueFeature.enable(ctx);
    expect(infoHas("замер автовозврата, мс:")).toBe(false);
    vi.advanceTimersByTime(40);
    document.body.innerHTML = '<div class="p-play__profile-game--search"><span class="p-play__profile-game-search-time">00:01</span></div>';
    domSubscriber?.();
    const metrics = vi.mocked(log.info).mock.calls.find(args => args[1] === "замер автовозврата, мс:");
    expect(metrics?.[2]).toEqual({stopToClick: 150, stopToQueue: 190, landingToClick: 0, clickToQueue: 40, prerendered: false});
  });

  test("ранний отказ «в игре», reload и успешная очередь сохраняют время сигнала", () => {
    const stoppedAt = Date.now();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      issuedAt: stoppedAt - 5000, refreshedAt: stoppedAt, roomStoppedAt: stoppedAt,
    }));
    playButton();
    queueRequeueFeature.enable(ctx);
    vi.advanceTimersByTime(80);
    document.body.insertAdjacentHTML("beforeend", '<div class="modal modal-game-in-progress">Вы уже в игре</div>');
    giveSize(document.querySelector(".modal"));
    domSubscriber?.();
    expect(reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(220); // всего 300 мс после раннего клика
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({roomStoppedAt: stoppedAt, issuedAt: stoppedAt - 5000});
    queueRequeueFeature.disable();
    vi.advanceTimersByTime(500);
    playButton();
    queueRequeueFeature.enable(ctx);
    vi.advanceTimersByTime(40);
    document.body.innerHTML = '<div class="p-play__profile-game--search"><span class="p-play__profile-game-search-time">00:01</span></div>';
    domSubscriber?.();
    const metrics = vi.mocked(log.info).mock.calls.find(args => args[1] === "замер автовозврата, мс:");
    expect(metrics?.[2]).toMatchObject({stopToClick: 800, stopToQueue: 840, clickToQueue: 40});
  });

  test("модалка «поиск уже идёт» после клика не рвёт очередь перезагрузкой", () => {
    freshBridge();
    playButton();
    queueRequeueFeature.enable(ctx);
    document.body.insertAdjacentHTML("beforeend", '<div class="modal modal-break-search">Игра уже ищется</div>');
    giveSize(document.querySelector(".modal"));
    domSubscriber?.();
    vi.advanceTimersByTime(2000);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
  });
});

describe("сервис поиска узнаёт о роспуске позже комнаты", () => {
  test("лаг 200 мс, отказ 20 мс, reload 60 мс — ранний клик восстанавливается", () => {
    const stoppedAt = Date.now();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({issuedAt: stoppedAt - 5000, refreshedAt: stoppedAt, roomStoppedAt: stoppedAt}));
    playButton();
    reloadSpy.mockImplementationOnce(() => {
      setTimeout(() => {
        queueRequeueFeature.disable();
        if (Date.now() - stoppedAt >= 200) playButton(); else decideBlock();
        queueRequeueFeature.enable(ctx);
        setTimeout(() => {
          document.body.innerHTML = '<div class="p-play__profile-game--search"><span class="p-play__profile-game-search-time">00:01</span></div>';
          domSubscriber?.();
        }, 40);
      }, 60);
    });
    queueRequeueFeature.enable(ctx);
    vi.advanceTimersByTime(20);
    document.body.insertAdjacentHTML("beforeend", '<div class="modal modal-game-in-progress">Вы уже в игре</div>');
    giveSize(document.querySelector(".modal"));
    domSubscriber?.();
    vi.advanceTimersByTime(279);
    expect(reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(101);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(infoHas("поиск возобновлён")).toBe(true);
    const metrics = vi.mocked(log.info).mock.calls.find(args => args[1] === "замер автовозврата, мс:");
    expect(metrics?.[2]).toMatchObject({stopToQueue: 400});
  });

  test("свежий сигнал и устаревший prerender: дождаться сервиса перед бесплатным reload", () => {
    setPrerendering(true);
    const stoppedAt = Date.now();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({issuedAt: stoppedAt - 5000, refreshedAt: stoppedAt, roomStoppedAt: stoppedAt}));
    decideBlock();
    queueRequeueFeature.enable(ctx);
    setPrerendering(false);
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });
});

 test("handoff подтверждённого direct-поиска восстанавливается без DOM-клика",()=>{ const resume=vi.fn();setDirectRequeuePort({prepare:vi.fn(),cancel:vi.fn(),start:()=>false,resume});freshBridge();sessionStorage.setItem("pn_direct_requeue_handoff",String(Date.now()));playButton();queueRequeueFeature.enable(ctx);expect(resume).toHaveBeenCalledTimes(1);expect(safeClick).not.toHaveBeenCalled(); });

test("handoff в скрытой вкладке сохраняется до возвращения",()=>{
  const resume=vi.fn();setDirectRequeuePort({prepare:vi.fn(),cancel:vi.fn(),start:()=>false,resume});
  const signal=Date.now();sessionStorage.setItem("pn_direct_requeue_handoff",String(signal));
  Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});playButton();queueRequeueFeature.enable(ctx);
  expect(resume).not.toHaveBeenCalled();expect(sessionStorage.getItem("pn_direct_requeue_handoff")).toBe(String(signal));
  Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));vi.advanceTimersByTime(350);
  expect(resume).toHaveBeenCalledTimes(1);expect(safeClick).not.toHaveBeenCalled();
});

 test.each([
  ["acknowledged", true], ["cold", false], ["legacy", false],
 ])("handoff %s preserves the evidence of queue acceptance", (kind, queued) => {
  const resume = vi.fn(); setDirectRequeuePort({ prepare: vi.fn(), cancel: vi.fn(), start: () => false, resume });
  const signal = Date.now(); freshBridge();
  sessionStorage.setItem("pn_direct_requeue_handoff", kind === "legacy" ? String(signal) : JSON.stringify({ signalAt: signal, queued }));
  playButton(); queueRequeueFeature.enable(ctx);
  expect(resume).toHaveBeenCalledExactlyOnceWith(signal, queued); expect(safeClick).not.toHaveBeenCalled();
 });
