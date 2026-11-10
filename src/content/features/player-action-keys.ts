/**
 * Фича: действия по цифрам — выставление, голос, выстрел, проверка с клавиши
 * места (просьба владельца 04.11.2026).
 *
 * У сайта цифры уже привязаны (hotkeys-js, room/bundle, сверено 04.11.2026):
 * `1…9, 0` и нумпад → `player.doAction()`. Но клавиша зовёт doAction БЕЗ
 * действия, а клик мышью передаёт его (`doAction("nominate")`). onPlayerAction
 * сначала снимает кнопки действий у всех игроков, потом смотрит на действие —
 * его нет, и на сервер ничего не уходит: цифра гасит кнопки и не действует.
 *
 * Поэтому:
 *  1. клавиша места жмёт КНОПКУ действия на плитке — тот же путь, что клик
 *     мышью; ничего сверх того, что игрок мог нажать сам;
 *  2. какое действие — по точной подписи кнопки (TEXT.playerAction): в
 *     isolated world стора сайта не видно. «Лучший ход» не трогаем (решение
 *     владельца 04.11: там выбор корона/пистолет/сердце) —
 *     ЛХ отдельно, см. п.5;
 *  3. пока на столе есть кнопки действий, клавиши игроков и цифры сайта ему
 *     не отдаются: его обработчик снял бы кнопки — в том числе у действия,
 *     которое игрок клавишей нажимать не разрешил (выстрел выключен — цифра
 *     не должна оставить мафию без кнопок). Без кнопок на столе клавиши
 *     сайту и браузеру как есть;
 *  4. ВЫКЛЮЧЕНО по умолчанию, выстрел и проверка — отдельные галочки;
 *  5. ЛХ по клавишам (10.11.2026, «ЛХ по клавишам» в попапе): во время
 *     лучшего хода — наша панель режима (пистолет / сердце / корона), клавиши
 *     режимов (Q/W/A по умолчанию) и цифры мест: клавиша места жмёт на плитке
 *     кнопку ЛХ текущего режима — «Оставить мафией», «Оставить мирным» или
 *     «Оставить за главного». Корона и роли — разные режимы САЙТА
 *     (guessRoles/guessVice): переключаем его же кнопкой в контролах.
 *     «Оставить ЛХ» игрок жмёт сам — отправку не автоматизируем.
 *
 * Печать в чате, сочетания с Ctrl/Alt/Cmd и автоповтор гасит роутер клавиш.
 */
import { keyboard, formatKeyCode, type HotkeyHandler } from "@core/keyboard";
import { isVisible, onDomChange, safeClick } from "@core/dom";
import { log } from "@core/log";
import { SITE, SITE_CLASS, TEXT } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import { NUMPAD_PLAYER_KEYS, parsePlayerActionKeys } from "@shared/player-action-keys";
import { playerIdFromNumberEl } from "./nick-plate";
import type { Feature, FeatureContext } from "@core/feature";
import type { Settings } from "@shared/types";

const SCOPE = "player-action-keys";

export type PlayerActionKind = keyof typeof TEXT.playerAction;

const KIND_SETTING: Record<PlayerActionKind, keyof Settings> = {
  nominate: "player_action_nominate",
  vote: "player_action_vote",
  shot: "player_action_shot",
  check: "player_action_check",
};

const KIND_LOG: Record<PlayerActionKind, string> = {
  nominate: "выставление",
  vote: "голос",
  shot: "выстрел",
  check: "проверка",
};

/** Цифры, которые сайт вешает на действия игроков, — с нумпадом. */
const SITE_DIGIT_KEYS: readonly string[] = [
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...NUMPAD_PLAYER_KEYS,
];

const norm = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Какие действия клавиша нажимает. Строго === true, как у FeatureManager. */
export function enabledKinds(s: Partial<Settings>): Set<PlayerActionKind> {
  return new Set(
    (Object.keys(KIND_SETTING) as PlayerActionKind[]).filter((k) => s[KIND_SETTING[k]] === true),
  );
}

/** Действие кнопки по её точной подписи; null — не наше (лучший ход, отстрел). */
export function actionKind(button: Element): PlayerActionKind | null {
  const text = norm(button.textContent);
  for (const kind of Object.keys(TEXT.playerAction) as PlayerActionKind[]) {
    if (TEXT.playerAction[kind].includes(text)) return kind;
  }
  return null;
}

/** Место игрока (1…10) по классу `player-N` номера на плитке. */
export function tileSeat(tile: Element): number | null {
  const numberEl = tile.querySelector(SITE.playerNumber);
  const id = numberEl ? playerIdFromNumberEl(numberEl) : null;
  return id === null ? null : Number(id) + 1;
}

/** Кнопки действий на столе с местом и видом действия. Тестовый шов, его же читают подсказки. */
export function listActionButtons(
  root: ParentNode = document,
): Array<{ button: HTMLElement; seat: number; kind: PlayerActionKind }> {
  const out: Array<{ button: HTMLElement; seat: number; kind: PlayerActionKind }> = [];
  for (const tile of Array.from(root.querySelectorAll<HTMLElement>(SITE.playerDesktop))) {
    const seat = tileSeat(tile);
    if (seat === null) continue;
    for (const button of Array.from(tile.querySelectorAll<HTMLElement>(SITE.playerActionButton))) {
      const kind = actionKind(button);
      if (kind) out.push({ button, seat, kind });
    }
  }
  return out;
}

// ───────────────────────────── Лучший ход ─────────────────────────────

export type GuessKind = keyof typeof TEXT.guessAction;
const GUESS_KINDS: readonly GuessKind[] = ["maf", "civ", "vice"];
const GUESS_LABEL: Record<GuessKind, { icon: string; text: string }> = {
  maf: { icon: "🔫", text: "Мафия" },
  civ: { icon: "❤️", text: "Мирный" },
  vice: { icon: "👑", text: "Главный" },
};
const GUESS_KEY_SETTING: Record<GuessKind, keyof Settings> = {
  maf: "guess_key_maf",
  civ: "guess_key_civ",
  vice: "guess_key_vice",
};
const GUESS_KEY_DEFAULT: Record<GuessKind, string> = { maf: "KeyQ", civ: "KeyW", vice: "KeyA" };
const KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,24}$/;

/** Вид кнопки ЛХ по точной подписи; null — не ЛХ. */
export function guessKind(button: Element): GuessKind | null {
  const text = norm(button.textContent);
  return GUESS_KINDS.find((k) => TEXT.guessAction[k].includes(text)) ?? null;
}

/** Кнопки ЛХ на плитках с местом и видом. Тестовый шов, его же читают подсказки. */
export function listGuessButtons(
  root: ParentNode = document,
): Array<{ button: HTMLElement; seat: number; kind: GuessKind }> {
  const out: Array<{ button: HTMLElement; seat: number; kind: GuessKind }> = [];
  for (const tile of Array.from(root.querySelectorAll<HTMLElement>(SITE.playerDesktop))) {
    const seat = tileSeat(tile);
    if (seat === null) continue;
    for (const button of Array.from(tile.querySelectorAll<HTMLElement>(SITE.playerActionButton))) {
      const kind = guessKind(button);
      if (kind) out.push({ button, seat, kind });
    }
  }
  return out;
}

/** Режим сайта по кнопкам плиток: корона — "vice", пистолет/сердце — "roles". */
function siteGuessMode(buttons: Array<{ kind: GuessKind }>): "roles" | "vice" | null {
  if (buttons.some((b) => b.kind === "vice")) return "vice";
  if (buttons.length > 0) return "roles";
  return null;
}

/** Переключатель режима ЛХ сайта в центре контролов (не плитка: подпись короны та же). */
function findModeToggle(mode: "roles" | "vice", root: ParentNode = document): HTMLElement | null {
  const center = root.querySelector<HTMLElement>(SITE.controlsCenter);
  if (!center) return null;
  const candidates = Array.from(center.querySelectorAll<HTMLElement>(SITE.controlsButton));
  // §4 п.2: точная подпись, видимая, не заблокированная, самая глубокая.
  return (
    candidates.find(
      (b) =>
        TEXT.guessModeButton[mode].includes(norm(b.textContent)) &&
        isVisible(b) &&
        !b.classList.contains(SITE_CLASS.disabled) &&
        !b.hasAttribute("disabled") &&
        !candidates.some((other) => other !== b && b.contains(other)),
    ) ?? null
  );
}

/**
 * Идёт ли сейчас свой ЛХ: кнопки ЛХ на плитках ИЛИ переключатель режима в
 * контролах. Второе нужно (ревью, major): игрок снял режим повторным кликом
 * по активному переключателю — на плитках пусто (сайт не показывает корону без
 * режима), а переключатели на месте; без них клавиши режимов молчали бы.
 */
function bestMoveVisible(buttons: unknown[]): boolean {
  return buttons.length > 0 || findModeToggle("roles") !== null || findModeToggle("vice") !== null;
}

let guessOn = false;
let guessMode: GuessKind = "maf";

/** Включён ли ЛХ по клавишам и идёт ли сейчас твой лучший ход. */
export function bestMoveKeysActive(): boolean {
  return guessOn && isGameRoomPath(location.pathname) && bestMoveVisible(listGuessButtons());
}

/** Текущий режим ЛХ (для подсказок на кнопках). */
export function currentGuessMode(): GuessKind {
  return guessMode;
}

/** Доступен ли режим: кнопки его вида на плитках или переключатель сайта на него. */
function modeAvailable(kind: GuessKind, buttons: Array<{ kind: GuessKind }>): boolean {
  if (buttons.some((b) => b.kind === kind)) return true;
  return findModeToggle(kind === "vice" ? "vice" : "roles") !== null;
}

/**
 * Выбрать режим ЛХ. Корона и роли — разные режимы сайта: если плитки сейчас
 * в другом, жмём его же переключатель в контролах (только неактивный — сайт
 * по повторному клику снимает режим). Тестовый шов.
 */
export function setGuessMode(kind: GuessKind): void {
  // Первый проход панели в этом ЛХ сбрасывает режим на исходный — пусть он
  // случится ДО выбора игрока, а не после.
  if (!bmShown) renderPanel();
  const buttons = listGuessButtons();
  // Недоступный режим (ЛХ уже начат в другом — сайт прячет переключатели)
  // не выбираем: панель обещала бы клавиши, которые ничего не сделают.
  if (buttons.length > 0 && !modeAvailable(kind, buttons)) return;
  guessMode = kind;
  const target = kind === "vice" ? "vice" : "roles";
  const current = siteGuessMode(buttons);
  if (current !== target) {
    const toggle = findModeToggle(target);
    if (toggle && !toggle.classList.contains(SITE_CLASS.activated)) safeClick(toggle);
  }
  log.debug(SCOPE, `режим ЛХ: ${KIND_LOG_GUESS[kind]}`);
  renderPanel();
}

const KIND_LOG_GUESS: Record<GuessKind, string> = { maf: "мафия", civ: "мирный", vice: "главный" };

/** Клавиша места во время ЛХ: кнопка текущего режима на плитке. */
function pressGuessSeat(seat: number): boolean {
  const hit = listGuessButtons().find((b) => b.seat === seat && b.kind === guessMode);
  if (!hit) {
    log.debug(SCOPE, `ЛХ: у игрока ${seat} нет кнопки «${KIND_LOG_GUESS[guessMode]}»`);
    return false;
  }
  safeClick(hit.button);
  log.info(SCOPE, `ЛХ ${KIND_LOG_GUESS[guessMode]} — игрок ${seat} по клавише`);
  return true;
}

// ── Панель режима: показывается только во время своего ЛХ ──

const PANEL_ID = "pn-best-move-panel";
let panelSig = "";
/** Режим сайта на прошлом проходе: синхронизируемся только на его СМЕНЕ. */
let lastSiteMode: "roles" | "vice" | null = null;
/** Панель этого ЛХ уже показана (новый ЛХ сбрасывает режим на исходный). */
let bmShown = false;
/** Панель создана ЭТОЙ копией скрипта (после обновления расширения — чужая). */
let panelOwned = false;
let modeCodes: Record<GuessKind, string> = { ...GUESS_KEY_DEFAULT };

/**
 * Нарисовать/убрать панель. Идемпотентно (§4 п.1): узел пишется только при
 * смене подписи состояния; зовётся из onDomChange.
 */
function renderPanel(): void {
  // Кнопок действий на столе нет — плитки не обходим (проход на каждый тик).
  const buttons =
    guessOn && isGameRoomPath(location.pathname) && document.querySelector(SITE.playerActionButton)
      ? listGuessButtons()
      : [];
  let existing = document.getElementById(PANEL_ID);
  if (!guessOn || !isGameRoomPath(location.pathname) || !bestMoveVisible(buttons)) {
    panelSig = "";
    lastSiteMode = null;
    bmShown = false;
    existing?.remove();
    panelOwned = false;
    return;
  }
  // Панель прежней копии скрипта (обновили расширение посреди ЛХ): её клики
  // ушли бы в осиротевшее состояние — пересоздаём своей.
  if (existing && !panelOwned) {
    existing.remove();
    existing = null;
  }
  // Режим, сменённый кнопкой сайта мышью, — тоже наш: панель не врёт. Только
  // на СМЕНЕ режима сайта: наш же клик по переключателю доходит до плиток не
  // сразу, и сверка «в лоб» откатывала бы только что выбранную корону.
  const site = siteGuessMode(buttons);
  if (!bmShown) {
    bmShown = true; // новый ЛХ
    guessMode = site === "vice" ? "vice" : "maf";
    lastSiteMode = site;
  } else if (site !== lastSiteMode) {
    if (site === "vice") guessMode = "vice";
    else if (site === "roles" && guessMode === "vice") guessMode = "maf";
    lastSiteMode = site;
  }
  const avail = GUESS_KINDS.map((k) => (modeAvailable(k, buttons) ? "1" : "0")).join("");
  // Клавиши — фактически привязанные (место главнее, чужую не отнимаем):
  // обещать Q, которая отметит игрока 1, нельзя (ревью).
  const keys = GUESS_KINDS.map((k) => guessModeKey(k));
  const sig = `${guessMode}|${avail}|${keys.join(",")}`;
  if (existing && sig === panelSig) return;
  panelSig = sig;
  const panel = existing ?? document.createElement("div");
  if (!existing) {
    panelOwned = true;
    panel.id = PANEL_ID;
    panel.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:12px;" +
      "background:rgba(11,27,57,.92);border:1px solid rgba(255,255,255,.2);color:#e6e9f0;" +
      "font:12px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)";
    panel.addEventListener("click", (e) => {
      const kind = (e.target as Element | null)?.closest<HTMLElement>("[data-pn-guess]")?.dataset.pnGuess;
      if (kind === "maf" || kind === "civ" || kind === "vice") setGuessMode(kind);
    });
  }
  panel.replaceChildren();
  const title = document.createElement("span");
  title.textContent = "ЛХ:";
  title.style.cssText = "font-weight:600;margin-right:2px";
  panel.appendChild(title);
  GUESS_KINDS.forEach((k, i) => {
    const chip = document.createElement("span");
    chip.dataset.pnGuess = k;
    const on = k === guessMode;
    const usable = avail[i] === "1";
    chip.style.cssText =
      "padding:3px 8px;border-radius:8px;cursor:pointer;white-space:nowrap;" +
      `border:1px solid ${on ? "#5b8cff" : "rgba(255,255,255,.15)"};` +
      `background:${on ? "rgba(91,140,255,.35)" : "transparent"};opacity:${usable ? "1" : ".4"}`;
    const key = keys[i] ? ` (${formatKeyCode(keys[i])})` : "";
    chip.textContent = `${GUESS_LABEL[k].icon} ${GUESS_LABEL[k].text}${key}`;
    panel.appendChild(chip);
  });
  const hint = document.createElement("span");
  hint.textContent = "цифры — игроки, «Оставить ЛХ» — сам";
  hint.style.cssText = "opacity:.6;margin-left:4px;white-space:nowrap";
  panel.appendChild(hint);
  if (!existing) document.body.appendChild(panel);
}

/** Есть ли на столе кнопки действий — то есть привязаны ли сейчас цифры сайта. */
function actionsShown(): boolean {
  return isGameRoomPath(location.pathname) && document.querySelector(SITE.playerActionButton) !== null;
}

let kinds = new Set<PlayerActionKind>();

/** Нажатие клавиши места. Экспорт — тестовый шов. */
export function pressSeat(seat: number): boolean {
  if (bestMoveKeysActive()) return pressGuessSeat(seat);
  const hit = listActionButtons().find((b) => b.seat === seat && kinds.has(b.kind));
  if (!hit) {
    log.debug(SCOPE, `игрок ${seat}: подходящей кнопки действия нет`);
    return false;
  }
  safeClick(hit.button);
  log.info(SCOPE, `${KIND_LOG[hit.kind]} — игрок ${seat} по клавише`);
  return true;
}

/** Наши привязки: код → место (0 — цифра сайта, которую только гасим) и обработчик. */
let mine = new Map<string, { seat: number; handler: HotkeyHandler; off: (() => void) | null }>();
let boundSig = "";
/** О занятой клавише предупреждаем один раз, а не на каждую смену настроек. */
let warned = new Set<string>();

/** Клавиши режимов ЛХ: код → режим и обработчик. */
let modeBound = new Map<string, { kind: GuessKind; handler: HotkeyHandler; off: (() => void) | null }>();

function unbind(): void {
  mine.forEach((b) => b.off?.());
  mine = new Map();
  modeBound.forEach((b) => b.off?.());
  modeBound = new Map();
  boundSig = "";
  warned = new Set();
}

function seatHandler(code: string, seat: number): HotkeyHandler {
  return (e) => {
    // Нумпад без NumLock — навигация (Num2 = ↓, Num3 = PageDown): code тот
    // же, а цифры нет. Сайт такую клавишу цифрой не считает — и мы тоже
    // (ревью 04.11.2026, M2).
    if (code.startsWith("Numpad") && !/^\d$/.test(e.key)) return;
    if (!actionsShown()) return;
    e.preventDefault();
    e.stopPropagation();
    if (seat) pressSeat(seat);
  };
}

function modeHandler(kind: GuessKind): HotkeyHandler {
  return (e) => {
    // Вне своего ЛХ клавиша (Q/W/A) — обычная буква для сайта и браузера.
    if (!bestMoveKeysActive()) return;
    e.preventDefault();
    e.stopPropagation();
    setGuessMode(kind);
  };
}

/** Клавиши режимов из настроек: мусор и дубли — без клавиши. Экспорт — тестовый шов. */
export function readModeCodes(s: Partial<Settings>): Record<GuessKind, string> {
  const out = {} as Record<GuessKind, string>;
  const seen = new Set<string>();
  for (const k of GUESS_KINDS) {
    const raw = s[GUESS_KEY_SETTING[k]];
    const code = typeof raw === "string" && KEY_CODE_RE.test(raw) ? raw : GUESS_KEY_DEFAULT[k];
    out[k] = seen.has(code) ? "" : code;
    seen.add(code);
  }
  return out;
}

function bind(s: Partial<Settings>): void {
  kinds = enabledKinds(s);
  guessOn = s.player_action_guess !== false;
  modeCodes = guessOn ? readModeCodes(s) : { maf: "", civ: "", vice: "" };
  const keys = parsePlayerActionKeys(s.player_action_keys);
  const numpad = s.player_action_numpad !== false;
  const sig = `${keys.join(",")}|${numpad}|${GUESS_KINDS.map((k) => modeCodes[k]).join(",")}`;
  if (sig !== boundSig) {
    unbind();
    boundSig = sig;
    const seats = new Map<string, number>();
    keys.forEach((code, i) => code && seats.set(code, i + 1));
    if (numpad) NUMPAD_PLAYER_KEYS.forEach((code, i) => seats.has(code) || seats.set(code, i + 1));
    // Цифры сайта, не ставшие клавишами мест, только гасим (п. 3 шапки).
    for (const code of SITE_DIGIT_KEYS) if (!seats.has(code)) seats.set(code, 0);
    for (const [code, seat] of seats) mine.set(code, { seat, handler: seatHandler(code, seat), off: null });
    // Клавиша режима на клавише места не ставится: место главнее (попап такое
    // не назначит, но импорт и старые настройки — могут).
    for (const k of GUESS_KINDS) {
      const code = modeCodes[k];
      if (code && !seats.has(code)) modeBound.set(code, { kind: k, handler: modeHandler(k), off: null });
    }
  }
  // И при неизменных клавишах: другая фича могла занять наш код, а потом
  // отпустить — её off() удаляет код целиком, и без возврата цифра сайта
  // снова снимала бы кнопки (ревью, m4). update() зовётся на любую смену
  // настроек, в том числе на выключение той фичи.
  for (const [code, b] of mine) {
    if (keyboard.isBoundTo(code, b.handler)) continue;
    if (keyboard.isBound(code)) {
      // Чужая клавиша (пауза, роли, клип, микрофон) — не наша: попап такое
      // не назначит, а импорт и порядок включения фич не должны её отнимать.
      if (b.seat && !warned.has(code)) {
        warned.add(code);
        log.warn(SCOPE, `клавиша ${code} занята другой функцией — игрок ${b.seat} без неё`);
      }
      b.off = null;
      continue;
    }
    b.off = keyboard.register(code, b.handler, { swallowRepeat: actionsShown });
  }
  for (const [code, b] of modeBound) {
    if (keyboard.isBoundTo(code, b.handler)) continue;
    if (keyboard.isBound(code)) {
      if (!warned.has(code)) {
        warned.add(code);
        log.warn(SCOPE, `клавиша ${code} занята другой функцией — режим ЛХ «${KIND_LOG_GUESS[b.kind]}» без неё`);
      }
      b.off = null;
      continue;
    }
    b.off = keyboard.register(code, b.handler, { swallowRepeat: bestMoveKeysActive });
  }
  renderPanel();
}

/** Клавиша режима ЛХ, которая сейчас сработает; "" — нет. */
export function guessModeKey(kind: GuessKind): string {
  for (const [code, b] of modeBound) if (b.kind === kind && keyboard.isBoundTo(code, b.handler)) return code;
  return "";
}

/**
 * Клавиша, которая СЕЙЧАС нажмёт действие у места: своя клавиша места, иначе
 * нумпад; занятая другой фичей не считается. "" — нечем. Её показывает
 * подсказка: обещать клавишу, которая делает другое, нельзя (ревью, m3).
 */
export function seatKey(seat: number): string {
  let fallback = "";
  for (const [code, b] of mine) {
    if (b.seat !== seat || !keyboard.isBoundTo(code, b.handler)) continue;
    if (!code.startsWith("Numpad")) return code;
    fallback ||= code;
  }
  return fallback;
}

let offDom: (() => void) | null = null;

export const playerActionKeysFeature: Feature = {
  id: "player-action-keys",
  settingKey: "player_action_keys_enabled",

  enable(ctx: FeatureContext) {
    bind(ctx.settings);
    // Панель ЛХ живёт, пока на плитках кнопки ЛХ. Дешёвый гейт первым:
    // кнопок действий на столе почти всегда нет.
    offDom = onDomChange(() => {
      if (!guessOn && !document.getElementById(PANEL_ID)) return;
      // Дешёвый гейт: ни кнопок на плитках, ни контролов — ЛХ точно нет.
      if (
        !document.getElementById(PANEL_ID) &&
        !document.querySelector(SITE.playerActionButton) &&
        !document.querySelector(SITE.controlsCenter)
      ) {
        return;
      }
      renderPanel();
    });
  },

  update(ctx: FeatureContext) {
    // Галочки и клавиши применяются на лету, без перезахода в игру.
    bind(ctx.settings);
  },

  disable() {
    offDom?.();
    offDom = null;
    unbind();
    kinds = new Set();
    guessOn = false;
    renderPanel();
  },
};
