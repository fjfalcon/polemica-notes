/**
 * Источник микрофона в OBS для «Микрофон: OBS и игра» (просьба владельца
 * 02.11.2026: «зачем указывать имя, мы же можем вытащить источники из OBS»).
 *
 * Имя «Mic/Aux» — не системный ключ, а обычное имя источника: в русском OBS
 * главный микрофон зовётся иначе, стримеры его переименовывают. Поэтому:
 *  - пустое значение настройки = «авто»: имя главного микрофона берётся из
 *    GetSpecialInputs.mic1 В МОМЕНТ РАБОТЫ (язык и переименование не мешают).
 *    Именно mic1, а не «первый непустой»: mic2 может быть посторонним
 *    устройством, и «авто» молча глушило бы не тот вход (ревью 02.11.2026, M1);
 *  - mic1 выключен — пробуем источник, буквально названный «Mic/Aux» (под
 *    прежний дефолт его могли завести вручную), иначе честная ошибка;
 *  - прежнее значение по умолчанию «Mic/Aux», которого в этом OBS нет,
 *    уходит на главный микрофон — сохранённые настройки не ломаются;
 *  - список для попапа: микрофоны (системные mic1..mic4 и устройства ввода
 *    `*_input_capture`) и отдельно все прочие источники — звук бывает у
 *    вебкамеры, захвата приложения, плагинов (ревью, M4).
 * Чистые функции поверх запроса — тестируются без двойника сокета.
 */

import { LEGACY_MIC_DEFAULT } from "@shared/mic-input";

export { LEGACY_MIC_DEFAULT };

export type ObsRequest = <T = unknown>(requestType: string, requestData?: object) => Promise<T>;

/** RequestStatus::ResourceNotFound — источника с таким именем нет. */
export const OBS_RESOURCE_NOT_FOUND = 600;

export const NO_MAIN_MIC_ERROR = "в OBS не задан главный микрофон — выберите источник в настройках";

const SPECIAL_MIC_KEYS = ["mic1", "mic2", "mic3", "mic4"] as const;

/** Источники без звука по природе — в «прочих» только шумели бы. */
const SILENT_KIND = /^(image_source|color_source|text_|slideshow)/;

/** Строка-имя или null: выключенный слот OBS присылает null (или пусто). */
function nameOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Системные микрофоны OBS: главный (mic1) и все включённые mic1..mic4 по порядку. */
export async function specialMics(request: ObsRequest): Promise<{ main: string | null; all: string[] }> {
  const res = await request<Record<string, unknown>>("GetSpecialInputs");
  return {
    main: nameOrNull(res?.mic1),
    all: SPECIAL_MIC_KEYS.map((k) => nameOrNull(res?.[k])).filter((v): v is string => v !== null),
  };
}

export interface MicInputList {
  /** Чем станет «авто»: главный микрофон (mic1) или, если он выключен, источник «Mic/Aux»; null — ничем. */
  main: string | null;
  /** Микрофоны: системные первыми, затем устройства ввода. */
  mics: string[];
  /** Прочие источники, у которых может быть звук. */
  others: string[];
}

export async function listMicInputs(request: ObsRequest): Promise<MicInputList> {
  const [special, list] = await Promise.all([
    specialMics(request),
    request<{ inputs?: Array<{ inputName?: unknown; inputKind?: unknown }> }>("GetInputList"),
  ]);
  const inputs = (Array.isArray(list?.inputs) ? list.inputs : []).filter(
    (i): i is { inputName: string; inputKind?: unknown } => nameOrNull(i?.inputName) !== null,
  );
  const kindOf = (i: { inputKind?: unknown }) => (typeof i.inputKind === "string" ? i.inputKind : "");
  const mics = [
    ...new Set([
      ...special.all,
      ...inputs.filter((i) => /_input_capture$/.test(kindOf(i))).map((i) => i.inputName),
    ]),
  ];
  const others = [
    ...new Set(
      inputs.filter((i) => !mics.includes(i.inputName) && !SILENT_KIND.test(kindOf(i))).map((i) => i.inputName),
    ),
  ];
  // mic1 выключен, но «Mic/Aux» есть — «авто» возьмёт его (withMicInput), так и подписываем.
  const allNames = inputs.map((i) => i.inputName);
  const main = special.main ?? (allNames.includes(LEGACY_MIC_DEFAULT) ? LEGACY_MIC_DEFAULT : null);
  return { main, mics, others };
}

function isNotFound(e: unknown): boolean {
  return (e as { code?: unknown })?.code === OBS_RESOURCE_NOT_FOUND;
}

/**
 * Выполнить операцию над источником микрофона и вернуть, над КАКИМ: вкладке
 * нужно настоящее имя, чтобы узнавать свои события InputMuteStateChanged.
 * Своё имя, которого нет, НЕ подменяется главным микрофоном: стример выбрал
 * не его. Исключение — «Mic/Aux»: это прежнее значение по умолчанию.
 */
export async function withMicInput<T>(
  request: ObsRequest,
  requested: string,
  op: (inputName: string) => Promise<T>,
): Promise<{ inputName: string; result: T }> {
  const name = requested.trim();
  if (name) {
    try {
      return { inputName: name, result: await op(name) };
    } catch (e) {
      if (name !== LEGACY_MIC_DEFAULT || !isNotFound(e)) throw e;
      const { main } = await specialMics(request);
      if (!main || main === name) throw e;
      return { inputName: main, result: await op(main) };
    }
  }
  const { main } = await specialMics(request);
  if (main) return { inputName: main, result: await op(main) };
  try {
    return { inputName: LEGACY_MIC_DEFAULT, result: await op(LEGACY_MIC_DEFAULT) };
  } catch (e) {
    if (isNotFound(e)) throw new Error(NO_MAIN_MIC_ERROR);
    throw e;
  }
}
