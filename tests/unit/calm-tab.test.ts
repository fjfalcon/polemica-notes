// @vitest-environment jsdom
/**
 * Вкладка «Тильт» (11.11.2026): упражнения для успокоения из fjtilt.
 * Сторожим тайминги дыхания (то, что игрок делает телом) и то, что
 * анимация и таймеры не крутятся, когда вкладка не на экране.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BREATH_PATTERNS, CALM_TOOLS, cycleDuration, phaseAt } from "@shared/calm";
import { CALM_CSS, ensureCalmStyles, mountCalm } from "@core/calm-ui";

describe("дыхание: фазы по времени", () => {
  test("4-7-8: вдох 4 с, задержка 7 с, выдох 8 с, цикл 19 с", () => {
    const p = BREATH_PATTERNS["478"];
    expect(cycleDuration(p)).toBe(19);
    expect(phaseAt(p, 0).phase.label).toBe("Вдох");
    expect(phaseAt(p, 0).secondsLeft).toBe(4);
    expect(phaseAt(p, 4.1).phase.label).toBe("Задержка");
    expect(phaseAt(p, 11.5).phase.label).toBe("Выдох");
    expect(phaseAt(p, 19.2)).toMatchObject({ cycle: 1, index: 0 });
  });

  test("круг: на вдохе растёт, на задержке стоит, на выдохе сжимается", () => {
    const p = BREATH_PATTERNS["478"];
    expect(phaseAt(p, 0).scale).toBeCloseTo(0.45);
    expect(phaseAt(p, 2).scale).toBeGreaterThan(0.45);
    expect(phaseAt(p, 6).scale).toBeCloseTo(1);
    expect(phaseAt(p, 15).scale).toBeLessThan(1);
  });

  test("отрицательное время — начало, а не падение", () => {
    expect(phaseAt(BREATH_PATTERNS.box, -5)).toMatchObject({ index: 0, cycle: 0 });
  });

  test("шесть упражнений, без КПТ и дневников", () => {
    expect(CALM_TOOLS.map((t) => t.id)).toEqual(["breath-478", "breath-box", "breath-sigh", "grounding", "stop", "bodyscan"]);
  });
});

describe("вкладка", () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="panel active" data-panel="tilt" id="calm_panel"></div>';
    root = document.getElementById("calm_panel")!;
    mountCalm(root, () => root.classList.contains("active"));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
  const open = (id: string) => (root.querySelector(`[data-calm-tool="${id}"]`) as HTMLElement).click();
  const back = () => (root.querySelector(".pn-calm-back") as HTMLElement).click();

  test("список из шести карточек; клик открывает упражнение, «Назад» возвращает", () => {
    expect(root.querySelectorAll(".pn-calm-card")).toHaveLength(6);
    open("breath-box");
    expect(root.querySelector(".pn-calm-head-title")?.textContent).toBe("Квадратное дыхание");
    expect(root.querySelector(".pn-calm-chip.pn-calm-on")?.textContent).toBe("Квадратное дыхание");
    back();
    expect(root.querySelectorAll(".pn-calm-card")).toHaveLength(6);
  });

  test("дыхание идёт по кадрам и встаёт на паузу, когда вкладку сменили", () => {
    open("breath-478");
    expect(root.querySelector(".pn-calm-phase")?.textContent).toBe("Вдох");
    vi.advanceTimersByTime(5000);
    expect(root.querySelector(".pn-calm-phase")?.textContent).toBe("Задержка");
    root.classList.remove("active"); // ушли на другую вкладку
    vi.advanceTimersByTime(100);
    expect(root.querySelector(".pn-calm-controls .pn-calm-btn")?.textContent).toBe("Продолжить");
    root.classList.add("active");
    vi.advanceTimersByTime(20000);
    expect(root.querySelector(".pn-calm-phase")?.textContent, "на паузе время не шло").toBe("Задержка");
  });

  test("заземление: 5-4-3-2-1 по кнопке, в конце «Ты здесь и сейчас»", () => {
    open("grounding");
    const nums: string[] = [];
    for (let i = 0; i < 5; i++) {
      nums.push(root.querySelector(".pn-calm-big")!.textContent!);
      (root.querySelector(".pn-calm-next") as HTMLElement).click();
    }
    expect(nums).toEqual(["5", "4", "3", "2", "1"]);
    expect(root.querySelector(".pn-calm-done-title")?.textContent).toBe("Ты здесь и сейчас");
  });

  test("STOP: шаги сменяются по таймеру; «Дальше» пропускает; вне вкладки время стоит", () => {
    open("stop");
    expect(root.querySelector(".pn-calm-step-title")?.textContent).toContain("Stop");
    vi.advanceTimersByTime(5000);
    expect(root.querySelector(".pn-calm-step-title")?.textContent).toContain("Take a breath");
    root.classList.remove("active");
    vi.advanceTimersByTime(30000);
    root.classList.add("active");
    expect(root.querySelector(".pn-calm-step-title")?.textContent).toContain("Take a breath");
    (root.querySelector(".pn-calm-next") as HTMLElement).click();
    expect(root.querySelector(".pn-calm-step-title")?.textContent).toContain("Observe");
  });

  test("скрытая вкладка браузера: после возврата дыхание продолжается с той же точки, а не прыгает", () => {
    // rAF в скрытой вкладке не крутится: кадры приходят с разрывом.
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = null;
    });
    try {
      open("breath-478");
      for (let t = 0; t <= 1000; t += 16) frame!(t); // секунда обычных кадров
      expect(root.querySelector(".pn-calm-phase")?.textContent).toBe("Вдох");
      const count = root.querySelector(".pn-calm-count")?.textContent;
      frame!(31000); // вернулись через 30 с
      expect(root.querySelector(".pn-calm-phase")?.textContent).toBe("Вдох");
      expect(root.querySelector(".pn-calm-count")?.textContent, "разрыв не засчитан").toBe(count);
      expect(root.querySelector(".pn-calm-controls .pn-calm-btn")?.textContent, "не на паузе").toBe("Пауза");
      for (let t = 31016; t <= 32100; t += 16) frame!(t);
      expect(Number(root.querySelector(".pn-calm-count")?.textContent)).toBeLessThan(Number(count));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("стили — один раз на документ, все правила под корнем .pn-calm", () => {
    ensureCalmStyles();
    mountCalm(document.createElement("div"), () => true);
    expect(document.querySelectorAll("#pn-calm-style")).toHaveLength(1);
    const rules = CALM_CSS.trim().split("\n").filter(Boolean);
    expect(rules.every((r) => r.startsWith(".pn-calm")), "CSS не должен задевать страницу сайта").toBe(true);
  });

  test("уход назад останавливает таймер шагов", () => {
    open("bodyscan");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    back();
    expect(vi.getTimerCount(), "таймер шагов снят").toBe(0);
  });
});
