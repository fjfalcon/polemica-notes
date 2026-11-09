/**
 * Минимальный клиент Socket.IO 2 (Engine.IO v3) поверх обычного WebSocket —
 * вместо socket.io-client 2.5.0 (просьба владельца 09.11.2026).
 *
 * Почему не библиотека: сервер поиска сайта говорит на протоколе Socket.IO 2
 * (EIO=3), а клиенты 3.x/4.x к таким серверам не подключаются. Ветка 2.x
 * заморожена, тянет ~30 пакетов и несёт неисправимую в ней уязвимость
 * (ReDoS в parseuri). Поиску нужно крошечное подмножество протокола, и его
 * честнее держать своим кодом без зависимостей.
 *
 * Что повторяем ровно как socket.io-client 2.x у сайта (connectSocketAndStartSearch):
 *  - URL: `/socket.io/?<query>&EIO=3&transport=websocket`, только WebSocket,
 *    без переподключения (у сайта reconnection:false);
 *  - пространство имён из пути endpoint (`/search`), query — и в URL, и в
 *    пакете подключения: `40/search?<query>,`;
 *  - пульс EIO3: ping (`2`) шлёт КЛИЕНТ каждые pingInterval, нет pong (`3`)
 *    за pingTimeout — соединение закрыто;
 *  - события `42/search,["имя",данные]` в обе стороны.
 * Не нужно и не реализовано: ack, бинарные пакеты, polling, переподключение.
 */
import type { SearchSocket } from "./direct-search";

type Handler = (value: any) => void;

export interface SearchSocketOptions {
  query: Record<string, string | number>;
  /** Сколько ждать подключения пространства имён (у socket.io-client — 20 с). */
  timeoutMs?: number;
  /** Тестовый шов: в браузере — window.WebSocket. */
  WebSocketImpl?: { new (url: string): WebSocket };
}

/**
 * Адрес WebSocket и пространство имён — как их получает socket.io-client 2.x
 * из endpoint. Query — только из параметров (у 2.x opts.query вытесняет
 * query адреса, не сливается с ним).
 */
export function socketTarget(endpoint: string, query: Record<string, string | number>): { url: string; nsp: string; nspQuery: string } {
  const source = new URL(endpoint);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  const nspQuery = params.toString();
  params.set("EIO", "3");
  params.set("transport", "websocket");
  const protocol = source.protocol === "https:" ? "wss:" : source.protocol === "http:" ? "ws:" : source.protocol;
  const nsp = source.pathname.replace(/\/+$/, "") || "/";
  return { url: `${protocol}//${source.host}/socket.io/?${params.toString()}`, nsp, nspQuery };
}

/** Разбор пакета Socket.IO внутри сообщения Engine.IO (`4…`). null — не наш формат. */
export function parsePacket(data: string): { type: number; nsp: string; payload: unknown } | null {
  const type = Number(data[0]);
  if (!Number.isInteger(type)) return null;
  let i = 1;
  let nsp = "/";
  if (data[i] === "/") {
    const end = data.indexOf(",", i);
    nsp = end < 0 ? data.slice(i) : data.slice(i, end);
    i = end < 0 ? data.length : end + 1;
    const q = nsp.indexOf("?");
    if (q >= 0) nsp = nsp.slice(0, q);
  }
  while (i < data.length && data[i] >= "0" && data[i] <= "9") i++; // id подтверждения — не используем
  if (i >= data.length) return { type, nsp, payload: undefined };
  try {
    return { type, nsp, payload: JSON.parse(data.slice(i)) };
  } catch {
    return null;
  }
}

export function connectSearchSocket(endpoint: string, options: SearchSocketOptions): SearchSocket {
  const { url, nsp, nspQuery } = socketTarget(endpoint, options.query);
  const prefix = nsp === "/" ? "" : nsp;
  const handlers = new Map<string, Set<Handler>>();
  const Impl = options.WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** Пульс из рукопожатия: [pingInterval, pingTimeout]. */
  let pulse: [number, number] = [25_000, 20_000];

  const fire = (name: string, value?: unknown): void => {
    for (const h of Array.from(handlers.get(name) ?? [])) {
      try {
        h(value);
      } catch {
        /* обработчик подписчика не должен ронять разбор кадров */
      }
    }
  };
  const clearTimers = (): void => {
    for (const t of [pingTimer, pongTimer, connectTimer]) if (t) clearTimeout(t);
    pingTimer = pongTimer = connectTimer = null;
  };
  const send = (frame: string): boolean => {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(frame);
    return true;
  };
  /** Конец соединения: одно событие на жизнь сокета, как у socket.io-client. */
  const shutdown = (event: "disconnect" | "connect_error" | "connect_timeout", reason: string): void => {
    if (closed) return;
    const wasConnected = socket.connected;
    closed = true;
    socket.connected = false;
    clearTimers();
    if (ws) ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws?.close();
    } catch {
      /* уже закрыт */
    }
    ws = null;
    fire(wasConnected ? "disconnect" : event, reason);
  };
  const schedulePing = (interval: number, timeout: number): void => {
    pingTimer = setTimeout(() => {
      pingTimer = null;
      if (!send("2")) return;
      pongTimer = setTimeout(() => shutdown("disconnect", "ping timeout"), timeout);
    }, interval);
  };

  const socket: SearchSocket & { connected: boolean } = {
    connected: false,
    emit(event: string, ...args: unknown[]) {
      if (!socket.connected) return socket;
      send(`42${prefix}${prefix ? "," : ""}${JSON.stringify([event, ...args])}`);
      return socket;
    },
    on(event: string, handler: Handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(handler);
      return socket;
    },
    removeListener(event: string, handler: Handler) {
      handlers.get(event)?.delete(handler);
      return socket;
    },
    disconnect() {
      if (closed) return socket;
      if (!socket.connected) {
        // Как 2.x: до подключения отключение молчит — событий нет.
        closed = true;
        clearTimers();
        if (ws) ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws?.close();
        } catch {
          /* уже закрыт */
        }
        ws = null;
        return socket;
      }
      send(`41${prefix}${prefix ? "," : ""}`);
      shutdown("disconnect", "io client disconnect");
      return socket;
    },
  };

  try {
    ws = new Impl(url);
  } catch {
    // Как у socket.io-client: синхронный отказ всё равно приходит событием.
    setTimeout(() => shutdown("connect_error", "websocket error"), 0);
    return socket;
  }
  connectTimer = setTimeout(() => shutdown("connect_timeout", "timeout"), options.timeoutMs ?? 20_000);
  ws.onerror = () => shutdown(socket.connected ? "disconnect" : "connect_error", "transport error");
  ws.onclose = () => shutdown(socket.connected ? "disconnect" : "connect_error", "transport close");
  ws.onmessage = (event: MessageEvent) => {
    if (closed || typeof event.data !== "string" || !event.data) return;
    const frame = event.data;
    const kind = frame[0];
    if (kind === "0") {
      // Рукопожатие Engine.IO: параметры пульса. Пространство имён по
      // умолчанию подключается само; своё — пакетом CONNECT с query.
      let hs: { pingInterval?: unknown; pingTimeout?: unknown } = {};
      try {
        hs = JSON.parse(frame.slice(1));
      } catch {
        shutdown("connect_error", "bad handshake");
        return;
      }
      const interval = typeof hs.pingInterval === "number" && hs.pingInterval > 0 ? hs.pingInterval : 25_000;
      const timeout = typeof hs.pingTimeout === "number" && hs.pingTimeout > 0 ? hs.pingTimeout : 20_000;
      pulse = [interval, timeout];
      if (prefix) send(`40${prefix}${nspQuery ? `?${nspQuery}` : ""},`);
      schedulePing(interval, timeout);
      return;
    }
    if (kind === "3") {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
      schedulePing(...pulse);
      return;
    }
    if (kind === "1") {
      shutdown(socket.connected ? "disconnect" : "connect_error", "transport close");
      return;
    }
    if (kind !== "4") return; // noop/upgrade и прочее — не для нас
    const packet = parsePacket(frame.slice(1));
    if (!packet || packet.nsp !== nsp) return;
    if (packet.type === 0) {
      if (socket.connected) return;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      socket.connected = true;
      fire("connect");
    } else if (packet.type === 1) {
      shutdown("disconnect", "io server disconnect");
    } else if (packet.type === 4) {
      // Ошибка пространства имён (отказ в подключении) — как «error» у 2.x.
      if (!socket.connected) shutdown("connect_error", "namespace error");
      else fire("error", packet.payload);
    } else if (packet.type === 2 && Array.isArray(packet.payload) && typeof packet.payload[0] === "string") {
      if (socket.connected || prefix === "") fire(packet.payload[0], packet.payload[1]);
    }
  };
  return socket;
}
