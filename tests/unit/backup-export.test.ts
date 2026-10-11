import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: vi.fn(), set: vi.fn(async () => undefined) },
      sync: { get: vi.fn() },
    },
    runtime: { id: "x", getManifest: () => ({ version: "9.65.2" }) },
  },
}));
vi.mock("@core/messaging", () => ({
  sendRuntime: vi.fn(async () => ({ ok: true })),
  onMessage: vi.fn(() => () => undefined),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { browser } from "@core/env";
import { collectBackup } from "@popup/backup-export";

const local = browser.storage.local as unknown as { get: Mock };
const sync = browser.storage.sync as unknown as { get: Mock };

const MIGRATED_KEY = "pn_notes_migrated_v1";

function area(data: Record<string, unknown>) {
  return async (defaults: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(defaults)) if (key in data) out[key] = data[key];
    return out;
  };
}

function givenStorage(localData: Record<string, unknown>, syncData: Record<string, unknown>) {
  local.get.mockImplementation(area(localData));
  sync.get.mockImplementation(area(syncData));
}

beforeEach(() => {
  local.get.mockReset();
  sync.get.mockReset();
});

describe("бэкап: палитра до переноса из sync", () => {
  test("цвета из sync попадают в файл, общий цвет не удваивается", async () => {
    givenStorage(
      { tagCustomColors: ["#111111"], [MIGRATED_KEY]: false },
      { tagCustomColors: ["#222222", "#111111"] },
    );
    const backup = await collectBackup();
    expect(backup?.payload.customTags).toEqual(["#111111", "#222222"]);
  });

  test("после переноса палитра и заметки из sync не читаются: в файле палитра local", async () => {
    givenStorage(
      { tagCustomColors: ["#111111"], [MIGRATED_KEY]: true },
      { tagCustomColors: ["#222222"] },
    );
    const backup = await collectBackup();
    expect(backup?.payload.customTags).toEqual(["#111111"]);
    const syncKeys = sync.get.mock.calls.flatMap((call) => Object.keys((call[0] ?? {}) as object));
    expect(syncKeys).not.toContain("tagCustomColors");
    expect(syncKeys).not.toContain("playerNotes");
  });

  test("заметки не прочитались — бэкапа нет", async () => {
    local.get.mockRejectedValueOnce(new Error("read failed"));
    expect(await collectBackup()).toBeNull();
  });

  test("все сохраняемые поля попадают в файл", async () => {
    const notes = { "u:1": { text: "а", ts: 1 }, alice: { text: "б", ts: 2 } };
    const roleMarks = { g1: { 3: "sheriff" } };
    givenStorage(
      {
        playerNotes: notes,
        tagCustomColors: ["#111111"],
        [MIGRATED_KEY]: true,
        pn_muted_players: ["bob"],
        pn_hidden_players: ["eve"],
        roleMarks,
        obs_password: "секрет",
      },
      { show_id: true },
    );
    const backup = await collectBackup();
    expect(backup?.count).toBe(2);
    expect(backup?.payload).toMatchObject({
      app: "polemica-notes",
      type: "notes-backup",
      version: "9.65.2",
      notes,
      customTags: ["#111111"],
      mutedPlayers: ["bob"],
      hiddenPlayers: ["eve"],
      roleMarks,
    });
    expect(backup?.payload.settings).toMatchObject({ show_id: true });
    expect(backup?.payload.settings).not.toHaveProperty("obs_password");
  });

  test("пароль OBS в файл не попадает", async () => {
    givenStorage({ obs_password: "секрет", [MIGRATED_KEY]: true }, {});
    const backup = await collectBackup();
    expect(backup?.payload.settings).not.toHaveProperty("obs_password");
  });
});
