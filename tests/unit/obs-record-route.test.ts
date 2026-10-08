// @vitest-environment jsdom
/**
 * Автозапись: маршрут → команды фону. Стражи: выключенная фича молчит,
 * повторная сверка того же состояния не дублирует команды, включение
 * посреди игры стартует запись, выключение — останавливает СВОЮ.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const sent = vi.hoisted(() => ({
  commands: [] as string[],
  data: [] as unknown[],
  handlers: [] as ((msg: unknown) => unknown)[],
}));

vi.mock("@core/messaging", () => ({
  sendRuntime: vi.fn(async (msg: { command: string; data?: unknown }) => {
    sent.commands.push(msg.command);
    sent.data.push(msg.data);
    return { success: true, data: { started: true } };
  }),
  onMessage: vi.fn((fn: (msg: unknown) => unknown) => {
    sent.handlers.push(fn);
    return () => {
      const i = sent.handlers.indexOf(fn);
      if (i >= 0) sent.handlers.splice(i, 1);
    };
  }),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));

import { obsRecordFeature, syncObsRecordRoute } from "@content/features/obs-record";
import type { FeatureContext } from "@core/feature";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Фон разослал «OBS подключился» (Identified, в том числе после реконнекта). */
function obsConnected(): void {
  for (const fn of [...sent.handlers]) fn({ type: "obs_event", eventType: "obs_connected" });
}

beforeEach(() => {
  obsRecordFeature.disable();
  syncObsRecordRoute(false);
  sent.commands.length = 0;
  sent.data.length = 0;
});

describe("автозапись по маршруту", () => {
  test("вход в комнату — start, выход — stop; повторы не дублируются", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    syncObsRecordRoute(true);
    syncObsRecordRoute(true); // сверка того же состояния (роутер зовёт часто)
    await flush();
    expect(sent.commands).toEqual(["record_start"]);
    syncObsRecordRoute(false);
    syncObsRecordRoute(false);
    await flush();
    expect(sent.commands).toEqual(["record_start", "record_stop"]);
  });

  test("фича выключена — маршрут не рождает команд", async () => {
    syncObsRecordRoute(true);
    syncObsRecordRoute(false);
    await flush();
    expect(sent.commands).toEqual([]);
  });

  test("включили настройку уже сидя в комнате — запись стартует сразу", async () => {
    syncObsRecordRoute(true); // в комнате, фича ещё выключена
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    await flush();
    expect(sent.commands).toEqual(["record_start"]);
  });

  test("выключение фичи в комнате останавливает запись (симметрия)", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    syncObsRecordRoute(true);
    await flush();
    obsRecordFeature.disable();
    await flush();
    expect(sent.commands).toEqual(["record_start", "record_stop"]);
  });
});

describe("OBS подключился позже входа в комнату", () => {
  test("obs_connected в комнате повторяет старт с пометкой reconnect", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    syncObsRecordRoute(true); // старт ушёл, когда OBS ещё не был запущен
    await flush();
    obsConnected();
    await flush();
    expect(sent.commands).toEqual(["record_start", "record_start"]);
    expect(sent.data[1]).toEqual({ reconnect: true });
  });

  test("каждое повторное obs_connected шлёт повтор (дубли гасит фон)", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    syncObsRecordRoute(true);
    await flush();
    obsConnected();
    obsConnected();
    await flush();
    expect(sent.commands).toEqual(["record_start", "record_start", "record_start"]);
    expect(sent.data.slice(1)).toEqual([{ reconnect: true }, { reconnect: true }]);
  });

  test("вне комнаты obs_connected команд не рождает", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    obsConnected();
    await flush();
    expect(sent.commands).toEqual([]);
  });

  test("disable снимает подписку", async () => {
    obsRecordFeature.enable({ settings: {} } as unknown as FeatureContext);
    syncObsRecordRoute(true);
    await flush();
    obsRecordFeature.disable();
    await flush();
    sent.commands.length = 0;
    obsConnected();
    await flush();
    expect(sent.commands).toEqual([]);
    expect(sent.handlers).toEqual([]);
  });
});
