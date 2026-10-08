/**
 * Фича: «клип момента» — сохранить последние N минут эфира по клавише
 * (OBS Replay Buffer; стримерский пакет, просьба владельца 26.08.2026).
 *
 * Включение фичи настраивает буфер повторов OBS (replay_setup: длина из
 * настроек, старт буфера) и вешает клавишу; нажатие — SaveReplayBuffer,
 * файл падает в папку записей OBS. Кнопка «Сохранить клип» в попапе идёт
 * тем же путём через фон (обработчик команды здесь не нужен).
 *
 * Замечания:
 *  • буфер повторов должен быть ВКЛЮЧЁН в настройках вывода OBS — иначе
 *    StartReplayBuffer честно отказывает, и мы показываем это тостом
 *    один раз, а не молчим;
 *  • смена длины буфера в настройках применяется на лету перезапуском
 *    буфера (его текущий хвост при этом теряется — так устроен OBS);
 *  • OBS, поднятый позже вкладки, получает replay_setup по obs_connected;
 *  • клавиша работает на любой странице сайта: момент случается и в лобби.
 */
import { keyboard } from "@core/keyboard";
import { log } from "@core/log";
import { sendRuntime } from "@core/messaging";
import { onObsConnected } from "@core/obs-events";
import { showToast } from "@core/toast";
import type { Feature, FeatureContext } from "@core/feature";

const SCOPE = "obs-clip";

/** Настройка хранит минуты; OBS ждёт секунды. Границы — здравый смысл. */
export function clipSeconds(minutes: unknown): number {
  const m = typeof minutes === "number" && Number.isFinite(minutes) ? minutes : 1;
  return Math.max(1, Math.min(20, Math.round(m))) * 60;
}

let off: (() => void) | null = null;
let boundCode = "";
let configuredSeconds = 0;
let setupFailedWarned = false;
let wantedSeconds = 0;
let offConnected: (() => void) | null = null;
/** Поколение включения: ответ replay_setup, пришедший после disable(), состояние не трогает. */
let generation = 0;

async function obsCommand(
  command: "replay_save" | "replay_setup",
  data?: { seconds?: number },
): Promise<{ success?: boolean; data?: Record<string, unknown>; error?: string } | undefined> {
  return sendRuntime({ type: "obs_command", command, data });
}

async function setupBuffer(seconds: number): Promise<void> {
  const gen = generation;
  const res = await obsCommand("replay_setup", { seconds });
  if (gen !== generation) return;
  if (res?.success) {
    configuredSeconds = seconds;
    setupFailedWarned = false;
    log.info(SCOPE, "буфер повторов готов:", seconds, "с", res.data?.restarted ? "(перезапущен)" : "");
    return;
  }
  log.warn(SCOPE, "буфер повторов не настроился:", res?.error ?? "нет ответа фона");
  // Один тост на неудачу, не на каждый повтор update(): OBS может быть
  // просто выключен, и это не повод спамить.
  if (!setupFailedWarned) {
    setupFailedWarned = true;
    showToast("Клипы: буфер повторов не запустился — проверьте OBS (Replay Buffer)");
  }
}

/** Нажатие клавиши/кнопки. Экспорт — тестовый шов. */
export async function saveClip(): Promise<boolean> {
  const res = await obsCommand("replay_save");
  if (res?.success) {
    log.info(SCOPE, "клип сохранён");
    showToast("🎬 Клип сохранён");
    return true;
  }
  log.warn(SCOPE, "клип не сохранился:", res?.error ?? "нет ответа фона");
  showToast(res?.error ? `Клип: ${res.error}` : "Клип не сохранился — OBS не отвечает");
  return false;
}

function bind(code: string): void {
  off?.();
  boundCode = code || "F9";
  off = keyboard.register(
    boundCode,
    () => {
      void saveClip();
    },
    { preventDefault: true },
  );
}

export const obsClipFeature: Feature = {
  id: "obs-clip",
  settingKey: "obs_clip_enabled",

  enable(ctx: FeatureContext) {
    bind(ctx.settings.obs_clip_hotkey_code);
    wantedSeconds = clipSeconds(ctx.settings.obs_clip_minutes);
    offConnected = onObsConnected(() => {
      void setupBuffer(wantedSeconds);
    });
    void setupBuffer(wantedSeconds);
  },

  update(ctx: FeatureContext) {
    if (ctx.settings.obs_clip_hotkey_code !== boundCode) bind(ctx.settings.obs_clip_hotkey_code);
    const seconds = clipSeconds(ctx.settings.obs_clip_minutes);
    wantedSeconds = seconds;
    if (seconds !== configuredSeconds) void setupBuffer(seconds);
  },

  disable() {
    generation += 1;
    off?.();
    off = null;
    offConnected?.();
    offConnected = null;
    wantedSeconds = 0;
    boundCode = "";
    configuredSeconds = 0;
    setupFailedWarned = false;
    // Буфер в OBS не останавливаем: он мог быть нужен стримеру и без нас.
  },
};
