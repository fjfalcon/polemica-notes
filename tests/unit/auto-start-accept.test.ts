// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  // У auto-start НЕСКОЛЬКО подписчиков (принятие + игровая страница) —
  // держим всех и дёргаем всех, как это делает настоящий наблюдатель.
  subs: [] as Array<(muts: Array<{ addedNodes: unknown[] }>) => void>,
}));
vi.mock("@core/dom", () => ({
  onDomChangeImmediate: (fn: (muts: MutationRecord[]) => void) => {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  },

  onDomChange: vi.fn((cb: (muts: Array<{ addedNodes: unknown[] }>) => void) => {
    seam.subs.push(cb);
    return () => {
      seam.subs = seam.subs.filter((s) => s !== cb);
    };
  }),
  safeClick: vi.fn(() => true),
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/env", () => ({
  browser: {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    runtime: { id: "x", getManifest: () => ({ version: "9.3.1" }) },
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
const fakerSeam = vi.hoisted(() => ({ faked: false }));
vi.mock("@content/features/role-faker", () => ({
  isRoleFaked: () => fakerSeam.faked,
}));
vi.mock("@core/keyboard", () => ({
  keyboard: { register: vi.fn(() => () => {}), registerHold: vi.fn(() => () => {}), observe: vi.fn(() => () => {}) },
}));

import {
  autoStartFeature,
  hidesRolesByDay,
  shouldRehideAfterPeek,
} from "@content/features/auto-start";
import { keyboard } from "@core/keyboard";
import { pinOwnRole, releasePins } from "@content/role-pin";
import { safeClick } from "@core/dom";
import { log } from "@core/log";
import type { Settings } from "@shared/types";

const ctx = {
  settings: {
    auto_accept_enabled: true,
    skip_start_screen_enabled: true,
  } as unknown as Settings,
};

const warnHas = (needle: string) =>
  vi.mocked(log.warn).mock.calls.some((args) => args.some((a) => String(a).includes(needle)));
const infoCount = (needle: string) =>
  vi.mocked(log.info).mock.calls.filter((args) => args.some((a) => String(a).includes(needle)))
    .length;

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  // Не с нуля: бэкофф после кликов игрока сравнивает Date.now() с нулём.
  vi.setSystemTime(new Date(1_800_000_000_000));
});

afterEach(() => {
  autoStartFeature.disable();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("автопринятие: принятый блок — путь успеха, а не отказа", () => {
  test("блок БЕЗ cursor-pointer (уже принят) не кликается и не сжигает бюджет", () => {
    // Лог 04.08.2026: «3 клика по цели карточка не дали результата» за 1.7 с
    // при УСПЕШНОМ принятии. Принятый блок остаётся в DOM («Готовы: N/10»),
    // cursor-pointer сайт держит ровно до принятия — клики по принятому
    // лишь врали терминальным warn в лог поддержки.
    document.body.innerHTML = `
      <div class="p-play__profile-panel"><div class="p-play-profile__wr">
        <div class="p-play__profile-game p-play__profile-accept">
          <div class="p-play__profile-accept-timer">0:22</div>
          Готовы: 7/10
        </div>
      </div></div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(4_500); // четыре тика интервала
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
    expect(warnHas("не дали результата"), "warn на пути успеха запрещён").toBe(false);
  });

  test("блок С cursor-pointer (ещё не принят) кликается как раньше", () => {
    document.body.innerHTML = `
      <div class="p-play__profile-panel"><div class="p-play-profile__wr">
        <div class="p-play__profile-game p-play__profile-accept cursor-pointer">
          <div class="p-play__profile-accept-timer">0:22</div>
          Принять игру
        </div>
      </div></div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(1_100);
    expect(vi.mocked(safeClick)).toHaveBeenCalled();
  });
});

describe("PERF-3: единый планировщик сканов принятия", () => {
  test("наблюдатель и интервал не дают второго скана внутри 250 мс", () => {
    // Раньше это были независимые пути: наблюдатель кликал через 250 мс от
    // мутации, интервал — сам по себе; в худшем случае двойной скан (и
    // двойной клик) внутри одного окна.
    document.body.innerHTML = `
      <div class="p-play__profile-panel"><div class="p-play-profile__wr">
        <div class="p-play__profile-game p-play__profile-accept cursor-pointer">Принять игру</div>
      </div></div>`;
    autoStartFeature.enable(ctx);
    vi.mocked(safeClick).mockClear();

    // Шквал: три «мутации» подряд + тик интервала внутри того же окна.
    const fire = () => seam.subs.forEach((s) => s([{ addedNodes: [document.createElement("div")] }]));
    fire();
    fire();
    fire();
    vi.advanceTimersByTime(260);
    expect(vi.mocked(safeClick).mock.calls.length, "ровно один скан за окно").toBe(1);

    vi.advanceTimersByTime(1_100); // следующий интервал-тик — новый скан легитимен
    expect(vi.mocked(safeClick).mock.calls.length).toBe(2);
  });
});

describe("стартовое окно: один клик на попытку", () => {
  test("кнопка и текстовый дубль — клик ровно один, по кнопке", () => {
    // Лог 04.08.2026: «клик по кнопке» и «клик по тексту» одной миллисекундой
    // — окно получало два синтетических клика подряд. Текстовая ветка — это
    // фолбэк для окна без <button>, а не второй клик.
    document.body.innerHTML = `
      <div class="common-room-modal">
        <p>Добро пожаловать</p>
        <button>НАЧАТЬ ИГРУ</button>
        <div class="button">НАЧАТЬ ИГРУ</div>
      </div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(1_100);
    expect(infoCount("клик по кнопке")).toBe(1);
    expect(infoCount("клик по тексту"), "текстовый дубль запрещён").toBe(0);
    expect(vi.mocked(safeClick), "safeClick — путь текстовой ветки").not.toHaveBeenCalled();
  });

  test("выключенная кнопка не съедает попытку — текстовый фолбэк спасает", () => {
    // Ранний return кнопочной ветки глушит фолбэк: без фильтра !disabled
    // клик по мёртвой кнопке молча съедал бы попытку целиком.
    document.body.innerHTML = `
      <div class="common-room-modal">
        <p>Добро пожаловать</p>
        <button disabled>НАЧАТЬ ИГРУ</button>
        <div class="button">НАЧАТЬ ИГРУ</div>
      </div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(1_100);
    expect(infoCount("клик по кнопке")).toBe(0);
    expect(infoCount("клик по тексту")).toBe(1);
  });

  test("текст «Принять игру» внутри ПРИНЯТОГО блока не кликается (симметрия фильтра)", () => {
    // Сегодня принятая карточка меняет подпись, но защита текстового пути
    // не должна держаться на подписи сайта.
    history.replaceState(null, "", "/game-search");
    document.body.innerHTML = `
      <div class="p-play__profile-panel"><div class="p-play-profile__wr">
        <div class="p-play__profile-game p-play__profile-accept">
          <div class="animation-on-active-child">Принять игру</div>
        </div>
      </div></div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(2_200);
    expect(vi.mocked(safeClick)).not.toHaveBeenCalled();
  });

  test("окно без <button> — текстовый фолбэк работает", () => {
    document.body.innerHTML = `
      <div class="common-room-modal">
        <p>Добро пожаловать</p>
        <div class="button">НАЧАТЬ ИГРУ</div>
      </div>`;
    autoStartFeature.enable(ctx);
    vi.advanceTimersByTime(1_100);
    expect(infoCount("клик по тексту")).toBe(1);
    expect(vi.mocked(safeClick)).toHaveBeenCalledTimes(1);
  });
});

describe("подсматривание ролей: возврат скрытия (самопроверка 12.08.2026)", () => {
  test("клавиша скрытия не действует во время подсматривания — и говорит об этом", () => {
    // Обе клавиши трогают одно и то же скрытие. Нажатие D под зажатым V
    // ушло бы в ветку «игрок сам показал роли» и перевернуло бы учёт.
    const kb = vi.mocked(keyboard);
    autoStartFeature.enable({ settings: { auto_hide_roles_enabled: true } } as never);
    const holdCall = kb.registerHold.mock.calls.at(-1);
    const roleKeyCall = kb.register.mock.calls.find((c) => c[0] === "KeyD");
    expect(holdCall, "клавиша подсматривания зарегистрирована").toBeTruthy();
    expect(roleKeyCall, "клавиша скрытия зарегистрирована").toBeTruthy();

    // Скрытие ставится не мгновенно, а первым тиком интервала — без него
    // подсматривать нечего, и гейт не сработал бы по другой причине.
    vi.advanceTimersByTime(1_100);
    expect(document.getElementById("polemica-role-hide"), "роли скрыты").not.toBeNull();

    (holdCall![1] as () => void)();
    vi.mocked(log.info).mockClear();
    // Событие с шпионом (№10, adversarial): прежний вызов без события не
    // проверял, что нативный D сайта тоже глушится — грепа обходилась
    // stopPropagation'ом СОСЕДНЕЙ ветки.
    const peekEvt = new KeyboardEvent("keydown", { code: "KeyD", cancelable: true });
    const peekStop = vi.spyOn(peekEvt, "stopPropagation");
    (roleKeyCall![1] as (e?: KeyboardEvent) => void)(peekEvt);
    expect(peekStop, "нативный D сайта не должен переключить #stop под V").toHaveBeenCalled();
    expect(
      vi.mocked(log.info).mock.calls.some((args) =>
        args.some((a) => String(a).includes("не действует, пока удерживается")),
      ),
      "молчаливое бездействие человек читает как поломку",
    ).toBe(true);
    (holdCall![2] as () => void)();
    autoStartFeature.disable();
  });

  test("после отпускания возвращаем РОВНО то скрытие, что было (21.10.2026)", () => {
    // Решение не по «роли сейчас видны»: во время удержания они видны по
    // определению, и сверка с DOM успевала записать «показаны» — отпускание
    // тогда ничего не прятало, и роль уезжала в эфир. Без настроек скрытия
    // тоже возвращаем: снятым мог быть страховочный CSS.
    expect(shouldRehideAfterPeek({ nightShowDue: false, nightSceneSafe: true })).toBe(true);
    expect(shouldRehideAfterPeek({ nightShowDue: false, nightSceneSafe: false })).toBe(true);
  });

  test("ночной показ положен: не прячем только на ночной сцене эфира", () => {
    // На ночной сцене спрятать, чтобы показ тут же открыл, — мигание.
    expect(shouldRehideAfterPeek({ nightShowDue: true, nightSceneSafe: true })).toBe(false);
    // Эфир ещё на дневной сцене — прятать обязательно (прежде ночью с
    // автосменой не прятали вовсе — роли оставались на дневной сцене).
    expect(shouldRehideAfterPeek({ nightShowDue: true, nightSceneSafe: false })).toBe(true);
  });

  test("автосмена работает САМА, без авто-скрытия (просьба Ильи 12.08.2026)", () => {
    // Раньше тумблер автосмены в одиночку не делал ничего: код гейтил его
    // авто-скрытием. Днём прячем, ночью показываем — и с одной настройкой.
    expect(hidesRolesByDay({ autoHideRoles: false, rolePhaseSwitch: true })).toBe(true);
    expect(hidesRolesByDay({ autoHideRoles: true, rolePhaseSwitch: false })).toBe(true);
    expect(hidesRolesByDay({ autoHideRoles: false, rolePhaseSwitch: false })).toBe(false);
  });
});

describe("автосмена ролей без авто-скрытия (просьба Ильи 12.08.2026)", () => {
  /** Комната с явной фазой: сайт вешает класс на body. */
  function roomWithPhase(phase: "day" | "night"): void {
    document.body.className = phase;
    document.body.innerHTML = `
      <div class="player my-player">
        <span class="player__role role my-role red"><svg><use href="#sheriff"></use></svg></span>
      </div>`;
  }

  test("днём роли прячутся, хотя авто-скрытие выключено", () => {
    // Раньше тумблер автосмены в одиночку не делал НИЧЕГО: код гейтил его
    // авто-скрытием, и человек считал настройку сломанной.
    roomWithPhase("day");
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: true },
    } as never);
    // Фазовая проверка идёт через интервал + отложенный разбор — даём обоим.
    vi.advanceTimersByTime(2_500);
    expect(document.getElementById("polemica-role-hide"), "днём скрыто").not.toBeNull();
    autoStartFeature.disable();
  });

  test("обе выключены — не трогаем роли вовсе", () => {
    roomWithPhase("day");
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
    } as never);
    vi.advanceTimersByTime(2_500);
    expect(document.getElementById("polemica-role-hide")).toBeNull();
    autoStartFeature.disable();
  });
});

describe("inline-слой подчиняется фазе (жалоба Ильи 03.09.2026: «ночью проверки нет, V не работает»)", () => {
  function nightRoomWithInlineHiddenRole(): HTMLElement {
    document.body.className = "night";
    document.body.innerHTML = `
      <div class="player my-player">
        <span class="player__role role my-role red"><svg><use href="#sheriff"></use></svg></span>
      </div>`;
    const role = document.querySelector<HTMLElement>(".my-role")!;
    // Inline-скрытие, как его пишут вход в игру и возврат после peek. БЕЗ
    // display (21.10.2026): display:none — флаг сайта, наш слой его не пишет.
    role.style.visibility = "hidden";
    role.style.opacity = "0";
    return role;
  }

  test("ночной автопоказ снимает и INLINE-слой, а не только CSS с нативом", () => {
    // Роль ночью оставалась скрытой inline'ом: показ снимал CSS и натив,
    // верификация проверяла только #stop — inline-скрытая роль считалась
    // показанной, ретрай молчал.
    const role = nightRoomWithInlineHiddenRole();
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: true },
    } as never);
    // Интервал фазы (~1с) + night-show (3с) + верификация (0.5с).
    vi.advanceTimersByTime(6_000);
    expect(role.style.visibility, "inline снят — проверки ночью видны").not.toBe("hidden");
    expect(role.style.opacity).not.toBe("0");
    autoStartFeature.disable();
  });

  test("отпускание V ночью НЕ возвращает inline-скрытие (решение за фазовой логикой)", () => {
    const role = nightRoomWithInlineHiddenRole();
    autoStartFeature.enable({
      settings: {
        auto_hide_roles_enabled: true,
        role_phase_auto_switch_enabled: true,
        hotkey_role_peek: "KeyV", // без явной клавиши bindPeekKey не привяжется
      },
    } as never);
    vi.advanceTimersByTime(2_500); // фаза «ночь» распознана до отпускания
    const kb = keyboard as unknown as { registerHold: ReturnType<typeof vi.fn> };
    const holdCall = kb.registerHold.mock.calls.at(-1)!;
    (holdCall[1] as () => void)(); // зажали V: peek поднимает inline
    expect(role.style.visibility, "во время удержания роль видна").not.toBe("hidden");
    (holdCall[2] as () => void)(); // отпустили
    expect(
      role.style.visibility,
      "ночью с автосменой inline не возвращается — иначе каждый отпуск гасил роль",
    ).not.toBe("hidden");
    autoStartFeature.disable();
  });

  test("днём отпускание V честно возвращает inline-скрытие (регресс-страж)", () => {
    document.body.className = "day";
    document.body.innerHTML = `
      <div class="player my-player">
        <span class="player__role role my-role red"><svg><use href="#sheriff"></use></svg></span>
      </div>`;
    const role = document.querySelector<HTMLElement>(".my-role")!;
    role.style.visibility = "hidden"; // наш inline-слой (не display — он сайта)
    autoStartFeature.enable({
      settings: {
        auto_hide_roles_enabled: true,
        role_phase_auto_switch_enabled: true,
        hotkey_role_peek: "KeyV",
      },
    } as never);
    vi.advanceTimersByTime(2_500); // фаза «день» распознана
    const kb = keyboard as unknown as { registerHold: ReturnType<typeof vi.fn> };
    const holdCall = kb.registerHold.mock.calls.at(-1)!;
    (holdCall[1] as () => void)();
    (holdCall[2] as () => void)();
    expect(role.style.visibility, "днём скрытие возвращается").toBe("hidden");
    autoStartFeature.disable();
  });

  test("D-показ из-под CSS снимает и inline", () => {
    const role = nightRoomWithInlineHiddenRole();
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false },
    } as never);
    vi.advanceTimersByTime(1_100); // CSS-скрытие встало
    const kb = keyboard as unknown as { register: ReturnType<typeof vi.fn> };
    const roleKeyCall = kb.register.mock.calls.find((c) => c[0] === "KeyD")!;
    (roleKeyCall[1] as (e?: KeyboardEvent) => void)(
      new KeyboardEvent("keydown", { code: "KeyD", cancelable: true }),
    );
    expect(document.getElementById("polemica-role-hide"), "CSS снят").toBeNull();
    expect(
      role.style.visibility,
      "inline снят тем же нажатием — D работает с первого раза",
    ).not.toBe("hidden");
    autoStartFeature.disable();
  });
});

/**
 * «Одна власть» (решение владельца 21.10.2026): роли видны/скрыты только по
 * нашему CSS. Скрытие сайта (флаг roleDisplay → v-show → inline display:none
 * на каждой роли) нейтрализовано правилом стилей, а решение игрока на сайте
 * принимается в наш слой. Синтетического D сайту больше нет.
 */
describe("одна власть: флаг сайта нейтрализован, его решения — в наш слой", () => {
  /** Стол мафии со скрытым сайтом флагом и сайтовым D (как v-show). */
  function mafiaTableWithSiteFlag(phase: "day" | "night"): {
    own: HTMLElement;
    partner: HTMLElement;
    siteToggles: () => number;
  } {
    document.body.innerHTML = `
      <div class="stage"><div class="substage current">${phase === "night" ? "Ход мафии" : "Речь игрока"}</div></div>
      <div class="player my-player">
        <span class="player__role role my-role mafia"><svg><use href="#mafia"></use></svg></span>
      </div>
      <div class="player">
        <span class="player__role role godfather"><svg><use href="#godfather"></use></svg></span>
      </div>`;
    const own = document.querySelector<HTMLElement>(".my-role")!;
    const partner = document.querySelector<HTMLElement>(".godfather")!;
    let toggles = 0;
    document.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).code !== "KeyD" || (e as KeyboardEvent).ctrlKey) return;
      toggles++;
    });
    // Игрок уже спрятал роли самим сайтом (его D / меню).
    own.style.display = "none";
    partner.style.display = "none";
    return { own, partner, siteToggles: () => toggles };
  }
  /** Видит ли зритель роль: наш CSS-тег и нейтрализатор display сайта. */
  const seen = (el: HTMLElement) =>
    (el.style.display !== "none" || !!document.getElementById("pn-role-display-override")) &&
    !document.getElementById("polemica-role-hide");

  const pressOurD = () => {
    const kb = keyboard as unknown as { register: ReturnType<typeof vi.fn> };
    const roleKeyCall = kb.register.mock.calls.find((c) => c[0] === "KeyD")!;
    (roleKeyCall[1] as (e?: KeyboardEvent) => void)(
      new KeyboardEvent("keydown", { code: "KeyD", cancelable: true }),
    );
  };

  test("скрытие сайта при включении принято в наш CSS; D показывает всё, сайту D не шлём", async () => {
    const { own, partner, siteToggles } = mafiaTableWithSiteFlag("day");
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
    } as never);
    expect(document.getElementById("polemica-role-hide"), "решение сайта принято").not.toBeNull();
    expect([seen(own), seen(partner)]).toEqual([false, false]);
    pressOurD();
    expect([seen(own), seen(partner)], "своя И дон видны вместе").toEqual([true, true]);
    expect(own.style.display, "inline display сайта мы не трогаем (инвариант №13)").toBe("none");
    expect(siteToggles(), "синтетического D сайту больше нет").toBe(0);
    autoStartFeature.disable();
    expect(document.getElementById("pn-role-display-override"), "без нас решает сайт").toBeNull();
  });

  test("V при скрытии сайтом: видно всё вместе, отпустили — всё скрыто вместе", () => {
    const { own, partner, siteToggles } = mafiaTableWithSiteFlag("day");
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_peek: "KeyV" },
    } as never);
    const kb = keyboard as unknown as { registerHold: ReturnType<typeof vi.fn> };
    const holdCall = kb.registerHold.mock.calls.at(-1)!;
    expect((holdCall[1] as () => boolean)(), "подсматривание включилось").toBe(true);
    expect([seen(own), seen(partner)]).toEqual([true, true]);
    (holdCall[2] as () => void)();
    expect([seen(own), seen(partner)], "отпустили — скрыты ОБЕ").toEqual([false, false]);
    expect(siteToggles()).toBe(0);
    autoStartFeature.disable();
  });

  test("ночной автопоказ при скрытии сайтом — видно всё вместе, без D сайту", () => {
    const { own, partner, siteToggles } = mafiaTableWithSiteFlag("night");
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: true },
    } as never);
    vi.advanceTimersByTime(6_000);
    expect([seen(own), seen(partner)]).toEqual([true, true]);
    expect(siteToggles()).toBe(0);
    autoStartFeature.disable();
  });

  test("№5: выключили авто-скрытие под дневным пином — роли стола видны", () => {
    const { partner } = mafiaTableWithSiteFlag("day");
    partner.style.display = "";
    document.querySelector<HTMLElement>(".my-role")!.style.display = "";
    autoStartFeature.enable({
      settings: { auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false },
    } as never);
    pinOwnRole("hidden"); // дневной пин obs-панели
    autoStartFeature.update!({
      settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
    } as never);
    expect(seen(partner), "сокомандник виден").toBe(true);
    releasePins();
    autoStartFeature.disable();
  });

  test("CSS-скрытие прячет и уведомление «Игрок является …» (внешний аудит 21.10.2026)", () => {
    document.body.innerHTML = `<div class="player"><div class="notifications-block player__notifications-block">
      <div class="notification-element roleReveal"><span>Игрок является мафией</span></div></div></div>`;
    autoStartFeature.enable({ settings: { auto_hide_roles_enabled: true } } as never);
    const note = document.querySelector(".roleReveal")!;
    expect(getComputedStyle(note).visibility).toBe("hidden");
    autoStartFeature.disable();
    expect(getComputedStyle(note).visibility).not.toBe("hidden");
  });
});

describe("клавиша скрытия уступает подмене роли (аудит скрытия ролей 29.08.2026, №4)", () => {
  test("D при активном F не снимает CSS и глушит событие для сайта", () => {
    fakerSeam.faked = true;
    try {
      autoStartFeature.enable({ settings: { auto_hide_roles_enabled: true } } as never);
      const kb = keyboard as unknown as { register: ReturnType<typeof vi.fn> };
      const roleKeyCall = kb.register.mock.calls.find((c) => c[0] === "KeyD");
      expect(roleKeyCall).toBeTruthy();
      // Скрытие ставится первым тиком интервала (как в тесте выше).
      vi.advanceTimersByTime(1_100);
      expect(document.getElementById("polemica-role-hide"), "роли скрыты CSS").not.toBeNull();
      const e = new KeyboardEvent("keydown", { code: "KeyD", cancelable: true });
      const stop = vi.spyOn(e, "stopPropagation");
      const prevent = vi.spyOn(e, "preventDefault");
      (roleKeyCall![1] as (e?: KeyboardEvent) => void)(e);
      expect(
        document.getElementById("polemica-role-hide"),
        "CSS на месте: настоящие роли стола не уехали в эфир под фальшивой своей",
      ).not.toBeNull();
      expect(stop, "нативный D сайта тоже не сработает").toHaveBeenCalled();
      expect(prevent, "и default тоже глушится (мутация снимала его молча)").toHaveBeenCalled();
    } finally {
      fakerSeam.faked = false;
      autoStartFeature.disable();
    }
  });
});

describe("peek и пин: source-стражи (№7/№10; поведение пина — в role-pin.test)", () => {
  const src = readFileSync("src/content/features/auto-start.ts", "utf8");

  test("Н6: возврат натива ночью с автосменой перевзводит ночной показ", () => {
    // V, удержанная через переход в ночь дольше night-show, оставляла роль
    // нативно скрытой до ручного D: показ отработал ПОД клавишей, а
    // applyRolePhase его не перевзводит (фаза не менялась).
    const stopStart = src.indexOf("function stopPeek");
    const body = src.slice(stopStart, src.indexOf("function bindPeekKey"));
    // Поведенчески — в role-visibility-fuzz («V держали через смену на ночь»).
    expect(body).toMatch(/showAllRoles\(\)/);
    expect(body).toMatch(/nightShowDue\(\)/);
  });

  test("№7: peek поднимает пин через владельца, а не срывом стилей", () => {
    const start = src.indexOf("function startPeek");
    const body = src.slice(start, src.indexOf("function stopPeek"));
    expect(body).toMatch(/liftPins\(\)/);
    const stopBody = src.slice(src.indexOf("function stopPeek"), src.indexOf("function bindPeek"));
    expect(stopBody, "возврат пина при отпускании").toMatch(/restoreLiftedPins\(\)/);
  });

  test("№7: запинённый узел не считается «нашим inline» и не попадает в снимки", () => {
    expect(src).toMatch(/!isPinnedElement\(el\)/);
    const remember = src.slice(
      src.indexOf("function rememberRoleInlineState"),
      src.indexOf("function applyInlineRoleVisibility"),
    );
    expect(remember).toMatch(/isPinnedElement\(el\)\) return/);
  });

  test("№10: D во время peek глушится и для сайта", () => {
    const start = src.indexOf("function handleRoleKey");
    const body = src.slice(start, src.indexOf("if (isRoleFaked())", start));
    expect(body).toMatch(/if \(peeking\) \{[\s\S]*stopPropagation/);
  });
});
