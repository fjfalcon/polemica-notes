/**
 * Источник микрофона из OBS (9.75.0): «авто» = строго главный микрофон OBS
 * (mic1), список для выбора, фолбэк прежнего значения по умолчанию «Mic/Aux».
 * Выключенный слот OBS присылает null — как в настоящем протоколе.
 */
import { describe, expect, test, vi } from "vitest";
import {
  LEGACY_MIC_DEFAULT,
  NO_MAIN_MIC_ERROR,
  OBS_RESOURCE_NOT_FOUND,
  listMicInputs,
  specialMics,
  withMicInput,
  type ObsRequest,
} from "../../src/background/obs-mic";

function fakeObs(opts: {
  special?: Record<string, string | null>;
  inputs?: Array<{ inputName: unknown; inputKind: unknown }>;
}) {
  const calls: string[] = [];
  const request = vi.fn(async (type: string) => {
    calls.push(type);
    if (type === "GetSpecialInputs") return opts.special ?? {};
    if (type === "GetInputList") return { inputs: opts.inputs ?? [] };
    throw new Error(`unexpected ${type}`);
  }) as unknown as ObsRequest;
  return { request, calls };
}

const notFound = () => Object.assign(new Error("No source was found"), { code: OBS_RESOURCE_NOT_FOUND });

/** Операция над «существующими» в OBS источниками; прочие — ResourceNotFound. */
const opOver = (existing: string[]) =>
  vi.fn(async (name: string) => {
    if (!existing.includes(name)) throw notFound();
    return `ok:${name}`;
  });

const SPECIAL_RU = { desktop1: "Звук рабочего стола", desktop2: null, mic1: "Мик/Доп", mic2: null, mic3: "Гарнитура", mic4: null };

describe("системные микрофоны", () => {
  test("главный — только mic1; включённые mic1..mic4 по порядку; рабочий стол не берём", async () => {
    const { request } = fakeObs({ special: SPECIAL_RU });
    expect(await specialMics(request)).toEqual({ main: "Мик/Доп", all: ["Мик/Доп", "Гарнитура"] });
  });

  test("mic1 выключен (null) — главного нет, даже если включён mic2", async () => {
    const { request } = fakeObs({ special: { mic1: null, mic2: "Гарнитура" } });
    expect((await specialMics(request)).main).toBeNull();
  });
});

describe("список для выбора в попапе", () => {
  test("микрофоны: системные первыми, затем устройства ввода всех ОС; прочие со звуком — отдельно", async () => {
    const { request } = fakeObs({
      special: { mic1: "Мик/Доп", mic2: null },
      inputs: [
        { inputName: "Мик/Доп", inputKind: "wasapi_input_capture" },
        { inputName: "Shure", inputKind: "coreaudio_input_capture" },
        { inputName: "Линукс-мик", inputKind: "pulse_input_capture" },
        { inputName: "ALSA", inputKind: "alsa_input_capture" },
        { inputName: "Звук рабочего стола", inputKind: "wasapi_output_capture" },
        { inputName: "Вебкамера", inputKind: "dshow_input" },
        { inputName: "Дискорд", inputKind: "wasapi_process_output_capture" },
        { inputName: "Логотип", inputKind: "image_source" },
        { inputName: "Подпись", inputKind: "text_gdiplus_v3" },
        { inputName: "Фон", inputKind: "color_source_v3" },
        { inputName: "", inputKind: "wasapi_input_capture" },
        { inputName: 42, inputKind: "wasapi_input_capture" },
      ],
    });
    expect(await listMicInputs(request)).toEqual({
      main: "Мик/Доп",
      mics: ["Мик/Доп", "Shure", "Линукс-мик", "ALSA"],
      others: ["Звук рабочего стола", "Вебкамера", "Дискорд"],
    });
  });

  test("mic1 выключен, но «Mic/Aux» есть — «авто» подписано им, как и работает", async () => {
    const { request } = fakeObs({
      special: { mic1: null },
      inputs: [{ inputName: LEGACY_MIC_DEFAULT, inputKind: "wasapi_input_capture" }],
    });
    expect((await listMicInputs(request)).main).toBe(LEGACY_MIC_DEFAULT);
  });

  test("мусорный ответ GetInputList — только системные", async () => {
    const request = (async (type: string) =>
      type === "GetSpecialInputs" ? { mic1: "Mic/Aux" } : { inputs: "x" }) as unknown as ObsRequest;
    expect(await listMicInputs(request)).toEqual({ main: "Mic/Aux", mics: ["Mic/Aux"], others: [] });
  });
});

describe("«авто»", () => {
  test("главный микрофон OBS в его языке; в ответе — настоящее имя", async () => {
    const { request } = fakeObs({ special: SPECIAL_RU });
    expect(await withMicInput(request, "", opOver(["Мик/Доп"]))).toEqual({ inputName: "Мик/Доп", result: "ok:Мик/Доп" });
  });

  test("mic1 выключен, включён mic2 — mic2 НЕ трогаем (не тот вход, эфир бы слышал)", async () => {
    const { request } = fakeObs({ special: { mic1: null, mic2: "Гарнитура" } });
    const op = opOver(["Гарнитура"]);
    await expect(withMicInput(request, "", op)).rejects.toThrow(NO_MAIN_MIC_ERROR);
    expect(op.mock.calls.map((c) => c[0])).not.toContain("Гарнитура");
  });

  test("mic1 выключен, но источник «Mic/Aux» заведён руками под прежний дефолт — работаем с ним", async () => {
    const { request } = fakeObs({ special: { mic1: null } });
    expect(await withMicInput(request, "", opOver([LEGACY_MIC_DEFAULT]))).toEqual({
      inputName: LEGACY_MIC_DEFAULT,
      result: `ok:${LEGACY_MIC_DEFAULT}`,
    });
  });

  test("mic1 выключен и «Mic/Aux» нет — понятная ошибка, а не «No source was found»", async () => {
    const { request } = fakeObs({ special: { mic1: null } });
    await expect(withMicInput(request, "", opOver([]))).rejects.toThrow(NO_MAIN_MIC_ERROR);
  });
});

describe("своё имя", () => {
  test("как есть, OBS про системные не спрашиваем", async () => {
    const { request, calls } = fakeObs({ special: SPECIAL_RU });
    expect(await withMicInput(request, "  Shure  ", opOver(["Shure"]))).toEqual({ inputName: "Shure", result: "ok:Shure" });
    expect(calls).toEqual([]);
  });

  test("которого нет — НЕ подменяется главным микрофоном: стример выбрал не его", async () => {
    const { request } = fakeObs({ special: SPECIAL_RU });
    const op = opOver(["Мик/Доп"]);
    await expect(withMicInput(request, "Shure", op)).rejects.toThrow("No source was found");
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("прежнее значение по умолчанию «Mic/Aux»", () => {
  test("в русском OBS его нет — уходим на главный микрофон", async () => {
    const { request } = fakeObs({ special: SPECIAL_RU });
    const op = opOver(["Мик/Доп"]);
    expect(await withMicInput(request, LEGACY_MIC_DEFAULT, op)).toEqual({ inputName: "Мик/Доп", result: "ok:Мик/Доп" });
    expect(op.mock.calls.map((c) => c[0])).toEqual([LEGACY_MIC_DEFAULT, "Мик/Доп"]);
  });

  test("есть — работает с ним, OBS лишний раз не спрашиваем", async () => {
    const { request, calls } = fakeObs({ special: { mic1: "Другой" } });
    expect(await withMicInput(request, LEGACY_MIC_DEFAULT, opOver([LEGACY_MIC_DEFAULT]))).toEqual({
      inputName: LEGACY_MIC_DEFAULT,
      result: `ok:${LEGACY_MIC_DEFAULT}`,
    });
    expect(calls).toEqual([]);
  });

  test("другая ошибка (не «нет источника») не маскируется фолбэком", async () => {
    const { request } = fakeObs({ special: SPECIAL_RU });
    const op = vi.fn(async () => {
      throw new Error("Request timeout");
    });
    await expect(withMicInput(request, LEGACY_MIC_DEFAULT, op)).rejects.toThrow("Request timeout");
    expect(op).toHaveBeenCalledTimes(1);
  });

  test("его нет, а главный микрофон выключен — исходная ошибка, без подмены на mic2", async () => {
    const { request } = fakeObs({ special: { mic1: null, mic2: "Гарнитура" } });
    const op = opOver(["Гарнитура"]);
    await expect(withMicInput(request, LEGACY_MIC_DEFAULT, op)).rejects.toThrow("No source was found");
    expect(op).toHaveBeenCalledTimes(1);
  });

  test("главный микрофон и есть «Mic/Aux», которого нет — без повтора по кругу", async () => {
    const { request } = fakeObs({ special: { mic1: LEGACY_MIC_DEFAULT } });
    const op = opOver([]);
    await expect(withMicInput(request, LEGACY_MIC_DEFAULT, op)).rejects.toThrow("No source was found");
    expect(op).toHaveBeenCalledTimes(1);
  });
});
