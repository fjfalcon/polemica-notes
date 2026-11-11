// @vitest-environment jsdom
/**
 * Клавиша микрофона живёт в замыкании попапа, как и остальные хоткеи.
 * Чужое изменение (импорт бэкапа, второе окно или устройство) обязано
 * доехать до замыкания: иначе следующее сохранение любого тумблера
 * записывает прежнюю клавишу обратно.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

type Changes = Record<string, { newValue?: unknown; oldValue?: unknown }>;

const env = vi.hoisted(() => {
  const listeners: Array<(changes: Changes, area: string) => void> = [];
  const stored: Record<string, unknown> = { mic_sync_hotkey: "KeyA" };
  const syncSet = vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(stored, patch);
  });
  const area = (data: Record<string, unknown>, set: (p: Record<string, unknown>) => Promise<void>) => ({
    get: vi.fn(async (defaults: Record<string, unknown> | null) => ({ ...(defaults || {}), ...data })),
    set: vi.fn(set),
    remove: vi.fn(async () => undefined),
  });
  const browser = {
    storage: {
      sync: area(stored, syncSet),
      local: area({}, async () => undefined),
      onChanged: {
        addListener: vi.fn((fn: (changes: Changes, area: string) => void) => listeners.push(fn)),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      id: "test",
      getManifest: vi.fn(() => ({ version: "9.1.0" })),
      getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
  };
  return { browser, listeners, syncSet };
});

vi.mock("@core/env", () => ({ browser: env.browser, isStoreInstall: () => false }));
vi.mock("@core/log", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setPersist: vi.fn(),
  },
}));
vi.mock("@core/errors", () => ({ installErrorCapture: vi.fn() }));
vi.mock("@core/messaging", () => ({
  sendRuntime: vi.fn(async () => undefined),
  sendToActiveTab: vi.fn(async () => undefined),
  sendToActiveTabStrict: vi.fn(async () => undefined),
  broadcastToGameTabs: vi.fn(async () => undefined),
  onMessage: vi.fn(() => () => undefined),
}));
vi.mock("@popup/player-search", () => ({ setupPlayerSearch: vi.fn() }));

import { formatKeyCode } from "@core/keyboard";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = fs.readFileSync(path.join(ROOT, "src/static/popup.html"), "utf8");

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const emitSync = (key: string, oldValue: unknown, newValue: unknown) => {
  for (const fn of env.listeners) fn({ [key]: { oldValue, newValue } }, "sync");
};

const toggleAndSave = async (id: string): Promise<Record<string, unknown>> => {
  const box = document.getElementById(id) as HTMLInputElement;
  box.checked = !box.checked;
  env.syncSet.mockClear();
  box.dispatchEvent(new Event("change"));
  await flush();
  expect(env.syncSet, `сохранение после переключения ${id}`).toHaveBeenCalledTimes(1);
  return env.syncSet.mock.calls[0][0];
};

describe("клавиша микрофона в попапе", () => {
  test("чужое изменение не откатывается следующим сохранением", async () => {
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    await import("@popup/index");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await flush();

    const label = document.getElementById("mic_sync_hotkey_capture") as HTMLButtonElement;
    expect(label.textContent).toBe(formatKeyCode("KeyA"));

    emitSync("mic_sync_hotkey", "KeyA", "KeyB");
    let written = await toggleAndSave("show_id");
    expect(written, "прежняя клавиша записана поверх чужой").not.toHaveProperty("mic_sync_hotkey");
    expect(label.textContent).toBe(formatKeyCode("KeyB"));

    emitSync("mic_sync_hotkey", "KeyB", "");
    written = await toggleAndSave("show_id");
    expect(written, "снятая клавиша вернулась").not.toHaveProperty("mic_sync_hotkey");
    expect(label.textContent).toBe(formatKeyCode(""));
  });
});
