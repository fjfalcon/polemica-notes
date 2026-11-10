// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/123" }
/**
 * Действия по цифрам (04.11.2026): клавиша места жмёт кнопку действия на
 * плитке — тот же клик, что мышью, и только разрешённого галочкой действия.
 * Пока на столе кнопки действий, сломанный обработчик цифр сайта (doAction()
 * без действия снимает кнопки) клавишу не получает; без кнопок — получает
 * как есть. Печать в чате, сочетания и автоповтор ничего не нажимают.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  actionKind,
  listActionButtons,
  playerActionKeysFeature,
  seatKey,
} from "@content/features/player-action-keys";
import { keyboard } from "@core/keyboard";
import { DEFAULT_PLAYER_ACTION_KEYS, parsePlayerActionKeys } from "@shared/player-action-keys";
import type { Settings } from "@shared/types";

const LABEL = {
  nominate: "Выставить этого игрока",
  vote: "Проголосовать за этого игрока",
  shot: "Сделать выстрел",
  check: "Раскрыть роль",
  guessMaf: "Мафия",
} as const;

/** Плитка как в бандле: .player.desktop-version → номер player-N → .player__actions → PlayerAction. */
function tile(seat: number, actions: Array<keyof typeof LABEL>, extra = ""): void {
  const buttons = actions
    .map(
      (a) =>
        `<div class="player-action" data-a="${a}"><div class="player-action__content"><img src="x.svg"><span>${LABEL[a]}</span></div></div>`,
    )
    .join("");
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="player desktop-version ${extra}" data-seat="${seat}">` +
      `<div class="player__botleftmenu"><div class="player__info info"><div class="player-number player-${seat - 1}">${seat}</div></div></div>` +
      (buttons ? `<div class="player__actions show-on-hover">${buttons}</div>` : "") +
      "</div>",
  );
}

/** Стол из 10 игроков с одним действием у всех. */
function table(action: keyof typeof LABEL | null): void {
  for (let s = 1; s <= 10; s++) tile(s, action ? [action] : []);
}

const clicks: string[] = [];
let siteKeys: string[] = [];
const siteListener = (e: Event) => siteKeys.push((e as KeyboardEvent).code);
/** Клик по кнопке действия — как обработчик Vue на самой кнопке. */
const clickListener = (e: Event) => {
  const b = (e.target as Element).closest<HTMLElement>(".player-action");
  const t = b?.closest<HTMLElement>(".player");
  if (b && t) clicks.push(`${b.dataset.a}:${t.dataset.seat}`);
};

function press(code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): boolean {
  // key — как у настоящей клавиатуры с NumLock: цифра у Digit/Numpad.
  const key = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1] ?? code;
  return target.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init }));
}

const settings = (over: Partial<Settings> = {}): Partial<Settings> => ({
  player_action_keys_enabled: true,
  player_action_nominate: true,
  player_action_vote: true,
  player_action_shot: false,
  player_action_check: false,
  player_action_keys: DEFAULT_PLAYER_ACTION_KEYS,
  player_action_numpad: true,
  ...over,
});
const ctx = (over: Partial<Settings> = {}) => ({ settings: settings(over) }) as never;

beforeEach(() => {
  document.body.innerHTML = "";
  clicks.length = 0;
  siteKeys = [];
  document.addEventListener("click", clickListener);
  // hotkeys-js сайта слушает keydown на document, всплытием.
  document.addEventListener("keydown", siteListener);
});

afterEach(() => {
  playerActionKeysFeature.disable();
  document.removeEventListener("keydown", siteListener);
  document.removeEventListener("click", clickListener);
  window.history.replaceState(null, "", "/game/123");
});

describe("какие кнопки узнаём", () => {
  test("четыре действия по точной подписи; лучший ход и чужой текст — нет", () => {
    tile(1, ["nominate", "vote", "shot", "check", "guessMaf"]);
    const kinds = Array.from(document.querySelectorAll(".player-action")).map(actionKind);
    expect(kinds).toEqual(["nominate", "vote", "shot", "check", null]);
  });

  test("место — по классу player-N (0-based), а не по порядку плиток", () => {
    tile(7, ["vote"]);
    tile(2, ["vote"]);
    expect(listActionButtons().map((b) => b.seat)).toEqual([7, 2]);
  });

  test("судья (judge-player) в стол не входит", () => {
    tile(3, ["vote"], "judge-player");
    expect(listActionButtons()).toEqual([]);
  });
});

describe("клавиша места", () => {
  test("цифра жмёт кнопку действия своего игрока; 0 — десятый", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    press("Digit3");
    press("Digit0");
    expect(clicks).toEqual(["vote:3", "vote:10"]);
  });

  test("нумпад — те же места; выключили галочку — нумпад ничего не жмёт", () => {
    table("nominate");
    playerActionKeysFeature.enable(ctx());
    press("Numpad4");
    expect(clicks).toEqual(["nominate:4"]);
    playerActionKeysFeature.update!(ctx({ player_action_numpad: false }));
    press("Numpad5");
    expect(clicks).toEqual(["nominate:4"]);
  });

  test("выключенное галочкой действие не нажимается (выстрел по умолчанию выключен)", () => {
    table("shot");
    playerActionKeysFeature.enable(ctx());
    press("Digit2");
    expect(clicks).toEqual([]);
    playerActionKeysFeature.update!(ctx({ player_action_shot: true }));
    press("Digit2");
    expect(clicks).toEqual(["shot:2"]);
  });

  test("переназначенная клавиша работает, прежняя цифра места больше не жмёт", () => {
    table("vote");
    const keys = parsePlayerActionKeys(DEFAULT_PLAYER_ACTION_KEYS);
    keys[0] = "KeyQ";
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(",") }));
    press("KeyQ");
    press("Digit1");
    expect(clicks).toEqual(["vote:1"]);
  });

  test("на плитке несколько действий — жмётся разрешённое, а не первое", () => {
    tile(4, ["shot", "check"]);
    playerActionKeysFeature.enable(ctx({ player_action_check: true }));
    press("Digit4");
    expect(clicks).toEqual(["check:4"]);
  });

  test("переназначение на лету: прежняя клавиша освобождена, новая жмёт", () => {
    table("vote");
    const keys = parsePlayerActionKeys(DEFAULT_PLAYER_ACTION_KEYS);
    keys[0] = "KeyQ";
    // ЛХ выключен: его режимы по умолчанию тоже на Q/W, тест — про места.
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(","), player_action_guess: false }));
    keys[0] = "KeyW";
    playerActionKeysFeature.update!(ctx({ player_action_keys: keys.join(","), player_action_guess: false }));
    press("KeyQ");
    expect(keyboard.isBound("KeyQ")).toBe(false);
    press("KeyW");
    expect(clicks).toEqual(["vote:1"]);
  });

  test("нумпад без NumLock — навигация, а не место: не жмёт и сайту не мешает", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    expect(press("Numpad2", { key: "ArrowDown" })).toBe(true);
    press("Numpad0", { key: "Insert" });
    expect(clicks).toEqual([]);
    expect(siteKeys).toEqual(["Numpad2", "Numpad0"]);
    press("Numpad2", { key: "2" });
    expect(clicks).toEqual(["vote:2"]);
  });

  test("клавиши сайта местам не назначаются даже из хранилища", () => {
    expect(parsePlayerActionKeys("KeyM,KeyV,F5,KeyQ").slice(0, 4)).toEqual(["", "", "", "KeyQ"]);
  });

  test("у игрока нет кнопки (уже выставлен, убит) — ничего", () => {
    tile(1, ["vote"]);
    tile(2, []);
    playerActionKeysFeature.enable(ctx());
    press("Digit2");
    expect(clicks).toEqual([]);
  });
});

describe("цифры сайта", () => {
  test("пока на столе кнопки действий — сайт клавишу не получает (его doAction() снял бы кнопки)", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    press("Digit5");
    expect(siteKeys).toEqual([]);
  });

  test("…в том числе на выключенном действии и на цифре, ставшей не клавишей места", () => {
    table("shot");
    const keys = parsePlayerActionKeys(DEFAULT_PLAYER_ACTION_KEYS);
    keys[0] = "KeyQ";
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(",") }));
    press("Digit2");
    press("Digit1");
    expect(clicks).toEqual([]);
    expect(siteKeys).toEqual([]);
  });

  test("кнопок действий нет — клавиши сайту и браузеру как есть", () => {
    table(null);
    playerActionKeysFeature.enable(ctx());
    expect(press("Digit5")).toBe(true);
    expect(siteKeys).toEqual(["Digit5"]);
  });

  test("вне игровой комнаты — ничего не трогаем", () => {
    window.history.replaceState(null, "", "/profile/1");
    table("vote");
    playerActionKeysFeature.enable(ctx());
    press("Digit5");
    expect(clicks).toEqual([]);
    expect(siteKeys).toEqual(["Digit5"]);
  });
});

describe("случайные нажатия", () => {
  test("печать в чате — не действие", () => {
    table("vote");
    document.body.insertAdjacentHTML("beforeend", '<input id="chat">');
    const chat = document.getElementById("chat")!;
    playerActionKeysFeature.enable(ctx());
    chat.focus();
    press("Digit3", {}, chat);
    expect(clicks).toEqual([]);
  });

  test("Ctrl/Alt/Cmd + цифра — не наша", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    press("Digit3", { ctrlKey: true });
    press("Digit3", { altKey: true });
    press("Digit3", { metaKey: true });
    expect(clicks).toEqual([]);
  });

  test("зажатая клавиша жмёт один раз, автоповторы сайту тоже не уходят", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    press("Digit3");
    press("Digit3", { repeat: true });
    press("Digit3", { repeat: true });
    expect(clicks).toEqual(["vote:3"]);
    expect(siteKeys).toEqual([]);
  });
});

describe("жизненный цикл и соседи", () => {
  test("выключили — клавиши освобождены, сайт получает их снова", () => {
    table("vote");
    playerActionKeysFeature.enable(ctx());
    playerActionKeysFeature.disable();
    press("Digit3");
    expect(clicks).toEqual([]);
    expect(siteKeys).toEqual(["Digit3"]);
    expect(keyboard.isBound("Digit3")).toBe(false);
  });

  test("клавишу другой нашей функции место не отнимает и не обещает", () => {
    const own = vi.fn();
    const off = keyboard.register("Digit4", own);
    try {
      table("vote");
      playerActionKeysFeature.enable(ctx());
      press("Digit4");
      expect(own).toHaveBeenCalledTimes(1);
      expect(clicks).toEqual([]);
      expect(seatKey(4), "подсказка — нумпадом, а не чужой 4").toBe("Numpad4");
      expect(seatKey(5)).toBe("Digit5");
    } finally {
      off();
    }
  });

  test("другая функция отпустила гасящую цифру — фича забирает её обратно на update()", () => {
    table("shot");
    const keys = parsePlayerActionKeys(DEFAULT_PLAYER_ACTION_KEYS);
    keys[0] = "KeyQ";
    playerActionKeysFeature.enable(ctx({ player_action_keys: keys.join(",") }));
    // Выкрик временно взял Digit1 (уже не клавиша места), потом выключен:
    // его off() удаляет код целиком.
    const off = keyboard.register("Digit1", vi.fn());
    off();
    playerActionKeysFeature.update!(ctx({ player_action_keys: keys.join(",") }));
    press("Digit1");
    expect(siteKeys, "сломанная цифра сайта снова глушится").toEqual([]);
  });
});

describe("разбор клавиш из хранилища", () => {
  test("дефолт — 1…9, 0", () => {
    expect(parsePlayerActionKeys(undefined)).toEqual(DEFAULT_PLAYER_ACTION_KEYS.split(","));
    expect(DEFAULT_PLAYER_ACTION_KEYS.split(",")[9]).toBe("Digit0");
  });

  test("мусор и дубли не назначаются: дубль достаётся первому месту", () => {
    const keys = parsePlayerActionKeys("KeyQ,KeyQ,<script>,,Digit5");
    expect(keys.slice(0, 5)).toEqual(["KeyQ", "", "", "", "Digit5"]);
    expect(keys).toHaveLength(10);
  });
});
