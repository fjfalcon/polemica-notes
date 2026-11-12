// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/777" }
/**
 * «А что там в очереди» в игровой комнате (12.11.2026): кнопка в правом ряду
 * контролов сайта, окошко со счётчиками столов; запрос публичный и в очередь
 * не заходит.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const fetchQueueCounts = vi.fn(
  async (_force?: boolean): Promise<Record<string, number>> => ({ standard: 3, polite: 1, prime: 9 }),
);
vi.mock("@core/polemica-api", () => ({ fetchQueueCounts: (f?: boolean) => fetchQueueCounts(f) }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  ROOM_QUEUE_BUTTON_CLASS,
  apply,
  closePopover,
  roomQueueCountsFeature,
} from "@content/features/room-queue-counts";

const controls = () =>
  '<div class="controls"><div class="center"></div><div class="right">' +
  '<div class="button">cam</div><div class="button">mic</div></div></div>';
const button = () => document.querySelector<HTMLButtonElement>(`.${ROOM_QUEUE_BUTTON_CLASS}`);
const pop = () => document.getElementById("pn-room-queue-pop");
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  roomQueueCountsFeature.disable();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/game/777");
  fetchQueueCounts.mockClear();
});

describe("кнопка", () => {
  test("встаёт в правый ряд контролов один раз", () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    apply();
    apply();
    expect(document.querySelectorAll(`.${ROOM_QUEUE_BUTTON_CLASS}`)).toHaveLength(1);
    expect(button()!.parentElement!.className).toBe("right");
    expect(button()!.title).toBe("А что там в очереди?");
  });

  test("ряда нет — кнопки нет (не висит поверх стола); не комната — убрана", () => {
    document.body.innerHTML = "<div></div>";
    roomQueueCountsFeature.enable({ settings: {} } as never);
    expect(button()).toBeNull();
    document.body.innerHTML = controls();
    apply();
    expect(button()).not.toBeNull();
    window.history.replaceState(null, "", "/game-search");
    apply();
    expect(button()).toBeNull();
  });
});

describe("окошко", () => {
  test("клик открывает окошко со счётчиками столов; повторный клик закрывает", async () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    expect(pop()).not.toBeNull();
    await flush();
    const rows = Array.from(pop()!.querySelectorAll(".pn-rqc-row"), (r) => r.textContent);
    expect(rows).toEqual(["Обычный3/10", "Рейтинг1/10", "Prime9/10"]);
    expect(pop()!.querySelector(".pn-rqc-hot")?.textContent, "почти собранный стол подсвечен").toBe("9/10");
    expect(fetchQueueCounts).toHaveBeenCalledWith(false);
    button()!.click();
    expect(pop()).toBeNull();
  });

  test("↻ — свежий запрос в обход кэша", async () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    await flush();
    (pop()!.querySelector(".pn-rqc-refresh") as HTMLElement).click();
    expect(fetchQueueCounts).toHaveBeenLastCalledWith(true);
  });

  test("сайт не ответил — честная надпись, а не нули", async () => {
    fetchQueueCounts.mockRejectedValueOnce(new Error("503"));
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    await flush();
    expect(pop()!.querySelector(".pn-rqc-body")?.textContent).toContain("Сайт не ответил");
  });

  test("Esc, клик мимо и уход из комнаты закрывают", async () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pop()).toBeNull();
    button()!.click();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(pop()).toBeNull();
    button()!.click();
    window.history.replaceState(null, "", "/game-search");
    apply();
    expect(pop()).toBeNull();
    closePopover();
  });

  test("поздний ответ закрытого окна не пишется и окно не воскрешает", async () => {
    let resolve!: (v: Record<string, number>) => void;
    fetchQueueCounts.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    const first = pop()!;
    closePopover();
    resolve({ standard: 5, polite: 0, prime: 0 });
    await flush();
    expect(pop()).toBeNull();
    expect(first.querySelectorAll(".pn-rqc-row"), "в закрытое окно не писали").toHaveLength(0);
  });

  test("ряд контролов ушёл (смерть, конец игры) — окошко закрывается", async () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    document.querySelector(".controls")!.remove();
    apply();
    expect(pop()).toBeNull();
  });

  test("клик внутри окошка его не закрывает", async () => {
    document.body.innerHTML = controls();
    roomQueueCountsFeature.enable({ settings: {} } as never);
    button()!.click();
    await flush();
    pop()!.querySelector(".pn-rqc-row")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(pop()).not.toBeNull();
  });
});
