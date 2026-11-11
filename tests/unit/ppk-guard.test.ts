// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/123" }
/**
 * Подтверждение ППК (04.11.2026): запуск ППК из меню игрока и голос «Да» за
 * ППК спрашивают подтверждение; отказ гасит клик ДО обработчика сайта,
 * согласие пропускает тот же клик. Остальное — меню, голосования за фол и
 * исключение, «Нет», меню судьи — не трогаем. Окно, подавленное браузером,
 * не делает ППК невозможным.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@core/toast", () => ({
  showToast: (t: string) => {
    toasts.push(t);
    return true;
  },
}));

import { PPK_CONFIRM_TEXT, ppkClickKind, ppkGuardFeature } from "@content/features/ppk-guard";
import type { FeatureContext } from "@core/feature";

/** Разметка как в бандле комнаты: плитка → меню → section → ul → li. */
function menu(items: Array<string | { html: string }>): HTMLElement[] {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="player"><div class="menu"><div class="menu__container"><section><ul>' +
      items.map((i) => `<li>${typeof i === "string" ? i : i.html}</li>`).join("") +
      "</ul></section></div></div></div>",
  );
  return Array.from(document.querySelectorAll<HTMLElement>(".menu__container li")).slice(-items.length);
}

/** Голосование на плитке обвиняемого (PenaltyVoting). */
function voting(title: string): { yes: HTMLButtonElement; no: HTMLButtonElement } {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="player"><div class="voting"><div class="voting__container">' +
      `<div class="voting__top voting__top-footer"><p class="voting__top-title">${title}</p></div>` +
      '<div class="voting__bottom"><div class="voting__bottom-buttons">' +
      '<button class="voting__bottom-button">Да</button><button class="voting__bottom-button">Нет</button>' +
      "</div></div></div></div></div>",
  );
  const [yes, no] = Array.from(document.querySelectorAll<HTMLButtonElement>(".voting__bottom-button")).slice(-2);
  return { yes, no };
}

/** Клик пользователя; false — клик погашен (preventDefault). */
function userClick(el: Element): boolean {
  return el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

let siteHandler: ReturnType<typeof vi.fn<(e: Event) => void>>;
let confirmSpy: ReturnType<typeof vi.spyOn>;
let clock = 0;

/** Ответ в окне: человек думает секунду; подавленное браузером окно отвечает мгновенно. */
function answer(ok: boolean, ms = 1000): void {
  confirmSpy.mockImplementation(() => {
    clock += ms;
    return ok;
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  toasts.length = 0;
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  siteHandler = vi.fn<(e: Event) => void>();
  confirmSpy = vi.spyOn(window, "confirm");
  answer(false);
  ppkGuardFeature.enable({ settings: {} } as unknown as FeatureContext);
});

afterEach(() => {
  ppkGuardFeature.disable();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/game/123");
});

describe("какие клики узнаём", () => {
  test("«ППК» в меню игрока — запуск; соседние пункты — нет", () => {
    const [foul, kick, ppk] = menu(["Тех. фол игроку", "Исключение игрока", " ППК "]);
    expect(ppkClickKind(ppk)).toBe("start");
    expect(ppkClickKind(foul)).toBeNull();
    expect(ppkClickKind(kick)).toBeNull();
  });

  test("недоступный «ППК» тоже спрашиваем: обработчик сайта висит и на нём (fail-closed)", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="player"><div class="menu"><div class="menu__container"><section><ul><li class="disabled">ППК</li></ul></section></div></div></div>',
    );
    expect(ppkClickKind(document.querySelector("li.disabled"))).toBe("start");
  });

  test("клик по вложенному элементу пункта тоже узнаётся", () => {
    const [ppk] = menu([{ html: "<span>ППК</span>" }]);
    expect(ppkClickKind(ppk.querySelector("span"))).toBe("start");
  });

  test("меню судьи (есть «Фол игроку») — не спрашиваем: у судьи своё подтверждение сайта", () => {
    const [, ppk] = menu(["Фол игроку", "ППК"]);
    expect(ppkClickKind(ppk)).toBeNull();
  });

  test("«ППК» вне меню игрока (например, текст в чате) — не наш клик", () => {
    document.body.innerHTML = "<ul><li>ППК</li></ul>";
    expect(ppkClickKind(document.querySelector("li"))).toBeNull();
  });

  test("«Да» в голосовании за ППК — голос; «Нет» и «Да» в голосовании за фол — нет", () => {
    const ppk = voting("Проголосовать за ППК?");
    const foul = voting("Присудить технический фол?");
    expect(ppkClickKind(ppk.yes)).toBe("vote");
    expect(ppkClickKind(ppk.no)).toBeNull();
    expect(ppkClickKind(foul.yes)).toBeNull();
  });
});

describe("подтверждение", () => {
  test("отказ — клик не доходит до обработчика сайта", () => {
    const [ppk] = menu(["ППК"]);
    ppk.addEventListener("click", siteHandler);
    answer(false);
    expect(userClick(ppk)).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(PPK_CONFIRM_TEXT.start);
    expect(siteHandler).not.toHaveBeenCalled();
  });

  test("согласие — тот же клик проходит к сайту, повторных нажатий нет", () => {
    const [ppk] = menu(["ППК"]);
    ppk.addEventListener("click", siteHandler);
    answer(true);
    expect(userClick(ppk)).toBe(true);
    expect(siteHandler).toHaveBeenCalledTimes(1);
  });

  test("голос «Да» за ППК спрашивает своим текстом; отказ гасит голос", () => {
    const { yes } = voting("Проголосовать за ППК?");
    yes.addEventListener("click", siteHandler);
    answer(false);
    userClick(yes);
    expect(confirmSpy).toHaveBeenCalledWith(PPK_CONFIRM_TEXT.vote);
    expect(siteHandler).not.toHaveBeenCalled();
  });

  test("обычные клики не спрашивают", () => {
    const [foul] = menu(["Тех. фол игроку"]);
    const { no } = voting("Проголосовать за ППК?");
    foul.addEventListener("click", siteHandler);
    no.addEventListener("click", siteHandler);
    userClick(foul);
    userClick(no);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(siteHandler).toHaveBeenCalledTimes(2);
  });

  test("браузер подавил окна (мгновенный отказ) — клик проходит как у сайта, с предупреждением", () => {
    const [ppk] = menu(["ППК"]);
    ppk.addEventListener("click", siteHandler);
    answer(false, 1);
    expect(userClick(ppk)).toBe(true);
    expect(siteHandler).toHaveBeenCalledTimes(1);
    expect(toasts.join(" ")).toContain("запретил");
  });
});

describe("текст сверен с правилами (/rules) — ничего сверх них правилом не называем", () => {
  const texts = Object.values(PPK_CONFIRM_TEXT);

  test("клятва или пари ради доказательства роли — дисквалификация, а не технический фол", () => {
    for (const t of texts) {
      expect(t).toMatch(/дисквалификация — .*клятва или пари ради доказательства роли/);
      expect(t).not.toMatch(/клятв[аы]? — технический фол/);
    }
  });

  test("бан после решённого исхода — практика модерации, а не «по правилам»", () => {
    for (const t of texts) expect(t).toMatch(/модерация банит за ППК после этого/);
  });

  test("репорт — подписью пункта меню игрока в комнате (show_appeal_modal_btn)", () => {
    for (const t of texts) expect(t).toContain("«Отправить репорт»");
  });
});

describe("границы", () => {
  test("вне игровой комнаты не действует", () => {
    window.history.replaceState(null, "", "/profile/1");
    const [ppk] = menu(["ППК"]);
    userClick(ppk);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("выключили в настройках — слушатель снят (симметрия жизненного цикла)", () => {
    ppkGuardFeature.disable();
    const [ppk] = menu(["ППК"]);
    ppk.addEventListener("click", siteHandler);
    userClick(ppk);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(siteHandler).toHaveBeenCalledTimes(1);
  });
});
