// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/123" }
/**
 * Догрузка пропущенного из фонового реле (жалоба владельца 16.11.2026:
 * «игра закончилась, пока открывалась новая страница, кто-то написал —
 * сообщение потерялось»). После входа в канал панель забирает у фона буфер
 * и дорисовывает то, чего у неё нет; одно сообщение — одна строка.
 *
 * Каркас — из соседнего теста автоскролла.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({ onDomChange: vi.fn(() => () => undefined) }));
vi.mock("@core/env", () => ({
  browser: { storage: { sync: { set: vi.fn(async () => {}) } }, runtime: { id: "x" } },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Msg = { type: string; channel?: string };
/** Что фон ответит на запрос буфера: значение или отложенный промис. */
let backlogReply: (() => unknown) | null = null;
const sent: Msg[] = [];
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn(() => () => undefined),
  sendRuntime: vi.fn(async (msg: Msg) => {
    sent.push(msg);
    if (msg.type === "twitch_relay_backlog") return backlogReply ? backlogReply() : undefined;
    return undefined;
  }),
}));
vi.mock("@core/selectors", () => ({
  SITE: { playerDesktop: ".pd", playerVideo: ".pv", obsGameControls: ".gc" },
}));
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
import { parseChatHistory, twitchPanelFeature } from "@content/panels/twitch-panel";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
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
  emitJoined(): void {
    this.onmessage?.({ data: ":tmi.twitch.tv 366 justinfan1 #streamer :End of /NAMES list\r\n" });
  }
  chat(n: number, text: string): void {
    this.onmessage?.({
      data: `@display-name=Viewer;id=${idOf(n)};tmi-sent-ts=${Date.now()} :viewer!v@v.tmi.twitch.tv PRIVMSG #streamer :${text}\r\n`,
    });
  }
}

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const relayMsg = (n: number, text: string, ts = Date.now() - 5000) => ({
  id: idOf(n),
  ts,
  username: "Viewer",
  message: text,
  badges: [],
});
const realWebSocket = globalThis.WebSocket;
const texts = (): string[] =>
  [...document.querySelectorAll(".twitch-message-text")].map((el) => (el.textContent ?? "").trim());
const count = (type: string) => sent.filter((m) => m.type === type).length;
/** Дать отработать промисам (ответ фона) без сдвига часов. */
const settle = () => vi.advanceTimersByTimeAsync(0);

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

function enableFeature(): FakeWebSocket {
  twitchPanelFeature.enable({
    settings: { twitch_chat_enabled: true, twitch_channel_name: "streamer" },
  } as unknown as FeatureContext);
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

beforeEach(() => {
  sessionStorage.clear();
  sent.length = 0;
  backlogReply = null;
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

describe("догрузка после входа в канал", () => {
  test("пропущенное встаёт ВЫШЕ живых сообщений, пришедших до ответа фона", async () => {
    backlogReply = () => ({ messages: [relayMsg(2, "пропущено 2", 2000), relayMsg(1, "пропущено 1", 1000)] });
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(3, "живое"); // пришло, пока ждём фон, — придержано
    expect(texts(), "до ответа фона живое не рисуем — иначе порядок перевернётся").toEqual([]);
    await settle();
    expect(texts()).toEqual(["пропущено 1", "пропущено 2", "живое"]);
    expect(sent.find((m) => m.type === "twitch_relay_backlog")).toEqual({
      type: "twitch_relay_backlog",
      channel: "streamer",
    });
    ws.chat(4, "дальше как обычно");
    expect(texts().at(-1)).toBe("дальше как обычно");
  });

  test("одно сообщение — одна строка: из истории, из реле и вживую", async () => {
    // Прошлая страница успела показать и сохранить сообщение 1.
    backlogReply = () => ({ messages: [] });
    let ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    ws.chat(1, "было до перехода");
    window.dispatchEvent(new Event("pagehide"));
    const saved = sessionStorage.getItem("fp:twitch-panel:history");
    expect(parseChatHistory(saved, "streamer")[0].id, "id сохраняется в истории").toBe(idOf(1));
    twitchPanelFeature.disable();

    // Новая страница: в буфере реле — то же сообщение 1 и пропущенное 2.
    backlogReply = () => ({ messages: [relayMsg(1, "было до перехода"), relayMsg(2, "пришло в переходе")] });
    ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(2, "пришло в переходе"); // и вживую, и в буфере
    await settle();
    expect(texts()).toEqual(["было до перехода", "пришло в переходе"]);
  });

  test("фон молчит — через 1.5 с придержанное показывается; опоздавший ответ не теряется", async () => {
    let resolve!: (v: unknown) => void;
    backlogReply = () => new Promise((r) => (resolve = r));
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(3, "живое");
    await vi.advanceTimersByTimeAsync(1499);
    expect(texts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(texts()).toEqual(["живое"]);
    resolve({ messages: [relayMsg(1, "опоздавшее"), relayMsg(3, "живое")] });
    await settle();
    expect(texts()).toEqual(["живое", "опоздавшее"]);
  });

  test("фон недоступен или ответил мусором — чат работает как раньше", async () => {
    backlogReply = () => ({ messages: [{ id: "x" }, null, "строка"] });
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(1, "живое");
    await settle();
    expect(texts()).toEqual(["живое"]);
  });

  test("обрыв во время ожидания — придержанное не теряется, старый ответ не применяется", async () => {
    let resolve!: (v: unknown) => void;
    backlogReply = () => new Promise((r) => (resolve = r));
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(3, "успело прийти");
    ws.readyState = FakeWebSocket.CLOSED;
    ws.onclose?.({ code: 1006 });
    expect(texts()).toEqual(["успело прийти"]);
    resolve({ messages: [relayMsg(1, "ответ прежнему подключению")] });
    await settle();
    expect(texts()).toEqual(["успело прийти"]);
  });

  test("догруженное показывает время ОТПРАВКИ, а не момент дорисовки", async () => {
    const sentAt = Date.now() - 42_000;
    backlogReply = () => ({ messages: [relayMsg(1, "давнее", sentAt)] });
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    const restored = parseChatHistory(sessionStorage.getItem("fp:twitch-panel:history"), "streamer");
    expect(restored[0].timestamp.getTime()).toBe(sentAt);
  });
});

describe("находки ревью", () => {
  test("полное окно + полный буфер реле без пропусков — ничего не дорисовывается", async () => {
    // Бойкий канал: панель держит 200 строк, реле — 200 сообщений и достаёт
    // дальше окна. Раньше id вытесненной строки забывался, старое сообщение
    // дорисовывалось как «пропущенное» и по цепочке переигрывало весь буфер.
    backlogReply = () => ({ messages: [] });
    let ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    for (let i = 1; i <= 260; i++) ws.chat(i, `m${i}`);
    const before = texts();
    expect(before.at(-1)).toBe("m260");
    // Реконнект той же страницы: реле отдаёт последние 200 (m61…m260).
    backlogReply = () => ({ messages: Array.from({ length: 200 }, (_, k) => relayMsg(61 + k, `m${61 + k}`)) });
    ws.readyState = FakeWebSocket.CLOSED;
    ws.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(5000);
    ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    expect(texts().filter((t) => /^m\d+$/.test(t)).at(-1)).toBe("m260");
    expect(new Set(texts()).size, "ни одного повтора").toBe(texts().length);
    expect(texts().slice(-3)).toEqual(before.slice(-3));
  });

  test("после перезагрузки страницы: старше последнего виденного — не «пропущенное»", async () => {
    backlogReply = () => ({ messages: [] });
    let ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    for (let i = 1; i <= 230; i++) ws.chat(i, `m${i}`);
    window.dispatchEvent(new Event("pagehide"));
    twitchPanelFeature.disable();
    // Новая страница восстанавливает 199 строк (m32…m230), а реле помнит 200
    // и достаёт на сообщение глубже: m31 страница видела, но в истории его
    // уже нет. Пропущенных нет — дорисовывать нечего.
    backlogReply = () => ({ messages: Array.from({ length: 200 }, (_, k) => relayMsg(31 + k, `m${31 + k}`)) });
    ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    expect(texts()).not.toContain("m31");
    expect(texts().at(-1)).toBe("m230");
    twitchPanelFeature.disable();

    // То же, но два сообщения действительно пропущены при переходе.
    backlogReply = () => ({ messages: Array.from({ length: 200 }, (_, k) => relayMsg(33 + k, `m${33 + k}`)) });
    ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    const shown = texts();
    expect(shown.slice(-2), "дорисованы ровно пропущенные").toEqual(["m231", "m232"]);
    expect(new Set(shown).size).toBe(shown.length);
  });

  test("смена канала во время ожидания: придержанное старого канала в новый не попадает", async () => {
    backlogReply = () => new Promise(() => undefined); // фон молчит
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    ws.chat(1, "из старого канала");
    twitchPanelFeature.update!({
      settings: { twitch_chat_enabled: true, twitch_channel_name: "another" },
    } as unknown as FeatureContext);
    await vi.advanceTimersByTimeAsync(2000);
    expect(texts()).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem("fp:twitch-panel:history") || "").not.toContain("из старого канала");
  });

  test("часы Twitch спешат — метка догруженного не уходит в будущее и переживает восстановление", async () => {
    backlogReply = () => ({ messages: [relayMsg(1, "из будущего", Date.now() + 5 * 60_000)] });
    const ws = enableFeature();
    ws.emitOpen();
    ws.emitJoined();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    const restored = parseChatHistory(sessionStorage.getItem("fp:twitch-panel:history"), "streamer");
    expect(restored.map((m) => m.message)).toEqual(["из будущего"]);
    expect(restored[0].timestamp.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("«нужно» для реле", () => {
  test("реле общее: «Отключиться» одной вкладки и откат без сокета его не гасят", () => {
    // Вкладка без подключения (откат enable, чат «только в игре» вне игры).
    twitchPanelFeature.disable();
    expect(count("twitch_relay_release")).toBe(0);
  });

  test("при подключении, раз в 20 с при живом сокете и на уходе со страницы", () => {
    const ws = enableFeature();
    expect(count("twitch_relay_want"), "реле поднимаем вместе со своим сокетом").toBe(1);
    expect(sent[0]).toEqual({ type: "twitch_relay_want", channel: "streamer" });
    ws.emitOpen();
    vi.advanceTimersByTime(60_000);
    expect(count("twitch_relay_want")).toBe(4);
    window.dispatchEvent(new Event("pagehide"));
    expect(count("twitch_relay_want"), "продление на время перехода").toBe(5);
  });

  test("сокета нет (идёт переподключение) — «нужно» не шлём; выключили чат — реле отпускаем", () => {
    const ws = enableFeature();
    ws.emitOpen();
    ws.readyState = FakeWebSocket.CLOSED;
    ws.onclose?.({ code: 1006 });
    const before = count("twitch_relay_want");
    vi.advanceTimersByTime(4000); // до первой попытки переподключения (5 с)
    expect(count("twitch_relay_want")).toBe(before);
    twitchPanelFeature.disable();
    expect(count("twitch_relay_release")).toBe(1);
    const after = count("twitch_relay_want");
    vi.advanceTimersByTime(120_000);
    expect(count("twitch_relay_want"), "после выключения сердцебиения нет").toBe(after);
  });
});
