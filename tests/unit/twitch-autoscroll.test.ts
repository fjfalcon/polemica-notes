// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/123" }
/**
 * Автоскролл чата (жалоба 15.10.2026, скрин стримера: «↓ 2 нов.», хотя он
 * ничего не листал). Сдвиг прокрутки от САМОЙ вставки длинного сообщения
 * (подрезка окна + scroll anchoring) считался уходом пользователя в
 * историю — автоскролл отключался. Уйти со дна может только человек.
 *
 * Ниже — каркас из соседнего теста системных строк.
 *
 * Жалоба владельца 27.08.2026 (скриншот): «Подключаемся к чату…» и
 * «Подключились к чату» занимали в узкой панели две строки подряд, хотя это
 * начало и конец одного и того же шага. Исход попытки переписывает её строку
 * на месте; события РАЗНЫЕ (отключились, ошибка на живом чате) остаются
 * отдельными — иначе лента врёт про порядок произошедшего.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({ onDomChange: vi.fn(() => () => undefined) }));
vi.mock("@core/env", () => ({
  browser: { storage: { sync: { set: vi.fn(async () => {}) } }, runtime: { id: "x" } },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn(() => () => undefined),
  sendRuntime: vi.fn(async () => ({ success: true })),
}));
vi.mock("@core/selectors", () => ({
  SITE: { playerDesktop: ".pd", playerVideo: ".pv", obsGameControls: ".gc" },
}));
// Каркас панели: настоящий renderBody (его DOM — предмет теста), но без
// перетаскивания, ресайза и localStorage базовой FloatingPanel.
vi.mock("@core/FloatingPanel", () => ({
  FloatingPanel: class {
    root = document.createElement("div");
    header = document.createElement("div");
    body = document.createElement("div");
    isMounted = false;
    private built = false;
    constructor(_opts: unknown) {}
    show(): void {
      if (!this.built) {
        this.built = true;
        this.root.append(this.header, this.body);
        document.body.appendChild(this.root);
        (this as unknown as { renderBody(b: HTMLElement): void }).renderBody(this.body);
      }
      this.isMounted = true;
      this.root.style.display = "";
    }
    hide(): void {
      this.root.style.display = "none";
    }
    unmount(): void {
      this.isMounted = false;
      this.root.remove();
      this.built = false;
    }
    protected addHeaderButton(): HTMLButtonElement {
      const b = document.createElement("button");
      this.header.appendChild(b);
      return b;
    }
    protected enableDrag(): void {}
  },
}));

import type { FeatureContext } from "@core/feature";
import { twitchPanelFeature } from "@content/panels/twitch-panel";
import { sendRuntime } from "@core/messaging";

type Handler = ((e: unknown) => void) | null;

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  onopen: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;
  readyState = 0;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }
  /** Вход в канал подтверждён (366 — конец списка имён). */
  emitJoined(): void {
    this.onmessage?.({ data: ":tmi.twitch.tv 366 justinfan1 #streamer :End of /NAMES list\r\n" });
  }
}

const realWebSocket = globalThis.WebSocket;

function mountGameUi(): void {
  for (let i = 0; i < 10; i++) {
    const tile = document.createElement("div");
    tile.className = "pd";
    document.body.appendChild(tile);
  }
  const controls = document.createElement("div");
  controls.className = "gc";
  document.body.appendChild(controls);
}

const sysLines = (): string[] =>
  [...document.querySelectorAll(".twitch-system-message")].map((el) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

function enableFeature(): FakeWebSocket {
  twitchPanelFeature.enable({
    settings: { twitch_chat_enabled: true, twitch_channel_name: "streamer" },
  } as unknown as FeatureContext);
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

beforeEach(() => {
  sessionStorage.clear();
  FakeWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_800_000_000_000));
  window.history.replaceState(null, "", "/game/123");
  document.body.innerHTML = "";
  mountGameUi();
});

afterEach(() => {
  twitchPanelFeature.disable();
  document.body.innerHTML = "";
  (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
  vi.useRealTimers();
});


import { decideAtBottom } from "@content/panels/twitch-panel";

describe("decideAtBottom", () => {
  test("у дна — всегда «у дна»", () => {
    expect(decideAtBottom({ nearBottom: true, userIntent: false, current: false })).toBe(true);
  });
  test("ушли со дна БЕЗ действия человека — состояние не меняем", () => {
    expect(decideAtBottom({ nearBottom: false, userIntent: false, current: true })).toBe(true);
  });
  test("ушли со дна колесом/касанием/полосой — читаем историю", () => {
    expect(decideAtBottom({ nearBottom: false, userIntent: true, current: true })).toBe(false);
  });
});

/** Геометрия ленты: jsdom вёрстку не считает — строка = 40 px, окно = 200 px. */
function fakeGeometry(el: HTMLElement): { setTop(v: number): void } {
  let top = 0;
  const height = () => el.childElementCount * 40;
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: height });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, height() - 200));
    },
  });
  return { setTop: (v: number) => (top = v) };
}

const privmsg = (text: string) =>
  `@display-name=Viewer :viewer!v@v.tmi.twitch.tv PRIVMSG #streamer :${text}\r\n`;

function newBadge(): string {
  const btns = [...document.querySelectorAll("button")].filter((b) => /нов\./.test(b.textContent ?? ""));
  const b = btns[0] as HTMLElement | undefined;
  return b && b.style.display !== "none" ? (b.textContent ?? "") : "";
}

describe("автоскролл чата", () => {
  test("сдвиг прокрутки от вставки длинного сообщения НЕ отключает автоскролл", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    const el = document.querySelector<HTMLElement>(".twitch-chat-messages")!;
    const geo = fakeGeometry(el);
    for (let i = 0; i < 8; i++) ws.onmessage?.({ data: privmsg(`m${i}`) });
    vi.advanceTimersByTime(50);
    el.scrollTop = el.scrollHeight; // у дна
    // Приходит длинное сообщение; браузер (scroll anchoring) сдвигает
    // прокрутку и шлёт scroll, где до дна больше 24 px — человека нет.
    ws.onmessage?.({ data: privmsg("очень длинное сообщение на три строки") });
    geo.setTop(el.scrollHeight - 200 - 60);
    el.dispatchEvent(new Event("scroll"));
    ws.onmessage?.({ data: privmsg("и ещё одно") });
    vi.advanceTimersByTime(50); // кадр доскролла
    expect(el.scrollTop, "чат докручен до дна").toBe(el.scrollHeight - 200);
    expect(newBadge(), "плашки «N нов.» быть не должно").toBe("");
  });

  test("колесо вверх — честное чтение истории: копим «N нов.», не дёргаем вниз", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    const el = document.querySelector<HTMLElement>(".twitch-chat-messages")!;
    const geo = fakeGeometry(el);
    for (let i = 0; i < 8; i++) ws.onmessage?.({ data: privmsg(`m${i}`) });
    vi.advanceTimersByTime(50);
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    geo.setTop(0);
    el.dispatchEvent(new Event("scroll"));
    ws.onmessage?.({ data: privmsg("новое") });
    ws.onmessage?.({ data: privmsg("и ещё") });
    vi.advanceTimersByTime(50);
    expect(el.scrollTop, "история не уехала из-под глаз").toBe(0);
    expect(newBadge()).toContain("2 нов.");
  });

  /** Общий сценарий «длинное сообщение сдвигает прокрутку» после действия. */
  function longMessageShift(ws: ReturnType<typeof enableFeature>, el: HTMLElement, geo: { setTop(v: number): void }) {
    ws.onmessage?.({ data: privmsg("длинное сообщение на три строки") });
    geo.setTop(el.scrollHeight - 200 - 60);
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(50);
  }

  test("adversarial: рефлекторное колесо ВНИЗ у дна не отключает автоскролл", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    const el = document.querySelector<HTMLElement>(".twitch-chat-messages")!;
    const geo = fakeGeometry(el);
    for (let i = 0; i < 8; i++) ws.onmessage?.({ data: privmsg(`m${i}`) });
    vi.advanceTimersByTime(50);
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    longMessageShift(ws, el, geo);
    expect(el.scrollTop).toBe(el.scrollHeight - 200);
    expect(newBadge()).toBe("");
  });

  test("adversarial: pointerup не пришёл (полоса за окном) — флаг протухает, баг не возвращается", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    const el = document.querySelector<HTMLElement>(".twitch-chat-messages")!;
    const geo = fakeGeometry(el);
    for (let i = 0; i < 8; i++) ws.onmessage?.({ data: privmsg(`m${i}`) });
    vi.advanceTimersByTime(50);
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("pointerdown")); // pointerup так и не придёт
    vi.advanceTimersByTime(11_000);
    longMessageShift(ws, el, geo);
    expect(el.scrollTop).toBe(el.scrollHeight - 200);
    expect(newBadge()).toBe("");
  });

  test("adversarial: движение мыши без кнопок снимает залипшую «кнопку» сразу", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    const el = document.querySelector<HTMLElement>(".twitch-chat-messages")!;
    const geo = fakeGeometry(el);
    for (let i = 0; i < 8; i++) ws.onmessage?.({ data: privmsg(`m${i}`) });
    vi.advanceTimersByTime(50);
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(1000); // намерение от нажатия уже истекло
    const move = new Event("pointermove");
    Object.defineProperty(move, "buttons", { value: 0 });
    el.dispatchEvent(move);
    longMessageShift(ws, el, geo);
    expect(el.scrollTop).toBe(el.scrollHeight - 200);
    expect(newBadge()).toBe("");
  });
});
