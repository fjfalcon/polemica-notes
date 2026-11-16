/**
 * Фоновое реле Twitch-чата (16.11.2026): держит своё подключение и буфер,
 * чтобы страница после перехода догрузила пропущенное; гаснет само, когда
 * чат страницам больше не нужен.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getPlatformInfo = vi.fn(async () => ({}));
vi.mock("@core/env", () => ({ browser: { runtime: { getPlatformInfo: () => getPlatformInfo() } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  BUFFER_MAX,
  BUFFER_MAX_AGE_MS,
  GRACE_MS,
  TICK_MS,
  handleRelayMessage,
  relayBacklog,
  relayRelease,
  relayStateForTest,
  relayWant,
  resetRelayForTest,
} from "../../src/background/twitch-relay";

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
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }
  join(channel = "streamer"): void {
    this.onmessage?.({ data: `:tmi.twitch.tv 366 justinfan1 #${channel} :End of /NAMES list\r\n` });
  }
  chat(n: number, text = `m${n}`, channel = "streamer"): void {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    this.onmessage?.({
      data: `@display-name=Viewer;id=${id};tmi-sent-ts=${Date.now()} :viewer!v@v.tmi.twitch.tv PRIVMSG #${channel} :${text}\r\n`,
    });
  }
  drop(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const realWebSocket = globalThis.WebSocket;
const sockets = () => FakeWebSocket.instances;
const last = () => sockets()[sockets().length - 1];

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_800_000_000_000));
  getPlatformInfo.mockClear();
});

afterEach(() => {
  resetRelayForTest();
  (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
  vi.useRealTimers();
});

describe("подключение и буфер", () => {
  test("«нужно» поднимает одно анонимное подключение с тегами и входит в канал", () => {
    relayWant("https://twitch.tv/Streamer");
    relayWant("streamer"); // повтор — второго сокета нет
    expect(sockets()).toHaveLength(1);
    last().open();
    expect(last().sent).toEqual([
      "CAP REQ :twitch.tv/tags",
      "PASS SCHMOOPIIE",
      expect.stringMatching(/^NICK justinfan\d+$/),
      "JOIN #streamer",
    ]);
    last().join();
    expect(relayStateForTest()).toMatchObject({ channel: "streamer", joined: true, running: true });
  });

  test("сообщения копятся в буфере без дублей; отдаются только своему каналу", () => {
    relayWant("streamer");
    last().open();
    last().join();
    last().chat(1, "первое");
    last().chat(2, "второе");
    last().chat(2, "второе"); // тот же id второй раз
    expect(relayBacklog("streamer").map((m) => m.message)).toEqual(["первое", "второе"]);
    expect(relayBacklog("STREAMER"), "имя канала нормализуется").toHaveLength(2);
    expect(relayBacklog("other")).toEqual([]);
    expect(relayBacklog(undefined)).toEqual([]);
  });

  test("буфер ограничен по числу и по возрасту", () => {
    relayWant("streamer");
    last().open();
    last().join();
    for (let i = 0; i < BUFFER_MAX + 5; i++) last().chat(i);
    const all = relayBacklog("streamer");
    expect(all).toHaveLength(BUFFER_MAX);
    expect(all[0].message).toBe("m5");
    // Вытесненный id снова принимается (дедуп не раздувается и не «помнит вечно»).
    last().chat(0, "снова");
    expect(relayBacklog("streamer").at(-1)?.message).toBe("снова");
    // Старше потолка возраста — не отдаём. Реле держим живым «нужно».
    for (let t = 0; t <= BUFFER_MAX_AGE_MS; t += TICK_MS) {
      relayWant("streamer");
      last().onmessage?.({ data: "PONG :tmi.twitch.tv\r\n" });
      vi.advanceTimersByTime(TICK_MS);
    }
    expect(relayBacklog("streamer")).toEqual([]);
  });

  test("PING сервера получает PONG; пустое имя канала реле не поднимает", () => {
    relayWant("  ");
    relayWant(42);
    expect(sockets()).toHaveLength(0);
    relayWant("streamer");
    last().open();
    last().onmessage?.({ data: "PING :tmi.twitch.tv\r\n" });
    expect(last().sent.at(-1)).toBe("PONG :tmi.twitch.tv");
  });
});

describe("жизнь реле", () => {
  test("тик шлёт PING и продлевает фон; без «нужно» реле гаснет после грейса", () => {
    relayWant("streamer");
    const ws = last();
    ws.open();
    ws.join();
    ws.chat(1);
    vi.advanceTimersByTime(TICK_MS);
    expect(ws.sent.at(-1)).toBe("PING :pn");
    expect(getPlatformInfo).toHaveBeenCalled();
    // Страница молчит (вкладку закрыли): живём грейс, потом гаснем.
    for (let t = TICK_MS; t < GRACE_MS; t += TICK_MS) {
      ws.onmessage?.({ data: "PONG :tmi.twitch.tv\r\n" });
      vi.advanceTimersByTime(TICK_MS);
    }
    expect(relayStateForTest().running, "в пределах грейса реле ещё живо").toBe(true);
    vi.advanceTimersByTime(TICK_MS);
    expect(relayStateForTest()).toEqual({ channel: "", joined: false, buffered: 0, running: false });
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    // Таймеров не осталось — фон может спать.
    expect(vi.getTimerCount()).toBe(0);
  });

  test("«нужно» со страницы продлевает жизнь: переход между страницами реле переживает", () => {
    relayWant("streamer");
    last().open();
    last().join();
    for (let t = 0; t < GRACE_MS * 3; t += TICK_MS) {
      relayWant("streamer");
      last().onmessage?.({ data: "PONG :tmi.twitch.tv\r\n" });
      vi.advanceTimersByTime(TICK_MS);
    }
    last().chat(7, "во время перехода");
    expect(sockets(), "то же подключение, без переподключений").toHaveLength(1);
    expect(relayBacklog("streamer").map((m) => m.message)).toEqual(["во время перехода"]);
  });

  test("молчащий сокет считается мёртвым и заменяется; буфер при этом цел", () => {
    relayWant("streamer");
    const ws = last();
    ws.open();
    ws.join();
    ws.chat(1);
    // PONG не приходит: два тика шлют PING, третий видит тишину > 50 с.
    for (let i = 0; i < 3; i++) {
      relayWant("streamer");
      vi.advanceTimersByTime(TICK_MS);
    }
    expect(sockets()).toHaveLength(2);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(relayBacklog("streamer")).toHaveLength(1);
  });

  test("обрыв — переподключение с растущей задержкой, пока чат нужен", () => {
    relayWant("streamer");
    last().open();
    last().join();
    last().drop();
    expect(sockets()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(sockets()).toHaveLength(2);
    last().drop(); // до входа в канал — задержка растёт
    vi.advanceTimersByTime(2000);
    expect(sockets()).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(sockets()).toHaveLength(3);
  });

  test("обрыв после истечения грейса — не переподключаемся", () => {
    relayWant("streamer");
    last().open();
    vi.setSystemTime(Date.now() + GRACE_MS + 1);
    last().drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets()).toHaveLength(1);
    expect(relayStateForTest().running).toBe(false);
  });

  test("смена канала: старый сокет закрыт, буфер старого канала не отдаётся", () => {
    relayWant("streamer");
    const first = last();
    first.open();
    first.join();
    first.chat(1);
    relayWant("another");
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(sockets()).toHaveLength(2);
    last().open();
    expect(last().sent.at(-1)).toBe("JOIN #another");
    expect(relayBacklog("streamer")).toEqual([]);
    expect(relayBacklog("another")).toEqual([]);
    // Опоздавшее событие старого сокета новое подключение не трогает.
    first.onmessage?.({ data: "x" });
    first.onclose?.({ code: 1000 });
    expect(sockets()).toHaveLength(2);
  });

  test("«чат выключен» гасит реле сразу", () => {
    relayWant("streamer");
    last().open();
    last().join();
    last().chat(1);
    relayRelease();
    expect(relayStateForTest()).toEqual({ channel: "", joined: false, buffered: 0, running: false });
    expect(relayBacklog("streamer")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("находки ревью", () => {
  test("сообщение без id в буфер не идёт: дедупить его нечем", () => {
    relayWant("streamer");
    last().open();
    last().join();
    last().onmessage?.({ data: "@display-name=V :v!v@v.tmi.twitch.tv PRIVMSG #streamer :без id\r\n" });
    last().onmessage?.({ data: ":v!v@v.tmi.twitch.tv PRIVMSG #streamer :без тегов\r\n" });
    expect(relayBacklog("streamer")).toEqual([]);
  });

  test("сокет, зависший в CONNECTING, заменяется на следующем тике", () => {
    relayWant("streamer");
    const stuck = last();
    expect(stuck.readyState).toBe(FakeWebSocket.CONNECTING);
    vi.advanceTimersByTime(TICK_MS);
    expect(sockets(), "20 с > 15 с ожидания рукопожатия").toHaveLength(2);
    expect(stuck.readyState).toBe(FakeWebSocket.CLOSED);
    // Свежий CONNECTING не трогаем раньше срока.
    relayWant("streamer");
    vi.advanceTimersByTime(1000);
    expect(sockets()).toHaveLength(2);
  });
});

describe("сообщения вкладок", () => {
  test("«нужно» и «отпустить» — только от вкладки; буфер отдаётся в поле messages", async () => {
    expect(handleRelayMessage({ type: "obs_command" }, true)).toEqual({ handled: false });
    expect(handleRelayMessage(null, true)).toEqual({ handled: false });

    // Попап (не вкладка): реле не поднимается, буфер не отдаётся.
    expect(handleRelayMessage({ type: "twitch_relay_want", channel: "streamer" }, false).handled).toBe(true);
    expect(sockets()).toHaveLength(0);

    handleRelayMessage({ type: "twitch_relay_want", channel: "Streamer" }, true);
    expect(sockets()).toHaveLength(1);
    last().open();
    last().join();
    last().chat(1, "привет");
    const forTab = await handleRelayMessage({ type: "twitch_relay_backlog", channel: "streamer" }, true).reply;
    expect(forTab?.messages.map((m) => m.message)).toEqual(["привет"]);
    const forPopup = await handleRelayMessage({ type: "twitch_relay_backlog", channel: "streamer" }, false).reply;
    expect(forPopup).toEqual({ messages: [] });

    handleRelayMessage({ type: "twitch_relay_release" }, false);
    expect(relayStateForTest().running, "чужой «отпустить» реле не гасит").toBe(true);
    handleRelayMessage({ type: "twitch_relay_release" }, true);
    expect(relayStateForTest().running).toBe(false);
  });
});
