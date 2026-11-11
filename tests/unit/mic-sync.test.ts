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
  /** Имя главного микрофона OBS, которым фон отвечает на «авто» (пусто в запросе). */
  mainMic: "Mic/Aux",
  /** Придержать ответ на запрос про этот источник до release() — гонка смены источника. */
  hold: null as string | null,
  release: null as (() => void) | null,
  /** Мьют по источникам; нет в карте — общий obsReply.muted. */
  mutedBy: {} as Record<string, boolean>,
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn((fn: (msg: unknown) => unknown) => {
    obsReply.handler = fn;
    return () => {
      obsReply.handler = null;
    };
  }),
  sendRuntime: vi.fn(async (msg: { command: string; data?: { muted?: boolean; inputName?: string } }) => {
    sent.push({ command: msg.command, muted: msg.data?.muted });
    const asked = msg.data?.inputName || obsReply.mainMic;
    if (obsReply.hold !== null && asked === obsReply.hold) {
      obsReply.hold = null;
      await new Promise<void>((r) => (obsReply.release = r));
    }
    if (obsReply.fail) return { success: false, error: obsReply.fail };
    if (msg.command === "get_input_mute" && asked in obsReply.mutedBy) {
      return { success: true, data: { muted: obsReply.mutedBy[asked], inputName: asked } };
    }
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
    // Как фон 9.75.0: в ответе — настоящее имя источника («авто» → главный микрофон).
    return { success: true, data: { muted: obsReply.muted, inputName: msg.data?.inputName || obsReply.mainMic } };
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
  obsReply.mainMic = "Mic/Aux";
  obsReply.hold = null;
  obsReply.release = null;
  obsReply.mutedBy = {};
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
  test("«авто», а главного микрофона в OBS нет — просит выбрать источник, а не «Нет источника «»»", () => {
    const text = pillView({ muted: null, problem: "missing" }, null, "").text;
    expect(text).toContain("главный микрофон");
    expect(text).not.toContain("«»");
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

describe("«авто»: главный микрофон OBS (9.75.0)", () => {
  const event = (inputName: string, inputMuted: boolean) =>
    obsReply.handler?.({ type: "obs_event", eventType: "obs_input_mute_changed", data: { inputName, inputMuted } });

  test("события мьюта узнаются по НАСТОЯЩЕМУ имени из ответа фона, чужие — нет", async () => {
    obsReply.mainMic = "Мик/Доп";
    const btn = micButton(false);
    void micSyncFeature.enable(ctx({ mic_sync_input: "" }));
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    event("Звук рабочего стола", true);
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.classList.contains("off"), "чужой источник не трогает игру").toBe(false);
    event("Мик/Доп", true);
    await vi.waitFor(() => expect(btn.classList.contains("off"), "мьют главного микрофона догоняет игру").toBe(true));
  });

  test("сменили источник в настройках — старое имя больше не узнаётся", async () => {
    obsReply.mainMic = "Мик/Доп";
    const btn = micButton(false);
    void micSyncFeature.enable(ctx({ mic_sync_input: "" }));
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    obsReply.fail = "OBS не ответил"; // новый источник ещё не подтверждён фоном
    micSyncFeature.update?.(ctx({ mic_sync_input: "Shure" }));
    event("Мик/Доп", true);
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.classList.contains("off")).toBe(false);
  });
});

describe("ревью 02.11.2026: смена и переименование источника", () => {
  const pillEl = () => [...document.body.querySelectorAll<HTMLElement>("div")].find((d) => d.textContent?.startsWith("🎙") || d.textContent?.startsWith("🔇"));
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test("ответ про СТАРЫЙ источник, пришедший после смены, не ложится на плашку (M2)", async () => {
    obsReply.mutedBy = { A: true, B: false };
    micButton(false);
    obsReply.hold = "A";
    void micSyncFeature.enable(ctx({ mic_sync_input: "A" }));
    await vi.waitFor(() => expect(obsReply.release).not.toBeNull());
    micSyncFeature.update?.(ctx({ mic_sync_input: "B" }));
    await tick();
    expect(pillEl()?.textContent).toContain("вкл");
    obsReply.release?.(); // запоздалый ответ про A: «выключен»
    await tick();
    await tick();
    expect(pillEl()?.textContent, "плашка про B, а не про A").not.toContain("выкл");
  });

  test("главный микрофон переименовали в OBS — «авто» узнаёт события по новому имени (M3)", async () => {
    obsReply.mainMic = "Мик/Доп";
    const btn = micButton(false);
    void micSyncFeature.enable(ctx({ mic_sync_input: "" }));
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    await tick();
    obsReply.mainMic = "Мой мик";
    obsReply.handler?.({ type: "obs_event", eventType: "obs_input_renamed", data: { oldInputName: "Мик/Доп", inputName: "Мой мик" } });
    obsReply.handler?.({ type: "obs_event", eventType: "obs_input_mute_changed", data: { inputName: "Мой мик", inputMuted: true } });
    await vi.waitFor(() => expect(btn.classList.contains("off")).toBe(true));
  });

  test("своё имя переименовали в OBS — плашка называет пропавший источник, а не новое имя", async () => {
    obsReply.mutedBy = { Shure: false };
    micButton(false);
    void micSyncFeature.enable(ctx({ mic_sync_input: "Shure" }));
    await vi.waitFor(() => expect(sent.some((s) => s.command === "get_input_mute")).toBe(true));
    await tick();
    obsReply.fail = "No source was found by the name of `Shure`.";
    obsReply.handler?.({ type: "obs_event", eventType: "obs_input_renamed", data: { oldInputName: "Shure", inputName: "Shure2" } });
    await vi.waitFor(() => expect(pillEl()?.textContent).toContain("«Shure»"));
    expect(pillEl()?.title).toBe("Источник в OBS: Shure");
  });

  test("в подсказке плашки — каким источником OBS управляем (L1)", async () => {
    obsReply.mainMic = "Мик/Доп";
    micButton(false);
    void micSyncFeature.enable(ctx({ mic_sync_input: "" }));
    await vi.waitFor(() => expect(pillEl()?.title).toBe("Источник в OBS: Мик/Доп"));
  });
});
