/**
 * «Брать только выбранный микрофон» — сторона content-скрипта.
 *
 * Сам перехват живёт в мире страницы (page/mic-pin-page) и ставится ранним
 * инжектором на document_start. Здесь две вещи:
 *
 *  1. ЗЕРКАЛО настройки в localStorage страницы. Инжектор обязан решить
 *     «ставить или нет» синхронно, а storage расширения асинхронный. В
 *     зеркале уже учтён главный выключатель: выключенное расширение API
 *     браузера на сайте не трогает. Выключено — ключ УДАЛЯЕМ, а не пишем
 *     «0»: у тех, кто опцию не включал, в хранилище сайта от неё нет ничего.
 *     Включение действует со следующей загрузки игры (перехват ставится один
 *     раз), выключение — сразу (page-скрипт перечитывает флаг на запросе).
 *     Настройки не прочитались — зеркало НЕ трогаем: случайный сбой storage
 *     не должен молча выключать опцию на эту и следующую игру. Исключение —
 *     Firefox на macOS: там опция отключена целиком, и ключ убирается всегда.
 *
 *  2. ОТЧЁТ в лог и подсказка. Перехват молчалив по построению, и без отчёта
 *     на жалобу «всё равно переключает» ответить было бы нечем. В лог идут
 *     только счётчики — ни deviceId, ни названий устройств.
 */
import { log } from "@core/log";
import { browser } from "@core/env";
import { getSetting, onSettingsChanged } from "@core/settings";
import { showToast } from "@core/toast";
import { isGameRoomPath } from "@shared/routes";
import {
  MIC_PIN_FLAG_KEY,
  MIC_PIN_STATE_ATTR,
  currentBrowserSigns,
  isFirefoxOnMac,
  parseMicPinState,
  type MicPinCounts,
} from "@shared/mic-pin";

const SCOPE = "mic-pin";
/** К этому времени комната уже запросила устройства (вход в игру — секунды). */
export const REPORT_DELAY_MS = 20_000;
/** Подсказка — раз на вкладку, а не в каждой игре: sessionStorage страницы. */
const HINT_SHOWN_KEY = "pn_mic_pin_hint";

/**
 * Действует ли опция. `blocked` — Firefox на macOS (см. isFirefoxOnMac):
 * зеркало там не пишется (и убирается, если осталось от 10.3.0), обёртка не
 * ставится, отчёта и подсказок нет.
 */
export function micPinActive(state: { master?: unknown; option?: unknown }, blocked = false): boolean {
  return state.master !== false && state.option === true && !blocked;
}

export function writeMicPinMirror(store: Pick<Storage, "setItem" | "removeItem"> | null, on: boolean): void {
  try {
    if (on) store?.setItem(MIC_PIN_FLAG_KEY, "1");
    else store?.removeItem(MIC_PIN_FLAG_KEY);
  } catch {
    /* приватный режим: перехват останется выключенным */
  }
}

export type MicPinVerdict =
  /** Счётчиков нет: обёртка на этой странице не стоит. */
  | "not-installed"
  /** Обёртка стоит, микрофон ещё не запрашивали. */
  | "idle"
  /** Запросы были, но ни один не «по умолчанию»: обёртка встала позже первого запроса комнаты. */
  | "late"
  /** Хотя бы раз браузер выдал именно сохранённый микрофон. */
  | "working"
  /** Подставляли, а игра получила другой микрофон: сохранённого нет в системе или он не открылся. */
  | "unavailable"
  /** Подставляли, но ни один запрос не завершился успехом: отказ в разрешении, занятая камера, открытый запрос браузера. */
  | "unsettled"
  /** Сайт просил «по умолчанию», а подставить нечего: игрок не выбирал устройство в настройках комнаты. */
  | "nothing-to-pin";

/** Вердикты, по которым игроку есть что сделать самому. */
const HINTS: Partial<Record<MicPinVerdict, string>> = {
  "nothing-to-pin":
    "Микрофон в игре не выбран: откройте настройки устройств и выберите его в списке (не «по умолчанию») — иначе сайт берёт системный",
  unavailable:
    "Игра получила не тот микрофон, что выбран в её настройках устройств, — проверьте их",
};

/**
 * Вердикт строится по ИСХОДАМ, а не по попыткам: «подставили» ещё не значит
 * «получили» (ревью 19.11.2026 — отказ в разрешении и занятая камера читались
 * как «работает» и «микрофон недоступен»).
 */
export function micPinVerdict(counts: MicPinCounts | null): MicPinVerdict {
  if (!counts) return "not-installed";
  if (counts.landed > 0) return "working";
  if (counts.missed + counts.fallback > 0) return "unavailable";
  if (counts.noSaved > 0) return "nothing-to-pin";
  if (counts.pinned > 0) return "unsettled";
  // Вход в комнату всегда начинается с запроса без устройства — раз его
  // нет среди посчитанных, обёртка его пропустила.
  if (counts.explicit > 0) return "late";
  return "idle";
}

function safeStore(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

/**
 * Показать подсказку один раз на вкладку (по каждому вердикту отдельно).
 * «Показано» записываем только после того, как тост действительно вышел, и
 * только известными словами: sessionStorage страницы пишет и сайт.
 */
function hintOnce(verdict: MicPinVerdict): void {
  const text = HINTS[verdict];
  if (!text) return;
  const session = safeStore("sessionStorage");
  let shown: string[] = [];
  try {
    shown = (session?.getItem(HINT_SHOWN_KEY) ?? "").split(",").filter((v) => v in HINTS);
  } catch {
    /* sessionStorage недоступен — повторы ограничит дедуп самого тоста */
  }
  if (shown.includes(verdict)) return;
  if (!showToast(text, { kind: "warn", durationMs: 12_000 })) return;
  try {
    session?.setItem(HINT_SHOWN_KEY, [...shown, verdict].join(","));
  } catch {
    /* не записалось — подсказка может повториться в следующей игре */
  }
}

let lastReported = "";

/**
 * Записать счётчики в лог. `hint: false` — для ухода со страницы: тост на
 * умирающей странице никто не увидит, а отметка «показано» лишила бы игрока
 * подсказки в следующей игре.
 */
export function reportMicPin(
  root: Element | null = document.documentElement,
  options: { hint?: boolean } = {},
): MicPinVerdict {
  const raw = root?.getAttribute(MIC_PIN_STATE_ATTR) ?? null;
  const counts = parseMicPinState(raw);
  const verdict = micPinVerdict(counts);
  const signature = `${verdict}|${raw ?? ""}`;
  if (signature === lastReported) return verdict;
  lastReported = signature;
  if (!counts) {
    log.info(SCOPE, "перехвата на этой странице нет: опция включена после её загрузки либо скрипт не встал");
    return verdict;
  }
  const line = [
    "запросы микрофона: подставлено",
    counts.pinned,
    "| получен выбранный",
    counts.landed,
    "| получен другой",
    counts.missed,
    "| отвергнуто и повторено как было",
    counts.fallback,
    "| устройство назвал сайт",
    counts.explicit,
    "| на сайте микрофон не выбран",
    counts.noSaved,
    "| вердикт",
    verdict,
  ];
  if (verdict === "late" || verdict === "unavailable") log.warn(SCOPE, ...line);
  else log.info(SCOPE, ...line);
  if (options.hint !== false) hintOnce(verdict);
  return verdict;
}

const FAILED = Symbol("read-failed");

export function setupMicPin(): void {
  const state: { master?: unknown; option?: unknown } = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Что писать в зеркало; null — пока неизвестно, не трогаем.
   * «Включено» требует ОБЕИХ настроек. «Выключено» — достаточно одной: раз
   * опция или всё расширение точно выключены, вторая настройка ничего не
   * меняет, и ждать её значило бы оставить устаревшую «1».
   */
  const blocked = isFirefoxOnMac(currentBrowserSigns(browser.runtime));
  const decision = (): boolean | null => {
    if (blocked) return false;
    if ("option" in state && state.option !== true) return false;
    if ("master" in state && state.master === false) return false;
    return "master" in state && "option" in state ? true : null;
  };

  /** Один раз на страницу комнаты: опция включена, а здесь не действует. */
  let blockedLogged = false;
  const noteBlocked = (): void => {
    if (!blocked || blockedLogged) return;
    if (state.option !== true || state.master === false || !("master" in state)) return;
    if (!isGameRoomPath(location.pathname)) return;
    blockedLogged = true;
    log.info(SCOPE, "Firefox на macOS: опция включена, но здесь не действует — см. приписку в попапе");
  };

  const sync = (): void => {
    noteBlocked();
    const on = decision();
    if (on === null) return;
    writeMicPinMirror(safeStore("localStorage"), on);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (on && isGameRoomPath(location.pathname)) {
      timer = setTimeout(() => {
        timer = null;
        if (micPinActive(state, blocked)) reportMicPin();
      }, REPORT_DELAY_MS);
    }
  };

  // Подписка — ДО чтения: тумблер, нажатый в окно между чтением и ответом,
  // иначе потерялся бы до перезагрузки страницы (тот же порядок, что у
  // rating-flag-early). Значение из события новее прочитанного — чтение его
  // не перезаписывает.
  onSettingsChanged((patch) => {
    let touched = false;
    if ("extension_enabled" in patch) {
      state.master = patch.extension_enabled;
      touched = true;
    }
    if ("mic_pin_enabled" in patch) {
      state.option = patch.mic_pin_enabled;
      touched = true;
    }
    if (touched) sync();
  });

  void Promise.all([
    getSetting("extension_enabled").catch(() => FAILED),
    getSetting("mic_pin_enabled").catch(() => FAILED),
  ]).then(([master, option]) => {
    if (!("master" in state) && master !== FAILED) state.master = master;
    if (!("option" in state) && option !== FAILED) state.option = option;
    sync();
  });

  // Итог за игру: счётчики на момент ухода со страницы. log сам сбрасывает
  // буфер на pagehide, но его слушатель стоит раньше нашего — без явного
  // сброса эта строка осталась бы в памяти умирающей страницы.
  window.addEventListener("pagehide", () => {
    if (!micPinActive(state, blocked) || !isGameRoomPath(location.pathname)) return;
    reportMicPin(document.documentElement, { hint: false });
    log.flushNow();
  });
}

/** Тестовый шов: сброс модульного состояния. */
export function resetMicPinForTest(): void {
  lastReported = "";
}
