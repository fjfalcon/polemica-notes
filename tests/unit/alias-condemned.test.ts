// @vitest-environment jsdom
/**
 * «Осуждёнка» и свои ники на эфире (просьба владельца 22.10.2026): ник с
 * пометкой «Осуждёнка» прячется, пока в OBS идёт трансляция, вне эфира
 * виден. Плюс тумблер «во время эфира» прячет на трансляции все свои ники.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  listener: null as null | ((m: unknown) => void),
  status: { streaming: false as boolean | null },
  sent: [] as unknown[],
}));

vi.mock("@core/messaging", () => ({
  onMessage: vi.fn((fn: (m: unknown) => void) => {
    h.listener = fn;
    return () => {
      h.listener = null;
    };
  }),
  sendRuntime: vi.fn(async (m: unknown) => {
    h.sent.push(m);
    return h.status;
  }),
}));
vi.mock("@core/dom", () => ({ onDomChangeImmediate: vi.fn(() => () => undefined) }));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } } },
}));

import { aliasPolicy } from "@shared/alias-policy";
import { aliasFrom, buildAliasIndex, mergeNotes, normalizeNoteRecord, type NotesMap } from "@core/notes-store";
import { AliasResolver } from "@content/features/player-notes/nick-alias";
import { NoteKeys } from "@content/features/player-notes/note-keys";
import { isStreaming, refreshStreamState, watchStreamState } from "@core/stream-state";

const notes: NotesMap = {
  "u:1": { text: "", timestamp: 1, nick: "Igolka", alias: "Игорь" },
  "u:2": { text: "", timestamp: 1, nick: "Toxic", alias: "Неприличное", aliasCondemned: true },
};
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("политика показа", () => {
  test("вне эфира — все; эфир — без осуждёнки; эфир с выключенным «во время эфира» — никаких", () => {
    expect(aliasPolicy({}, false)).toBe("all");
    expect(aliasPolicy({}, true)).toBe("safe");
    expect(aliasPolicy({ nick_aliases_hide_condemned_on_stream: false }, true)).toBe("all");
    expect(aliasPolicy({ nick_aliases_on_stream: false }, true)).toBe("none");
    expect(aliasPolicy({ nick_aliases_on_stream: false }, false), "вне эфира тумблер эфира не действует").toBe("all");
    expect(aliasPolicy({ nick_aliases_enabled: false }, false)).toBe("none");
  });
});

describe("индекс и плитка", () => {
  test("на эфире осуждёнка исчезает, обычный свой ник — нет; по нику чужой не подставляется", () => {
    const safe = buildAliasIndex(notes, true);
    expect(aliasFrom(safe, 1, null)).toBe("Игорь");
    expect(aliasFrom(safe, 2, null)).toBe("");
    expect(aliasFrom(safe, null, "toxic"), "и через историю ников тоже").toBe("");
    expect(aliasFrom(buildAliasIndex(notes), 2, null)).toBe("Неприличное");
  });

  test("резолвер пересобирает индекс при смене политики (эфир начался)", () => {
    let policy: "all" | "safe" = "all";
    const r = new AliasResolver(() => notes, () => policy);
    expect(r.aliasFor(2, null)).toBe("Неприличное");
    policy = "safe";
    expect(r.aliasFor(2, null), "без ожидания TTL кэша").toBe("");
  });

  test("плитка: displayAlias прячет осуждёнку только по просьбе", () => {
    const keys = new NoteKeys({ notes: () => notes, lookupId: (l) => (l === "toxic" ? 2 : undefined) });
    expect(keys.displayAlias("Toxic")).toBe("Неприличное");
    expect(keys.displayAlias("Toxic", true)).toBe("");
  });
});

describe("данные", () => {
  test("пометка хранится только вместе со своим ником", () => {
    expect(normalizeNoteRecord({ text: "", timestamp: 1, alias: "X", aliasCondemned: true })?.aliasCondemned).toBe(true);
    expect(normalizeNoteRecord({ text: "", timestamp: 1, aliasCondemned: true })).not.toHaveProperty("aliasCondemned");
    expect(normalizeNoteRecord({ text: "", timestamp: 1, alias: "X", aliasCondemned: "yes" })).not.toHaveProperty("aliasCondemned");
  });

  test("импорт: пометка едет парой со своим ником; отличие только в пометке — обновление", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const a = mergeNotes({ "u:2": { text: "x", timestamp: 100, alias: "N" } }, { "u:2": { text: "x", timestamp: 100, alias: "N", aliasCondemned: true } });
    expect(a.replaced).toBe(1);
    expect((a.merged["u:2"] as { aliasCondemned?: boolean }).aliasCondemned).toBe(true);
    // Свежая запись без своего ника берёт ник у старой — вместе с её пометкой, не с чужой.
    const b = mergeNotes(
      { "u:2": { text: "x", timestamp: 100, alias: "N", aliasCondemned: true } },
      { "u:2": { text: "y", timestamp: 200 } },
    );
    expect(b.merged["u:2"]).toMatchObject({ alias: "N", aliasCondemned: true });
  });
});

describe("состояние эфира во вкладке", () => {
  beforeEach(() => {
    h.sent = [];
    h.status = { streaming: false };
  });

  test("подписка спрашивает фон и слушает рассылку; отписка снимает слушатель", async () => {
    h.status = { streaming: true };
    let calls = 0;
    const off = watchStreamState(() => calls++, () => true);
    await flush();
    expect(isStreaming()).toBe(true);
    expect(calls).toBe(1);
    h.listener!({ type: "obs_event", eventType: "obs_stream_state", data: { streaming: false } });
    expect(isStreaming()).toBe(false);
    expect(calls).toBe(2);
    off();
    expect(h.listener).toBeNull();
  });

  test("без интеграции OBS фон не спрашивается, эфира нет", async () => {
    expect(await refreshStreamState(false)).toBe(false);
    expect(h.sent).toEqual([]);
  });
});
