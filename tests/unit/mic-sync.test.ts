// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * «Микрофон: OBS и игра» (09.10.2026). Сторожим то, чем можно навредить
 * эфиру: нажать не ту кнопку (неоднозначность), промолчать, когда OBS не
 * выключил микрофон, и тихо жить при выключенной интеграции OBS.
 */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

const sent: Array<{ command: string; muted?: boolean }> = [];
const obsReply = vi.hoisted(() => ({
  fail: null as string | null,
  muted: false,
  /** Эхо InputMuteStateChanged ДО ответа на SetInputMute (как в живом OBS). */
  echoBeforeReply: false,
  handler: null as ((msg: unknown) => unknown) | null,
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn((fn: (msg: unknown) => unknown) => {
    obsReply.handler = fn;
    return () => {
      obsReply.handler = null;
    };
  }),
  sendRuntime: vi.fn(async (msg: { command: string; data?: { muted?: boolean } }) => {
    sent.push({ command: msg.command, muted: msg.data?.muted });
    if (obsReply.fail) return { success: false, error: obsReply.fail };
    if (msg.command === "set_input_mute") {
      obsReply.muted = msg.data?.muted === true;
      if (obsReply.echoBeforeReply) {
        obsReply.handler?.({
          type: "obs_event",
          eventType: "obs_input_mute_changed",
          data: { inputName: "Mic/Aux", inputMuted: obsReply.muted },
        });
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    return { success: true, data: { muted: obsReply.muted } };
  }),
}));
vi.mock("@core/dom", () => ({
  onDomChange: vi.fn(() => () => undefined),
  registerOwnContainer: vi.fn(),
  unregisterOwnContainer: vi.fn(),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const toasts: string[] = [];
vi.mock("@core/toast", () => ({
  showToast: (t: string) => {
    toasts.push(t);
    return true;
  },
}));

import { micSyncActive, micSyncFeature, pillView, readGameMic, toggleMic } from "@content/features/mic-sync";
import type { FeatureContext } from "@core/feature";

const ON = "/room/bundle/652f9184e845e10a12e5.svg";
const OFF = "/room/bundle/3a2b1603137ca0fb3eeb.svg";

/** Кнопка микрофона сайта; клик переключает её, как делает Vue. */
function micButton(muted: boolean, opts: { lie?: boolean } = {}): HTMLElement {
  const btn = document.createElement("div");
  btn.className = `button preset-1 small desktop-version${muted ? " off" : ""}`;
  const img = document.createElement("img");
  img.className = "button__icon";
  // lie: иконка спорит с классом — такую кнопку нажимать нельзя.
  img.setAttribute("src", (opts.lie ? !muted : muted) ? OFF : ON);
  btn.appendChild(img);
  btn.addEventListener("click", () => {
    const nowMuted = !btn.classList.contains("off");
    btn.classList.toggle("off", nowMuted);
    img.setAttribute("src", nowMuted ? OFF : ON);
  });
  document.body.appendChild(btn);
  return btn;
}

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    settings: { mic_sync_enabled: true, obs_enabled: true, mic_sync_input: "Mic/Aux", mic_sync_hotkey: "", ...over },
  }) as unknown as FeatureContext;

beforeEach(() => {
  document.body.innerHTML = "";
  sent.length = 0;
  toasts.length = 0;
  obsReply.fail = null;
  obsReply.muted = false;
  obsReply.echoBeforeReply = false;
});

afterEach(() => micSyncFeature.disable());

describe("readGameMic", () => {
  test("одна кнопка микрофона — состояние по иконке и классу", () => {
    micButton(true);
    expect(readGameMic()?.muted).toBe(true);
  });

  test("иконка спорит с классом — не узнаём (нажали бы не то)", () => {
    micButton(true, { lie: true });
    expect(readGameMic()).toBeNull();
  });

  test("две кнопки микрофона — неоднозначно, null", () => {
    micButton(false);
    micButton(false);
    expect(readGameMic()).toBeNull();
  });

  test("кнопка камеры (другая иконка) микрофоном не считается", () => {
    const b = document.createElement("div");
    b.className = "button preset-1 small desktop-version";
    b.innerHTML = '<img class="button__icon" src="/room/bundle/516810fd6c1e38f17335.svg">';
    document.body.appendChild(b);
    expect(readGameMic()).toBeNull();
  });
});

describe("pillView", () => {
  test("согласовано — одна фраза про оба", () => {
    expect(pillView({ muted: true, problem: null }, { muted: true }, "Mic").text).toContain("OBS + игра");
  });
  test("расхождение — оба состояния и предупреждение", () => {
    const v = pillView({ muted: false, problem: null }, { muted: true }, "Mic");
    expect(v.tone).toBe("warn");
    expect(v.text).toContain("OBS: вкл; игра: выкл");
  });
  test("нет источника — называет имя, которое искали", () => {
    expect(pillView({ muted: null, problem: "missing" }, null, "Мой мик").text).toContain("«Мой мик»");
  });
});

describe("micSyncActive", () => {
  test("без включённой интеграции OBS не живёт (урок 07.10.2026)", () => {
    expect(micSyncActive({ mic_sync_enabled: true, obs_enabled: false })).toBe(false);
    expect(micSyncActive({ mic_sync_enabled: true, obs_enabled: true })).toBe(true);
  });
});

describe("toggleMic", () => {
  test("выключает и OBS, и игру одним действием", async () => {
    const btn = micButton(false);
    void micSyncFeature.enable(ctx());
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    await toggleMic();
    expect(sent).toContainEqual({ command: "set_input_mute", muted: true });
    expect(btn.classList.contains("off")).toBe(true);
    expect(toasts).toEqual([]);
  });

  test("OBS не ответил при ВЫКЛЮЧЕНИИ — громкое предупреждение «эфир слышит»", async () => {
    micButton(false);
    void micSyncFeature.enable(ctx());
    obsReply.fail = "OBS не подключён";
    await toggleMic();
    expect(toasts.join(" ")).toContain("НЕ выключен");
  });

  test("эхо OBS посреди запроса + медленный сайт: игра кликается РОВНО раз (adversarial)", async () => {
    // Кнопка сайта меняет класс только после ответа своего сервера (~300 мс):
    // два выравнивателя видели старый DOM, и второй клик возвращал мьют обратно.
    const btn = document.createElement("div");
    btn.className = "button preset-1 small desktop-version";
    const img = document.createElement("img");
    img.className = "button__icon";
    img.setAttribute("src", ON);
    btn.appendChild(img);
    let clicks = 0;
    btn.addEventListener("click", () => {
      clicks++;
      setTimeout(() => {
        const nowMuted = !btn.classList.contains("off");
        btn.classList.toggle("off", nowMuted);
        img.setAttribute("src", nowMuted ? OFF : ON);
      }, 300);
    });
    document.body.appendChild(btn);
    void micSyncFeature.enable(ctx());
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    obsReply.echoBeforeReply = true;
    await toggleMic();
    await new Promise((r) => setTimeout(r, 400));
    expect(clicks, "второй клик вернул бы микрофон игры обратно").toBe(1);
    expect(btn.classList.contains("off")).toBe(true);
  });

  test("при выключенной интеграции OBS фича ничего не делает", async () => {
    micButton(false);
    void micSyncFeature.enable(ctx({ obs_enabled: false }));
    await toggleMic();
    expect(sent).toEqual([]);
  });
});
