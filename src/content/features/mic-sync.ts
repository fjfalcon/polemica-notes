/**
 * «Микрофон: OBS и игра» (09.10.2026).
 *
 * Один клик (по плашке) или клавиша выключают/включают микрофон и в OBS
 * (источник звука из микшера), и в игре. Мьют, сделанный в самом OBS (его
 * горячая клавиша, микшер), догоняет микрофон игры. Обратного направления
 * НЕТ намеренно: выключить микрофон в игре и продолжать говорить со зрителями
 * — законный сценарий стримера, OBS за игрой не следует.
 *
 * Плашка честно показывает оба состояния и расхождение. Громкость не трогаем.
 * Работает только при включённой интеграции OBS (урок 07.10.2026: тумблер,
 * спрятанный вместе с блоком OBS, не должен жить невидимкой).
 */
import { log } from "@core/log";
import { keyboard } from "@core/keyboard";
import { onMessage, sendRuntime } from "@core/messaging";
import { onDomChange, registerOwnContainer, unregisterOwnContainer } from "@core/dom";
import { GAME_MIC_ICON, OWN, SITE } from "@core/selectors";
import { showToast } from "@core/toast";
import { isGameRoomPath } from "@shared/routes";
import type { Feature, FeatureContext } from "@core/feature";

const SCOPE = "mic-sync";
const POS_KEY = "pn-mic-pill-pos";
/** Сколько ждём, пока сайт отразит клик по своей кнопке микрофона. */
const GAME_VERIFY_MS = 3000;

export interface GameMic {
  button: HTMLElement;
  muted: boolean;
}

/**
 * Кнопка микрофона игры. null — не найдена ИЛИ неоднозначна: кнопок такого
 * вида больше одной или иконка спорит с классом «выключено». Нажимать в
 * сомнении нельзя — нажмём не то.
 */
export function readGameMic(root: ParentNode = document): GameMic | null {
  const found: GameMic[] = [];
  for (const btn of Array.from(root.querySelectorAll<HTMLElement>(SITE.webcamButton))) {
    const src = btn.querySelector(SITE.buttonIconImg)?.getAttribute("src") ?? "";
    const file = src.split(/[?#]/)[0].split("/").pop() ?? "";
    if (file !== GAME_MIC_ICON.on && file !== GAME_MIC_ICON.off) continue;
    const offClass = btn.classList.contains(SITE.webcamButtonOffClass);
    if (offClass !== (file === GAME_MIC_ICON.off)) continue; // иконка и класс спорят
    found.push({ button: btn, muted: offClass });
  }
  return found.length === 1 ? found[0] : null;
}

/** Что известно про OBS. */
export interface ObsMicState {
  /** null — неизвестно (не спрашивали или OBS не ответил). */
  muted: boolean | null;
  problem: "down" | "missing" | null;
}

export interface PillView {
  text: string;
  /** ok — всё согласовано; warn — расхождение или проблема. */
  tone: "ok" | "muted" | "warn";
}

/** Текст плашки по двум состояниям. Чистая функция. */
export function pillView(obs: ObsMicState, game: { muted: boolean } | null, input: string): PillView {
  if (obs.problem === "down") return { text: "🎙 OBS не подключён", tone: "warn" };
  if (obs.problem === "missing") return { text: `🎙 Нет источника «${input}» в OBS`, tone: "warn" };
  if (obs.muted === null) return { text: "🎙 OBS: …", tone: "warn" };
  const g = game === null ? "?" : game.muted ? "выкл" : "вкл";
  if (game && game.muted === obs.muted) {
    return obs.muted
      ? { text: "🔇 Микрофон выключен — OBS + игра", tone: "muted" }
      : { text: "🎙 Микрофон включён — OBS + игра", tone: "ok" };
  }
  return {
    text: `${obs.muted ? "🔇" : "🎙"} OBS: ${obs.muted ? "выкл" : "вкл"}; игра: ${g}`,
    tone: "warn",
  };
}

// ─────────────────────────── состояние ───────────────────────────

let active = false;
let inputName = "Mic/Aux";
let hotkeyCode = "";
let obs: ObsMicState = { muted: null, problem: null };
let pill: HTMLElement | null = null;
let offDom: (() => void) | null = null;
let offMsg: (() => void) | null = null;
let offKey: (() => void) | null = null;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

function classifyError(e: unknown): ObsMicState["problem"] {
  const msg = String((e as Error)?.message ?? e);
  return /не подключ|not connected/i.test(msg) ? "down" : "missing";
}

async function obsCommand(command: "get_input_mute" | "set_input_mute", muted?: boolean): Promise<boolean> {
  const res = await sendRuntime<{ success?: boolean; data?: { muted?: boolean }; error?: string }>({
    type: "obs_command",
    command,
    data: { inputName, muted },
  });
  if (!res?.success) throw new Error(res?.error || "OBS не ответил");
  return res.data?.muted === true;
}

async function refreshObs(): Promise<void> {
  try {
    obs = { muted: await obsCommand("get_input_mute"), problem: null };
  } catch (e) {
    obs = { muted: null, problem: classifyError(e) };
  }
  render();
}

/**
 * Выравнивание микрофона игры — ОДНО на вкладку (adversarial 09.10.2026):
 * эхо InputMuteStateChanged от нашего же SetInputMute приходит РАНЬШЕ ответа
 * на запрос, и два выравнивателя (переключатель и обработчик события) видели
 * старый DOM — кнопка сайта меняет класс только после ответа своего сервера.
 * Второй клик возвращал микрофон игры обратно. Теперь вызов с той же целью
 * ждёт идущий; с другой — дожидается его и только потом идёт сам.
 */
let alignInFlight: { muted: boolean; promise: Promise<boolean> } | null = null;

async function alignGameMic(muted: boolean): Promise<boolean> {
  while (alignInFlight) {
    const running = alignInFlight;
    if (running.muted === muted) return running.promise;
    await running.promise.catch(() => false);
  }
  const promise = alignGameMicOnce(muted);
  alignInFlight = { muted, promise };
  try {
    return await promise;
  } finally {
    if (alignInFlight?.promise === promise) alignInFlight = null;
  }
}

async function alignGameMicOnce(muted: boolean): Promise<boolean> {
  const mic = readGameMic();
  if (!mic) return false;
  if (mic.muted === muted) return true;
  if (mic.button.getAttribute("aria-disabled") === "true") return false;
  mic.button.click();
  const deadline = Date.now() + GAME_VERIFY_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    if (!active) return false;
    if (readGameMic()?.muted === muted) return true;
  }
  return false;
}

/** Клик по плашке или клавиша: переключить оба микрофона разом. */
export async function toggleMic(): Promise<void> {
  if (!active || busy) return;
  busy = true;
  try {
    const game = readGameMic();
    const current = obs.muted ?? game?.muted ?? false;
    const target = !current;
    let obsOk = true;
    try {
      await obsCommand("set_input_mute", target);
      obs = { muted: target, problem: null };
    } catch (e) {
      obsOk = false;
      obs = { muted: null, problem: classifyError(e) };
    }
    const gameOk = await alignGameMic(target);
    render();
    if (!obsOk) {
      // Самое опасное направление — «хотел выключить, а эфир слышит».
      showToast(
        target
          ? "Микрофон в OBS НЕ выключен — проверьте подключение и имя источника"
          : "Микрофон в OBS не включён — проверьте подключение и имя источника",
        { key: "mic-sync-obs", kind: "warn" },
      );
    } else if (!gameOk) {
      showToast("OBS переключён, а кнопка микрофона игры не нашлась или не ответила", {
        key: "mic-sync-game",
        kind: "warn",
      });
    }
    log.info(SCOPE, `микрофон → ${target ? "выкл" : "вкл"}; OBS: ${obsOk}, игра: ${gameOk}`);
  } finally {
    busy = false;
  }
}

// ─────────────────────────── плашка ───────────────────────────

function ensurePill(): HTMLElement {
  if (pill && pill.isConnected) return pill;
  const el = document.createElement("div");
  el.className = OWN.micPill;
  el.setAttribute("role", "button");
  el.title = "Клик — переключить микрофон в OBS и в игре; перетащите, чтобы передвинуть";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "2147483000",
    padding: "6px 10px",
    borderRadius: "999px",
    font: "12px/1.3 system-ui, sans-serif",
    color: "#fff",
    cursor: "pointer",
    userSelect: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,.4)",
  } as CSSStyleDeclaration);
  placePill(el);
  attachDrag(el);
  registerOwnContainer(el);
  document.body.appendChild(el);
  pill = el;
  return el;
}

function placePill(el: HTMLElement): void {
  let pos: { left: number; top: number } | null = null;
  try {
    pos = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
  } catch {
    pos = null;
  }
  const left = Number.isFinite(pos?.left) ? (pos as { left: number }).left : 16;
  const top = Number.isFinite(pos?.top) ? (pos as { top: number }).top : 80;
  el.style.left = `${Math.max(0, Math.min(left, window.innerWidth - 60))}px`;
  el.style.top = `${Math.max(0, Math.min(top, window.innerHeight - 30))}px`;
}

function attachDrag(el: HTMLElement): void {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    moved = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* старый движок без захвата указателя */
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return; // дрожь руки — это клик
    moved = true;
    el.style.left = `${start.left + dx}px`;
    el.style.top = `${start.top + dy}px`;
  });
  el.addEventListener("pointerup", () => {
    if (!start) return;
    start = null;
    if (moved) {
      try {
        localStorage.setItem(
          POS_KEY,
          JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }),
        );
      } catch {
        /* приватный режим — позиция не запомнится */
      }
      return;
    }
    void toggleMic();
  });
}

const TONE_BG: Record<PillView["tone"], string> = {
  ok: "rgba(22,101,52,.92)",
  muted: "rgba(55,65,81,.92)",
  warn: "rgba(161,98,7,.95)",
};

/** Перерисовать плашку. Пишет в DOM, только если что-то изменилось (§4.1). */
function render(): void {
  if (!active) return;
  if (!isGameRoomPath(location.pathname)) {
    if (pill) {
      unregisterOwnContainer(pill);
      pill.remove();
      pill = null;
    }
    return;
  }
  const el = ensurePill();
  const view = pillView(obs, readGameMic(), inputName);
  if (el.textContent !== view.text) el.textContent = view.text;
  const bg = TONE_BG[view.tone];
  if (el.style.background !== bg) el.style.background = bg;
}

function readConfig(ctx: FeatureContext): void {
  const s = ctx.settings;
  inputName = (s.mic_sync_input || "").trim() || "Mic/Aux";
  hotkeyCode = s.mic_sync_hotkey || "";
}

function bindHotkey(): void {
  offKey?.();
  offKey = null;
  if (!hotkeyCode) return;
  offKey = keyboard.register(hotkeyCode, () => void toggleMic(), { preventDefault: true });
}

/** Микрофон работает только при включённой интеграции OBS. */
export function micSyncActive(s: { mic_sync_enabled?: unknown; obs_enabled?: unknown }): boolean {
  return s.mic_sync_enabled === true && s.obs_enabled === true;
}

function start(ctx: FeatureContext): void {
  active = true;
  readConfig(ctx);
  bindHotkey();
  offMsg = onMessage((msg) => {
    const m = msg as { type?: string; eventType?: string; data?: { inputName?: string; inputMuted?: boolean } };
    if (m?.type !== "obs_event") return undefined;
    if (m.eventType === "obs_input_mute_changed" && m.data?.inputName === inputName) {
      const muted = m.data.inputMuted === true;
      obs = { muted, problem: null };
      render();
      // OBS → игра: мьют в OBS догоняет микрофон игры.
      if (isGameRoomPath(location.pathname)) void alignGameMic(muted).then(() => render());
    } else if (m.eventType === "obs_connected" || m.eventType === "obs_scenes_updated") {
      void refreshObs();
    } else if (m.eventType === "obs_disconnected") {
      obs = { muted: null, problem: "down" };
      render();
    }
    return undefined;
  });
  offDom = onDomChange(() => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
    }, 500);
  });
  void refreshObs();
}

function stop(): void {
  active = false;
  alignInFlight = null;
  offDom?.();
  offDom = null;
  offMsg?.();
  offMsg = null;
  offKey?.();
  offKey = null;
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  if (pill) {
    unregisterOwnContainer(pill);
    pill.remove();
    pill = null;
  }
  obs = { muted: null, problem: null };
}

export const micSyncFeature: Feature = {
  id: "mic-sync",
  // Гейт по двум настройкам — см. micSyncActive; ключ-выключатель свой.
  settingKey: "mic_sync_enabled",
  enable(ctx) {
    if (!micSyncActive(ctx.settings)) return;
    start(ctx);
    log.info(SCOPE, "enabled, источник:", inputName);
  },
  update(ctx) {
    const want = micSyncActive(ctx.settings);
    if (!want && active) {
      stop();
      return;
    }
    if (want && !active) {
      start(ctx);
      return;
    }
    if (!active) return;
    const prevInput = inputName;
    const prevKey = hotkeyCode;
    readConfig(ctx);
    if (hotkeyCode !== prevKey) bindHotkey();
    if (inputName !== prevInput) void refreshObs();
  },
  disable() {
    stop();
  },
};
