// @vitest-environment jsdom
/** Клипы: перевод настройки-минут в секунды OBS с защитой от мусора; буфер после реконнекта. */
import { describe, expect, test, vi } from "vitest";

const sent = vi.hoisted(() => ({
  setups: [] as unknown[],
  handlers: [] as ((msg: unknown) => unknown)[],
}));

vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({
  sendRuntime: vi.fn(async (msg: { command: string; data?: { seconds?: number } }) => {
    if (msg.command === "replay_setup") sent.setups.push(msg.data?.seconds);
    return { success: true };
  }),
  onMessage: vi.fn((fn: (msg: unknown) => unknown) => {
    sent.handlers.push(fn);
    return () => {
      const i = sent.handlers.indexOf(fn);
      if (i >= 0) sent.handlers.splice(i, 1);
    };
  }),
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/keyboard", () => ({ keyboard: { register: vi.fn(() => () => undefined) } }));

import { clipSeconds, obsClipFeature } from "@content/features/obs-clip";
import { sendRuntime } from "@core/messaging";
import { showToast } from "@core/toast";
import type { FeatureContext } from "@core/feature";

const flush = () => new Promise((r) => setTimeout(r, 0));

function obsConnected(): void {
  for (const fn of [...sent.handlers]) fn({ type: "obs_event", eventType: "obs_connected" });
}

describe("длина буфера", () => {
  test("минуты настроек — в секунды OBS", () => {
    expect(clipSeconds(1)).toBe(60);
    expect(clipSeconds(5)).toBe(300);
  });
  test("границы: не короче минуты, не длиннее 20", () => {
    expect(clipSeconds(0)).toBe(60);
    expect(clipSeconds(999)).toBe(1200);
  });
  test("мусор из хранилища — дефолтная минута, не NaN-секунды", () => {
    expect(clipSeconds("три")).toBe(60);
    expect(clipSeconds(undefined)).toBe(60);
    expect(clipSeconds(Number.NaN)).toBe(60);
  });
});

describe("OBS поднялся позже вкладки", () => {
  test("obs_connected повторяет replay_setup с текущей длиной, disable снимает подписку", async () => {
    const ctx = { settings: { obs_clip_hotkey_code: "F9", obs_clip_minutes: 2 } } as unknown as FeatureContext;
    obsClipFeature.enable(ctx);
    await flush();
    obsConnected();
    await flush();
    expect(sent.setups).toEqual([120, 120]);
    obsClipFeature.disable();
    obsConnected();
    await flush();
    expect(sent.setups).toEqual([120, 120]);
    expect(sent.handlers).toEqual([]);
  });

  test("ответ replay_setup после disable не показывает тост и не трогает состояние", async () => {
    vi.mocked(showToast).mockClear();
    let answer: (v: unknown) => void = () => undefined;
    vi.mocked(sendRuntime).mockImplementationOnce(
      () => new Promise((r) => (answer = r)) as ReturnType<typeof sendRuntime>,
    );
    const ctx = { settings: { obs_clip_hotkey_code: "F9", obs_clip_minutes: 2 } } as unknown as FeatureContext;
    obsClipFeature.enable(ctx);
    obsClipFeature.disable();
    answer({ success: false, error: "отказ" });
    await flush();
    expect(showToast).not.toHaveBeenCalled();
  });
});
