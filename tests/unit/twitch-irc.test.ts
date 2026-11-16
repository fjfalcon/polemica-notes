/**
 * Общий разбор Twitch IRC (16.11.2026): им пользуются и панель чата, и
 * фоновое реле — догруженное сообщение обязано выглядеть как живое.
 */
import { describe, expect, test } from "vitest";

import {
  ircCommandOf,
  isMessageId,
  normalizeChannel,
  parsePrivMsgLine,
  sanitizeRelayMessages,
} from "@shared/twitch-irc";

const ID = "477c6790-c815-4260-9d28-fa595b1584ff";
const line = (tags: string, text: string) => `@${tags} :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :${text}`;

describe("PRIVMSG", () => {
  test("id и время отправки — из тегов; ник, цвет и бейджи как раньше", () => {
    const chat = parsePrivMsgLine(
      line(`badges=moderator/1,subscriber/12;color=#1E90FF;display-name=Зритель\\sОдин;id=${ID};tmi-sent-ts=1794793937217`, "привет!"),
    );
    expect(chat).toEqual({
      id: ID,
      ts: 1794793937217,
      username: "Зритель Один",
      message: "привет!",
      color: "#1E90FF",
      badges: ["🛡", "★"],
    });
  });

  test("мусорный id ключом дедупа не становится; нет тегов — сообщение всё равно разбирается", () => {
    expect(parsePrivMsgLine(line("id=<script>;tmi-sent-ts=abc", "x"))).toMatchObject({ id: undefined, ts: undefined });
    expect(parsePrivMsgLine(":viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :без тегов")).toMatchObject({
      username: "viewer",
      message: "без тегов",
      badges: [],
    });
  });

  test("/me без управляющих байтов; не PRIVMSG — null", () => {
    expect(parsePrivMsgLine(line(`id=${ID}`, "\u0001ACTION машет\u0001"))?.message).toBe("машет");
    expect(parsePrivMsgLine(":tmi.twitch.tv 366 justinfan1 #streamer :End of /NAMES list")).toBeNull();
  });
});

describe("служебное", () => {
  test("команда строки и имя канала", () => {
    expect(ircCommandOf(line(`id=${ID}`, "x"))).toBe("PRIVMSG");
    expect(ircCommandOf(":tmi.twitch.tv 366 a #b :End")).toBe("366");
    expect(normalizeChannel(" https://twitch.tv/Some_Streamer ")).toBe("some_streamer");
    expect(normalizeChannel("#канал")).toBe("");
    expect(isMessageId(ID)).toBe(true);
    expect(isMessageId("x")).toBe(false);
  });
});

describe("ответ реле — недоверенный ввод", () => {
  const good = { id: ID, ts: 1794793937217, username: "Зритель", message: "привет", color: "#aabbcc", badges: ["🛡"] };

  test("целое сообщение проходит; цвет и бейджи — только допустимые", () => {
    expect(sanitizeRelayMessages([good], 200)).toEqual([good]);
    expect(
      sanitizeRelayMessages([{ ...good, color: "red;background:url(x)", badges: ["<img>", "★", "★"] }], 200),
    ).toEqual([{ ...good, color: undefined, badges: ["★"] }]);
  });

  test("битые записи отбрасываются целиком; не массив — пусто; потолок числа", () => {
    expect(
      sanitizeRelayMessages(
        [null, 1, { ...good, id: "nope" }, { ...good, ts: -1 }, { ...good, username: " " }, { ...good, message: "" }],
        200,
      ),
    ).toEqual([]);
    expect(sanitizeRelayMessages({ length: 1 }, 200)).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i) => ({ ...good, id: `${ID.slice(0, -1)}${i}` }));
    expect(sanitizeRelayMessages(many, 2).map((m) => m.id.slice(-1))).toEqual(["3", "4"]);
  });
});
