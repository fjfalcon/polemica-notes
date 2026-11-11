/**
 * «Сводка стола» — чистая модель (09.10.2026). Сторожим то, что окно
 * утверждает про игроков: суммы сторон, винрейт без деления на ноль,
 * «тройки» по MMR и честность сортировки на маленьких выборках.
 */
import { describe, expect, test } from "vitest";
import {
  MIN_GAMES_FOR_RANK,
  mmrTiers,
  roleTotals,
  sortRows,
  winratePct,
  type SummaryRow,
} from "@shared/table-summary";

function row(seat: number, over: Partial<SummaryRow> = {}): SummaryRow {
  return { seat, nick: `p${seat}`, id: String(seat), mmr: null, totals: null, status: "ok", ...over };
}

describe("roleTotals", () => {
  test("красные = мирный + шериф, чёрные = мафия + дон", () => {
    const t = roleTotals({
      civilian: { games_count: 20, wins_count: 12 },
      sheriff: { games_count: 5, wins_count: 3 },
      mafia: { games_count: 8, wins_count: 4 },
      godfather: { games_count: 2, wins_count: 2 },
    });
    expect(t).toEqual({ civGames: 25, civWins: 15, mafGames: 10, mafWins: 6 });
  });

  test("мусор и пропуски — нули, а не NaN", () => {
    expect(roleTotals({ civilian: { games_count: "x", wins_count: -3 } })).toEqual({
      civGames: 0,
      civWins: 0,
      mafGames: 0,
      mafWins: 0,
    });
    expect(roleTotals(null).civGames).toBe(0);
  });
});

describe("winratePct", () => {
  test("ноль игр — null (ноль игр ≠ ноль процентов)", () => {
    expect(winratePct(0, 0)).toBeNull();
  });
  test("процент с одним знаком; побед больше игр не бывает", () => {
    expect(winratePct(1, 3)).toBe(33.3);
    expect(winratePct(9, 3)).toBe(100);
  });
});

describe("mmrTiers", () => {
  test("три сверху, три снизу, остальные — середина", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((s) => row(s, { mmr: 1000 + s * 100 }));
    const t = mmrTiers(rows);
    expect([7, 6, 5].map((s) => t.get(s))).toEqual(["top", "top", "top"]);
    expect([1, 2, 3].map((s) => t.get(s))).toEqual(["bottom", "bottom", "bottom"]);
    expect(t.get(4)).toBe("mid");
  });

  test("меньше шести известных MMR — без деления (тройки пересеклись бы)", () => {
    const rows = [1, 2, 3, 4, 5].map((s) => row(s, { mmr: 1000 + s }));
    expect(mmrTiers(rows).size).toBe(0);
  });

  test("неизвестный MMR не участвует и цвета не получает", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((s) => row(s, { mmr: 1000 + s }));
    rows.push(row(7));
    expect(mmrTiers(rows).has(7)).toBe(false);
  });
});

describe("sortRows", () => {
  const t = (mafGames: number, mafWins: number, civGames = 0, civWins = 0) => ({
    mafGames,
    mafWins,
    civGames,
    civWins,
  });

  test("по месту — как за столом", () => {
    expect(sortRows([row(3), row(1), row(2)], "seat").map((r) => r.seat)).toEqual([1, 2, 3]);
  });

  test("«сильные чёрные»: винрейт за мафию по убыванию", () => {
    const rows = [row(1, { totals: t(20, 8) }), row(2, { totals: t(20, 14) }), row(3, { totals: t(20, 10) })];
    expect(sortRows(rows, "maf").map((r) => r.seat)).toEqual([2, 3, 1]);
  });

  test("малая выборка не обгоняет набравших порог, даже со 100%", () => {
    const newbie = row(1, { totals: t(2, 2) }); // 100% с двух игр
    const vet = row(2, { totals: t(MIN_GAMES_FOR_RANK + 40, 25) }); // 50% с полусотни
    expect(sortRows([newbie, vet], "maf").map((r) => r.seat)).toEqual([2, 1]);
  });

  test("без данных — в самом конце", () => {
    const rows = [row(1), row(2, { totals: t(15, 3) })];
    expect(sortRows(rows, "maf").map((r) => r.seat)).toEqual([2, 1]);
  });

  test("«сильные красные» смотрят на винрейт за мирных", () => {
    const rows = [row(1, { totals: t(0, 0, 30, 12) }), row(2, { totals: t(0, 0, 30, 21) })];
    expect(sortRows(rows, "civ").map((r) => r.seat)).toEqual([2, 1]);
  });
});
