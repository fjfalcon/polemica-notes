// @vitest-environment jsdom
/**
 * Режим «Скрыть рейтинг» (28.10.2026): ранний флаг на <html>, метки колонки
 * и строки MMR, CSS под флагом и регистрация раннего скрипта.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: "test" },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import {
  HIDE_RATING_ATTR,
  HIDE_RATING_MIRROR_KEY,
  applyRatingFlag,
  bootRatingFlag,
  hideRatingActive,
  readMirror,
} from "@content/page/rating-flag-early";
import { RATING_MARK, hideRatingFeature, markRatingNodes } from "@content/features/hide-rating";
import type { FeatureContext } from "@core/feature";

const root = () => document.documentElement;
const flagged = () => root().hasAttribute(HIDE_RATING_ATTR);

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function fakeStorage(items: Record<string, unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const listeners: Listener[] = [];
  return {
    api: {
      sync: {
        get: async (defaults: Record<string, unknown>) => {
          await gate;
          return { ...defaults, ...items };
        },
      },
      onChanged: { addListener: (cb: Listener) => listeners.push(cb) },
    },
    release,
    emit: (changes: Record<string, { newValue?: unknown }>, area = "sync") =>
      listeners.forEach((cb) => cb(changes, area)),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  root().removeAttribute(HIDE_RATING_ATTR);
  localStorage.clear();
});

afterEach(() => {
  hideRatingFeature.disable();
  document.body.innerHTML = "";
  root().removeAttribute(HIDE_RATING_ATTR);
});

describe("ранний флаг", () => {
  test("до ответа storage рейтинг виден, только если зеркало ЯВНО говорит «0»", () => {
    const store = (v: string | null) => ({ getItem: () => v, setItem() {}, removeItem() {} });
    expect(readMirror(store("0"))).toBe(false);
    expect(readMirror(store("1"))).toBe(true);
    expect(readMirror(store(null)), "первый заход на origin — прячем").toBe(true);
    expect(readMirror(null), "localStorage запрещён — прячем").toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem() {},
      removeItem() {},
    };
    expect(readMirror(broken)).toBe(true);
  });

  test("мастер-выключатель гасит режим", () => {
    expect(hideRatingActive({ hide_rating: true })).toBe(true);
    expect(hideRatingActive({ hide_rating: true, extension_enabled: false })).toBe(false);
    expect(hideRatingActive({ hide_rating: false })).toBe(false);
  });

  test("атрибут пишется только при смене состояния (идемпотентно)", async () => {
    const seen: MutationRecord[] = [];
    const mo = new MutationObserver((m) => seen.push(...m));
    mo.observe(root(), { attributes: true });
    applyRatingFlag(true);
    applyRatingFlag(true);
    applyRatingFlag(false);
    applyRatingFlag(false);
    await flush();
    mo.disconnect();
    expect(seen.length).toBe(2);
  });

  test("зеркало ставит флаг ДО ответа storage; ответ «выключено» снимает и чистит зеркало", async () => {
    localStorage.setItem(HIDE_RATING_MIRROR_KEY, "1");
    const s = fakeStorage({ hide_rating: false });
    bootRatingFlag(s.api, localStorage);
    expect(flagged(), "сразу по зеркалу").toBe(true);
    s.release();
    await flush();
    expect(flagged()).toBe(false);
    expect(localStorage.getItem(HIDE_RATING_MIRROR_KEY), "явное «выключено»").toBe("0");
  });

  test("зеркала нет — рейтинг спрятан до ответа storage (миг без рейтинга безвреден)", async () => {
    const s = fakeStorage({ hide_rating: false });
    bootRatingFlag(s.api, localStorage);
    expect(flagged()).toBe(true);
    s.release();
    await flush();
    expect(flagged()).toBe(false);
  });

  test("storage не ответит вовсе — верим только явному «1», не прячем навсегда", async () => {
    bootRatingFlag(undefined, localStorage);
    expect(flagged(), "нет storage и нет зеркала").toBe(false);
    localStorage.setItem(HIDE_RATING_MIRROR_KEY, "1");
    bootRatingFlag(undefined, localStorage);
    expect(flagged()).toBe(true);
    localStorage.clear();
    const failing = {
      sync: { get: () => Promise.reject(new Error("context invalidated")) },
      onChanged: { addListener() {} },
    };
    bootRatingFlag(failing, localStorage);
    expect(flagged(), "до отказа — прячем").toBe(true);
    await flush();
    expect(flagged(), "отказ storage без зеркала — показываем").toBe(false);
  });

  test("включено в storage — флаг и зеркало; тумблер в попапе переключает живьём", async () => {
    const s = fakeStorage({ hide_rating: true });
    localStorage.setItem(HIDE_RATING_MIRROR_KEY, "0");
    bootRatingFlag(s.api, localStorage);
    expect(flagged(), "зеркало «0» — до ответа виден").toBe(false);
    s.release();
    await flush();
    expect(flagged()).toBe(true);
    expect(localStorage.getItem(HIDE_RATING_MIRROR_KEY)).toBe("1");
    s.emit({ hide_rating: { newValue: false } });
    expect(flagged()).toBe(false);
    s.emit({ hide_rating: { newValue: true } }, "local");
    expect(flagged(), "чужая область не считается").toBe(false);
    s.emit({ hide_rating: { newValue: true } });
    s.emit({ extension_enabled: { newValue: false } });
    expect(flagged(), "мастер-выключатель").toBe(false);
  });

  test("тумблер, нажатый пока storage отвечал, не теряется", async () => {
    const s = fakeStorage({ hide_rating: false });
    bootRatingFlag(s.api, localStorage);
    s.emit({ hide_rating: { newValue: true } });
    s.release();
    await flush();
    expect(flagged(), "свежее событие важнее устаревшего ответа get").toBe(true);
  });
});

describe("метки колонки и строки MMR", () => {
  const profileTable = (cols: string[]) =>
    `<div class="profileGames__table-head-row">${cols
      .map((t) => `<div class="profileGames__table-head-row-item">${t}</div>`)
      .join("")}</div>` +
    `<div class="profileGames__table-body-row">${cols
      .map((_, i) => `<div class="profileGames__table-body-row-item">v${i}</div>`)
      .join("")}</div>`;

  test("колонка ищется по подписи, а не по номеру", () => {
    document.body.innerHTML = profileTable(["MMR", "Дата", "Роль"]);
    markRatingNodes();
    const marked = [...document.querySelectorAll(`[${RATING_MARK}]`)].map((e) => e.textContent);
    expect(marked).toEqual(["MMR", "v0"]);
  });

  test("в разборе матча метится только строка MMR: «Итог» (баллы) и наши фазы остаются", () => {
    document.body.innerHTML =
      '<div class="game-stats-table">' +
      '<div class="row"><div class="cell title">Итог</div><div class="cell">2.5</div></div>' +
      '<div class="row" data-phase="d1"><div class="cell title">MMR</div></div>' +
      '<div class="row"><div class="cell title"> MMR </div><div class="cell positive-mmr">+25</div></div>' +
      "</div>";
    markRatingNodes();
    const rows = [...document.querySelectorAll(`[${RATING_MARK}]`)];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("+25");
  });

  test("disable снимает все метки (симметрия жизненного цикла)", () => {
    document.body.innerHTML = profileTable(["Дата", "MMR"]);
    hideRatingFeature.enable({ settings: {} } as unknown as FeatureContext);
    expect(document.querySelectorAll(`[${RATING_MARK}]`).length).toBe(2);
    hideRatingFeature.disable();
    expect(document.querySelectorAll(`[${RATING_MARK}]`).length).toBe(0);
  });
});

describe("CSS под флагом", () => {
  const block = readFileSync("src/static/rating-hide.css", "utf8");

  test("каждое правило режима заякорено на флаг: без режима сайт не тронут", () => {
    const selectors = [...block.matchAll(/([^{}]+)\{[^}]*\}/g)].flatMap((m) =>
      m[1]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // Запятые верхнего уровня: внутри :has(...) — часть одного селектора.
        .split(/,(?![^(]*\))/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    expect(selectors.length).toBeGreaterThanOrEqual(9);
    for (const s of selectors) expect(s.startsWith(`html[${HIDE_RATING_ATTR}] `), s).toBe(true);
  });

  test("под флагом прячутся значок MMR, ± истории, места в карточке игрока и наши метки", () => {
    const style = document.createElement("style");
    style.textContent = block;
    document.head.appendChild(style);
    document.body.innerHTML =
      '<div class="mmrLabel"><img class="mmrLabel__icon" src="/images/user_mmr/9.svg"><span>9154</span></div>' +
      '<div class="profileGames__table-body-row-item-cont-mmr">+22</div>' +
      '<div class="player-preview"><div class="profile-info"><div class="wrapper">' +
      '<p class="username">fj</p><p>12 место в рейтинге</p><p><span class="rank">3 ранг</span></p>' +
      "</div></div></div>" +
      '<span data-pn-rating>MMR: 9154</span><span data-pn-rating-site>MMR</span>' +
      '<div class="pn-mmr-chart"></div>' +
      '<div class="game-stats-table">' +
      '<div class="row sum-row"><div class="cell title">Итог</div><div class="cell player sum">2.5</div></div>' +
      '<div class="row mmr-row"><div class="cell title">±</div><div class="cell player mmr_diff">0</div></div>' +
      "</div>";
    const hidden = (sel: string) => getComputedStyle(document.querySelector(sel)!).display === "none";
    const all = [
      ".mmrLabel",
      ".profileGames__table-body-row-item-cont-mmr",
      ".wrapper > p:nth-of-type(2)",
      ".wrapper > p:nth-of-type(3)",
      "[data-pn-rating]",
      "[data-pn-rating-site]",
      ".pn-mmr-chart",
      ".mmr-row",
    ];
    expect(all.filter(hidden), "без флага ничего не спрятано").toEqual([]);
    root().setAttribute(HIDE_RATING_ATTR, "");
    expect(all.filter((s) => !hidden(s)), "под флагом спрятано всё").toEqual([]);
    expect(hidden(".username"), "ник в карточке остаётся").toBe(false);
    expect(hidden(".sum-row"), "«Итог» — баллы Полемики — остаётся").toBe(false);
    expect(
      getComputedStyle(document.querySelector(".cell.mmr_diff")!).visibility,
      "страховка без :has — значение ± невидимо",
    ).toBe("hidden");
    style.remove();
  });
});

describe("сборка", () => {
  test("ранний скрипт — отдельный entry и content-скрипт на document_start по всему сайту", () => {
    const manifest = JSON.parse(readFileSync("src/manifest/manifest.base.json", "utf8")) as {
      content_scripts: Array<{ matches: string[]; js: string[]; run_at?: string }>;
    };
    const entry = manifest.content_scripts.find((c) => c.js.includes("rating-flag-early.js")) as
      | { matches: string[]; js: string[]; css?: string[]; run_at?: string }
      | undefined;
    expect(entry?.run_at).toBe("document_start");
    // Firefox вставляет CSS content-скрипта в момент run_at: правила режима
    // обязаны ехать с ранним скриптом, а не с notes.css (document_end).
    expect(entry?.css).toEqual(["rating-hide.css"]);
    expect(readFileSync("src/static/notes.css", "utf8")).not.toContain("data-pn-hide-rating");
    expect(entry?.matches).toEqual(["https://*.polemicagame.com/*"]);
    expect(readFileSync("tsup.config.ts", "utf8")).toContain(
      '"rating-flag-early": "src/content/page/rating-flag-early.ts"',
    );
  });
});
