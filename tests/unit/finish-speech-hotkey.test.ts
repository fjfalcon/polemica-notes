// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * «Завершите речь» с клавиши и общая с выкриком клавиша (10.11.2026).
 *
 * Конец речи необратим, выкрик стоит фола. Сторожим: точная подпись, клавиша
 * вне своей речи — обычная буква, общая клавиша жмёт ровно ту кнопку, что
 * сейчас на месте, а при обеих разом — ничего.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clicks: string[] = [];
const domSubs = vi.hoisted(() => [] as Array<() => void>);
vi.mock("@core/dom", () => ({
  safeClick: (el: Element) => {
    clicks.push((el.textContent ?? "").trim());
    return true;
  },
  isVisible: (el: Element) => !(el as HTMLElement).dataset.hidden,
  onDomChange: vi.fn((fn: () => void) => {
    domSubs.push(fn);
    return () => {
      const i = domSubs.indexOf(fn);
      if (i >= 0) domSubs.splice(i, 1);
    };
  }),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { findFinishSpeechButton, finishSpeechHotkeyFeature } from "@content/features/finish-speech-hotkey";
import { outcryHotkeyFeature } from "@content/features/outcry-hotkey";
import { controlKeyCode, FINISH_GUARD_MS, resetFinishGuard } from "@content/features/controls-keys";
import { keyboard } from "@core/keyboard";
import type { Settings } from "@shared/types";

function center(html: string): void {
  document.body.innerHTML = `<div class="controls"><div class="center">${html}</div></div>`;
}
const btn = (label: string, extra = "") => `<div class="button preset-1 ${extra}">${label}</div>`;

let siteKeys: string[] = [];
const siteListener = (e: Event) => siteKeys.push((e as KeyboardEvent).code);
function press(code: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
}
const ctx = (over: Partial<Settings> = {}) =>
  ({
    settings: { outcry_hotkey_code: "KeyC", finish_speech_hotkey_code: "KeyS", ...over },
  }) as never;

beforeEach(() => {
  resetFinishGuard();
  clicks.length = 0;
  siteKeys = [];
  document.addEventListener("keydown", siteListener);
});
afterEach(() => {
  finishSpeechHotkeyFeature.disable();
  outcryHotkeyFeature.disable();
  document.removeEventListener("keydown", siteListener);
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/game/1");
});

describe("кнопка «Завершите речь»", () => {
  test("точная подпись RU/EN; похожий текст и заблокированная — нет", () => {
    center(btn("Завершите речь"));
    expect(findFinishSpeechButton()).not.toBeNull();
    center(btn("End the speech"));
    expect(findFinishSpeechButton()).not.toBeNull();
    center(btn("Завершите речь сейчас"));
    expect(findFinishSpeechButton()).toBeNull();
    center(btn("Завершите речь", "disabled"));
    expect(findFinishSpeechButton()).toBeNull();
  });
});

describe("клавиша конца речи", () => {
  test("в свою речь — жмёт и забирает клавишу у сайта", () => {
    center(btn("Завершите речь"));
    finishSpeechHotkeyFeature.enable(ctx());
    const e = press("KeyS");
    expect(clicks).toEqual(["Завершите речь"]);
    expect(e.defaultPrevented).toBe(true);
    expect(siteKeys).toEqual([]);
  });

  test("вне своей речи — обычная буква: сайт её получает", () => {
    center(btn("Выкрикнуть"));
    finishSpeechHotkeyFeature.enable(ctx());
    const e = press("KeyS");
    expect(clicks).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
    expect(siteKeys).toEqual(["KeyS"]);
  });

  test("вне комнаты — молчит", () => {
    window.history.replaceState(null, "", "/game-search");
    center(btn("Завершите речь"));
    finishSpeechHotkeyFeature.enable(ctx());
    press("KeyS");
    expect(clicks).toEqual([]);
  });

  test("смена клавиши на лету; выключение освобождает", () => {
    center(btn("Завершите речь"));
    finishSpeechHotkeyFeature.enable(ctx());
    finishSpeechHotkeyFeature.update!(ctx({ finish_speech_hotkey_code: "KeyX" }));
    expect(keyboard.isBound("KeyS")).toBe(false);
    press("KeyX");
    expect(clicks).toEqual(["Завершите речь"]);
    finishSpeechHotkeyFeature.disable();
    expect(keyboard.isBound("KeyX")).toBe(false);
  });
});

describe("выкрик и конец речи на одной клавише", () => {
  const shared = { outcry_hotkey_code: "KeyC", finish_speech_hotkey_code: "KeyC" };

  test("своя речь — завершает речь; чужая — выкрикивает", () => {
    outcryHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.enable(ctx(shared));
    center(btn("Выкрикнуть"));
    press("KeyC");
    expect(clicks).toEqual(["Выкрикнуть"]);
    resetFinishGuard();
    center(btn("Завершите речь"));
    press("KeyC");
    expect(clicks).toEqual(["Выкрикнуть", "Завершите речь"]);
    expect(controlKeyCode("finish")).toBe("KeyC");
    expect(controlKeyCode("outcry")).toBe("KeyC");
  });

  test("двойное нажатие: второе после смены кнопки на выкрик — НЕ выкрикивает (фол)", () => {
    vi.useFakeTimers();
    try {
      outcryHotkeyFeature.enable(ctx(shared));
      finishSpeechHotkeyFeature.enable(ctx(shared));
      center(btn("Завершите речь"));
      press("KeyC");
      center(btn("Выкрикнуть")); // сайт сменил кнопку
      vi.advanceTimersByTime(300);
      press("KeyC");
      expect(clicks).toEqual(["Завершите речь"]);
      vi.advanceTimersByTime(FINISH_GUARD_MS);
      press("KeyC");
      expect(clicks, "через паузу — обычный выкрик").toEqual(["Завершите речь", "Выкрикнуть"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("речь кончилась по таймеру, нажатие дошло после смены — не выкрикивает", () => {
    vi.useFakeTimers();
    try {
      outcryHotkeyFeature.enable(ctx(shared));
      finishSpeechHotkeyFeature.enable(ctx(shared));
      expect(domSubs.length, "при общей клавише сторож смотрит DOM").toBe(1);
      center(btn("Завершите речь"));
      domSubs.forEach((f) => f()); // проход наблюдателя увидел конец речи
      vi.advanceTimersByTime(500);
      center(btn("Выкрикнуть"));
      press("KeyC");
      expect(clicks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("тихая речь: последний проход с кнопкой > 2 с назад, смена по таймеру — всё равно не выкрикивает", () => {
    vi.useFakeTimers();
    try {
      outcryHotkeyFeature.enable(ctx(shared));
      finishSpeechHotkeyFeature.enable(ctx(shared));
      center(btn("Завершите речь"));
      domSubs.forEach((f) => f());
      vi.advanceTimersByTime(FINISH_GUARD_MS + 3000); // тишина в DOM
      center(btn("Выкрикнуть")); // таймер кончил речь
      domSubs.forEach((f) => f()); // проход со сменой детей: кнопка исчезла
      vi.advanceTimersByTime(200);
      press("KeyC");
      expect(clicks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("нажатие опередило проход: сторож видел конец речи, а кнопки уже нет — не выкрикивает", () => {
    vi.useFakeTimers();
    try {
      outcryHotkeyFeature.enable(ctx(shared));
      finishSpeechHotkeyFeature.enable(ctx(shared));
      center(btn("Завершите речь"));
      domSubs.forEach((f) => f());
      vi.advanceTimersByTime(FINISH_GUARD_MS + 3000);
      center(btn("Выкрикнуть"));
      press("KeyC"); // прохода ещё не было
      expect(clicks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("разные клавиши — сторожа DOM нет", () => {
    outcryHotkeyFeature.enable(ctx());
    finishSpeechHotkeyFeature.enable(ctx());
    expect(domSubs.length).toBe(0);
  });

  test("клавиша занята другой функцией — не отнимаем; освободилась — берём", () => {
    const foreign = vi.fn();
    const off = keyboard.register("KeyS", foreign);
    center(btn("Завершите речь"));
    finishSpeechHotkeyFeature.enable(ctx());
    press("KeyS");
    expect(foreign).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([]);
    expect(controlKeyCode("finish")).toBe("");
    off();
    finishSpeechHotkeyFeature.update!(ctx()); // любая смена настроек
    press("KeyS");
    expect(clicks).toEqual(["Завершите речь"]);
  });

  test("обе кнопки разом (неизвестное состояние) — не жмёт ничего", () => {
    outcryHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.enable(ctx(shared));
    center(btn("Завершите речь") + btn("Выкрикнуть"));
    press("KeyC");
    expect(clicks).toEqual([]);
  });

  test("выключили конец речи — клавиша остаётся у выкрика", () => {
    outcryHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.disable();
    center(btn("Завершите речь"));
    press("KeyC");
    expect(clicks).toEqual([]);
    center(btn("Выкрикнуть"));
    press("KeyC");
    expect(clicks).toEqual(["Выкрикнуть"]);
    expect(controlKeyCode("finish")).toBe("");
  });

  test("разъехались по разным клавишам — каждая своё", () => {
    outcryHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.enable(ctx(shared));
    finishSpeechHotkeyFeature.update!(ctx({ ...shared, finish_speech_hotkey_code: "KeyS" }));
    center(btn("Завершите речь"));
    press("KeyC");
    press("KeyS");
    expect(clicks).toEqual(["Завершите речь"]);
  });

  test("выкрик без кнопки гасит только действие браузера, как раньше; сайт клавишу получает", () => {
    outcryHotkeyFeature.enable(ctx());
    center(btn("Завершите речь"));
    const e = press("KeyC");
    expect(e.defaultPrevented).toBe(true);
    expect(siteKeys).toEqual(["KeyC"]);
  });
});
