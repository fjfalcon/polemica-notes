// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/match/616168" }
/**
 * Раскладка вставленных строк фаз на странице матча.
 *
 * Жалоба 07.08.2026 (скриншот): чипы голосований схлопнулись в левый край,
 * строки растянулись на пол-экрана. Причина — стили таблицы у сайта SCOPED
 * (`.table .row .cell[data-v-XXXX]{flex:1;min-width:115px}`), а аудит
 * хрупкости 06.08 убрал копирование scope-ID на наши строки, посчитав его
 * мёртвым. Проверено на живой странице: со scope наша строка повторяет
 * геометрию сайта (67/115×10), без него ячейки схлопываются в ноль.
 *
 * Тест идёт через НАСТОЯЩИЙ вход фичи (событие gameDataParsed), а не через
 * чистую функцию: мутант «detectScopeAttr есть, но applyScope не зовут»
 * обязан падать.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn(() => () => {}),
  registerOwnContainer: vi.fn(),
  unregisterOwnContainer: vi.fn(),
  safeClick: vi.fn(),
  isVisible: () => true,
}));
vi.mock("@core/env", () => ({
  browser: {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, sync: { set: vi.fn(async () => {}) } },
    runtime: { id: "x", getManifest: () => ({ version: "9.7.0" }) },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn(() => () => {}),
  sendRuntime: vi.fn(async () => ({ success: true })),
  broadcastToGameTabs: vi.fn(),
  sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("../../src/content/match-data", () => ({
  getMatchId: () => location.pathname.match(/^\/match\/([^/]+)/)?.[1] ?? null,
  getLastGameData: () => null,
  parseMatchOnPage: vi.fn(),
}));

import { matchStatsFeature, syncMatchStatsRoute } from "@content/features/match-stats";
import { onDomChange } from "@core/dom";
import { browser } from "@core/env";
import { showToast } from "@core/toast";
import { AliasResolver, applyMatchAliases, clearAllAliases } from "@content/features/player-notes/nick-alias";
import type { AliasPolicy } from "@shared/alias-policy";
import { log } from "@core/log";
import type { Settings } from "@shared/types";
import match673463 from "../fixtures/match_673463.json";
import match673041 from "../fixtures/match_673041.json";
import match598995 from "../../docs/fixtures/match_598995.json";

/**
 * Живые scope сайта на 07.08.2026 (в коде НЕ зашиты, читаются из DOM):
 * у обёртки `.game-stats-table` — scope РОДИТЕЛЬСКОГО компонента, а
 * раскладка строк живёт под своим, табличным. Поэтому детект обязан читать
 * атрибут с самой строки/ячейки: взяв его с контейнера, мы проставили бы
 * чужой хеш и получили ровно тот же развал вёрстки.
 */
const SCOPE_ATTR = "data-v-1db9d42a";
const PARENT_SCOPE_ATTR = "data-v-bb241ecc";

const ctx = {
  settings: {
    match_page_stats_enabled: true,
    statistics_enabled: true,
    match_stats_view: "legend",
  } as unknown as Settings,
};

/** Разметка страницы матча так, как её рисует сайт (со scoped-атрибутами). */
function buildSitePage(scopeAttr: string | null): void {
  const scope = scopeAttr ? ` ${scopeAttr}=""` : "";
  // Обёртка и заголовок — под родительским scope, как на живой странице.
  const parent = ` ${PARENT_SCOPE_ATTR}=""`;
  document.body.innerHTML = `
    <div class="game-stats-header"${parent}></div>
    <div class="game-stats-table"${parent}>
      <div class="table"${scope}${parent}>
        <div class="row"${scope}>
          <div class="cell title"${scope}>Роль</div>
          <div class="cell player"${scope}>Мафия</div>
          <div class="cell player"${scope}>Мирный</div>
        </div>
        <div class="row"${scope}>
          <div class="cell title"${scope}>Игрок</div>
          <div class="cell username"${scope} data-player="1">a</div>
          <div class="cell username"${scope} data-player="2">a</div>
          <div class="cell username"${scope}>b</div>
        </div>
        <div class="row"${scope}>
          <div class="cell title"${scope}>Итог</div>
          <div class="cell player"${scope}>1.5</div>
          <div class="cell player"${scope}>0.5</div>
        </div>
      </div>
    </div>`;
}

/** Данные матча: день с голосованием и ночь с выстрелом. */
const GAME_DATA = {
  data: {
    players: [
      { position: 1, role: 1, username: "a", player: 111 },
      { position: 2, role: 2, username: "b", player: 222 },
    ],
    votes: [{ day: 1, voter: 2, candidate: 1, num: 1 }],
    shots: [{ night: 1, shooter: 1, target: 2 }],
    checks: [],
  },
  winner: 1,
};

function fireGameData(detail: unknown = GAME_DATA): void {
  document.dispatchEvent(new CustomEvent("gameDataParsed", { detail }));
  // Таблицу фича ждёт интервалом в 500 мс — без прокрутки строки не встанут.
  vi.advanceTimersByTime(600);
}

/** Наши вставленные строки фаз. */
const phaseRows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".row[data-phase]"));

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", "/match/616168");
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("полный и прежние виды: три тура матча 673463", () => {
  function context(view = "hints", enabled = true) {
    return { settings: { ...ctx.settings, match_stats_view: view, statistics_enabled: enabled } };
  }
  const host = () => document.querySelector<HTMLElement>(".pn-match-review");
  const full = () => (host()?.shadowRoot ?? null)!;
  const pickView = (view: string) => full().querySelector<HTMLButtonElement>(`[data-pn-review-view="${view}"]`)!.click();
  const pickDay = (n: number) => full().querySelector<HTMLButtonElement>(`[data-pn-review-day="${n}"]`)!.click();

  function start(view = "hints", match = match673463.id) {
    history.replaceState(null, "", `/match/${match}`);
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(context(view));
  }

  const viewPicker = () => document.querySelector<HTMLSelectElement>(".pn-match-view-picker select");
  // jsdom не создаёт доверенные события ввода; вызываем обработчик самого контрола.
  async function chooseFormat(select: HTMLSelectElement, value: string) {
    select.value = value;
    await select.onchange!.call(select, { isTrusted: true } as Event);
  }

  test("выбор на странице пишет только вид разбора; страница следует общей настройке во всех форматах", async () => {
    start("classic");
    fireGameData(match673463);
    const select = viewPicker()!;
    expect(select.value).toBe("classic");
    expect(Array.from(select.options, (option) => option.text)).toEqual([
      "Полный вид", "С подсказками", "Только сводка", "Как в старой версии",
    ]);
    for (const view of ["phase_hints", "legend", "classic", "hints"]) {
      await chooseFormat(select, view);
      expect(browser.storage.sync.set).toHaveBeenLastCalledWith({ match_stats_view: view });
      matchStatsFeature.update!(context(view)); // доставка изменения storage через FeatureManager
      vi.advanceTimersByTime(600);
      expect(viewPicker()).toBe(select);
      expect(select.closest("[data-pn-review-replaced]")).toBeNull();
      expect(!!host()).toBe(view === "hints");
      expect(!!document.querySelector(".pn-timeline")).toBe(view === "phase_hints" || view === "legend");
    }
    matchStatsFeature.update!(context("legend")); // выбор из попапа
    expect(select.value).toBe("legend");
    matchStatsFeature.disable();
    expect(viewPicker()).toBeNull();
    start("legend", match673041.id);
    fireGameData(match673041);
    expect(viewPicker()?.value).toBe("legend");
  });

  test("отказ записи возвращает сохранённый формат и сообщает об ошибке", async () => {
    start();
    fireGameData(match673463);
    vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error("quota"));
    await chooseFormat(viewPicker()!, "classic");
    expect(viewPicker()?.value).toBe("hints");
    expect(host()).not.toBeNull();
    expect(showToast).toHaveBeenCalledWith("Не удалось сохранить вид разбора", { kind: "warn" });
  });

  test("хронология, таблица и фильтруемый журнал используют одни и те же три тура", () => {
    start();
    fireGameData(match673463);
    const panel = full();
    expect(host()?.nextElementSibling).toBe(document.querySelector(".game-stats-table"));
    expect(phaseRows()).toHaveLength(0);
    const openDay = panel.querySelector(".pn-mr-day[open]")!;
    expect(openDay.querySelector("summary")?.textContent).toMatch(/День 2.*3 тура/s);
    expect(openDay.querySelector("summary")?.textContent).toContain("Ушёл №7 · 6:3");
    expect(openDay.querySelectorAll(".pn-mr-card .pn-mr-leading")).toHaveLength(7); // 4 + 2 + 1
    expect(openDay.querySelector(".pn-mr-final .pn-mr-leading .pn-mr-voters")?.textContent)
      .toBe("Голосовали№1№3№5№6№7№10");
    expect(openDay.textContent).toContain("Лучший ход");
    expect(panel.querySelector('[data-pn-review-detail="3"] summary')?.textContent).toContain("Дисквалификация: №6");

    pickView("table");
    const rows = Array.from(panel.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(rows).toHaveLength(4); // выставления отдельно
    expect(Array.from(rows[1].querySelectorAll<HTMLTableCellElement>(".pn-mr-leading")).map((c) => c.cellIndex))
      .toEqual([1, 3, 4, 7]);
    expect(rows[3].cells[7].querySelector("b")?.textContent).toBe("6");
    expect(rows[3].cells[1].querySelector("b")?.textContent).toBe("3");

    pickView("journal");
    const counts = () => Array.from(panel.querySelectorAll("[data-pn-review-round]"), (el) => el.querySelectorAll("li").length);
    expect(counts()).toEqual([9, 9, 9]);
    const select = panel.querySelector("select")!;
    select.value = "7";
    select.dispatchEvent(new Event("change"));
    expect(counts()).toEqual([3, 4, 6]); // голосовал сам или голосовали за него
    panel.querySelector<HTMLButtonElement>('[data-pn-review-jump="3"]')!.click();
    expect(panel.activeElement).toBe(panel.querySelector('[data-pn-review-round="3"]'));
    pickDay(4);
    expect(counts()).toEqual([]);
    expect(panel.querySelector(".pn-mr-day-banner")?.textContent).toContain("Матч завершён");
    pickView("table");
    expect(panel.querySelector(".pn-mr-day-banner strong")?.textContent).toBe("День 4");
  });

  test("все дни: одна сетка с итогами матча, возврат в выбранный день и раскрытие хронологии", () => {
    start("hints", match673041.id);
    fireGameData(match673041);
    const panel = full();
    const all = panel.querySelector<HTMLButtonElement>("[data-pn-review-all]")!;
    const days = Array.from(panel.querySelectorAll<HTMLDetailsElement>(".pn-mr-day"));
    all.click();
    expect(days.every((d) => d.open)).toBe(true);
    expect(browser.storage.sync.set).toHaveBeenLastCalledWith({ match_review_all_days: true });
    expect(all.textContent).toBe("Свернуть все дни");
    all.click();
    expect(days.every((d) => !d.open)).toBe(true);
    expect(browser.storage.sync.set).toHaveBeenLastCalledWith({ match_review_all_days: false });
    pickView("table");
    all.click();
    const table = panel.querySelector("table")!;
    expect(table.tBodies.length).toBe(days.length);
    const secondDay = Array.from(table.tBodies).find((group) =>
      group.querySelector(".pn-mr-day-summary strong")?.textContent === "День 2");
    expect(secondDay?.querySelector(".pn-mr-outcome")?.textContent).toBe("Ушёл №7 · 7:2");
    expect(secondDay?.querySelectorAll("tr.pn-mr-final")).toHaveLength(1);
    expect(panel.querySelectorAll("thead")).toHaveLength(1);
    expect(panel.querySelectorAll("tfoot")).toHaveLength(1);
    pickDay(2); // даже уже выбранный до открытия всех дней
    expect(browser.storage.sync.set).toHaveBeenLastCalledWith({ match_review_all_days: false });
    expect(panel.querySelector("table")?.tBodies.length).toBe(1);
    expect(all.textContent).toBe("Открыть все дни");
    pickView("journal");
    expect(all.hidden).toBe(true);
  });

  test("сохранённая настройка открывает следующий матч; изменение из попапа применяется на месте", () => {
    const init = context();
    buildSitePage(SCOPE_ATTR);
    history.replaceState(null, "", `/match/${match673463.id}`);
    matchStatsFeature.enable({ settings: { ...init.settings, match_review_all_days: true } });
    fireGameData(match673463);
    expect(full().querySelectorAll(".pn-mr-day:not([open])")).toHaveLength(0);
    pickView("table");
    expect(full().querySelector("table")!.tBodies.length).toBeGreaterThan(1);
    matchStatsFeature.update!(init);
    expect(full().querySelector("table")!.tBodies).toHaveLength(1);
  });

  test("№673041: одна таблица с голосами, баллами и MMR, ник и профиль по ID", () => {
    start("hints", match673041.id);
    const native = document.querySelector<HTMLElement>(".game-stats-table")!;
    const header = document.querySelector<HTMLElement>(".game-stats-header")!;
    header.textContent = "Заголовок сайта";
    const footerAction = document.createElement("button");
    footerAction.textContent = "Репорт";
    native.after(footerAction);
    const action = vi.fn();
    footerAction.addEventListener("click", action);
    // Переставляем список итогов: склейка по индексу отдаст чужие баллы.
    fireGameData({ ...match673041, players: match673041.players.slice().reverse() });
    expect(getComputedStyle(native).display).toBe("none");
    expect(getComputedStyle(header).display).toBe("none");
    expect(getComputedStyle(footerAction).display).not.toBe("none");
    footerAction.click();
    expect(action).toHaveBeenCalledOnce();
    expect(full().querySelector(".pn-mr-head")?.textContent).toMatch(/Матч №673041.*Победа мафии/s);
    expect(full().querySelector("table")).toBeNull(); // в ходе игры нет таблицы-дублёра
    expect(full().querySelector(".pn-mr-roster")?.hasAttribute("open")).toBe(false);
    pickView("table");
    const table = full().querySelector<HTMLTableElement>("table")!;
    expect(document.querySelector(".pn-mr-table")).toBeNull(); // CSS сайта не видит её
    expect(full().querySelectorAll("table")).toHaveLength(1);
    expect(full().querySelector(".pn-mr-roster")?.hasAttribute("hidden")).toBe(true);
    const [places, names, roles] = Array.from(table.tHead!.rows);
    expect(places.cells[9].textContent).toBe("№9");
    expect(roles.cells[9].textContent).toBe("Мирный");
    const name = names.cells[9].querySelector("a");
    expect(name?.textContent).toBe("yfii7i7ft6tdr6u6dyt");
    expect(name?.getAttribute("href")).toBe("/profile/158505");
    expect(names.cells[9].querySelector("details")?.open).toBe(false);
    expect(names.cells[9].querySelector(".pn-mr-former")?.textContent)
      .toBe("В матче: Неординарный 2099");
    expect(table.tFoot?.rows[0].cells[9].textContent).toBe("-0,1");
    expect(table.tFoot?.rows[1].cells[9].textContent).toBe("+11");
    expect(full().querySelector(".pn-mr-outcome")?.textContent).toBe("Ушёл №7 · 7:2");
    pickDay(4);
    expect(full().querySelectorAll("tfoot tr")).toHaveLength(2); // итоги даже в день без голосования
    pickView("journal");
    expect(full().querySelector("table")).toBeNull();
    expect(full().querySelector(".pn-mr-roster")?.hasAttribute("hidden")).toBe(false);
    matchStatsFeature.disable();
    expect(getComputedStyle(native).display).not.toBe("none");
    expect(header.textContent).toBe("Заголовок сайта");
    expect(getComputedStyle(header).display).not.toBe("none");
    expect(footerAction.isConnected).toBe(true);
  });

  test("свои ники в разборе используют политику заметок при эфире и смене режима", () => {
    start("hints", match673041.id);
    let policy: AliasPolicy = "all";
    const resolver = new AliasResolver(() => ({
      "u:158505": { text: "", timestamp: 1, alias: "Секретный ник", aliasCondemned: true },
      "u:13509": { text: "", timestamp: 1, alias: "Обычный ник" },
    }), () => policy);
    applyMatchAliases(resolver); // заметки загрузились прежде таблицы
    fireGameData(match673041);
    pickView("table");
    const cellName = full().querySelector('table a[href="/profile/158505"]');
    expect(cellName?.textContent).toBe("yfii7i7ft6tdr6u6dyt");
    expect(cellName?.getAttribute("data-pn-alias-suffix")).toBe("Секретный ник");
    expect(cellName?.getAttribute("title")).toContain("Секретный ник");

    policy = "safe"; // player-notes получает уведомление о начале эфира
    applyMatchAliases(resolver);
    expect(full().querySelector(".pn-mr-panel")?.innerHTML).not.toContain("Секретный ник");
    expect(full().querySelector('table a[href="/profile/13509"]')?.getAttribute("data-pn-alias-suffix"))
      .toBe("Обычный ник");
    pickView("journal");
    expect(full().querySelector(".pn-mr-panel")?.innerHTML).not.toContain("Секретный ник");
    pickDay(4);
    pickView("table");
    expect(full().querySelector(".pn-mr-panel")?.innerHTML).not.toContain("Секретный ник");
    clearAllAliases(); // выключили заметки, разбор остался
    expect(full().querySelector("[data-pn-alias-suffix]")).toBeNull();
    expect(full().querySelector('table a[href="/profile/158505"]')?.getAttribute("title"))
      .toContain("В матче: Неординарный 2099");
  });

  test("новый разбор не берёт псевдоним тёзки: ни при отсутствии записи u:<id>, ни без ID", () => {
    start("hints", match673041.id);
    applyMatchAliases(new AliasResolver(() => ({
      yfii7i7ft6tdr6u6dyt: { text: "", timestamp: 1, alias: "Псевдоним по общему нику" },
      hanna_ross: { text: "", timestamp: 1, alias: "Псевдоним без ID" },
    })));
    const players = match673041.data.players.map((p) => p.position === 1 ? { ...p, player: undefined } : p);
    fireGameData({ ...match673041, data: { ...match673041.data, players } });
    pickView("table");
    const stable = full().querySelector('table a[href="/profile/158505"]');
    const withoutId = full().querySelector('table [data-pn-review-name=""]');
    expect(stable?.textContent).toBe("yfii7i7ft6tdr6u6dyt");
    expect(withoutId?.textContent).toBe("hanna_ross");
    expect(full().querySelector(".pn-mr-panel")?.innerHTML).not.toContain("Псевдоним");
  });

  test.each(["phase_hints", "legend", "classic"])("%s: видны все три тура матча", (view) => {
    start(view);
    fireGameData(match673463);
    expect(full()).toBeNull();
    const day = phaseRows().find((r) => r.dataset.phase === "day-2")!;
    if (view === "phase_hints") {
      expect(phaseRows().every((row) => row.style.display !== "none")).toBe(true);
      const summary = document.querySelector<HTMLElement>(".pn-tl-body")!;
      expect(summary.style.display).toBe("none");
      document.querySelector<HTMLElement>(".pn-tl-header")!.click();
      expect(summary.style.display).toBe("");
      const toggle = summary.querySelectorAll<HTMLElement>(".pn-tl-line")[1];
      toggle.click();
      expect(day.style.display).toBe("none");
      toggle.click();
    }
    if (view === "legend") document.querySelectorAll<HTMLElement>(".pn-tl-line")[1].click();
    expect(day.style.display).toBe("");
    const player7 = day.querySelector('[data-player="7"]')!;
    expect(Array.from(player7.querySelectorAll(".action"), (a) => a.querySelectorAll(".voter").length))
      .toEqual(view === "classic" ? [2, 3, 6] : [1, 2, 3, 6]);
    expect(Array.from(player7.querySelectorAll(".action")).at(-1)?.getAttribute("data-tip"))
      .toBe("Переголосование 2 за №7");
    expect(!!player7.querySelector(".pn-tour-label")).toBe(view !== "classic");
  });

  test("попил: бюллетень отдельно от числовых туров и не становится голосом за №1", () => {
    start("hints", 598995);
    fireGameData(match598995);
    pickView("table");
    pickDay(4);
    expect(full().querySelector(".pn-mr-outcome")?.textContent).toBe("Подъём: ушли №4, №5");
    const ballot = full().querySelector(".pn-mr-lift")!;
    expect(ballot.textContent).toMatch(/Поднимаем всех\?.*За — 6.*Против — 0/s);
    expect(full().querySelectorAll("tbody tr")).toHaveLength(3);
  });

  test("выбыл по голосам один игрок, дисквалифицирован другой — итоги не смешиваются", () => {
    start();
    const data = {
      ...match673463.data,
      players: match673463.data.players.map((p) => p.position === 8
        ? { ...p, disqual: { day: 2, type: "speech" } } : p),
    };
    fireGameData({ ...match673463, data });
    const statuses = full().querySelectorAll(".pn-mr-day[open] summary .pn-mr-outcome");
    expect(Array.from(statuses, (el) => el.textContent)).toEqual(["Ушёл №7 · 6:3", "Дисквалификация: №8"]);
  });

  test("быстрый демонтаж и повторный монтаж таблицы — разбор восстанавливается", () => {
    start();
    fireGameData(match673463);
    const flush = vi.mocked(onDomChange).mock.lastCall![0];
    const native = document.querySelector(".game-stats-table")!;
    const replacement = native.cloneNode(true);
    native.remove();
    flush([]); // Vue снял таблицу; пришёл проход наблюдателя, якоря ещё нет.
    expect(full()).toBeNull();
    vi.advanceTimersByTime(250);
    document.body.append(replacement);
    flush([]); // Vue смонтировал замену. Других DOM-изменений ждать нельзя.
    vi.advanceTimersByTime(600);
    expect(host()?.nextElementSibling).toBe(replacement);
    expect(document.querySelectorAll(".pn-match-review")).toHaveLength(1);
  });

  test("таблица вернулась перед дедлайном ожидания, но после последнего тика", () => {
    const setIntervalBeforeSpy = globalThis.setInterval;
    const jitter = vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) =>
      setIntervalBeforeSpy(fn, ms === 500 ? 505 : ms)) as typeof setInterval);
    try {
      start();
      const flush = vi.mocked(onDomChange).mock.lastCall![0];
      const native = document.querySelector(".game-stats-table")!;
      document.dispatchEvent(new CustomEvent("gameDataParsed", { detail: match673463 }));
      native.remove();
      vi.advanceTimersByTime(9700);
      document.body.append(native);
      flush([]);
      expect(full()).toBeNull();
      vi.advanceTimersByTime(300);
      expect(host()?.nextElementSibling).toBe(native);
    } finally {
      jitter.mockRestore();
    }
  });

  test("смена настроек и маршрута не оставляет панель, таймеры или старый разбор", () => {
    start();
    fireGameData(match673463);
    pickView("journal");
    const first = host();
    matchStatsFeature.update!(context("classic"));
    vi.advanceTimersByTime(600);
    expect(first?.isConnected).toBe(false);
    expect(document.querySelector("[data-pn-review-replaced]")).toBeNull();
    expect(full()).toBeNull();
    expect(phaseRows().length).toBeGreaterThan(0);
    matchStatsFeature.update!(context());
    vi.advanceTimersByTime(600);
    expect(document.querySelectorAll(".pn-match-review")).toHaveLength(1);
    expect(full().querySelector('[aria-pressed="true"]')?.textContent).toContain("Журнал");
    matchStatsFeature.update!(context("legend")); // отложенный рендер старого матча
    history.replaceState(null, "", "/match/616168");
    syncMatchStatsRoute("616168");
    vi.advanceTimersByTime(600);
    expect(phaseRows()).toHaveLength(0);
    expect(full()).toBeNull();
    matchStatsFeature.update!(context("hints", false));
    expect(vi.getTimerCount()).toBe(0);
  });
});

afterEach(() => {
  matchStatsFeature.disable();
  clearAllAliases();
  vi.useRealTimers();
});

describe("строки фаз наследуют Vue-scope сайта", () => {
  test("scope копируется на строки И на все ячейки — иначе таблица разваливается", () => {
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx);
    fireGameData();

    const rows = phaseRows();
    expect(rows.length, "строки дня и ночи вставлены").toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.hasAttribute(SCOPE_ATTR), `у строки ${row.dataset.phase} нет scope`).toBe(true);
      const cells = Array.from(row.querySelectorAll<HTMLElement>(".cell"));
      expect(cells.length, "ячейка заголовка + по ячейке на игрока").toBe(3);
      for (const cell of cells) {
        expect(cell.hasAttribute(SCOPE_ATTR), `у ячейки в ${row.dataset.phase} нет scope`).toBe(
          true,
        );
      }
    }
  });

  test("берётся scope СТРОКИ, а не обёртки: у контейнера хеш другого компонента", () => {
    // Живая страница: .game-stats-table несёт scope родителя, а правила
    // .table .row .cell — под своим. Детект «с контейнера» дал бы чужой хеш
    // и тот же самый развал вёрстки, что в жалобе.
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx);
    fireGameData();

    const rows = phaseRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.hasAttribute(SCOPE_ATTR))).toBe(true);
    expect(
      rows.some((r) => r.hasAttribute(PARENT_SCOPE_ATTR)),
      "scope обёртки на строках не нужен — под ним нет правил раскладки",
    ).toBe(false);
  });

  test("scope-ID НЕ зашит в код: другой хеш сайта подхватывается как есть", () => {
    // Ровно та хрупкость, из-за которой баг и родился: жёсткий data-v-1db9d42a
    // умер бы молча при следующем ребилде сайта.
    buildSitePage("data-v-deadbeef");
    matchStatsFeature.enable(ctx);
    fireGameData();

    const rows = phaseRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.hasAttribute("data-v-deadbeef"))).toBe(true);
    expect(rows.some((r) => r.hasAttribute(SCOPE_ATTR)), "старый хеш не выдумываем").toBe(false);
  });

  test("сайт без scoped-стилей: строки строятся, но об этом сказано в лог", () => {
    // Фолбэк-CSS (.table .row[data-pn-stats]) держит раскладку сам, но
    // молчать нельзя: следующий такой скриншот должен объясняться логом.
    buildSitePage(null);
    matchStatsFeature.enable(ctx);
    fireGameData();

    expect(phaseRows().length).toBeGreaterThanOrEqual(2);
    expect(
      vi.mocked(log.warn).mock.calls.some((args) =>
        args.some((a) => String(a).includes("нет Vue-scope")),
      ),
    ).toBe(true);
  });

  test("фолбэк-CSS задаёт строкам flex и ячейкам ширину сайта", () => {
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx);
    fireGameData();

    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .join("\n");
    expect(css).toMatch(/\.table \.row\[data-pn-stats\]\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.table \.row\[data-pn-stats\]\s*>\s*\.cell\s*\{[^}]*min-width:\s*115px/);
  });

  test("ячейка дня не сжимается сильнее соседних (нет inline min-width:0)", () => {
    // Inline-ноль перебивал сайтовые 115px: на узком экране наши колонки
    // разъезжались с шапкой (найдено при разборе жалобы 07.08.2026).
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx);
    fireGameData();

    const dayCells = Array.from(
      document.querySelectorAll<HTMLElement>('.row[data-phase^="day"] .cell.player'),
    );
    expect(dayCells.length).toBeGreaterThan(0);
    for (const cell of dayCells) {
      expect(cell.style.minWidth, "min-width остаётся за CSS сайта").toBe("");
      expect(cell.style.display, "раскладка чипов внутри ячейки — наша").toBe("flex");
    }
  });
});

describe("ники в разборе ведут в профиль игрока", () => {
  const links = (): HTMLAnchorElement[] =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a.pn-profile-link"));

  test("ссылка ставится по позиции ячейки, а не по одному лишь тексту", () => {
    // Позиция уникальна всегда, ник — нет. В таблице два игрока с ником «a»:
    // по тексту оба уехали бы в ОДИН профиль, что и есть тихое враньё.
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx as never);
    fireGameData();
    const hrefs = links()
      .filter((a) => a.textContent === "a")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/profile/111", "/profile/222"]);
  });

  test("без атрибута позиции выручает ник", () => {
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx as never);
    fireGameData();
    const byName = links().find((a) => a.textContent === "b");
    expect(byName?.getAttribute("href")).toBe("/profile/222");
  });

  test("повторная отрисовка НИЧЕГО не пишет в DOM", () => {
    // Таблицу перерисовывает Vue, а наш подписчик пишет снова. Считать узлы
    // мало: пересоздание ссылки даёт то же их число, но будит наблюдатель на
    // каждом проходе — это и есть петля из §4 п.1. Сторожим тождество узла.
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx as never);
    fireGameData();
    const first = links()[0];
    fireGameData();
    expect(links()).toHaveLength(3);
    expect(links()[0], "узел обязан быть ТЕМ ЖЕ").toBe(first);
    expect(document.querySelectorAll("a.pn-profile-link a")).toHaveLength(0);
  });

  test("игрок без валидного id ссылкой не становится", () => {
    // Данные матча приходят с сайта: у гостя или битой записи id может не
    // быть вовсе, и «/profile/undefined» вело бы в никуда.
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx as never);
    document.dispatchEvent(
      new CustomEvent("gameDataParsed", {
        detail: {
          ...GAME_DATA,
          data: {
            ...GAME_DATA.data,
            players: [
              { position: 1, role: 1, username: "a", player: null },
              { position: 2, role: 2, username: "b", player: 222 },
            ],
          },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(links().map((a) => a.getAttribute("href"))).toEqual(["/profile/222", "/profile/222"]);
  });

  test("значки сайта в ячейке не уничтожаются ссылкой", () => {
    // Рядом с ником сайт рисует значки (подписка, prime, twitch). Прежняя
    // версия делала cell.textContent = "" и сносила их молча.
    buildSitePage(SCOPE_ATTR);
    const cell = document.querySelector<HTMLElement>('.cell.username[data-player="1"]')!;
    cell.innerHTML = 'a <img class="site-icon" src="x.svg">';
    matchStatsFeature.enable(ctx as never);
    fireGameData();
    expect(cell.querySelector("img.site-icon"), "значок обязан уцелеть").not.toBeNull();
    expect(cell.querySelector("a.pn-profile-link img.site-icon"), "и уехать внутрь ссылки").not.toBeNull();

    matchStatsFeature.disable();
    expect(cell.querySelector("img.site-icon"), "и вернуться при выключении").not.toBeNull();
    expect(cell.querySelector("a.pn-profile-link")).toBeNull();
  });

  test("выключение фичи возвращает ячейкам обычный текст", () => {
    buildSitePage(SCOPE_ATTR);
    matchStatsFeature.enable(ctx as never);
    fireGameData();
    expect(links().length).toBeGreaterThan(0);
    matchStatsFeature.disable();
    expect(links()).toHaveLength(0);
    const cell = document.querySelector<HTMLElement>('.cell.username[data-player="1"]');
    expect(cell?.textContent).toBe("a");
  });
});
