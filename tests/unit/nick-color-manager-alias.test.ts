// @vitest-environment jsdom
/**
 * «Заметки и цвета игроков»: правка своего ника (22.10.2026).
 *
 * До сегрегации 28.08.2026 диалог жил внутри четырёхтысячестрочной фичи и не
 * проверялся НИЧЕМ: чтобы дойти до него в тесте, нужен был стол, кнопки и
 * ховер. Теперь это функция от порта — и её можно спросить напрямую про то,
 * что важно: не подставляется ли чужой ввод в разметку сайта, сохраняется ли
 * текст, честно ли ведёт себя отказ записи.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  colorsChanged: 0,
  fail: false,
  loadResult: { notes: {} as Record<string, unknown>, customTags: [] as string[], loadFailed: false },
  saved: {} as Record<string, unknown>,
}));

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    },
    runtime: { id: "x" },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
// Координатор в фоне отвечает успехом и отдаёт свежую карту — как в бою.
vi.mock("@core/messaging", () => ({
  sendRuntime: vi.fn(async (msg: { ops?: Array<{ key: string; record: unknown }> }) => {
    if (h.fail) return { ok: false };
    for (const op of msg.ops ?? []) {
      if (op.record === null) delete h.saved[op.key];
      else h.saved[op.key] = op.record;
    }
    return { ok: true, truncated: 0, skipped: 0, notes: h.saved };
  }),
}));
vi.mock("@core/notes-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@core/notes-store")>();
  return { ...real, loadNotes: vi.fn(async () => h.loadResult), saveNotes: vi.fn(async () => true) };
});

import { openNickColorManager } from "@content/features/player-notes/nick-color-manager";
import type { ModalPort } from "@content/features/player-notes/modal-port";
import { NotesModel } from "@content/features/player-notes/notes-model";
import type { NotesMap } from "@core/notes-store";

/**
 * Модель НАСТОЯЩАЯ (mock только у хранилища): диалог должен проверяться
 * против тех же правил записи, что работают у пользователя.
 */
function makePort(
  notes: NotesMap = {},
  over: Partial<ModalPort> = {},
): { port: ModalPort; model: NotesModel; toasts: string[] } {
  h.loadResult = { notes, customTags: [], loadFailed: false };
  const toasts: string[] = [];
  const model = new NotesModel({
    isActive: () => true,
    onColorsChanged: () => {
      h.colorsChanged++;
    },
    onIndicatorsChanged: () => undefined,
    onTagsChanged: () => undefined,
    onTooltipsChanged: () => undefined,
    onPlayerTooltips: () => undefined,
    toast: (m) => toasts.push(m),
    lookupId: (lower) => (lower === "аня" ? 42 : undefined),
  });
  const port: ModalPort = {
    model,
    toast: (m: string) => toasts.push(m),
    registerModal: () => undefined,
    unregisterModal: () => undefined,
    closeOpenModal: () => undefined,
    resolvePlayerInput: async () => null,
    confirmRemoveCustomTag: () => true,
    refreshColors: () => undefined,
    refreshIndicators: () => undefined,
    refreshTags: () => undefined,
    refreshPlayer: () => undefined,
    ...over,
  };
  return { port, model, toasts };
}


const win = () => document.querySelector(".polemica-note-modal") as HTMLElement;
const btn = (text: string) =>
  [...win().querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const rowText = () => [...win().querySelectorAll("div")].map((d) => d.textContent ?? "");
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  document.body.innerHTML = "";
  h.saved = {};
  h.colorsChanged = 0;
  h.fail = false;
});
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("свой ник в «Заметках и цветах»", () => {
  test("строка показывает «Ник (свой)», кнопка «Ник» открывает поле со своим ником", async () => {
    const { port, model } = makePort({ "u:42": { text: "Женя", timestamp: 1, nick: "Азарт", alias: "Жека" } });
    await model.load();
    openNickColorManager(port);
    expect(rowText().some((t) => t === "Азарт (Жека)")).toBe(true);
    btn("Ник")!.click();
    const input = win().querySelector<HTMLInputElement>("input[placeholder^='Свой ник']")!;
    expect(input.value).toBe("Жека");
  });

  test("задать свой ник: Enter сохраняет очищенным, запись и заметка целы", async () => {
    const { port, model } = makePort({ "u:42": { text: "Женя", timestamp: 1, nick: "Азарт" } });
    await model.load();
    openNickColorManager(port);
    btn("+ ник")!.click();
    const input = win().querySelector<HTMLInputElement>("input[placeholder^='Свой ник']")!;
    input.value = "  Жека\u202e ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    const rec = h.saved["u:42"] as { text: string; alias?: string };
    expect(rec.alias).toBe("Жека");
    expect(rec.text).toBe("Женя");
  });

  test("стёртый свой ник снимается; запись с одним своим ником при этом удаляется", async () => {
    const start = {
      "u:42": { text: "Женя", timestamp: 1, nick: "Азарт", alias: "Жека" },
      "u:7": { text: "", timestamp: 1, nick: "Бемби", alias: "Алина" },
    };
    const { model } = makePort(start);
    // «Диск» координатора = исходная карта: после записи модель принимает её целиком.
    h.saved = structuredClone(start);
    await model.load();
    expect(await model.setAlias("u:42", "")).toBe(true);
    expect((h.saved["u:42"] as { alias?: string }).alias).toBeUndefined();
    expect(await model.setAlias("u:7", "  ")).toBe(true);
    expect("u:7" in h.saved, "пустышки не копим").toBe(false);
  });

  test("набор в поле не уходит в хоткеи страницы", async () => {
    const { port, model } = makePort({ "u:42": { text: "x", timestamp: 1, nick: "Азарт" } });
    await model.load();
    openNickColorManager(port);
    btn("+ ник")!.click();
    let leaked = 0;
    const probe = () => leaked++;
    document.addEventListener("keydown", probe);
    const input = win().querySelector<HTMLInputElement>("input[placeholder^='Свой ник']")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    document.removeEventListener("keydown", probe);
    expect(leaked).toBe(0);
  });
});

describe("setAlias: правила записи (ревью 22.10.2026)", () => {
  const boot = async (start: Record<string, unknown>) => {
    const { model, port } = makePort(start as NotesMap);
    h.saved = structuredClone(start);
    await model.load();
    return { model, port };
  };

  test("снятый свой ник не удаляет запись с меткой; nick и история целы", async () => {
    const { model } = await boot({ "u:7": { text: "", timestamp: 1, tag: "#ff0000", nick: "Бемби", nicks: ["Bambi"], alias: "Алина" } });
    expect(await model.setAlias("u:7", "")).toBe(true);
    const rec = h.saved["u:7"] as { tag?: string; nick?: string; nicks?: string[]; alias?: string };
    expect(rec.tag).toBe("#ff0000");
    expect(rec.nick).toBe("Бемби");
    expect(rec.nicks).toEqual(["Bambi"]);
    expect(rec.alias).toBeUndefined();
  });

  test("отказ записи — память откатывается, перерисовки нет", async () => {
    const { model } = await boot({ "u:7": { text: "x", timestamp: 1, alias: "Алина" } });
    h.fail = true;
    expect(await model.setAlias("u:7", "Другая")).toBe(false);
    expect((model.notes["u:7"] as { alias?: string }).alias, "память под диск").toBe("Алина");
    expect(h.colorsChanged).toBe(0);
  });

  test("успех — плитки перерисовываются (сигнал цвета)", async () => {
    const { model } = await boot({ "u:7": { text: "x", timestamp: 1 } });
    expect(await model.setAlias("u:7", "Алина")).toBe(true);
    expect(h.colorsChanged).toBe(1);
  });

  test("легаси-строка становится записью, текст сохраняется", async () => {
    const { model } = await boot({ Бемби: "старая заметка" });
    expect(await model.setAlias("Бемби", "Алина")).toBe(true);
    expect(h.saved["Бемби"]).toMatchObject({ text: "старая заметка", alias: "Алина" });
  });

  test("сохранение без изменений запись не трогает (время не обновляется)", async () => {
    const { model } = await boot({ "u:7": { text: "x", timestamp: 1, alias: "Алина" } });
    expect(await model.setAlias("u:7", " Алина ")).toBe(true);
    expect((h.saved["u:7"] as { timestamp: number }).timestamp).toBe(1);
  });
});

describe("окно не стирает черновик", () => {
  test("через 2 с после сохранения ника открытый редактор заметки не пересоздаётся", async () => {
    vi.useFakeTimers();
    try {
      const start = { "u:42": { text: "Женя", timestamp: 1, nick: "Азарт" } };
      const { port, model } = makePort(start);
      h.saved = structuredClone(start);
      await model.load();
      openNickColorManager(port);
      btn("+ ник")!.click();
      const input = win().querySelector<HTMLInputElement>("input[placeholder^='Свой ник']")!;
      input.value = "Жека";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flush();
      btn("Заметка")!.click();
      const area = win().querySelector("textarea")!;
      area.value = "длинный черновик";
      await vi.advanceTimersByTimeAsync(2100);
      expect(win().querySelector("textarea")?.value, "черновик на месте").toBe("длинный черновик");
      expect(win().querySelector("[data-pn-saved]"), "бейдж снят").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("«Осуждёнка» в «Заметках и цветах»", () => {
  test("галочка в редакторе ника сохраняет пометку, строка помечена 🙈", async () => {
    const start = { "u:42": { text: "Женя", timestamp: 1, nick: "Азарт" } };
    const { port, model } = makePort(start);
    h.saved = structuredClone(start);
    await model.load();
    openNickColorManager(port);
    btn("+ ник")!.click();
    const input = win().querySelector<HTMLInputElement>("input[placeholder^='Свой ник']")!;
    input.value = "Грубость";
    win().querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = true;
    btn("Сохранить")!.click();
    await flush();
    expect(h.saved["u:42"]).toMatchObject({ alias: "Грубость", aliasCondemned: true });
    expect(rowText().some((t) => t === "Азарт (Грубость) 🙈")).toBe(true);
  });

  test("смена только пометки — это изменение, запись перезаписывается", async () => {
    const start = { "u:42": { text: "x", timestamp: 1, nick: "Азарт", alias: "Жека" } };
    const { model } = makePort(start);
    h.saved = structuredClone(start);
    await model.load();
    expect(await model.setAlias("u:42", "Жека", true)).toBe(true);
    expect((h.saved["u:42"] as { aliasCondemned?: boolean }).aliasCondemned).toBe(true);
    expect(await model.setAlias("u:42", "Жека", false)).toBe(true);
    expect((h.saved["u:42"] as { aliasCondemned?: boolean }).aliasCondemned).toBeUndefined();
  });
});
