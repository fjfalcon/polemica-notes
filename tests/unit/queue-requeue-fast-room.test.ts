// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * Скорость автовозврата в КОМНАТЕ (9.75.0): сигнал сервера on_stop_game от
 * зонда и предзагрузка страницы поиска.
 *
 * Повод — жалоба владельца 29.10.2026: игроки, которые сами роняют лобби
 * (не жмут «Готов»), встают в поиск из заранее открытой второй вкладки
 * руками быстрее нашего автовозврата: мы ждали экран сайта (2 с после
 * on_stop_game) или 12-секундную грейс-паузу.
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
  safeClick: vi.fn(),
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));

import { PRERENDER_ATTR, noteTrustedInput, queueRequeueFeature, setDirectRequeuePort, noteDirectRequeueResult } from "@content/features/queue-requeue";
import { log } from "@core/log";
import type { Settings } from "@shared/types";

const PENDING_KEY = "pn_requeue_pending";

/** Навигация наблюдаемая: jsdom глотает location.assign молча. */
const assignSpy = vi.fn();
const jsdomLocation = location;
vi.stubGlobal("location", {
  get pathname() {
    return jsdomLocation.pathname;
  },
  origin: jsdomLocation.origin,
  assign: assignSpy,
});
const ctx = { settings: { requeue_after_lobby_fail_enabled: true } as Settings };

const infoHas = (needle: string) =>
  vi.mocked(log.info).mock.calls.some((args) => args.some((a) => String(a).includes(needle)));

function pregameWithCountdown(ready: boolean, seconds: string): void {
  document.body.innerHTML = `
    <div class="roller">
      <div class="new-stage"><div class="new-stage__name">Идет набор игроков</div></div>
      <div class="disbandment-timer">Игра будет распущена через ${seconds}</div>
    </div>
    <div class="player my-player">
      ${ready ? '<div class="player__topleftmenu"><div class="player__readiness"><span>Готов</span></div></div>' : ""}
    </div>`;
}

function pregameNoCountdown(): void {
  document.body.innerHTML = `
    <div class="roller">
      <div class="new-stage"><div class="new-stage__name">Идет набор игроков</div></div>
    </div>
    <div class="player my-player">
      <div class="player__topleftmenu"><div class="player__readiness"><span>Готов</span></div></div>
    </div>`;
}

function matchRunning(): void {
  document.body.innerHTML = `
    <div class="roller"><span class="stage"><span class="time-of-day">Ночь 1</span></span></div>`;
}

/** Сигнал зонда так, как его доставляет postMessage страницы. */
function roomEvent(name: string, source: Window | null = window, tag = "pn-room-event"): void {
  window.dispatchEvent(new MessageEvent("message", { data: { source: tag, name }, source }));
}

const prerenderScripts = () => document.querySelectorAll(`script[${PRERENDER_ATTR}]`);

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

/** jsdom не знает speculation rules — поддержку включаем явно. */
function stubPrerenderSupport(supported: boolean): void {
  (HTMLScriptElement as unknown as { supports?: (t: string) => boolean }).supports = supported
    ? (t: string) => t === "speculationrules"
    : undefined;
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  assignSpy.mockClear();
  vi.mocked(log.info).mockClear();
  vi.useFakeTimers();
  setHidden(false);
  stubPrerenderSupport(false);
});

afterEach(() => {
  queueRequeueFeature.disable();
  setDirectRequeuePort(null);
  domSubscriber = null;
  vi.useRealTimers();
  setHidden(false);
  stubPrerenderSupport(false);
});

describe("сигнал сервера on_stop_game", () => {
  test("сигнал роспуска сохраняется в мосте до навигации", () => {
    pregameWithCountdown(true, "00:05");
    queueRequeueFeature.enable(ctx);
    const stoppedAt = Date.now();
    roomEvent("on_stop_game");
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({roomStoppedAt: stoppedAt});
  });

  test("после отсчёта роспуска уходим СРАЗУ — без экрана сайта и грейс-паузы", () => {
    queueRequeueFeature.enable(ctx);
    // Клиентский отсчёт ещё показывает секунду: он отстаёт от серверного на
    // задержку сети. Решает сервер, а не наш таймер.
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    expect(assignSpy).not.toHaveBeenCalled();

    roomEvent("on_stop_game");
    expect(assignSpy, "уход обязан случиться синхронно с сигналом").toHaveBeenCalledWith(
      "/game-search",
    );
    expect(sessionStorage.getItem(PENDING_KEY), "мост автоклика обязан лечь до навигации").not.toBeNull();
    expect(infoHas("мс после on_stop_game")).toBe(true);
  });

  test("без отсчёта роспуска сигнал НЕ ускоряет: прямой on_stop_game решает DOM-путь", () => {
    // Прямой on_stop_game — не «лобби не собралось» (исключение, ошибка):
    // узкая классификация экрана (RQ-5) остаётся единственным судьёй.
    queueRequeueFeature.enable(ctx);
    pregameNoCountdown();
    domSubscriber?.();
    roomEvent("on_stop_game");
    expect(assignSpy).not.toHaveBeenCalled();
    expect(infoHas("сервер распустил комнату"), "сигнал не засчитан вовсе, а не только без ухода").toBe(
      false,
    );
  });

  test("старт стадии во время отсчёта запрещает уход: матч пошёл", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:03");
    domSubscriber?.();
    roomEvent("on_start_stage");
    roomEvent("on_stop_game");
    domSubscriber?.();
    vi.advanceTimersByTime(20_000);
    expect(assignSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY), "мост обязан умереть вместе со стартом").toBeNull();
  });

  test("сообщения не от самой страницы и чужие источники игнорируются", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    roomEvent("on_stop_game", null);
    roomEvent("on_stop_game", window, "аналитика сайта");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  test("вкладка в фоне: уход откладывается и случается на возвращении", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    setHidden(true);
    roomEvent("on_stop_game");
    expect(assignSpy, "в фоне игрока может не быть у экрана").not.toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(400);
    expect(assignSpy).toHaveBeenCalledWith("/game-search");
  });

  test("неготового уводят по сигналу тоже, но БЕЗ метки автоклика (RQ-7)", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(false, "00:01");
    domSubscriber?.();
    roomEvent("on_stop_game");
    expect(assignSpy).toHaveBeenCalledWith("/game-search");
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem("pn_requeue_not_ready_exit")).toBe("1");
  });

  test("живой ввод игрока откладывает уход и по сигналу (§4 п.2)", async () => {
    const { noteTrustedInput } = await import("@content/features/queue-requeue");
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    noteTrustedInput();
    roomEvent("on_stop_game");
    expect(assignSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_200);
    expect(assignSpy).toHaveBeenCalledWith("/game-search");
  });

  test("сигнал начала отсчёта разрешает on_stop_game, даже если DOM-тик не успел увидеть таймер", () => {
    queueRequeueFeature.enable(ctx);
    pregameNoCountdown();
    domSubscriber?.();
    roomEvent("on_game_disbandment");
    roomEvent("on_stop_game");
    expect(assignSpy).toHaveBeenCalledWith("/game-search");
  });

  test("один сигнал начала отсчёта без таймера НЕ запускает грейс-уход", () => {
    // Грейс (12 с) короче серверного отсчёта: уход по нему посреди ещё
    // идущего голосования выдернул бы игрока из, возможно, стартующей игры.
    queueRequeueFeature.enable(ctx);
    pregameNoCountdown();
    domSubscriber?.();
    roomEvent("on_game_disbandment");
    domSubscriber?.();
    vi.advanceTimersByTime(30_000);
    domSubscriber?.();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  test("старт стадии ДО отсчёта сигналом не считается — им занимается DOM", () => {
    queueRequeueFeature.enable(ctx);
    roomEvent("on_start_stage");
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    roomEvent("on_stop_game");
    expect(assignSpy).toHaveBeenCalledWith("/game-search");
  });

  test("уход начинает новый эпизод: запрет перезагрузки прошлого снимается", () => {
    sessionStorage.setItem("pn_requeue_reload", String(Date.now()));
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    roomEvent("on_stop_game");
    expect(sessionStorage.getItem("pn_requeue_reload")).toBeNull();
  });

  test("выключенная фича сигналы не слушает", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:01");
    domSubscriber?.();
    queueRequeueFeature.disable();
    roomEvent("on_stop_game");
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("предзагрузка страницы поиска (speculation rules)", () => {
  test("ставится на финише отсчёта и только один раз", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:40");
    domSubscriber?.();
    expect(prerenderScripts(), "рано: метка в копии хранилища могла бы протухнуть").toHaveLength(0);

    pregameWithCountdown(true, "00:20");
    domSubscriber?.();
    domSubscriber?.();
    const scripts = prerenderScripts();
    expect(scripts, "идемпотентно: один узел на любое число тиков (§4 п.1)").toHaveLength(1);
    const script = scripts[0] as HTMLScriptElement;
    expect(script.type).toBe("speculationrules");
    expect(JSON.parse(script.textContent || "{}")).toEqual({
      prerender: [{ source: "list", urls: ["/game-search"] }],
    });
    expect(sessionStorage.getItem(PENDING_KEY), "метка обязана лечь ДО предзагрузки").not.toBeNull();
  });

  test("неготовому не предзагружаем: автоклика ему не будет", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(false, "00:10");
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(0);
  });

  test("браузер без speculation rules (Firefox) — ничего не вставляем", () => {
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(0);
  });

  test("матч пошёл — предзагрузка снимается", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(1);
    matchRunning();
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(0);
  });

  test("сигнал старта стадии тоже снимает предзагрузку", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    roomEvent("on_start_stage");
    expect(prerenderScripts()).toHaveLength(0);
  });

  test("экран исключения снимает предзагрузку вместе с меткой (RQ-5)", () => {
    // Ссылка сайта «/game-search» на этом экране активировала бы предзагрузку,
    // а та может держать копию хранилища с ещё живой меткой.
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(1);
    document.body.innerHTML = `
      <div class="error">
        <a class="error__main-buttons-item" href="/">На главную</a>
        <a class="error__main-buttons-item" href="/game-search">Поиск</a>
      </div>`;
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(0);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test("отсчёт погас на большом значении (игра стартует) — предзагрузка снимается", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    document.body.innerHTML = `
      <div class="roller"><div class="new-stage"><div class="new-stage__name">Идет набор игроков</div></div></div>`;
    domSubscriber?.();
    expect(prerenderScripts()).toHaveLength(0);
  });

  test("выключение фичи снимает предзагрузку (симметрия жизненного цикла, §4 п.7)", () => {
    stubPrerenderSupport(true);
    queueRequeueFeature.enable(ctx);
    pregameWithCountdown(true, "00:10");
    domSubscriber?.();
    queueRequeueFeature.disable();
    expect(prerenderScripts()).toHaveLength(0);
  });
});

test("первый мост после отсрочки всё равно помнит более ранний сигнал", () => {
  pregameNoCountdown();
  queueRequeueFeature.enable(ctx);
  expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  roomEvent("on_game_disbandment");
  noteTrustedInput();
  const stoppedAt = Date.now();
  roomEvent("on_stop_game");
  vi.advanceTimersByTime(2100);
  const mark = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
  expect(mark.roomStoppedAt).toBe(stoppedAt);
  expect(mark.issuedAt).toBeGreaterThan(stoppedAt);
});

describe("прямой запрос из комнаты",()=>{
  test("подготовленный сокет запускается по роспуску, переход только после ACK",()=>{
    const start=vi.fn(()=>true);setDirectRequeuePort({prepare:vi.fn(),cancel:vi.fn(),start});
    pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);
    const at=Date.now();roomEvent("on_stop_game");expect(start).toHaveBeenCalledExactlyOnceWith(at);expect(assignSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);noteDirectRequeueResult("queued",at,at,Date.now());vi.advanceTimersByTime(50);expect(assignSpy).toHaveBeenCalledExactlyOnceWith("/game-search");
    expect(JSON.parse(sessionStorage.getItem("pn_direct_requeue_handoff")!)).toEqual({ signalAt: at, queued: true });
  });
  test("DOM-стадия после запроса отменяет прямой путь до позднего ACK",()=>{
    const cancel=vi.fn();setDirectRequeuePort({prepare:vi.fn(),cancel,start:()=>true});
    pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);const at=Date.now();roomEvent("on_stop_game");
    matchRunning();domSubscriber?.();noteDirectRequeueResult("queued",at,at,Date.now());expect(cancel).toHaveBeenCalled();expect(assignSpy).not.toHaveBeenCalled();
  });
  test("живой ввод отменяет retries и уступает игроку",()=>{
    const cancel=vi.fn();setDirectRequeuePort({prepare:vi.fn(),cancel,start:()=>true});
    pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);const at=Date.now();roomEvent("on_stop_game");
    noteTrustedInput();noteDirectRequeueResult("queued",at,at,Date.now());expect(cancel).toHaveBeenCalled();expect(assignSpy).not.toHaveBeenCalled();
  });
});

test("скрытие после прямого запроса отменяет retries и позднюю навигацию",()=>{
  const cancel=vi.fn();setDirectRequeuePort({prepare:vi.fn(),cancel,start:()=>true});
  pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);const at=Date.now();roomEvent("on_stop_game");
  setHidden(true);document.dispatchEvent(new Event("visibilitychange"));noteDirectRequeueResult("queued",at,at,Date.now());
  expect(cancel).toHaveBeenCalled();expect(assignSpy).not.toHaveBeenCalled();
});

test("ACK до DOM-тика новой стадии не оставляет handoff-маркер",()=>{
  setDirectRequeuePort({prepare:vi.fn(),cancel:vi.fn(),start:()=>true});pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);
  const at=Date.now();roomEvent("on_stop_game");matchRunning();noteDirectRequeueResult("queued",at,at,Date.now());
  expect(sessionStorage.getItem("pn_direct_requeue_handoff")).toBeNull();expect(assignSpy).not.toHaveBeenCalled();
});

test("ACK и немедленное game-found передают управление назначенной игре",()=>{
  const enterGame=vi.fn(()=>true);setDirectRequeuePort({prepare:vi.fn(),cancel:vi.fn(),start:()=>true,enterGame});
  pregameWithCountdown(true,"00:05");queueRequeueFeature.enable(ctx);const at=Date.now();roomEvent("on_stop_game");
  noteDirectRequeueResult("queued",at,at,at+40);expect(assignSpy).not.toHaveBeenCalled();
  noteDirectRequeueResult("found",at,at,at+41);expect(enterGame).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(100);
  expect(assignSpy).not.toHaveBeenCalled();
});
