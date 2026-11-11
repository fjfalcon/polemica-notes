// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * Подсказка клавиши на кнопке.
 *
 * Подсказка — это обещание («нажми C — выкрикнешь»). Поэтому сторожим не
 * «надпись появилась», а случаи, когда её быть НЕ должно: выключенный хоткей,
 * заблокированная кнопка, чужая страница. Плюс идемпотентность записи: атрибут
 * ставится в узел сайта, и лишняя запись будит общий наблюдатель.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

let domSubscriber: (() => void) | null = null;
vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    domSubscriber = cb;
    return () => {
      domSubscriber = null;
    };
  }),
  isVisible: (el: Element) => !(el as HTMLElement).dataset.hidden,
  safeClick: vi.fn(),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  HINT_ATTR,
  findPauseItem,
  hotkeyHintsFeature,
  keyHintLabel,
} from "@content/features/hotkey-hints";
import { playerActionKeysFeature } from "@content/features/player-action-keys";
import type { Settings } from "@shared/types";

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    settings: {
      outcry_hotkey_enabled: true,
      outcry_hotkey_code: "KeyC",
      pause_hotkey_enabled: true,
      pause_hotkey_code: "F8",
      ...over,
    } as unknown as Settings,
  }) as never;

function room(center: string, menu = ""): void {
  document.body.innerHTML = `
    <div class="controls"><div class="left"></div><div class="center">${center}</div><div class="right"></div></div>
    <div class="base-menu">${menu}</div>`;
}

const hintOf = (sel: string): string | null =>
  document.querySelector<HTMLElement>(sel)?.getAttribute(HINT_ATTR) ?? null;

afterEach(() => {
  hotkeyHintsFeature.disable();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.history.replaceState({}, "", "/game");
});

describe("что подписываем", () => {
  test("кнопка выкрика получает свою клавишу", () => {
    room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(hintOf("#cry")).toBe("C");
    expect(document.getElementById("pn-hotkey-hints"), "стиль обязан быть").not.toBeNull();
  });

  test("пункт «Пауза» получает клавишу паузы", () => {
    room("", '<div class="base-menu__item" id="p">Пауза</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(hintOf("#p")).toBe("F8");
  });

  test("пробел рисуется значком, а не словом", () => {
    // Просьба владельца: на кнопке нужен знак пробела.
    expect(keyHintLabel("Space")).toBe("␣");
    expect(keyHintLabel("KeyC")).toBe("C");
    expect(keyHintLabel("F8")).toBe("F8");
  });

  test("переназначил клавишу — подпись меняется сразу", () => {
    room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx());
    hotkeyHintsFeature.update?.(ctx({ outcry_hotkey_code: "Space" }));
    expect(hintOf("#cry")).toBe("␣");
  });
});

describe("где подписи быть НЕ должно", () => {
  test("хоткей выкрика выключен — обещать нечего", () => {
    room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx({ outcry_hotkey_enabled: false }));
    expect(hintOf("#cry")).toBeNull();
  });

  test("кнопка заблокирована — клавиша не сработает", () => {
    room('<div class="button preset-1 disabled" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(hintOf("#cry")).toBeNull();
  });

  test("пункт паузы заблокирован (пауза уже идёт)", () => {
    room("", '<div class="base-menu__item disabled" id="p">Пауза</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(hintOf("#p")).toBeNull();
  });

  test("похожая подпись — не наш пункт", () => {
    // Только ТОЧНЫЕ подписи: «Продолжить» и «Настройки паузы» кликать нечем.
    room("", '<div class="base-menu__item" id="p">Настройки паузы</div>');
    expect(findPauseItem()).toBeNull();
  });

  test("вне комнаты ни стиля, ни меток", () => {
    window.history.replaceState({}, "", "/match/617128");
    room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(document.getElementById("pn-hotkey-hints")).toBeNull();
    expect(hintOf("#cry")).toBeNull();
  });

  test("кнопка сменила действие — метка снимается", () => {
    // Vue переиспользует узел: был выкрик, стало «Завершите речь». Оставленная
    // подсказка обещала бы выкрик у кнопки конца речи — то есть фол.
    room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
    hotkeyHintsFeature.enable(ctx());
    expect(hintOf("#cry")).toBe("C");

    document.getElementById("cry")!.textContent = "Завершите речь";
    domSubscriber?.();
    expect(hintOf("#cry")).toBeNull();
  });

  test("выключение фичи убирает всё наше", () => {
    room(
      '<div class="button preset-1" id="cry">Выкрикнуть</div>',
      '<div class="base-menu__item" id="p">Пауза</div>',
    );
    hotkeyHintsFeature.enable(ctx());
    hotkeyHintsFeature.disable();
    expect(document.getElementById("pn-hotkey-hints")).toBeNull();
    expect(hintOf("#cry")).toBeNull();
    expect(hintOf("#p")).toBeNull();
  });
});

test("повторный проход НИЧЕГО не пишет в DOM", async () => {
  // Запись будит общий наблюдатель; постоянная запись — это цикл
  // «запись → наблюдатель → запись» (инвариант §4 п.1).
  room('<div class="button preset-1" id="cry">Выкрикнуть</div>');
  hotkeyHintsFeature.enable(ctx());

  const seen: MutationRecord[] = [];
  const observer = new MutationObserver((records) => seen.push(...records));
  observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  for (let i = 0; i < 5; i++) domSubscriber?.();
  await Promise.resolve();
  observer.disconnect();
  expect(seen, "атрибут уже стоит — переписывать его незачем").toHaveLength(0);
});

test("меню закрыто — по документу не ходим", () => {
  // Проход идёт на каждое шевеление DOM. Обход всех `.button, li` комнаты на
  // тик — это тот самый расход, который вычищал перф-аудит 06.08.2026.
  document.body.innerHTML = `
    <div class="controls"><div class="center"></div></div>
    <div class="players">${'<div class="button preset-1">Игрок</div>'.repeat(30)}</div>`;
  hotkeyHintsFeature.enable(ctx());
  // Сторожим ОБА приёмника: обход по документу и обход внутри узла — иначе
  // «искать по всей странице» проходило бы мимо теста (поймано мутантом).
  const onElement = vi.spyOn(Element.prototype, "querySelectorAll");
  const onDocument = vi.spyOn(Document.prototype, "querySelectorAll");
  domSubscriber?.();
  const scanned = [...onElement.mock.calls, ...onDocument.mock.calls].filter((c) =>
    String(c[0]).includes("base-menu__item"),
  );
  expect(scanned, "внутрь пунктов меню лезем только когда меню открыто").toHaveLength(0);
  onElement.mockRestore();
  onDocument.mockRestore();
});

describe("действия по цифрам (04.11.2026)", () => {
  // Подпись — по фактической привязке фичи: фича включается тем же контекстом.
  const enableBoth = (c: never) => {
    playerActionKeysFeature.enable(c);
    hotkeyHintsFeature.enable(c);
  };
  afterEach(() => playerActionKeysFeature.disable());

  /** Плитка с кнопкой действия, как в бандле комнаты. */
  function actionTile(seat: number, label: string): void {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="player desktop-version"><div class="player-number player-${seat - 1}">${seat}</div>` +
        `<div class="player__actions"><div class="player-action"><div class="player-action__content">` +
        `<img src="x.svg"><span id="a${seat}">${label}</span></div></div></div></div>`,
    );
  }
  const keysOn = (over: Record<string, unknown> = {}) =>
    ctx({
      player_action_keys_enabled: true,
      player_action_vote: true,
      player_action_shot: false,
      player_action_keys: "Digit1,Digit2,Digit3,Digit4,Digit5,Digit6,Digit7,Digit8,Digit9,Digit0",
      player_action_numpad: true,
      ...over,
    });

  test("подпись кнопки получает клавишу своего места; десятый — 0", () => {
    actionTile(3, "Проголосовать за этого игрока");
    actionTile(10, "Проголосовать за этого игрока");
    enableBoth(keysOn());
    expect(hintOf("#a3")).toBe("3");
    expect(hintOf("#a10")).toBe("0");
  });

  test("переназначил — подпись новой клавишей; место без клавиши — нумпадом", () => {
    actionTile(1, "Проголосовать за этого игрока");
    actionTile(2, "Проголосовать за этого игрока");
    enableBoth(keysOn({ player_action_keys: "KeyQ,,Digit3" }));
    expect(hintOf("#a1")).toBe("Q");
    expect(hintOf("#a2")).toBe("Num 2");
  });

  test("действие выключено галочкой или фича выключена — клавиша не обещается", () => {
    actionTile(2, "Сделать выстрел");
    actionTile(4, "Проголосовать за этого игрока");
    enableBoth(keysOn());
    expect(hintOf("#a2"), "выстрел выключен").toBeNull();
    expect(hintOf("#a4")).toBe("4");
    hotkeyHintsFeature.update?.(keysOn({ player_action_keys_enabled: false }));
    expect(hintOf("#a4")).toBeNull();
  });

  test("лучший ход не подписываем", () => {
    actionTile(5, "Мафия");
    enableBoth(keysOn({ player_action_nominate: true, player_action_check: true }));
    expect(hintOf("#a5")).toBeNull();
  });
});
