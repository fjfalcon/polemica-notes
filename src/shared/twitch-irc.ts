/**
 * Разбор Twitch IRC — общий для панели чата (content) и фонового реле
 * (background/twitch-relay). Чистые функции, без окружения.
 *
 * Вынесено 16.11.2026: реле в фоне держит своё подключение к чату и буфер
 * последних сообщений, чтобы страница после перехода (конец игры → поиск →
 * лобби) забрала пропущенное. Разбирать строки по-разному в двух местах
 * значило бы показывать «догруженные» сообщения иначе, чем живые.
 */

export const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

/** Бейджи → наши эмодзи-префиксы (константы, в HTML попадают только они). */
export const BADGE_ICONS: Record<string, string> = {
  broadcaster: "🎥",
  moderator: "🛡",
  vip: "💎",
  subscriber: "★",
  founder: "★",
};

/** Известные значки бейджей — единственные строки, допущенные в HTML. */
export const KNOWN_BADGES: ReadonlySet<string> = new Set(Object.values(BADGE_ICONS));

/** Идентификатор сообщения Twitch (UUID). Чужая строка ключом дедупа не станет. */
const MESSAGE_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export function isMessageId(value: unknown): value is string {
  return typeof value === "string" && MESSAGE_ID_RE.test(value);
}

/**
 * Пользователи вставляют URL канала или имя с #/пробелами — Twitch на такой
 * JOIN молча не отвечает, а панель писала «Подключились к чату».
 */
export function normalizeChannel(raw: string): string {
  let name = raw.trim().toLowerCase();
  const m = name.match(/(?:twitch\.tv\/)([a-z0-9_]+)/);
  if (m) name = m[1];
  return name.replace(/^#+/, "").replace(/[^a-z0-9_]/g, "");
}

/** Команда IRC-строки (PRIVMSG/NOTICE/366/…) без её содержимого. */
export function ircCommandOf(line: string): string {
  const noTags = line.startsWith("@") ? line.slice(line.indexOf(" ") + 1) : line;
  const parts = noTags.startsWith(":") ? noTags.split(" ") : ["", ...noTags.split(" ")];
  return /^[A-Z0-9]{2,12}$/.test(parts[1] || "") ? parts[1] : "?";
}

/** Экранирование значений IRC-тегов (IRCv3): \s → пробел, \: → «;» и т.д. */
function unescapeTag(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => {
    if (c === "s") return " ";
    if (c === ":") return ";";
    if (c === "r") return "\r";
    if (c === "n") return "\n";
    return c;
  });
}

export function parseTags(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) out[pair] = "";
    else out[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
  }
  return out;
}

export function parseBadges(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw.split(",")) {
    const name = item.split("/")[0];
    const icon = BADGE_ICONS[name];
    if (icon && !out.includes(icon)) out.push(icon);
  }
  return out;
}

/** Сообщение чата, разобранное из PRIVMSG. */
export interface ParsedChat {
  /** Тег id — ключ дедупа между живым чатом, историей и буфером реле. */
  id?: string;
  /** Тег tmi-sent-ts — время отправки по часам Twitch, мс. */
  ts?: number;
  username: string;
  message: string;
  /** Проверенный #rrggbb либо undefined. */
  color?: string;
  /** Эмодзи-префиксы бейджей — только из BADGE_ICONS. */
  badges: string[];
}

/** Разобрать строку PRIVMSG. Не PRIVMSG или мусор — null. */
export function parsePrivMsgLine(line: string): ParsedChat | null {
  // С CAP tags строка может начинаться с @key=value;…, дальше как раньше:
  // :username!username@username.tmi.twitch.tv PRIVMSG #channel :message
  const match = line.match(/^(?:@(\S+) )?:([^!]+)![^@]+@[^\s]+ PRIVMSG #[^\s]+ :(.+)/);
  if (!match) return null;
  const tags = parseTags(match[1]);
  // display-name сохраняет регистр и юникод; пустой (или из одних пробелов
  // после \s-unescape) у части аккаунтов — тогда логин.
  const username = (tags["display-name"] || "").trim() || match[2];
  let message = match[3];
  // /me приходит как \x01ACTION текст\x01 — управляющие байты в чат не пускаем.
  if (message.startsWith("\u0001ACTION ")) {
    message = message.slice(8).replace(/\u0001$/, "").trim();
  }
  // Цвет уходит в inline-style — принимаем СТРОГО #rrggbb, ничего больше.
  const rawColor = tags["color"] || "";
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : undefined;
  const ts = Number(tags["tmi-sent-ts"]);
  return {
    id: isMessageId(tags["id"]) ? tags["id"] : undefined,
    ts: Number.isFinite(ts) && ts > 0 ? ts : undefined,
    username,
    message,
    color,
    badges: parseBadges(tags["badges"]),
  };
}

/** Сообщение в буфере реле и в ответе странице. */
export interface RelayChatMessage {
  id: string;
  ts: number;
  username: string;
  message: string;
  color?: string;
  badges: string[];
}

/**
 * Ответ реле — недоверенный для панели так же, как sessionStorage: фон наш,
 * но цвет уходит в inline-style, а бейджи в HTML, и граница одна на все входы.
 */
export function sanitizeRelayMessages(raw: unknown, limit: number): RelayChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: RelayChatMessage[] = [];
  for (const item of raw.slice(-limit)) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (!isMessageId(m.id)) continue;
    if (typeof m.ts !== "number" || !Number.isFinite(m.ts) || m.ts <= 0) continue;
    if (typeof m.username !== "string" || !m.username.trim() || m.username.length > 100) continue;
    if (typeof m.message !== "string" || !m.message || m.message.length > 2000) continue;
    out.push({
      id: m.id,
      ts: m.ts,
      username: m.username,
      message: m.message,
      color: typeof m.color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : undefined,
      badges: Array.isArray(m.badges)
        ? [...new Set(m.badges.filter((b): b is string => typeof b === "string" && KNOWN_BADGES.has(b)))].slice(0, 5)
        : [],
    });
  }
  return out;
}
