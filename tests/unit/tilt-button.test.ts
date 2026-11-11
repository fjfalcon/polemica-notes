// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
/**
 * «У меня тильт» на странице поиска (11.11.2026): кнопка за «Профилем» в
 * карточке, окно с упражнениями; вставка идемпотентна, окно закрывается
 * крестиком, кликом мимо и Esc, и останавливает упражнения.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { apply, closeModal, openModal, tiltButtonFeature, TILT_BUTTON_CLASS } from "@content/features/tilt-button";

const card = (withProfile = true) =>
  `<div class="p-play__profile-content"><div class="p-play__profile-main">` +
  `<div class="p-play__profile-info"><div class="p-play__profile-name">fj</div></div>` +
  (withProfile ? `<button class="p-play__profile-btn" type="button"><span>Профиль</span></button>` : "") +
  `</div></div>`;

afterEach(() => {
  tiltButtonFeature.disable();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/game-search");
});

describe("кнопка в карточке", () => {
  test("встаёт сразу за «Профилем», один раз", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    apply();
    apply();
    const buttons = document.querySelectorAll(`.${TILT_BUTTON_CLASS}`);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].previousElementSibling?.className).toBe("p-play__profile-btn");
    expect(buttons[0].textContent).toBe("У меня тильт");
  });

  test("без «Профиля» — в конец карточки", () => {
    document.body.innerHTML = card(false);
    tiltButtonFeature.enable({ settings: {} } as never);
    const main = document.querySelector(".p-play__profile-main")!;
    expect(main.lastElementChild?.className).toBe(TILT_BUTTON_CLASS);
  });

  test("не на странице поиска — кнопки нет; выключение убирает", () => {
    window.history.replaceState(null, "", "/profile/1");
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).toBeNull();
    window.history.replaceState(null, "", "/game-search");
    apply();
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).not.toBeNull();
    tiltButtonFeature.disable();
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).toBeNull();
  });
});

describe("окно не мешает игре", () => {
  test("собралась игра («Принять игру») — окно закрывается, кнопка прячется до входа в комнату", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    openModal();
    document.body.insertAdjacentHTML("beforeend", '<div class="p-play__profile-accept">Принять игру</div>');
    apply();
    expect(document.getElementById("pn-tilt-modal")).toBeNull();
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`), "кнопка, чьё окно тут же закрылось бы, не висит").toBeNull();
    document.querySelector(".p-play__profile-accept")!.remove(); // сорвалось — снова поиск
    apply();
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).not.toBeNull();
  });

  test("ушли со страницы поиска — окно закрывается вместе с кнопкой", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    openModal();
    window.history.replaceState(null, "", "/game/5");
    apply();
    expect(document.getElementById("pn-tilt-modal")).toBeNull();
  });

  test("доступность: aria-modal, подпись крестика, фокус в окно и обратно", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    const btn = document.querySelector(`.${TILT_BUTTON_CLASS}`) as HTMLElement;
    btn.focus();
    btn.click();
    expect(document.querySelector(".pn-tilt-box")?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Закрыть");
    closeModal();
    expect(document.activeElement).toBe(btn);
  });

  test("нажатие начато в окне, отпущено на фоне — окно не закрывается", () => {
    openModal();
    const overlay = document.getElementById("pn-tilt-modal")!;
    document.querySelector(".pn-tilt-box")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("pn-tilt-modal")).not.toBeNull();
  });
});

describe("настройки", () => {
  test("подопция «кнопка на сайте» выключена — кнопки нет; включили на лету — есть", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: { tilt_button_enabled: false } } as never);
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).toBeNull();
    tiltButtonFeature.update!({ settings: { tilt_button_enabled: true } } as never);
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).not.toBeNull();
    openModal();
    tiltButtonFeature.update!({ settings: { tilt_button_enabled: false } } as never);
    expect(document.querySelector(`.${TILT_BUTTON_CLASS}`)).toBeNull();
    expect(document.getElementById("pn-tilt-modal"), "окно закрылось вместе с кнопкой").toBeNull();
  });
});

describe("окно упражнений", () => {
  test("клик по кнопке открывает окно с шестью упражнениями", () => {
    document.body.innerHTML = card();
    tiltButtonFeature.enable({ settings: {} } as never);
    (document.querySelector(`.${TILT_BUTTON_CLASS}`) as HTMLElement).click();
    expect(document.getElementById("pn-tilt-modal")).not.toBeNull();
    expect(document.querySelectorAll("#pn-tilt-modal .pn-calm-card")).toHaveLength(6);
    openModal(); // повторно — не второе окно
    expect(document.querySelectorAll("#pn-tilt-modal")).toHaveLength(1);
  });

  test("Esc, крестик и клик мимо закрывают; клик внутри — нет", () => {
    openModal();
    (document.querySelector(".pn-tilt-box") as HTMLElement).click();
    expect(document.getElementById("pn-tilt-modal")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("pn-tilt-modal")).toBeNull();
    openModal();
    (document.querySelector(".pn-tilt-close") as HTMLElement).click();
    expect(document.getElementById("pn-tilt-modal")).toBeNull();
    openModal();
    const overlay = document.getElementById("pn-tilt-modal") as HTMLElement;
    overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    overlay.click();
    expect(document.getElementById("pn-tilt-modal")).toBeNull();
  });

  test("закрытие останавливает таймер упражнения", () => {
    vi.useFakeTimers();
    try {
      openModal();
      // Таймеры окружения (общий наблюдатель DOM дросселирует проход) — до шага.
      const base = vi.getTimerCount();
      (document.querySelector('[data-calm-tool="stop"]') as HTMLElement).click();
      const running = vi.getTimerCount();
      expect(running, "таймер шага идёт").toBe(base + 1);
      closeModal();
      expect(vi.getTimerCount(), "после закрытия таймер шага снят").toBeLessThan(running);
      const title = document.querySelector(".pn-calm-step-title");
      expect(title, "окна нет").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
