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
 *     владельца: там выбор корона/пистолет/сердце);
 *  3. пока на столе есть кнопки действий, клавиши игроков и цифры сайта ему
 *     не отдаются: его обработчик снял бы кнопки — в том числе у действия,
 *     которое игрок клавишей нажимать не разрешил (выстрел выключен — цифра
 *     не должна оставить мафию без кнопок). Без кнопок на столе клавиши
 *     сайту и браузеру как есть;
 *  4. ВЫКЛЮЧЕНО по умолчанию, выстрел и проверка — отдельные галочки.
 *
 * Печать в чате, сочетания с Ctrl/Alt/Cmd и автоповтор гасит роутер клавиш.
 */
import { keyboard, type HotkeyHandler } from "@core/keyboard";
import { safeClick } from "@core/dom";
import { log } from "@core/log";
import { SITE, TEXT } from "@core/selectors";
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

/** Есть ли на столе кнопки действий — то есть привязаны ли сейчас цифры сайта. */
function actionsShown(): boolean {
  return isGameRoomPath(location.pathname) && document.querySelector(SITE.playerActionButton) !== null;
}

let kinds = new Set<PlayerActionKind>();

/** Нажатие клавиши места. Экспорт — тестовый шов. */
export function pressSeat(seat: number): boolean {
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

function unbind(): void {
  mine.forEach((b) => b.off?.());
  mine = new Map();
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

function bind(s: Partial<Settings>): void {
  kinds = enabledKinds(s);
  const keys = parsePlayerActionKeys(s.player_action_keys);
  const numpad = s.player_action_numpad !== false;
  const sig = `${keys.join(",")}|${numpad}`;
  if (sig !== boundSig) {
    unbind();
    boundSig = sig;
    const seats = new Map<string, number>();
    keys.forEach((code, i) => code && seats.set(code, i + 1));
    if (numpad) NUMPAD_PLAYER_KEYS.forEach((code, i) => seats.has(code) || seats.set(code, i + 1));
    // Цифры сайта, не ставшие клавишами мест, только гасим (п. 3 шапки).
    for (const code of SITE_DIGIT_KEYS) if (!seats.has(code)) seats.set(code, 0);
    for (const [code, seat] of seats) mine.set(code, { seat, handler: seatHandler(code, seat), off: null });
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

export const playerActionKeysFeature: Feature = {
  id: "player-action-keys",
  settingKey: "player_action_keys_enabled",

  enable(ctx: FeatureContext) {
    bind(ctx.settings);
  },

  update(ctx: FeatureContext) {
    // Галочки и клавиши применяются на лету, без перезахода в игру.
    bind(ctx.settings);
  },

  disable() {
    unbind();
    kinds = new Set();
  },
};
