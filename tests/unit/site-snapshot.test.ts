/**
 * Журнал версий бандлов сайта (scripts/site-snapshot.mjs): чистая логика —
 * когда наблюдение считается новой версией, как называется файл в архиве и
 * что показывает сравнение двух минифицированных бандлов.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  WATCHED,
  archiveName,
  emptyJournal,
  literalDiff,
  recordVersion,
  sha256Of,
} from "../../scripts/site-snapshot.mjs";

const ROOT = path.resolve(__dirname, "../..");
const URL = "https://polemicagame.com/bundle/game-search.js";
const seen = "2026-11-16";

describe("recordVersion", () => {
  test("первое наблюдение создаёт запись, то же sha второй раз — нет", () => {
    const journal = emptyJournal();
    expect(recordVersion(journal, "gameSearch", URL, { sha256: "a".repeat(64), bytes: 10, seen })).toBe(true);
    expect(recordVersion(journal, "gameSearch", URL, { sha256: "a".repeat(64), bytes: 10, seen: "2026-11-17" })).toBe(
      false,
    );
    expect(journal.files.gameSearch.versions).toHaveLength(1);
    // День первого наблюдения повторным прогоном не переписывается.
    expect(journal.files.gameSearch.versions[0].seen).toBe(seen);
  });

  test("другое sha — новая строка в конце, старые не трогаются", () => {
    const journal = emptyJournal();
    recordVersion(journal, "gameSearch", URL, { sha256: "a".repeat(64), bytes: 10, seen });
    expect(recordVersion(journal, "gameSearch", URL, { sha256: "b".repeat(64), bytes: 12, seen })).toBe(true);
    expect(journal.files.gameSearch.versions.map((v) => v.sha256[0])).toEqual(["a", "b"]);
  });

  test("откат сайта к прежней сборке — отдельное событие, а не «уже видели»", () => {
    const journal = emptyJournal();
    for (const letter of ["a", "b", "a"]) {
      recordVersion(journal, "gameSearch", URL, { sha256: letter.repeat(64), bytes: 1, seen });
    }
    expect(journal.files.gameSearch.versions.map((v) => v.sha256[0])).toEqual(["a", "b", "a"]);
  });
});

describe("archiveName", () => {
  test("дата выкладки по серверу, начало sha и расширение из url", () => {
    const version = { sha256: "ce5f2df95993f7bb" + "0".repeat(48), lastModified: "2026-11-13T05:48:33.000Z", seen };
    expect(archiveName(URL, version)).toBe("2026-11-13_ce5f2df95993.js.gz");
    expect(archiveName("https://polemicagame.com/bundle/main.css", version)).toBe("2026-11-13_ce5f2df95993.css.gz");
  });

  test("без Last-Modified берётся день наблюдения", () => {
    expect(archiveName(URL, { sha256: "f".repeat(64), seen })).toBe("2026-11-16_ffffffffffff.js.gz");
  });
});

describe("literalDiff", () => {
  test("минифицированная строка: видны появившиеся и пропавшие литералы", () => {
    const before = 'a.on("lobby-created",function(){b("search__card")});c("queue_old")';
    const after = "a.on(\"lobby-created\",function(){b('search__card');d(\"lobby-double-create\")})";
    expect(literalDiff(before, after)).toEqual({ added: ["lobby-double-create"], removed: ["queue_old"] });
  });

  test("пустая строка не сбивает проход: её вторая кавычка не открывает новую строку", () => {
    const before = 'x={a:"",phase:"Card distribution",b:"First night"}';
    const after = 'x={a:"",phase:"Dealing the cards",b:"First night"}';
    expect(literalDiff(before, after)).toEqual({ added: ["Dealing the cards"], removed: ["Card distribution"] });
  });

  test("апостроф внутри двойных кавычек, экранированная кавычка и шаблонная строка", () => {
    const text = 'x={a:"Can\'t authorize",b:"say \\"hi\\" now",c:e=>`Day ${e}`}';
    const { added } = literalDiff("", text);
    expect(added).toEqual(["Can't authorize", "Day ${e}", 'say \\"hi\\" now']);
  });

  test("одинаковый текст — пусто; смена кавычек отличием не считается", () => {
    expect(literalDiff('x("phase")', "x('phase')")).toEqual({ added: [], removed: [] });
  });
});

describe("состав наблюдения", () => {
  test("sha256Of — обычный sha256 от байтов", () => {
    expect(sha256Of(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("всё, что сторожит контракт сайта, попадает и в журнал — под теми же именами", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/site-contract.json"), "utf8")) as {
      bundles: Record<string, { url: string }>;
    };
    for (const [key, bundle] of Object.entries(fixture.bundles)) {
      expect(`https://polemicagame.com${WATCHED[key]}`, key).toBe(bundle.url);
    }
  });

  test("архив с чужим кодом в git не попадает", () => {
    const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignore).toContain("site-history/");
  });
});
