/**
 * Свой клиент Socket.IO 2 вместо socket.io-client 2.5.0 (09.11.2026): адрес и
 * пространство имён как у библиотеки, разбор пакетов, пульс EIO3 (ping шлёт
 * клиент), одно событие конца на жизнь сокета, отказ пространства имён.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { connectSearchSocket, parsePacket, socketTarget } from "@content/page/search-socket";

/** WebSocket-двойник: кадры наружу копятся, входящие подаём руками. */
class FakeWs {
  static last: FakeWs | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWs.last = this;
  }
  send(frame: string) {
    this.sent.push(frame);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(data: string) {
    this.onmessage?.({ data });
  }
}
const Impl = FakeWs as unknown as { new (url: string): WebSocket };
const ENDPOINT = "https://game.polemicagame.com/search";
const QUERY = { userId: 7, authKey: "k", intention: "game_search" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function connected(ping = { pingInterval: 1000, pingTimeout: 500 }) {
  const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
  const ws = FakeWs.last!;
  ws.open();
  ws.recv(`0${JSON.stringify({ sid: "s", upgrades: [], ...ping })}`);
  ws.recv("40/search,");
  return { socket, ws };
}

describe("адрес и разбор", () => {
  test("URL и пространство имён — как у socket.io-client 2.x", () => {
    const t = socketTarget(ENDPOINT, QUERY);
    expect(t.nsp).toBe("/search");
    const url = new URL(t.url);
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/socket.io/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ userId: "7", authKey: "k", intention: "game_search", EIO: "3", transport: "websocket" });
    expect(socketTarget("https://h.polemicagame.com/", {}).nsp).toBe("/");
  });

  test("пакеты: пространство имён, query в CONNECT, id подтверждения, мусор", () => {
    expect(parsePacket('2/search,["ev",{"a":1}]')).toEqual({ type: 2, nsp: "/search", payload: ["ev", { a: 1 }] });
    expect(parsePacket("0/search?x=1,")).toEqual({ type: 0, nsp: "/search", payload: undefined });
    expect(parsePacket('2/search,12["ev"]')).toEqual({ type: 2, nsp: "/search", payload: ["ev"] });
    expect(parsePacket('2["ev",1]')).toEqual({ type: 2, nsp: "/", payload: ["ev", 1] });
    expect(parsePacket("2/search,{oops")).toBeNull();
    expect(parsePacket("x")).toBeNull();
  });
});

describe("жизнь соединения", () => {
  test("рукопожатие → CONNECT с query → connect; события в обе стороны", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
    const ws = FakeWs.last!;
    const got: unknown[] = [];
    socket.on("connect", () => got.push("connect"));
    socket.on("session_initialized", (v) => got.push(["init", v]));
    ws.open();
    ws.recv(`0${JSON.stringify({ sid: "s", pingInterval: 1000, pingTimeout: 500 })}`);
    expect(ws.sent).toEqual(["40/search?userId=7&authKey=k&intention=game_search,"]);
    expect(socket.connected).toBe(false);
    socket.emit("start_game_search", { a: 1 });
    expect(ws.sent, "до подключения пространства имён ничего не шлём").toHaveLength(1);
    ws.recv("40/search,");
    ws.recv('42/search,["session_initialized",null]');
    ws.recv('42/other,["session_initialized",1]');
    expect(socket.connected).toBe(true);
    expect(got).toEqual(["connect", ["init", null]]);
    socket.emit("start_game_search", { a: 1 });
    expect(ws.sent[1]).toBe('42/search,["start_game_search",{"a":1}]');
  });

  test("пульс EIO3: ping шлёт клиент; pong продлевает; нет pong — disconnect один раз", () => {
    const { socket, ws } = connected();
    const ends: string[] = [];
    socket.on("disconnect", (r) => ends.push(r));
    vi.advanceTimersByTime(1000);
    expect(ws.sent.at(-1)).toBe("2");
    ws.recv("3");
    vi.advanceTimersByTime(1000);
    expect(ws.sent.filter((f) => f === "2")).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(ends).toEqual(["ping timeout"]);
    expect(socket.connected).toBe(false);
    expect(ws.closed).toBe(true);
    ws.onclose?.();
    expect(ends, "закрытие после конца не даёт второго события").toHaveLength(1);
  });

  test("disconnect(): пакет отключения, закрытие, событие; повтор безопасен", () => {
    const { socket, ws } = connected();
    const ends: string[] = [];
    socket.on("disconnect", (r) => ends.push(r));
    socket.disconnect();
    socket.disconnect();
    expect(ws.sent.at(-1)).toBe("41/search,");
    expect(ws.closed).toBe(true);
    expect(ends).toEqual(["io client disconnect"]);
  });

  test("сервер отключил пространство имён — disconnect", () => {
    const { socket, ws } = connected();
    const ends: string[] = [];
    socket.on("disconnect", (r) => ends.push(r));
    ws.recv("41/search,");
    expect(ends).toEqual(["io server disconnect"]);
  });

  test("отказ до подключения — connect_error, а не disconnect", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
    const ws = FakeWs.last!;
    const seen: string[] = [];
    for (const ev of ["connect_error", "disconnect", "connect_timeout"]) socket.on(ev, () => seen.push(ev));
    ws.open();
    ws.recv(`0${JSON.stringify({ sid: "s", pingInterval: 1000, pingTimeout: 500 })}`);
    ws.recv('44/search,"Not authorized"');
    expect(seen).toEqual(["connect_error"]);
  });

  test("нет подключения за timeoutMs — connect_timeout", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl, timeoutMs: 300 });
    const seen: string[] = [];
    socket.on("connect_timeout", () => seen.push("timeout"));
    FakeWs.last!.open();
    vi.advanceTimersByTime(300);
    expect(seen).toEqual(["timeout"]);
    expect(FakeWs.last!.closed).toBe(true);
  });

  test("removeListener снимает обработчик; падение обработчика не ломает разбор", () => {
    const { socket, ws } = connected();
    const got: unknown[] = [];
    const h = (v: unknown) => got.push(v);
    socket.on("ev", () => {
      throw new Error("boom");
    });
    socket.on("ev", h);
    ws.recv('42/search,["ev",1]');
    socket.removeListener("ev", h);
    ws.recv('42/search,["ev",2]');
    expect(got).toEqual([1]);
  });

  test("обрыв транспорта: error/close/пакет 1 после подключения — один disconnect", () => {
    for (const cut of ["error", "close", "packet"] as const) {
      const { socket, ws } = connected();
      const ends: string[] = [];
      socket.on("disconnect", (r) => ends.push(r));
      if (cut === "error") ws.onerror?.();
      else if (cut === "close") ws.onclose?.();
      else ws.recv("1");
      expect(ends, cut).toHaveLength(1);
      expect(socket.connected).toBe(false);
    }
  });

  test("обрыв до подключения — connect_error, а не disconnect", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
    const seen: string[] = [];
    for (const ev of ["connect_error", "disconnect"]) socket.on(ev, () => seen.push(ev));
    FakeWs.last!.onclose?.();
    expect(seen).toEqual(["connect_error"]);
  });

  test("конструктор WebSocket бросил — connect_error асинхронно", () => {
    const Broken = class { constructor() { throw new Error("blocked"); } } as unknown as { new (url: string): WebSocket };
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Broken });
    const seen: string[] = [];
    socket.on("connect_error", () => seen.push("err"));
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(seen).toEqual(["err"]);
  });

  test("события пространства имён до его подключения не доставляются", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
    const ws = FakeWs.last!;
    const got: unknown[] = [];
    socket.on("session_initialized", (v) => got.push(v));
    ws.open();
    ws.recv(`0${JSON.stringify({ sid: "s", pingInterval: 1000, pingTimeout: 500 })}`);
    ws.recv('42/search,["session_initialized",1]');
    expect(got).toEqual([]);
  });

  test("ошибка пространства имён после подключения — событие error, соединение живо", () => {
    const { socket, ws } = connected();
    const errors: unknown[] = [];
    socket.on("error", (e) => errors.push(e));
    ws.recv('44/search,"boom"');
    expect(errors).toEqual(["boom"]);
    expect(socket.connected).toBe(true);
  });

  test("disconnect() до подключения молчит, как 2.x", () => {
    const socket = connectSearchSocket(ENDPOINT, { query: QUERY, WebSocketImpl: Impl });
    const seen: string[] = [];
    for (const ev of ["disconnect", "connect_error", "connect_timeout"]) socket.on(ev, () => seen.push(ev));
    FakeWs.last!.open();
    socket.disconnect();
    vi.advanceTimersByTime(30_000);
    expect(seen).toEqual([]);
    expect(FakeWs.last!.closed).toBe(true);
  });
});
