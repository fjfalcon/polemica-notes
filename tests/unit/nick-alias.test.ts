// @vitest-environment jsdom
/**
 * Свой ник игрока (просьба владельца 22.10.2026).
 *
 * Главный страж — ТЕКСТ САЙТА НЕ МЕНЯЕТСЯ: ник в плитке/списке/профиле/
 * разборе читают ключ заметки, сторожа и метки ролей. Свой ник живёт в
 * data-атрибуте, показывает его CSS; textContent узла остаётся ником сайта.
 * Плюс: очистка своего ника (управляющие и bidi-символы, длина), его
 * переживание слияний и бэкапа, индекс для списков, поиск в попапе.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({ onDomChangeImmediate: vi.fn(() => () => undefined) }));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } } },
}));

import {
  MAX_ALIAS,
  aliasFrom,
  buildAliasIndex,
  mergeNickKeysIntoId,
  mergeNotes,
  nickWithAlias,
  normalizeAlias,
  normalizeNoteRecord,
  type NotesMap,
} from "@core/notes-store";
import {
  ALIAS_ATTR,
  ALIAS_FOR_ATTR,
  ALIAS_SUFFIX_ATTR,
  AliasResolver,
  applyMatchAliases,
  clearAllAliases,
  setNickAlias,
  sweepStaleAliases,
  watchAliasText,
} from "@content/features/player-notes/nick-alias";
import { onDomChangeImmediate } from "@core/dom";
import { candidatesFromNotes, rankPlayerMatches } from "../../src/popup/player-search";

describe("очистка своего ника", () => {
  test("управляющие и переключатели направления вырезаются, пробелы схлопываются", () => {
    expect(normalizeAlias("  Ан\u0000я ‮киллер‬  ")).toBe("Аня киллер");
    expect(normalizeAlias("a​⁦b⁩﻿")).toBe("ab");
    expect(normalizeAlias("\n\t ")).toBeUndefined();
    expect(normalizeAlias(42)).toBeUndefined();
  });

  test("эмодзи-последовательности (ZWJ) не рвутся, длина — по символам", () => {
    expect(normalizeAlias("👨‍👩‍👧 Семья")).toBe("👨‍👩‍👧 Семья");
    const long = "🦄".repeat(MAX_ALIAS + 5);
    expect(Array.from(normalizeAlias(long) ?? "").length).toBe(MAX_ALIAS);
  });

  test("запись заметки хранит очищенный свой ник, мусорный — отбрасывает", () => {
    expect(normalizeNoteRecord({ text: "", timestamp: 1, alias: " Игорь " })?.alias).toBe("Игорь");
    expect(normalizeNoteRecord({ text: "", timestamp: 1, alias: ["x"] })).not.toHaveProperty("alias");
  });

  test("«Ник (свой)»: совпадение с ником без учёта регистра — просто ник", () => {
    expect(nickWithAlias("Igolka", "Игорь")).toBe("Igolka (Игорь)");
    expect(nickWithAlias("Igolka", "igolka")).toBe("Igolka");
    expect(nickWithAlias("Igolka", undefined)).toBe("Igolka");
  });
});

describe("свой ник переживает слияния", () => {
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000));

  test("миграция ник→id: свой ник проигравшей ник-записи переезжает", () => {
    const notes: NotesMap = {
      "u:42": { text: "новая", timestamp: 1_800_000_000_000 - 5 },
      Аня: { text: "старая", timestamp: 1, alias: "Анечка" },
    };
    expect(mergeNickKeysIntoId(notes, "Аня", 42)?.record.alias).toBe("Анечка");
  });

  test("импорт бэкапа: запись, отличающаяся только своим ником, — это обновление", () => {
    const local: NotesMap = { "u:42": { text: "x", timestamp: 100 } };
    const incoming: NotesMap = { "u:42": { text: "x", timestamp: 100, alias: "Анечка" } };
    const result = mergeNotes(local, incoming);
    expect(result.replaced, "засчитано обновлением, а не «уже есть»").toBe(1);
    expect((result.merged["u:42"] as { alias?: string }).alias).toBe("Анечка");
  });

  test("импорт: пустой свой ник более свежей записи берётся у старой", () => {
    const local: NotesMap = { "u:42": { text: "x", timestamp: 100, alias: "Анечка" } };
    const incoming: NotesMap = { "u:42": { text: "y", timestamp: 200 } };
    expect((mergeNotes(local, incoming).merged["u:42"] as { alias?: string }).alias).toBe("Анечка");
  });
});

describe("индекс своих ников", () => {
  test("по id приоритетно, по нику — из u:-записи и легаси-ключа", () => {
    const index = buildAliasIndex({
      "u:42": { text: "", timestamp: 1, nick: "Аня", alias: "Анечка" },
      "u:007": { text: "", timestamp: 1, alias: "Бонд" },
      Петя: { text: "", timestamp: 1, alias: "Пётр" },
      "u:9": { text: "", timestamp: 1, alias: "‮" },
    });
    expect(aliasFrom(index, 42, "кто-то")).toBe("Анечка");
    expect(aliasFrom(index, null, "аня")).toBe("Анечка");
    expect(aliasFrom(index, "7", null), "ключ канонизирован").toBe("Бонд");
    expect(aliasFrom(index, null, "Петя"), "легаси-ключ — точное написание").toBe("Пётр");
    expect(aliasFrom(index, null, "ПЕТЯ"), "тёзка по регистру — не он").toBe("");
    expect(aliasFrom(index, 9, null), "мусор из старого хранилища не показывается").toBe("");
  });

  test("резолвер: кэш сбрасывается явно — правка видна сразу", () => {
    const notes: NotesMap = { "u:42": { text: "", timestamp: 1, alias: "А" } };
    const r = new AliasResolver(() => notes);
    expect(r.aliasFor(42, null)).toBe("А");
    (notes["u:42"] as { alias?: string }).alias = "Б";
    expect(r.aliasFor(42, null), "в пределах TTL — кэш").toBe("А");
    r.reset();
    expect(r.aliasFor(42, null)).toBe("Б");
  });
});

describe("отрисовка: текст сайта не меняется", () => {
  const tile = (nick: string) => {
    document.body.innerHTML =
      `<div class="player desktop-version"><div class="player__botleftmenu"><div class="player__info info">` +
      `<div class="player-number player-0">1</div><span class="info__name">${nick}</span></div></div></div>`;
    return document.querySelector<HTMLElement>(".info__name")!;
  };

  test("замена в игре: атрибут, настоящий ник в title, textContent прежний", () => {
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    expect(el.getAttribute(ALIAS_ATTR)).toBe("Игорь");
    expect(el.getAttribute(ALIAS_FOR_ATTR)).toBe("Igolka");
    expect(el.title).toBe("Igolka");
    expect(el.textContent, "ник сайта нетронут — по нему ищется заметка").toBe("Igolka");
    expect(el.childNodes.length).toBe(1);
  });

  test("повторная запись — без изменений DOM (идемпотентно, §4)", () => {
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    const spy = vi.spyOn(el, "setAttribute");
    const rm = vi.spyOn(el, "removeAttribute");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    expect(spy).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  test("свой ник снят — title сайта не трогаем, свой убираем", () => {
    const el = tile("Igolka");
    el.title = "титул сайта";
    setNickAlias(el, "Игорь", "Igolka", "replace");
    expect(el.title, "чужой title не перезаписан").toBe("титул сайта");
    setNickAlias(el, "", "Igolka", "replace");
    expect(el.title).toBe("титул сайта");
    const el2 = tile("Igolka");
    setNickAlias(el2, "Игорь", "Igolka", "replace");
    setNickAlias(el2, "", "Igolka", "replace");
    expect(el2.hasAttribute("title")).toBe(false);
    expect(el2.hasAttribute(ALIAS_ATTR)).toBe(false);
  });

  test("суффикс для списков; совпавший с ником свой ник не показывается", () => {
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "suffix");
    expect(el.getAttribute(ALIAS_SUFFIX_ATTR)).toBe("Игорь");
    expect(el.hasAttribute(ALIAS_ATTR)).toBe(false);
    setNickAlias(el, "IGOLKA", "Igolka", "suffix");
    expect(el.hasAttribute(ALIAS_SUFFIX_ATTR)).toBe(false);
  });

  test("пересадка: в плитке теперь другой игрок — чужой свой ник снимается", () => {
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    el.textContent = "Outland";
    sweepStaleAliases();
    expect(el.hasAttribute(ALIAS_ATTR)).toBe(false);
    expect(el.hasAttribute("title")).toBe(false);
  });

  test("выключение снимает всё", () => {
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    clearAllAliases();
    expect(el.hasAttribute(ALIAS_ATTR) || el.hasAttribute(ALIAS_FOR_ATTR)).toBe(false);
  });

  test("таблица разбора: по id из ссылки, суффикс на ссылке (CSS разбора гасит ::after ячейки)", () => {
    // Разметка сайта: `cell player username`; заголовок строки — `.title`.
    document.body.innerHTML =
      '<div class="game-stats-table"><div class="table">' +
      '<div class="cell title username">Петя</div>' +
      '<div class="cell player username"><a class="pn-profile-link" href="/profile/42">Аня</a></div>' +
      '<div class="cell player username"><a class="pn-profile-link" href="/profile/7">vasya</a></div>' +
      '<div class="cell player username">Петя</div>' +
      '<div class="cell player username">Vasya</div></div></div>';
    const notes: NotesMap = {
      "u:42": { text: "", timestamp: 1, nick: "Аня", alias: "Анечка" },
      "u:1": { text: "", timestamp: 1, nick: "Vasya", alias: "Игорь" },
      Петя: { text: "", timestamp: 1, alias: "Пётр" },
    };
    applyMatchAliases(new AliasResolver(() => notes));
    const [title, a, v, p, noLink] = Array.from(document.querySelectorAll<HTMLElement>(".cell.username"));
    const link = a.querySelector("a")!;
    expect(link.getAttribute(ALIAS_SUFFIX_ATTR)).toBe("Анечка");
    expect(a.hasAttribute(ALIAS_SUFFIX_ATTR), "не на ячейке").toBe(false);
    expect(a.textContent).toBe("Аня");
    expect(v.querySelector("a")!.hasAttribute(ALIAS_SUFFIX_ATTR), "чужой (u:1) по нику не берётся").toBe(false);
    expect(p.getAttribute(ALIAS_SUFFIX_ATTR), "без ссылки — точный легаси-ключ").toBe("Пётр");
    expect(title.hasAttribute(ALIAS_SUFFIX_ATTR), "заголовок строки — не игрок").toBe(false);
    expect(noLink.hasAttribute(ALIAS_SUFFIX_ATTR), "без id — по истории ников u:-записей не берём").toBe(false);
  });

  test("БЛОКЕР ревью: при известном id чужой свой ник по совпадению ника не берётся", () => {
    const index = buildAliasIndex({ "u:1": { text: "", timestamp: 1, nick: "Vasya", alias: "Игорь" } });
    expect(aliasFrom(index, 2, "vasya"), "другой аккаунт с тем же ником").toBe("");
    expect(aliasFrom(index, null, "vasya"), "без id — фолбэк по нику (как у заметок)").toBe("Игорь");
    const r = new AliasResolver(() => ({ "u:1": { text: "", timestamp: 1, alias: "Игорь" } }), () => false);
    expect(r.aliasFor(1, null), "тумблер выключен — ничего").toBe("");
  });

  test("смена ника на месте снимает свой ник сразу (немедленный подписчик)", () => {
    let cb: ((m: MutationRecord[]) => void) | null = null;
    vi.mocked(onDomChangeImmediate).mockImplementation((fn) => {
      cb = fn;
      return () => undefined;
    });
    const el = tile("Igolka");
    setNickAlias(el, "Игорь", "Igolka", "replace");
    watchAliasText();
    const text = el.firstChild as Text;
    text.data = "Outland";
    cb!([{ type: "characterData", target: text } as unknown as MutationRecord]);
    expect(el.hasAttribute(ALIAS_ATTR)).toBe(false);
  });
});

describe("поиск в попапе", () => {
  test("находится по своему нику и показывает его", () => {
    const candidates = candidatesFromNotes({
      "u:42": { text: "", timestamp: 1, nick: "Igolka", alias: "Игорь" },
      "u:7": { text: "", timestamp: 1, nick: "Outland" },
    });
    const hits = rankPlayerMatches("игор", candidates);
    expect(hits.map((h) => h.id)).toEqual(["42"]);
    expect(hits[0].alias).toBe("Игорь");
  });
});
