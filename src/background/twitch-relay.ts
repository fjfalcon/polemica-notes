/**
 * Реле Twitch-чата в фоне (просьба владельца 16.11.2026): «игра закончилась,
 * пока открывалась новая страница, кто-то написал — сообщение потерялось;
 * то же при входе в лобби».
 *
 * Причина: соединение с чатом живёт в content-скрипте СТРАНИЦЫ. Сайт между
 * поиском, лобби и игрой переходит полной загрузкой, сокет умирает вместе со
 * страницей, а анонимный IRC Twitch пропущенное не досылает.
 *
 * Решение: фон держит СВОЁ анонимное подключение к тому же каналу и буфер
 * последних сообщений. Панель чата на странице остаётся главной (её сокет,
 * статусы и переподключения не тронуты), а после входа в канал забирает у
 * реле буфер и дорисовывает то, чего у неё нет (дедуп по id сообщения).
 *
 * Жизнь реле: страница, у которой чат подключён, раз в 20 с шлёт «нужно»
 * (twitch_relay_want). Реле живёт, пока «нужно» свежее GRACE_MS — этого
 * хватает, чтобы пережить переход между страницами, и не больше: чат
 * выключили или вкладку закрыли — через две минуты реле гаснет само, фон
 * может спать.
 *
 * Сервис-воркер Chrome засыпает через 30 с без активности: тик раз в 20 с
 * шлёт PING в IRC (обмен по сокету продлевает жизнь воркера, Chrome ≥116;
 * заодно это детектор молча умершего соединения) и дёргает лёгкий API
 * расширения. Для event page Firefox это страховка НЕПРОВЕРЕННАЯ (ревью
 * 16.11.2026): надёжно его будят сообщения вкладок («нужно» раз в 20 с и на
 * pagehide), а переход между страницами — секунды. Худший случай в Firefox —
 * фон уснёт через ~30 с без вкладок вместо двух минут грейса. Если фон
 * перезапустился, буфер пуст и догружать нечего — поведение как до реле.
 *
 * В логи — только факты (подключились/оборвалось/счётчики), без ников и
 * текста сообщений. Буфер живёт только в памяти.
 */
import { browser } from "@core/env";
import { log } from "@core/log";
import {
  TWITCH_IRC_URL,
  ircCommandOf,
  normalizeChannel,
  parsePrivMsgLine,
  type RelayChatMessage,
} from "@shared/twitch-irc";

const SCOPE = "twitch-relay";

/** Сколько реле живёт после последнего «нужно» от страницы. */
export const GRACE_MS = 120_000;
/** Тик: PING в IRC и продление жизни фона. */
export const TICK_MS = 20_000;
/** Тишина дольше этого при открытом сокете (PING шлём каждые 20 с) — сокет мёртв. */
const DEAD_AFTER_MS = 50_000;
/** Сокет не открылся за это время — рукопожатие зависло, заменяем. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Потолок буфера и возраста сообщений в нём. */
export const BUFFER_MAX = 200;
export const BUFFER_MAX_AGE_MS = 10 * 60_000;
/** Задержка переподключения: 2, 4, 8… до 30 с. */
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;
/** Потолок длины сообщения в буфере (IRC-строка и так ~500). */
const MESSAGE_MAX = 600;

let channel = "";
let socket: WebSocket | null = null;
let joined = false;
let wantedUntil = 0;
let lastActivityAt = 0;
let attempts = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** `at` — когда сообщение получили МЫ: возраст считаем по своим часам, не по часам Twitch. */
let buffer: Array<{ at: number; msg: RelayChatMessage }> = [];
const seen = new Set<string>();

function wanted(): boolean {
  return channel !== "" && Date.now() <= wantedUntil;
}

function dropSocket(): void {
  if (!socket) return;
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  try {
    socket.close();
  } catch {
    /* уже закрыт */
  }
  socket = null;
  joined = false;
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearBuffer(): void {
  buffer = [];
  seen.clear();
}

/** Полная остановка: чат больше никому не нужен. */
function shutdown(reason: string): void {
  if (!socket && !tickTimer && !reconnectTimer && buffer.length === 0) return;
  log.info(SCOPE, "реле остановлено:", reason);
  clearReconnect();
  dropSocket();
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  clearBuffer();
  channel = "";
  attempts = 0;
}

function scheduleReconnect(): void {
  if (!wanted() || reconnectTimer) return;
  attempts++;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wanted()) connect();
  }, delay);
}

function remember(line: string): void {
  const parsed = parsePrivMsgLine(line);
  // Без id дедуп невозможен — такое сообщение страница получит только вживую.
  if (!parsed || !parsed.id || seen.has(parsed.id)) return;
  seen.add(parsed.id);
  const now = Date.now();
  buffer.push({
    at: now,
    msg: {
      id: parsed.id,
      ts: parsed.ts ?? now,
      username: parsed.username.slice(0, 100),
      message: parsed.message.replace(/[\u0000-\u001f]/g, "").slice(0, MESSAGE_MAX),
      color: parsed.color,
      badges: parsed.badges,
    },
  });
  if (buffer.length > BUFFER_MAX) {
    const gone = buffer.shift();
    if (gone) seen.delete(gone.msg.id);
  }
}

function onData(ws: WebSocket, data: string): void {
  for (const line of data.split("\r\n")) {
    if (!line) continue;
    if (line.startsWith("PING")) {
      ws.send(line.replace("PING", "PONG"));
      continue;
    }
    const command = ircCommandOf(line);
    if (!joined && command === "366") {
      joined = true;
      attempts = 0;
      log.info(SCOPE, "реле вошло в канал");
      continue;
    }
    if (command === "PRIVMSG") remember(line);
  }
}

function connect(): void {
  clearReconnect();
  dropSocket();
  if (!wanted()) return;
  const target = channel;
  let ws: WebSocket;
  try {
    ws = new WebSocket(TWITCH_IRC_URL);
  } catch (e) {
    log.warn(SCOPE, "реле: сокет не создан", (e as Error)?.message || "");
    scheduleReconnect();
    return;
  }
  socket = ws;
  lastActivityAt = Date.now();
  ws.onopen = () => {
    if (socket !== ws) return;
    lastActivityAt = Date.now();
    // Теги дают id сообщения (ключ дедупа), цвет ника и бейджи.
    ws.send("CAP REQ :twitch.tv/tags");
    ws.send("PASS SCHMOOPIIE");
    ws.send(`NICK justinfan${Math.floor(Math.random() * 100000)}`);
    ws.send(`JOIN #${target}`);
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    lastActivityAt = Date.now();
    try {
      onData(ws, String(event.data));
    } catch (e) {
      log.warn(SCOPE, "реле: строка не разобрана", (e as Error)?.message || "");
    }
  };
  ws.onclose = (event) => {
    if (socket !== ws) return;
    log.info(SCOPE, "реле: соединение закрыто, код", event.code, joined ? "| было в канале" : "| до входа");
    socket = null;
    joined = false;
    scheduleReconnect();
  };
  ws.onerror = () => {
    // Следом придёт onclose — переподключение там.
  };
}

function tick(): void {
  if (!wanted()) {
    shutdown("страницам чат больше не нужен");
    return;
  }
  // Продление жизни фона (event page Firefox / сервис-воркер Chrome).
  void browser.runtime.getPlatformInfo().catch(() => undefined);
  if (!socket) {
    if (!reconnectTimer) connect();
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    // Завис в CONNECTING: браузер сам сдаётся минутами, а буфер всё это время пуст.
    if (Date.now() - lastActivityAt > CONNECT_TIMEOUT_MS) {
      log.warn(SCOPE, "реле: сокет не открылся — пробуем заново");
      dropSocket();
      connect();
    }
    return;
  }
  if (Date.now() - lastActivityAt > DEAD_AFTER_MS) {
    log.warn(SCOPE, "реле: сокет молчит — переподключаемся");
    dropSocket();
    connect();
    return;
  }
  try {
    socket.send("PING :pn");
  } catch {
    /* закрывается — onclose переподключит */
  }
}

/** Страница сообщила: чат на этом канале нужен. Поднимает и продлевает реле. */
export function relayWant(rawChannel: unknown): void {
  const next = typeof rawChannel === "string" ? normalizeChannel(rawChannel) : "";
  if (!next) return;
  if (next !== channel) {
    // Другой канал — буфер старого под новый не тащим.
    clearReconnect();
    dropSocket();
    clearBuffer();
    channel = next;
    attempts = 0;
  }
  wantedUntil = Date.now() + GRACE_MS;
  if (!tickTimer) tickTimer = setInterval(tick, TICK_MS);
  if (!socket && !reconnectTimer) connect();
}

/** Пользователь выключил чат — реле гаснет сразу, не дожидаясь грейса. */
export function relayRelease(): void {
  wantedUntil = 0;
  shutdown("чат выключен");
}

/** Буфер для страницы: только свой канал и только свежее. */
export function relayBacklog(rawChannel: unknown): RelayChatMessage[] {
  const asked = typeof rawChannel === "string" ? normalizeChannel(rawChannel) : "";
  if (!asked || asked !== channel) return [];
  const since = Date.now() - BUFFER_MAX_AGE_MS;
  return buffer.filter((e) => e.at >= since).map((e) => e.msg);
}

/**
 * Разбор сообщений вкладок. `fromTab` — отправитель content-скрипт вкладки:
 * у попапа вкладки нет, и реле «ни для кого» подниматься не должно.
 * Не наше сообщение — handled:false, фон идёт дальше по своим обработчикам.
 */
export function handleRelayMessage(
  msg: unknown,
  fromTab: boolean,
): { handled: boolean; reply?: Promise<{ messages: RelayChatMessage[] }> } {
  const m = msg as { type?: unknown; channel?: unknown } | null;
  switch (m?.type) {
    case "twitch_relay_want":
      if (fromTab) relayWant(m.channel);
      return { handled: true };
    case "twitch_relay_backlog":
      return { handled: true, reply: Promise.resolve({ messages: fromTab ? relayBacklog(m.channel) : [] }) };
    case "twitch_relay_release":
      if (fromTab) relayRelease();
      return { handled: true };
    default:
      return { handled: false };
  }
}

/** Тестовый шов: состояние реле. */
export function relayStateForTest(): { channel: string; joined: boolean; buffered: number; running: boolean } {
  return { channel, joined, buffered: buffer.length, running: tickTimer !== null };
}

/** Тестовый шов: сброс модульного состояния. */
export function resetRelayForTest(): void {
  wantedUntil = 0;
  clearReconnect();
  dropSocket();
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  clearBuffer();
  channel = "";
  attempts = 0;
  lastActivityAt = 0;
}
