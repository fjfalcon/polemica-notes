// @vitest-environment jsdom
/**
 * «Поиск игрока» в попапе (09.10.2026): ранжирование, слияние источников
 * и разбор заметок. Сеть и хранилище сюда не заходят.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/env", () => ({ browser: { storage: { local: { get: vi.fn() } } } }));

import { candidatesFromNotes, rankPlayerMatches, type Candidate } from "@popup/player-search";

const c = (nick: string, id: string, source: Candidate["source"], extra: Partial<Candidate> = {}) =>
  ({ nick, id, source, ...extra }) as Candidate;

describe("rankPlayerMatches", () => {
  test("точный ник → начало → подстрока; внутри — по MMR", () => {
    const hits = rankPlayerMatches("лис", [
      c("Алиса", "1", "rating", { mmr: 3000 }),
      c("Лисичка", "2", "rating", { mmr: 1000 }),
      c("лис", "3", "seen"),
      c("Лиса", "4", "rating", { mmr: 2000 }),
    ]);
    expect(hits.map((h) => h.id)).toEqual(["3", "4", "2", "1"]);
  });

  test("один id из разных источников — одна строка, источники слиты", () => {
    const hits = rankPlayerMatches("bob", [
      c("Bob", "7", "rating", { mmr: 2100 }),
      c("bob", "7", "seen"),
      c("Bob", "7", "note"),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].sources.sort()).toEqual(["note", "rating", "seen"]);
    expect(hits[0].mmr).toBe(2100);
  });

  test("переименовался — находится по прежнему нику из заметок, с пометкой", () => {
    const hits = rankPlayerMatches("старый", [
      c("НовыйНик", "9", "note", { oldNicks: ["СтарыйНик"] }),
    ]);
    expect(hits[0]?.id).toBe("9");
    expect(hits[0]?.matchedOldNick).toBe("СтарыйНик");
  });

  test("прежний ник ранжируется ниже совпадения по текущему", () => {
    const hits = rankPlayerMatches("max", [
      c("Other", "1", "note", { oldNicks: ["Max"] }),
      c("Maxwell", "2", "rating"),
    ]);
    expect(hits.map((h) => h.id)).toEqual(["2", "1"]);
  });

  test("цифры — это id: совпадение по id первым", () => {
    const hits = rankPlayerMatches("42", [c("Player42", "100", "rating"), c("Кто-то", "42", "seen")]);
    expect(hits[0].id).toBe("42");
  });

  test("слишком короткий запрос — пусто (одна буква дала бы полрейтинга)", () => {
    expect(rankPlayerMatches("а", [c("Аня", "1", "rating")])).toEqual([]);
  });

  test("не больше 20 строк", () => {
    const many = Array.from({ length: 50 }, (_, i) => c(`test${i}`, String(i), "rating"));
    expect(rankPlayerMatches("test", many)).toHaveLength(20);
  });
});

describe("candidatesFromNotes", () => {
  test("берёт только id-ключи с ником; история ников — в oldNicks", () => {
    const out = candidatesFromNotes({
      "u:15": { text: "", timestamp: 1, nick: "Нов", nicks: ["Стар", 5 as unknown as string] },
      "ник-ключ": { text: "", timestamp: 1, nick: "Старая запись" },
      "u:16": { text: "", timestamp: 1 },
      "u:abc": { text: "", timestamp: 1, nick: "битый" },
    });
    expect(out).toEqual([{ nick: "Нов", id: "15", source: "note", oldNicks: ["Стар"] }]);
  });
});
