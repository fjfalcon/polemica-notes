// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/123" }
/**
 * ЛХ по клавишам (10.11.2026). Во время своего лучшего хода — панель режима
 * (пистолет / сердце / корона), клавиши режимов и цифры мест: цифра жмёт на
 * плитке кнопку ЛХ текущего режима. Корона и роли — разные режимы сайта,
 * переключаем его же кнопкой в контролах. «Оставить ЛХ» не жмём.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// jsdom не считает раскладку: «видимость» переключателей режима — по метке.
vi.mock("@core/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/dom")>()),
  isVisible: (el: Element) => !(el as HTMLElement).dataset.hidden,
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  bestMoveKeysActive,
  currentGuessMode,
  guessKind,
  playerActionKeysFeature,
  readModeCodes,
  setGuessMode,
} from "@content/features/player-action-keys";
import { keyboard } from "@core/keyboard";
import { DEFAULT_PLAYER_ACTION_KEYS } from "@shared/player-action-keys";
import type { Settings } from "@shared/types";

const LABEL = {
  guessMaf: "Оставить мафией",
  guessCiv: "Оставить мирным",
  guessVice: "Оставить за главного",
  vote: "Проголосовать за этого игрока",
} as const;
type A = keyof typeof LABEL;

let siteMode: "roles" | "vice" | null = "roles";
/** Идёт ли ЛХ вообще (переключатели в контролах). */
let bestMove = true;

function tile(seat: number, actions: A[]): string {
  const buttons = actions
    .map(
      (a) =>
        `<div class="player-action" data-a="${a}"><div class="player-action__content"><img src="x.svg"><span>${LABEL[a]}</span></div></div>`,
    )
    .join("");
  return (
    `<div class="player desktop-version" data-seat="${seat}">` +
    `<div class="player__botleftmenu"><div class="player__info info"><div class="player-number player-${seat - 1}">${seat}</div></div></div>` +
    (buttons ? `<div class="player__actions">${buttons}</div>` : "") +
    "</div>"
  );
}

/** Стол во время ЛХ в режиме сайта + переключатели режима в центре контролов. */
function render(): void {
  const actions: A[] = siteMode === "vice" ? ["guessVice"] : siteMode === "roles" ? ["guessMaf", "guessCiv"] : [];
  const tiles = Array.from({ length: 10 }, (_, i) => tile(i + 1, actions)).join("");
  // Как сайт: переключатели рисуются, пока есть режимы ЛХ, — и без выбранного.
  const toggles = !bestMove
    ? ""
    : `<div class="button preset-1 ${siteMode === "roles" ? "activated" : "not-activated"}" data-mode="roles">Угадать роли</div>` +
        `<div class="button preset-1 ${siteMode === "vice" ? "activated" : "not-activated"}" data-mode="vice">Оставить за главного</div>`;
  document.body.innerHTML = `${tiles}<div class="controls"><div class="center">${toggles}</div></div>`;
}

const clicks: string[] = [];
let siteKeys: string[] = [];
const siteListener = (e: Event) => siteKeys.push((e as KeyboardEvent).code);
const clickListener = (e: Event) => {
  const el = e.target as Element;
  const mode = el.closest<HTMLElement>("[data-mode]")?.dataset.mode;
  if (mode === "roles" || mode === "vice") {
    clicks.push(`mode:${mode}`);
    // Как сайт: togglePlayerAction — повторный клик по активному снимает режим.
    siteMode = siteMode === mode ? null : mode;
    render();
    return;
  }
  const b = el.closest<HTMLElement>(".player-action");
  const t = b?.closest<HTMLElement>(".player");
  if (b && t) clicks.push(`${b.dataset.a}:${t.dataset.seat}`);
};

function press(code: string): KeyboardEvent {
  const key = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1] ?? code;
  const e = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
}

const settings = (over: Partial<Settings> = {}): Partial<Settings> => ({
  player_action_keys_enabled: true,
  player_action_nominate: true,
  player_action_vote: true,
  player_action_keys: DEFAULT_PLAYER_ACTION_KEYS,
  player_action_numpad: true,
  player_action_guess: true,
  guess_key_maf: "KeyQ",
  guess_key_civ: "KeyW",
  guess_key_vice: "KeyA",
  ...over,
});
const ctx = (over: Partial<Settings> = {}) => ({ settings: settings(over) }) as never;
const panel = () => document.getElementById("pn-best-move-panel");

beforeEach(() => {
  siteMode = "roles";
  bestMove = true;
  clicks.length = 0;
  siteKeys = [];
  document.addEventListener("click", clickListener);
  document.addEventListener("keydown", siteListener);
});
afterEach(() => {
  playerActionKeysFeature.disable();
  document.removeEventListener("click", clickListener);
  document.removeEventListener("keydown", siteListener);
  document.body.innerHTML = "";
});

describe("кнопки ЛХ", () => {
  test("три вида по точной подписи; прочее — нет", () => {
    render();
    const kinds = Array.from(document.querySelectorAll(".player-action")).slice(0, 2).map(guessKind);
    expect(kinds).toEqual(["maf", "civ"]);
    document.body.innerHTML = tile(1, ["guessVice", "vote"]);
    expect(Array.from(document.querySelectorAll(".player-action")).map(guessKind)).toEqual(["vice", null]);
  });

  test("клавиши режимов: мусор и дубли — без клавиши", () => {
    expect(readModeCodes({ guess_key_maf: "KeyQ", guess_key_civ: "KeyQ", guess_key_vice: "<x>" })).toEqual({
      maf: "KeyQ",
      civ: "",
      vice: "KeyA",
    });
  });
});

describe("ЛХ по клавишам", () => {
  test("панель появляется только во время ЛХ и уходит после него", () => {
    document.body.innerHTML = tile(1, ["vote"]);
    playerActionKeysFeature.enable(ctx());
    expect(panel()).toBeNull();
    render();
    playerActionKeysFeature.update!(ctx());
    expect(panel()?.textContent).toContain("Мафия");
    expect(panel()?.textContent).toContain("(Q)");
    siteMode = null;
    bestMove = false;
    document.body.innerHTML = tile(1, ["vote"]);
    playerActionKeysFeature.update!(ctx());
    expect(panel()).toBeNull();
  });

  test("режим по умолчанию — мафия: цифра жмёт «Оставить мафией» на месте", () => {
    render();
    playerActionKeysFeature.enable(ctx());
    expect(currentGuessMode()).toBe("maf");
    press("Digit3");
    expect(clicks).toEqual(["guessMaf:3"]);
    expect(siteKeys, "цифра сайту не ушла").toEqual([]);
  });

  test("W — сердце: цифра жмёт «Оставить мирным»", () => {
    render();
    playerActionKeysFeature.enable(ctx());
    press("KeyW");
    press("Digit0");
    expect(clicks).toEqual(["guessCiv:10"]);
  });

  test("A — корона: переключает режим сайта его кнопкой, цифра жмёт корону", () => {
    render();
    playerActionKeysFeature.enable(ctx());
    press("KeyA");
    expect(clicks).toEqual(["mode:vice"]);
    expect(currentGuessMode()).toBe("vice");
    playerActionKeysFeature.update!(ctx()); // проход панели после перерисовки
    expect(currentGuessMode(), "свой же клик не откатывается сверкой").toBe("vice");
    press("Digit5");
    expect(clicks).toEqual(["mode:vice", "guessVice:5"]);
  });

  test("Q из короны — обратно в роли; активный режим повторно не кликаем (сайт бы его снял)", () => {
    siteMode = "vice";
    render();
    playerActionKeysFeature.enable(ctx());
    expect(currentGuessMode()).toBe("vice");
    press("KeyA");
    expect(clicks, "корона уже активна — переключатель не трогаем").toEqual([]);
    press("KeyQ");
    expect(clicks).toEqual(["mode:roles"]);
    press("Digit2");
    expect(clicks).toEqual(["mode:roles", "guessMaf:2"]);
  });

  test("режим снят повторным кликом: плитки пусты, но панель и клавиши работают", () => {
    siteMode = null;
    render();
    playerActionKeysFeature.enable(ctx());
    expect(panel(), "переключатели на месте — ЛХ идёт").not.toBeNull();
    press("KeyA");
    expect(clicks).toEqual(["mode:vice"]);
    press("Digit4");
    expect(clicks).toEqual(["mode:vice", "guessVice:4"]);
  });

  test("на панели — фактическая клавиша: режим на клавише места клавиши не получает", () => {
    render();
    const keys = DEFAULT_PLAYER_ACTION_KEYS.split(",");
    keys[0] = "KeyQ";
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(",") }));
    expect(panel()?.textContent).not.toContain("(Q)");
    expect(panel()?.textContent).toContain("(W)");
  });

  test("панель прежней копии скрипта пересоздаётся своей", () => {
    render();
    document.body.insertAdjacentHTML("beforeend", '<div id="pn-best-move-panel">старая</div>');
    playerActionKeysFeature.enable(ctx());
    expect(document.querySelectorAll("#pn-best-move-panel")).toHaveLength(1);
    expect(panel()?.textContent).toContain("Мафия");
  });

  test("недоступный режим (переключателей нет) не выбирается", () => {
    render();
    document.querySelector(".controls .center")!.innerHTML = "";
    playerActionKeysFeature.enable(ctx());
    setGuessMode("vice");
    expect(currentGuessMode()).toBe("maf");
  });

  test("вне ЛХ клавиши режимов — обычные буквы для сайта", () => {
    document.body.innerHTML = tile(1, ["vote"]);
    playerActionKeysFeature.enable(ctx());
    const e = press("KeyQ");
    expect(e.defaultPrevented).toBe(false);
    expect(siteKeys).toEqual(["KeyQ"]);
    expect(bestMoveKeysActive()).toBe(false);
  });

  test("клик по режиму на панели переключает так же", () => {
    render();
    playerActionKeysFeature.enable(ctx());
    (panel()!.querySelector('[data-pn-guess="civ"]') as HTMLElement).click();
    expect(currentGuessMode()).toBe("civ");
  });

  test("ЛХ выключен галочкой: ни панели, ни клавиш режимов", () => {
    render();
    playerActionKeysFeature.enable(ctx({ player_action_guess: false }));
    expect(panel()).toBeNull();
    expect(keyboard.isBound("KeyQ")).toBe(false);
    press("Digit3");
    expect(clicks).toEqual([]);
  });

  test("выключение фичи убирает панель и освобождает клавиши режимов", () => {
    render();
    playerActionKeysFeature.enable(ctx());
    expect(panel()).not.toBeNull();
    playerActionKeysFeature.disable();
    expect(panel()).toBeNull();
    expect(keyboard.isBound("KeyA")).toBe(false);
  });

  test("клавиша режима на клавише места не ставится — место главнее", () => {
    render();
    const keys = DEFAULT_PLAYER_ACTION_KEYS.split(",");
    keys[0] = "KeyQ";
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(",") }));
    press("KeyQ");
    expect(clicks).toEqual(["guessMaf:1"]);
  });
});
