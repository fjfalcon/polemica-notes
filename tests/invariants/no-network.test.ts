/**
 * Сторож сети офлайн-набора (tests/setup/no-network.ts) сам должен быть
 * проверен: без него правило «сеть — только tests/contract» снова держалось
 * бы на честном слове, как до 19.11.2026.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { takeNetworkLeaks } from "../setup/no-network";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("сторож сети", () => {
  test("незаглушённый fetch в сеть не уходит: отклоняется и запоминается с адресом", async () => {
    const cases: Array<[unknown, string]> = [
      ["https://game.polemicagame.com/api/search", "https://game.polemicagame.com/api/search"],
      [new URL("https://polemicagame.com/api/games"), "https://polemicagame.com/api/games"],
      [new Request("https://polemicagame.com/x"), "https://polemicagame.com/x"],
    ];
    for (const [input, shown] of cases) {
      await expect(fetch(input as RequestInfo)).rejects.toThrow(`сеть в unit-тестах запрещена: fetch(${shown})`);
    }
    // Забираем сами: иначе сторож справедливо уронил бы и этот тест.
    expect(takeNetworkLeaks()).toEqual(cases.map(([, shown]) => shown));
    expect(takeNetworkLeaks()).toEqual([]);
  });

  test("отказ — как обрыв связи (TypeError): фичи переживают его штатным путём", async () => {
    const error = await fetch("https://polemicagame.com/y").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    takeNetworkLeaks();
  });

  test("своя заглушка работает поверх, после снятия сторож возвращается", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    await expect(fetch("https://polemicagame.com/z")).resolves.toEqual({ ok: true });
    expect(takeNetworkLeaks()).toEqual([]);
    vi.unstubAllGlobals();
    await expect(fetch("https://polemicagame.com/z")).rejects.toThrow("запрещена");
    expect(takeNetworkLeaks()).toEqual(["https://polemicagame.com/z"]);
  });

  test("сторож подключён к офлайн-набору и НЕ подключён к живому контракту", () => {
    expect(read("vitest.config.ts")).toContain('setupFiles: ["tests/setup/no-network.ts"]');
    // Контракт ходит в сеть по определению — там сторож всё сломал бы.
    expect(read("vitest.contract.config.ts")).not.toContain("no-network");
  });

  test("утечка валит тест, в котором случилась", () => {
    const src = read("tests/setup/no-network.ts");
    expect(src).toContain("afterEach(failOnLeaks);");
    expect(src).toContain("afterAll(failOnLeaks);");
    expect(src).toContain("expect.fail(");
  });
});
