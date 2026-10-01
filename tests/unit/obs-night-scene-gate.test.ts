// @vitest-environment jsdom
/**
 * Гейт «ночной показ роли ↔ ночная сцена эфира» (жалоба 01.10.2026: OBS был
 * не подключён, автосмена упала, стрим остался на дневной сцене — а автопоказ
 * роли об этом не знал, роль уехала зрителям: «ночь не включилась, роль
 * видно было»).
 *
 * Чистая функция сторожится мутационно: перепутать условие значит либо снова
 * показать роль на дневной сцене, либо навсегда спрятать её у стримеров без
 * настроенных сцен.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({ onDomChange: vi.fn(), safeClick: vi.fn(), isVisible: () => true }));
vi.mock("@core/env", () => ({
  browser: { storage: { local: { get: vi.fn(), set: vi.fn() }, sync: { set: vi.fn() } }, runtime: { id: "x" } },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({ onMessage: vi.fn(), sendRuntime: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));

import { nightRoleShowAllowed } from "@content/panels/obs-panel";

describe("nightRoleShowAllowed", () => {
  test("эфир на ночной сцене — показ разрешён", () => {
    expect(nightRoleShowAllowed({ nightScene: "я", currentScene: "я" })).toBe(true);
  });

  test("эфир остался на дневной (смена упала/не случилась) — показ ЗАПРЕЩЁН", () => {
    expect(nightRoleShowAllowed({ nightScene: "я", currentScene: "день" })).toBe(false);
  });

  test("сцена неизвестна (OBS не подключён) — показ запрещён", () => {
    expect(nightRoleShowAllowed({ nightScene: "я", currentScene: null })).toBe(false);
  });

  test("ночная сцена не настроена — защищать нечего, прежнее поведение", () => {
    expect(nightRoleShowAllowed({ nightScene: "", currentScene: null })).toBe(true);
    expect(nightRoleShowAllowed({ nightScene: "", currentScene: "что угодно" })).toBe(true);
  });
});
