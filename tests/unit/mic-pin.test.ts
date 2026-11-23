// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * «Брать только выбранный микрофон» (19.11.2026): Bluetooth-наушники уходят в
 * гарнитурный режим, когда комната сайта открывает микрофон «по умолчанию».
 *
 * Сторожим: (1) по умолчанию getUserMedia сайта никто не трогает; (2) запрос
 * без устройства получает микрофон, сохранённый сайтом, а явный выбор сайта
 * остаётся нетронутым; (3) наша ошибка не ломает запрос камеры и микрофона;
 * (4) зеркало учитывает главный выключатель и не оставляет следов у тех, кто
 * опцию не включал.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { extension_enabled: true, mic_pin_enabled: false } as Record<string, unknown>,
  handlers: [] as Array<(patch: Record<string, unknown>) => void>,
  /** true — не читается ничего; имя ключа — не читается только он. */
  failRead: false as boolean | string,
  toast: vi.fn(() => true),
  info: vi.fn(),
  warn: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock("@core/settings", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (mocks.failRead === true || mocks.failRead === key) throw new Error("storage unavailable");
    return mocks.settings[key];
  }),
  onSettingsChanged: vi.fn((fn: (patch: Record<string, unknown>) => void) => {
    mocks.handlers.push(fn);
    return () => undefined;
  }),
}));
vi.mock("@core/toast", () => ({ showToast: mocks.toast }));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: mocks.info, warn: mocks.warn, error: vi.fn(), flushNow: mocks.flushNow },
}));

import {
  MIC_PIN_FLAG_KEY,
  MIC_PIN_STATE_ATTR,
  SITE_MIC_KEY,
  emptyMicPinCounts,
  formatMicPinState,
  hasConcreteDevice,
  micPinAllowed,
  needsFirefoxMacMicNote,
  parseMicPinState,
  pinAudioConstraints,
  shouldRetryUnpinned,
  usableMicId,
} from "@shared/mic-pin";
import { injectMicPin } from "@content/page/mic-pin-inject";
import {
  REPORT_DELAY_MS,
  micPinActive,
  micPinVerdict,
  reportMicPin,
  resetMicPinForTest,
  setupMicPin,
  writeMicPinMirror,
} from "@content/mic-pin";

const MIC = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

let store: Map<string, string>;
let storeBroken = false;
/** Бросает только чтение ключа сайта — флаг опции читается нормально. */
let siteKeyBroken = false;
let session: Map<string, string>;
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

function setPath(pathname: string): void {
  window.history.replaceState(null, "", pathname);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.extension_enabled = true;
  mocks.settings.mic_pin_enabled = false;
  mocks.handlers.length = 0;
  mocks.failRead = false;
  resetMicPinForTest();
  setPath("/game");
  store = new Map();
  storeBroken = false;
  siteKeyBroken = false;
  session = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
      removeItem: (k: string) => void session.delete(k),
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => {
        if (storeBroken || (siteKeyBroken && k === SITE_MIC_KEY)) throw new Error("SecurityError");
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  };
  document.documentElement.removeAttribute(MIC_PIN_STATE_ATTR);
  document.querySelectorAll("script[data-pn-mic-pin-inject]").forEach((s) => s.remove());
});

/** Слушатели pagehide от setupMicPin: снимаем после теста, иначе они копятся на window. */
const pagehideListeners: EventListenerOrEventListenerObject[] = [];
const nativeAdd = window.addEventListener.bind(window);
window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
  if (type === "pagehide") pagehideListeners.push(fn);
  nativeAdd(type, fn, opts as AddEventListenerOptions);
}) as typeof window.addEventListener;

afterEach(() => {
  vi.useRealTimers();
  for (const fn of pagehideListeners.splice(0)) window.removeEventListener("pagehide", fn);
});

describe("гейт: по умолчанию перехвата нет", () => {
  test("ключа нет или он не «1» — нельзя", () => {
    expect(micPinAllowed({ getItem: () => null })).toBe(false);
    expect(micPinAllowed({ getItem: () => "0" })).toBe(false);
    expect(micPinAllowed({ getItem: () => "true" })).toBe(false);
    expect(micPinAllowed({ getItem: () => "1" })).toBe(true);
  });

  test("недоступное хранилище не роняет и не разрешает", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(micPinAllowed(throwing)).toBe(false);
    expect(micPinAllowed(null)).toBe(false);
  });

  test("инжектор: без флага тега нет, с флагом — один, синхронный по порядку", () => {
    injectMicPin();
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).toBeNull();

    store.set(MIC_PIN_FLAG_KEY, "1");
    injectMicPin();
    injectMicPin();
    const tags = document.querySelectorAll<HTMLScriptElement>("script[data-pn-mic-pin-inject]");
    expect(tags).toHaveLength(1);
    expect(tags[0].src).toBe("chrome-extension://test/mic-pin-page.js");
    expect(tags[0].async).toBe(false);
    // Тег снимается и после загрузки, и после ошибки загрузки.
    tags[0].dispatchEvent(new Event("load"));
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).toBeNull();
    injectMicPin();
    document.querySelector("script[data-pn-mic-pin-inject]")?.dispatchEvent(new Event("error"));
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).toBeNull();
  });

  test("инжектор: только в комнате — на странице поиска (/game-search тоже матчит манифест) тега нет", () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    for (const p of ["/game-search", "/game-search/", "/games", "/"]) {
      setPath(p);
      injectMicPin();
      expect(document.querySelector("script[data-pn-mic-pin-inject]"), p).toBeNull();
    }
    setPath("/game/123");
    injectMicPin();
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).not.toBeNull();
  });

  test("инжектор: нет API расширения или хранилище запрещено — молча ничего не делает", () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    expect(() => injectMicPin()).not.toThrow();
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).toBeNull();

    (globalThis as { chrome?: unknown }).chrome = { runtime: { getURL: (p: string) => `x://${p}` } };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(() => injectMicPin()).not.toThrow();
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).toBeNull();
  });

  test("модуль инжектора сам вызывает установку при загрузке", async () => {
    // Без вызова в конце файла content-скрипт был бы пустышкой, а тесты
    // функции injectMicPin оставались бы зелёными.
    store.set(MIC_PIN_FLAG_KEY, "1");
    vi.resetModules();
    await import("@content/page/mic-pin-inject");
    expect(document.querySelector("script[data-pn-mic-pin-inject]")).not.toBeNull();
  });

  test("настройка выключена по умолчанию — и в коде, и в разметке попапа", () => {
    // Настоящий @core/settings тянет полифилл расширения — читаем исходник.
    expect(read("src/core/settings.ts")).toMatch(/^\s*mic_pin_enabled: false,$/m);
    const row = /<input type="checkbox" id="mic_pin_enabled"[^>]*>/.exec(read("src/static/popup.html"));
    expect(row?.[0]).toBeDefined();
    expect(row?.[0]).not.toContain("checked");
  });
});

describe("pinAudioConstraints", () => {
  test("audio:true — подставляется сохранённый микрофон, видео и чужой объект не тронуты", () => {
    const original = { audio: true, video: { width: { ideal: 1280 } } };
    const { constraints, outcome } = pinAudioConstraints(original, MIC);
    expect(outcome).toBe("pinned");
    expect(constraints).toEqual({ audio: { deviceId: { ideal: MIC } }, video: { width: { ideal: 1280 } } });
    expect(original).toEqual({ audio: true, video: { width: { ideal: 1280 } } });
  });

  test("ideal, а не exact: без сохранённого устройства браузер возьмёт системное, а не упадёт", () => {
    const { constraints } = pinAudioConstraints({ audio: true }, MIC);
    expect(constraints).toEqual({ audio: { deviceId: { ideal: MIC } } });
  });

  test("объект без устройства (или с пустым) — подставляем, остальные поля сохраняем", () => {
    for (const deviceId of [undefined, null, ""]) {
      const audio = { echoCancellation: true, deviceId };
      const { constraints, outcome } = pinAudioConstraints({ audio }, MIC);
      expect(outcome).toBe("pinned");
      expect(constraints).toEqual({ audio: { echoCancellation: true, deviceId: { ideal: MIC } } });
      // streamConstraints сайт переиспользует — правка на месте недопустима.
      expect(audio.deviceId).toBe(deviceId);
    }
  });

  test("устройство назвал сайт — запрос уходит как был, тем же объектом", () => {
    const explicit = [
      { audio: { deviceId: "other" } },
      { audio: { deviceId: { exact: "other" } } },
      { audio: { deviceId: { ideal: "other" } } },
      { audio: { deviceId: ["other"] } },
      // Игрок выбрал в окне настроек строку «по умолчанию» — это его выбор.
      { audio: { deviceId: { exact: "default" } } },
      { audio: { deviceId: "default" } },
    ];
    for (const c of explicit) {
      const result = pinAudioConstraints(c, MIC);
      expect(result.outcome).toBe("explicit");
      expect(result.constraints).toBe(c);
    }
  });

  test("старый синтаксис Chrome не смешиваем с deviceId — браузер отверг бы запрос", () => {
    const legacy = { audio: { mandatory: { echoCancellation: false } } };
    expect(pinAudioConstraints(legacy, MIC)).toEqual({ constraints: legacy, outcome: "explicit" });
    const optional = { audio: { optional: [{ googAutoGainControl: true }] } };
    expect(pinAudioConstraints(optional, MIC).constraints).toBe(optional);
  });

  test("микрофон не просили — не наше дело", () => {
    for (const c of [{ video: true }, { audio: false, video: true }, { audio: null }, undefined, null, "x", []]) {
      const result = pinAudioConstraints(c, MIC);
      expect(result.outcome).toBe("no-audio");
      expect(result.constraints).toBe(c);
    }
  });

  test("на сайте микрофон не выбран — подставлять нечего, запрос не меняется", () => {
    const request = { audio: true };
    for (const saved of [null, undefined, "", "default", "communications", 42, "x".repeat(513)]) {
      const result = pinAudioConstraints(request, saved);
      expect(result.outcome).toBe("no-saved");
      expect(result.constraints).toBe(request);
    }
  });

  test("непонятная форма audio — запрос не трогаем, пусть судит браузер", () => {
    for (const audio of [[], [{ deviceId: "x" }], "yes", 1]) {
      const request = { audio };
      const result = pinAudioConstraints(request, MIC);
      expect(result.outcome).toBe("explicit");
      expect(result.constraints).toBe(request);
    }
  });

  test("повтор исходного запроса: всегда, кроме отказа в разрешении", () => {
    for (const name of ["NotReadableError", "OverconstrainedError", "AbortError", "NotFoundError", "TypeError"]) {
      expect(shouldRetryUnpinned({ name }), name).toBe(true);
    }
    expect(shouldRetryUnpinned(null)).toBe(true);
    expect(shouldRetryUnpinned({ name: "NotAllowedError" })).toBe(false);
    expect(shouldRetryUnpinned({ name: "SecurityError" })).toBe(false);
  });

  test("usableMicId и hasConcreteDevice — границы", () => {
    expect(usableMicId(MIC)).toBe(MIC);
    expect(usableMicId("x".repeat(512))).toBe("x".repeat(512));
    expect(usableMicId("x".repeat(513))).toBeNull();
    expect(pinAudioConstraints({ audio: true }, MIC).micId).toBe(MIC);
    expect(usableMicId("default")).toBeNull();
    expect(hasConcreteDevice({ exact: [] })).toBe(false);
    expect(hasConcreteDevice({})).toBe(false);
    expect(hasConcreteDevice({ exact: ["a"] })).toBe(true);
  });
});

describe("счётчики на <html>", () => {
  test("формат туда и обратно, мусор отвергается", () => {
    const counts = { pinned: 6, explicit: 1, noSaved: 0, landed: 2, missed: 1, fallback: 3 };
    expect(formatMicPinState(counts)).toBe("6:1:0:2:1:3");
    expect(parseMicPinState(formatMicPinState(counts))).toEqual(counts);
    expect(parseMicPinState("0:0:0:0:0:0")).toEqual(emptyMicPinCounts());
    const junkList = [
      null,
      "",
      "1:2:3",
      "1:2:3:4",
      "1:2:3:4:5",
      "1:2:3:4:5:",
      "1:2:3:4:5:6:7",
      "a:b:c:d:e:f",
      "-1:0:0:0:0:0",
      "1:2:3:4:5:6 onload=x",
      "1234567890:0:0:0:0:0",
    ];
    for (const junk of junkList) {
      expect(parseMicPinState(junk)).toBeNull();
    }
  });
});

describe("page-скрипт: обёртка getUserMedia", () => {
  type Gum = (...args: unknown[]) => Promise<unknown>;
  /** Поток, у которого браузер сообщает deviceId звуковой дорожки. */
  const streamOn = (deviceId: string | undefined) => ({
    getAudioTracks: () => [{ getSettings: () => ({ deviceId }) }],
  });
  const attr = (): string | null => document.documentElement.getAttribute(MIC_PIN_STATE_ATTR);
  let native: ReturnType<typeof vi.fn>;
  let devices: { getUserMedia: Gum };

  async function install(): Promise<void> {
    vi.resetModules();
    (window as { __pnMicPinInstalled?: boolean }).__pnMicPinInstalled = false;
    await import("@content/page/mic-pin-page");
  }

  beforeEach(() => {
    native = vi.fn(async () => streamOn(MIC));
    devices = { getUserMedia: native as unknown as Gum };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: devices });
  });

  test("флага нет — запрос уходит браузеру тем же объектом", async () => {
    await install();
    store.set(SITE_MIC_KEY, MIC);
    const request = { audio: true, video: true };
    await devices.getUserMedia(request);
    expect(native.mock.calls[0][0]).toBe(request);
  });

  test("флаг есть — запрос «по умолчанию» получает сохранённый микрофон", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const request = { audio: true, video: { width: { ideal: 1280 } } };
    const stream = streamOn(MIC);
    native.mockResolvedValueOnce(stream);
    // Сайт получает ровно тот поток, что выдал браузер.
    await expect(devices.getUserMedia(request)).resolves.toBe(stream);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][0]).toEqual({
      audio: { deviceId: { ideal: MIC } },
      video: { width: { ideal: 1280 } },
    });
    expect(native.mock.contexts[0]).toBe(devices);
    expect(request.audio).toBe(true);
  });

  test("this и лишние аргументы доходят до браузера как у сайта — в обеих ветках", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const other = { tag: "other-this" };
    await devices.getUserMedia.call(other, { audio: true }, "extra");
    expect(native.mock.contexts[0]).toBe(other);
    expect(native.mock.calls[0][1]).toBe("extra");
    await devices.getUserMedia.call(other, { video: true }, "extra");
    expect(native.mock.contexts[1]).toBe(other);
    expect(native.mock.calls[1][1]).toBe("extra");
  });

  test("сохранённый микрофон не открылся — повторяем запрос сайта как был", async () => {
    // Ревью 19.11.2026: без повтора окно настроек посреди игры ходило по
    // кругу «попробуйте ещё раз», хотя сайт сам взял бы системный микрофон.
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const fallbackStream = streamOn("system");
    native.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    native.mockResolvedValueOnce(fallbackStream);
    const request = { audio: true, video: true };
    await expect(devices.getUserMedia(request)).resolves.toBe(fallbackStream);
    expect(native).toHaveBeenCalledTimes(2);
    expect(native.mock.calls[1][0]).toBe(request);
    expect(native.mock.contexts[1]).toBe(devices);
    expect(attr()).toBe("1:0:0:0:0:1");
  });

  test("повтор идёт с тем же this и аргументами, что у сайта", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const other = { tag: "other-this" };
    native.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    await devices.getUserMedia.call(other, { audio: true }, "extra");
    expect(native.mock.contexts[1]).toBe(other);
    expect(native.mock.calls[1][1]).toBe("extra");
  });

  test("занята камера: оба запроса отвергнуты — в счётчик повтор не идёт (микрофон ни при чём)", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const busy = Object.assign(new Error("camera busy"), { name: "NotReadableError" });
    native.mockRejectedValueOnce(busy);
    native.mockRejectedValueOnce(busy);
    await expect(devices.getUserMedia({ audio: true, video: true })).rejects.toBe(busy);
    expect(attr()).toBe("1:0:0:0:0:0");
    // …и не всплывает позже, когда счётчики публикует следующий запрос.
    await devices.getUserMedia({ audio: { deviceId: { exact: "x" } } });
    expect(attr()).toBe("1:1:0:0:0:0");
  });

  test("сверка устройства не может уронить запрос сайта", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const weird = [
      { getAudioTracks: () => null },
      {
        getAudioTracks: () => [
          {
            getSettings: () => {
              throw new Error("InvalidStateError");
            },
          },
        ],
      },
      {
        getAudioTracks: () => {
          throw new Error("boom");
        },
      },
    ];
    for (const stream of weird) {
      native.mockResolvedValueOnce(stream);
      await expect(devices.getUserMedia({ audio: true })).resolves.toBe(stream);
    }
  });

  test("браузер вернул не Promise (чужая заглушка) — отдаём как есть, и в повторе тоже", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    native.mockReturnValueOnce("not-a-promise");
    expect(devices.getUserMedia({ audio: true })).toBe("not-a-promise");
    native.mockImplementationOnce(() => {
      throw new TypeError("malformed");
    });
    native.mockReturnValueOnce(undefined);
    expect(devices.getUserMedia({ audio: true })).toBeUndefined();
  });

  test("метод живёт на прототипе — обёртка встаёт туда же, а не своим свойством на экземпляр", async () => {
    // Иначе расширение, патчащее прототип ПОСЛЕ нас (виртуальная камера),
    // оказалось бы заслонено и перестало работать.
    const proto = { getUserMedia: native as unknown as Gum };
    const instance = Object.create(proto) as { getUserMedia: Gum };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: instance });
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    expect(Object.prototype.hasOwnProperty.call(instance, "getUserMedia")).toBe(false);
    expect(proto.getUserMedia).not.toBe(native);
    await instance.getUserMedia({ audio: true });
    expect(native.mock.calls[0][0]).toEqual({ audio: { deviceId: { ideal: MIC } } });
    expect(native.mock.contexts[0]).toBe(instance);
    // Поздний патч прототипа другим расширением виден сайту.
    const later = vi.fn(async () => "virtual");
    proto.getUserMedia = later as unknown as Gum;
    await expect(instance.getUserMedia({ audio: true })).resolves.toBe("virtual");
  });

  test("отказ в разрешении НЕ повторяем: второй запрос браузера игроку ни к чему", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    native.mockRejectedValueOnce(denied);
    await expect(devices.getUserMedia({ audio: true })).rejects.toBe(denied);
    expect(native).toHaveBeenCalledTimes(1);
    expect(attr()).toBe("1:0:0:0:0:0");
  });

  test("повтор тоже не удался — сайт получает ошибку повтора, третьей попытки нет", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const second = Object.assign(new Error("no devices"), { name: "NotFoundError" });
    native.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    native.mockRejectedValueOnce(second);
    await expect(devices.getUserMedia({ audio: true })).rejects.toBe(second);
    expect(native).toHaveBeenCalledTimes(2);
  });

  test("синхронное исключение на изменённом запросе — тоже повтор как был", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    native.mockImplementationOnce(() => {
      throw new TypeError("malformed");
    });
    const request = { audio: true };
    await devices.getUserMedia(request);
    expect(native.mock.calls[1][0]).toBe(request);
  });

  test("браузер выдал другой микрофон (сохранённого нет в системе) — считаем промахом", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    native.mockResolvedValueOnce(streamOn("airpods-mic"));
    await devices.getUserMedia({ audio: true });
    expect(attr()).toBe("1:0:0:0:1:0");
    // deviceId браузер не сообщил или потока-объекта нет — не гадаем: попадание.
    native.mockResolvedValueOnce(streamOn(undefined));
    await devices.getUserMedia({ audio: true });
    native.mockResolvedValueOnce("not-a-stream");
    await devices.getUserMedia({ audio: true });
    expect(attr()).toBe("3:0:0:2:1:0");
  });

  test("явный выбор сайта (окно настроек устройств) не подменяется", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const request = { audio: { deviceId: { exact: "headset" } }, video: false };
    await devices.getUserMedia(request);
    expect(native.mock.calls[0][0]).toBe(request);
  });

  test("выключение опции действует сразу, без перезагрузки игры", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    store.delete(MIC_PIN_FLAG_KEY);
    const request = { audio: true };
    await devices.getUserMedia(request);
    expect(native.mock.calls[0][0]).toBe(request);
  });

  test("наша ошибка не ломает запрос: хранилище бросает — уходит оригинал", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    await install();
    storeBroken = true;
    const request = { audio: true };
    await expect(devices.getUserMedia(request)).resolves.toBeDefined();
    expect(native.mock.calls[0][0]).toBe(request);
  });

  test("бросает только чтение ключа сайта (флаг опции читается) — запрос всё равно уходит", async () => {
    // Гейт глотает свои исключения сам; этот случай доходит до try обёртки.
    store.set(MIC_PIN_FLAG_KEY, "1");
    await install();
    siteKeyBroken = true;
    const request = { audio: true };
    await expect(devices.getUserMedia(request)).resolves.toBeDefined();
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][0]).toBe(request);
  });

  test("запись счётчика не удалась — запрос всё равно уходит", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const setAttribute = vi.spyOn(document.documentElement, "setAttribute").mockImplementation(() => {
      throw new Error("no document");
    });
    await expect(devices.getUserMedia({ audio: true })).resolves.toBeDefined();
    setAttribute.mockRestore();
    expect(native.mock.calls[0][0]).toEqual({ audio: { deviceId: { ideal: MIC } } });
  });

  test("отказ браузера доходит до сайта как есть", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    // Запрос, который мы не меняли: ошибка браузера — та же самая, без повторов.
    const failed = Object.assign(new Error("busy"), { name: "NotReadableError" });
    native.mockRejectedValueOnce(failed);
    await expect(devices.getUserMedia({ audio: { deviceId: { exact: "x" } } })).rejects.toBe(failed);
    expect(native).toHaveBeenCalledTimes(1);
  });

  test("вызов без аргументов остаётся вызовом без аргументов", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    await devices.getUserMedia();
    expect(native.mock.calls[0]).toHaveLength(0);
  });

  test("повторный инжект не ставит второй слой", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    const wrapped = devices.getUserMedia;
    vi.resetModules();
    await import("@content/page/mic-pin-page");
    expect(devices.getUserMedia).toBe(wrapped);
    await devices.getUserMedia({ audio: true });
    expect(native).toHaveBeenCalledTimes(1);
  });

  test("нет mediaDevices или getUserMedia — скрипт молча ничего не делает", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await expect(install()).resolves.toBeUndefined();
    const bare = { getUserMedia: undefined as unknown };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: bare });
    await expect(install()).resolves.toBeUndefined();
    expect(bare.getUserMedia).toBeUndefined();
    expect(attr()).toBeNull();
  });

  test("счётчики: перенаправлено / назвал сайт / нечего подставить; только видео не считается", async () => {
    store.set(MIC_PIN_FLAG_KEY, "1");
    store.set(SITE_MIC_KEY, MIC);
    await install();
    expect(attr()).toBe("0:0:0:0:0:0");
    await devices.getUserMedia({ audio: true });
    await devices.getUserMedia({ audio: { deviceId: { exact: "x" } } });
    await devices.getUserMedia({ video: true });
    store.set(SITE_MIC_KEY, "default");
    await devices.getUserMedia({ audio: true });
    expect(attr()).toBe("1:1:1:1:0:0");
    // Наружу — только числа: ни deviceId, ни названий.
    expect(document.documentElement.outerHTML).not.toContain(MIC);
  });
});

describe("content-сторона: зеркало и отчёт", () => {
  test("зеркало учитывает главный выключатель", () => {
    expect(micPinActive({ master: true, option: true })).toBe(true);
    expect(micPinActive({ master: undefined, option: true })).toBe(true);
    expect(micPinActive({ master: false, option: true })).toBe(false);
    expect(micPinActive({ master: true, option: false })).toBe(false);
    expect(micPinActive({ master: true, option: "1" })).toBe(false);
  });

  test("выключено — ключ удаляется, а не пишется «0»: следов у остальных нет", () => {
    writeMicPinMirror(localStorage, true);
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
    writeMicPinMirror(localStorage, false);
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
    expect(() => writeMicPinMirror(null, true)).not.toThrow();
    const throwing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => writeMicPinMirror(throwing, true)).not.toThrow();
    expect(() => writeMicPinMirror(throwing, false)).not.toThrow();
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  test("setupMicPin: главный выключатель снят ещё до загрузки страницы — зеркала нет", async () => {
    mocks.settings.mic_pin_enabled = true;
    mocks.settings.extension_enabled = false;
    store.set(MIC_PIN_FLAG_KEY, "1");
    setupMicPin();
    await settle();
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
  });

  test("setupMicPin: главный выключатель снят событием до ответа чтения — устаревшее «включено» его не затирает", async () => {
    mocks.settings.mic_pin_enabled = true;
    mocks.settings.extension_enabled = true;
    store.set(MIC_PIN_FLAG_KEY, "1");
    setupMicPin();
    mocks.handlers[0]({ extension_enabled: false });
    // Выключено — известно сразу: вторую настройку ждать незачем.
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
    await settle();
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
  });

  test("setupMicPin: одна настройка точно «выключено», вторая не прочиталась — устаревшая «1» убирается", async () => {
    mocks.failRead = "extension_enabled";
    mocks.settings.mic_pin_enabled = false;
    store.set(MIC_PIN_FLAG_KEY, "1");
    setupMicPin();
    await settle();
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
  });

  test("setupMicPin: событие до ответа чтения — зеркало ждёт обеих настроек, чтение событие не затирает", async () => {
    mocks.settings.mic_pin_enabled = false;
    setupMicPin();
    // Тумблер нажат раньше, чем storage ответил: главный выключатель ещё
    // неизвестен — писать рано.
    mocks.handlers[0]({ mic_pin_enabled: true });
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
    await settle();
    // Чтение вернуло старое «выключено», но событие новее.
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
  });

  test("setupMicPin: настройки не прочитались — зеркало не трогаем", async () => {
    mocks.failRead = true;
    store.set(MIC_PIN_FLAG_KEY, "1");
    setupMicPin();
    await settle();
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
    // Обе настройки пришли событиями — теперь состояние известно.
    mocks.handlers[0]({ mic_pin_enabled: false, extension_enabled: true });
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
  });

  test("setupMicPin: не прочиталась одна настройка из двух — «неизвестно» не значит «выключено»", async () => {
    for (const key of ["mic_pin_enabled", "extension_enabled"]) {
      mocks.failRead = key;
      mocks.settings.mic_pin_enabled = true;
      mocks.handlers.length = 0;
      store.set(MIC_PIN_FLAG_KEY, "1");
      setupMicPin();
      await settle();
      expect(store.get(MIC_PIN_FLAG_KEY), key).toBe("1");

      // …и «включено» тоже не значит: зеркала не было — оно не появляется.
      mocks.handlers.length = 0;
      store.delete(MIC_PIN_FLAG_KEY);
      setupMicPin();
      await settle();
      expect(store.has(MIC_PIN_FLAG_KEY), key).toBe(false);
    }
  });

  test("отчёт через 20 с — только в комнате и только при включённой опции", async () => {
    vi.useFakeTimers();
    mocks.settings.mic_pin_enabled = true;
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "1:1:0:1:0:0");
    setupMicPin();
    await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS - 1);
    expect(mocks.info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.info).toHaveBeenCalledTimes(1);

    // Не комната: отчёта нет.
    vi.clearAllMocks();
    resetMicPinForTest();
    mocks.handlers.length = 0;
    setPath("/game-search");
    setupMicPin();
    await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS * 2);
    expect(mocks.info).not.toHaveBeenCalled();

    // Комната, но опцию выключили до срока: таймер снят.
    setPath("/game");
    mocks.handlers.length = 0;
    setupMicPin();
    await vi.advanceTimersByTimeAsync(1000);
    mocks.handlers[0]({ mic_pin_enabled: false });
    await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS * 2);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  test("уход со страницы: итог пишется и сразу сбрасывается на диск", async () => {
    mocks.settings.mic_pin_enabled = true;
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:1:0:2:0:0");
    setupMicPin();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.info).toHaveBeenCalledTimes(1);
    // Слушатель log стоит раньше нашего: без явного сброса строка пропала бы.
    expect(mocks.flushNow).toHaveBeenCalled();
    expect(mocks.flushNow.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.info.mock.invocationCallOrder[0]);
  });

  test("уход со страницы до отчёта: подсказку не показываем и не помечаем показанной", async () => {
    // Лобби распалось на 10-й секунде: тост на умирающей странице никто не
    // увидит, а отметка лишила бы игрока подсказки в следующей игре.
    mocks.settings.mic_pin_enabled = true;
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:1:0:0:0");
    setupMicPin();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(session.has("pn_mic_pin_hint")).toBe(false);
    // Следующая игра в той же вкладке — подсказка на месте.
    resetMicPinForTest();
    expect(reportMicPin()).toBe("nothing-to-pin");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  test("уход со страницы не из комнаты — ни строки", async () => {
    mocks.settings.mic_pin_enabled = true;
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:1:0:2:0:0");
    setPath("/game-search");
    setupMicPin();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.flushNow).not.toHaveBeenCalled();
  });

  test("уход со страницы при выключенной опции — ни строки", async () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:1:0:2:0:0");
    setupMicPin();
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.flushNow).not.toHaveBeenCalled();
  });

  test("setupMicPin: по умолчанию ничего не пишет; включение и главный выключатель меняют зеркало", async () => {
    setupMicPin();
    await vi.waitFor(() => expect(mocks.handlers).toHaveLength(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);

    mocks.handlers[0]({ mic_pin_enabled: true });
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
    mocks.handlers[0]({ extension_enabled: false });
    expect(store.has(MIC_PIN_FLAG_KEY)).toBe(false);
    mocks.handlers[0]({ extension_enabled: true });
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
    mocks.handlers[0]({ hide_rating: true });
    expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1");
  });

  test("setupMicPin: включённая настройка поднимает зеркало при загрузке страницы", async () => {
    mocks.settings.mic_pin_enabled = true;
    setupMicPin();
    await vi.waitFor(() => expect(store.get(MIC_PIN_FLAG_KEY)).toBe("1"));
  });

  test("вердикт по счётчикам", () => {
    const c = (pinned: number, explicit: number, noSaved: number, landed = 0, missed = 0, fallback = 0) => ({
      pinned,
      explicit,
      noSaved,
      landed,
      missed,
      fallback,
    });
    expect(micPinVerdict(null)).toBe("not-installed");
    expect(micPinVerdict(c(0, 0, 0))).toBe("idle");
    // Вход в комнату всегда начинается с запроса без устройства: его нет —
    // значит, обёртка встала позже.
    expect(micPinVerdict(c(0, 1, 0))).toBe("late");
    expect(micPinVerdict(c(0, 2, 0))).toBe("late");
    // «Работает» — только когда браузер действительно выдал выбранный микрофон.
    expect(micPinVerdict(c(1, 1, 0, 1))).toBe("working");
    expect(micPinVerdict(c(3, 1, 0, 1, 1, 1))).toBe("working");
    expect(micPinVerdict(c(0, 1, 1))).toBe("nothing-to-pin");
    // Подставляли, а получили другой микрофон или пришлось повторять.
    expect(micPinVerdict(c(2, 1, 0, 0, 2, 0))).toBe("unavailable");
    expect(micPinVerdict(c(1, 0, 0, 0, 0, 1))).toBe("unavailable");
    // Отказ в разрешении, занятая камера, ещё открытый запрос браузера:
    // подставили, но исхода нет — это не «работает» и не «микрофон недоступен».
    expect(micPinVerdict(c(1, 0, 0))).toBe("unsettled");
    expect(micPinVerdict(c(2, 3, 0))).toBe("unsettled");
  });

  test("отчёт: в лог только числа; подсказка — один раз и только когда подставить нечего", () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:1:0:2:0:0");
    expect(reportMicPin()).toBe("working");
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
    // То же состояние второй раз в лог не пишется.
    reportMicPin();
    expect(mocks.info).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:1:0:0:0");
    expect(reportMicPin()).toBe("nothing-to-pin");
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:2:0:0:0");
    reportMicPin();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls.flat().join(" ")).not.toMatch(/[0-9a-f]{16}/);
  });

  test("подставили, но исхода нет (отказ в разрешении) — в лог без подсказки и без тревоги", () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "1:0:0:0:0:0");
    expect(reportMicPin()).toBe("unsettled");
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test("тост подавлен дедупом — подсказка не считается показанной", () => {
    mocks.toast.mockReturnValueOnce(false);
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:1:0:0:0");
    reportMicPin();
    expect(session.has("pn_mic_pin_hint")).toBe(false);
    resetMicPinForTest();
    reportMicPin();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(session.get("pn_mic_pin_hint")).toBe("nothing-to-pin");
  });

  test("sessionStorage недоступен или с мусором — подсказка всё равно выходит, мусор обратно не пишется", () => {
    session.set("pn_mic_pin_hint", "<b>x</b>,working,,late");
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:1:0:0:0");
    reportMicPin();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(session.get("pn_mic_pin_hint")).toBe("nothing-to-pin");

    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:0:0:0:2:0");
    expect(() => reportMicPin()).not.toThrow();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  test("подсказка — раз на вкладку: следующая игра в той же вкладке не напоминает", () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:1:1:0:0:0");
    reportMicPin();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    // Новая загрузка страницы: состояние модуля сброшено, sessionStorage — нет.
    resetMicPinForTest();
    reportMicPin();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    // Другая причина — своя подсказка, тоже один раз.
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "2:0:0:0:2:0");
    expect(reportMicPin()).toBe("unavailable");
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  test("обёртка опоздала к первому запросу — предупреждение в лог, игрока не дёргаем", () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:2:0:0:0:0");
    expect(reportMicPin()).toBe("late");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test("подделанный сайтом атрибут даёт максимум одну подсказку со статичным текстом", () => {
    document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, "0:0:1:0:0:0<img src=x>");
    expect(reportMicPin()).toBe("not-installed");
    expect(mocks.toast).not.toHaveBeenCalled();
    for (const forged of ["0:0:5:0:0:0", "0:0:6:0:0:0", "0:0:7:0:0:0"]) {
      document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, forged);
      reportMicPin();
    }
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  test("перехват не встал (опцию включили после загрузки) — в лог, без подсказки", () => {
    expect(reportMicPin()).toBe("not-installed");
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test("ключ зеркала один у инжектора, page-скрипта и content-скрипта", () => {
    for (const file of ["src/content/page/mic-pin-inject.ts", "src/content/page/mic-pin-page.ts"]) {
      expect(read(file), file).toContain("micPinAllowed");
    }
    expect(read("src/content/mic-pin.ts")).toContain("MIC_PIN_FLAG_KEY");
    expect(read("src/content/index.ts")).toContain("setupMicPin()");
  });

  test("оба скрипта собираются отдельными файлами", () => {
    const tsup = read("tsup.config.ts");
    expect(tsup).toContain('"mic-pin-page": "src/content/page/mic-pin-page.ts"');
    expect(tsup).toContain('"mic-pin-inject": "src/content/page/mic-pin-inject.ts"');
  });

  test("манифест: инжектор на document_start, page-скрипт доступен странице", () => {
    const manifest = JSON.parse(read("src/manifest/manifest.base.json")) as {
      content_scripts: Array<{ matches: string[]; js: string[]; run_at: string }>;
      web_accessible_resources: Array<{ resources: string[] }>;
    };
    const block = manifest.content_scripts.find((c) => c.js.includes("mic-pin-inject.js"));
    expect(block?.run_at).toBe("document_start");
    expect(block?.matches).toEqual(["https://*.polemicagame.com/game*"]);
    expect(manifest.web_accessible_resources.some((r) => r.resources.includes("mic-pin-page.js"))).toBe(true);
  });
});

describe("Firefox на macOS: приписка про настройку браузера", () => {
  const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0";
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
  const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0";

  test("только Firefox и только macOS", () => {
    expect(needsFirefoxMacMicNote(FIREFOX_MAC, "mac")).toBe(true);
    // В Chrome системной обработки голоса в цепочке нет — приписка была бы враньём.
    expect(needsFirefoxMacMicNote(CHROME_MAC, "mac")).toBe(false);
    expect(needsFirefoxMacMicNote(FIREFOX_WIN, "win")).toBe(false);
    expect(needsFirefoxMacMicNote(FIREFOX_MAC, "linux")).toBe(false);
    expect(needsFirefoxMacMicNote("", "mac")).toBe(false);
  });

  test("в разметке приписка — подопция сразу под тумблером, по умолчанию скрыта и вне поиска", () => {
    const html = read("src/static/popup.html");
    const at = html.indexOf('id="mic_pin_enabled"');
    const rowAt = html.indexOf('id="mic_pin_firefox_row"');
    expect(rowAt).toBeGreaterThan(at);
    // Между тумблером и припиской нет других строк настроек.
    expect(html.slice(at, rowAt).match(/<div class="row/g)).toHaveLength(1);
    const tag = html.slice(html.lastIndexOf("<div", rowAt), html.indexOf(">", rowAt) + 1);
    expect(tag).toContain('class="row child"');
    expect(tag).toContain('style="display:none"');
    expect(tag).toContain('data-search="off"');
    // Имя настройки — дословно: по нему её ищут в about:config.
    expect(html).toContain("media.getusermedia.microphone.prefer_voice_stream_with_processing.enabled");
  });

  test("попап показывает приписку и возвращает её в поиск только по признаку браузера", () => {
    const src = read("src/popup/index.ts");
    const at = src.indexOf("needsFirefoxMacMicNote(navigator.userAgent, info.os)");
    expect(at).toBeGreaterThan(0);
    // Сбой API не обрывает инициализацию попапа: вызов стоит внутри цепочки
    // промиса (иначе синхронное исключение ломало весь попап — поймано
    // тестом popup-mic-hotkey, где у заглушки getPlatformInfo нет).
    expect(src).toContain(".then(() => browser.runtime.getPlatformInfo())");
    const block = src.slice(at, at + 400);
    expect(block).toContain('$("mic_pin_firefox_row")');
    expect(block).toContain('row.style.display = ""');
    expect(block).toContain("delete row.dataset.search");
  });
});
