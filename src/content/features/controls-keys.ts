/**
 * Клавиши кнопок центра контролов: «Выкрикнуть» и «Завершите речь».
 *
 * Игроки просили ставить обе на ОДНУ клавишу (10.11.2026), и это безопасно
 * по устройству сайта: обе кнопки рисует UserControls в одном и том же месте
 * центра, и в свою речь там «Завершите речь», а в чужую — «Выкрикнуть»
 * (см. controls-safety: своя речь подменяется выкриком на том же месте).
 *
 * Роутер клавиш держит ОДИН обработчик на код, поэтому фичи не регистрируют
 * клавиши сами, а сообщают координатору «моя клавиша — X» (или null —
 * выключена). Координатор вешает по обработчику на код; общий код жмёт ту
 * кнопку, которая сейчас есть. Видны обе разом (неизвестное состояние
 * сайта) — не жмём ничего: выкрик стоит фола, конец речи необратим. И ещё
 * FINISH_GUARD_MS после конца речи общая клавиша выкрик не жмёт.
 */
import { keyboard, type HotkeyHandler } from "@core/keyboard";
import { log } from "@core/log";
import { onDomChange } from "@core/dom";

export type ControlKind = "outcry" | "finish";

export interface ControlAction {
  /** Кнопка сейчас доступна (видима, не заблокирована, мы в комнате). */
  available(): boolean;
  /** Нажать её. true — нажато. */
  press(): boolean;
  /**
   * preventDefault, даже если нажимать нечего. Выкрик так делал всегда (до
   * координатора); конец речи гасит клавишу, только когда сработал.
   */
  alwaysSwallow: boolean;
}

const SCOPE = "controls-keys";
/**
 * После «Завершите речь» общая клавиша ещё столько молчит для выкрика (ревью
 * 10.11.2026, major): сайт меняет конец речи на выкрик в том же месте, и
 * второе нажатие (сервер не успел ответить на первое) или нажатие на 59-й
 * секунде, дошедшее после смены, выкрикнуло бы — фол.
 */
export const FINISH_GUARD_MS = 2000;

const actions = new Map<ControlKind, ControlAction>();
const codes = new Map<ControlKind, string>();
let bound = new Map<string, { kinds: ControlKind[]; handler: HotkeyHandler; off: (() => void) | null }>();
let boundSig = "";
let warned = new Set<string>();
/**
 * Когда «Завершите речь» последний раз была на месте, нажата или ИСЧЕЗЛА.
 * Монотонные часы: перевод системного времени назад не запирает выкрик.
 */
let finishSeenAt = -Infinity;
/** Видел ли сторож конец речи на прошлом проходе: исчезновение = речь кончилась. */
let finishVisible = false;
const now = (): number => performance.now();
let offWatch: (() => void) | null = null;

/** Какие действия на каком коде. Порядок фиксирован — подпись стабильна. */
function plan(): Map<string, ControlKind[]> {
  const out = new Map<string, ControlKind[]>();
  for (const kind of ["outcry", "finish"] as ControlKind[]) {
    const code = codes.get(kind);
    if (!code || !actions.has(kind)) continue;
    out.set(code, [...(out.get(code) ?? []), kind]);
  }
  return out;
}

/**
 * Сверка с DOM: кнопка на месте — отметка «видели сейчас»; была и пропала —
 * отметка «речь кончилась сейчас». Второе важно (контрольный раунд ревью):
 * в тихую речь проходов наблюдателя может не быть секундами (тиканье таймера —
 * characterData, обычным подписчикам не приходит), а смена кнопки на выкрик —
 * изменение детей, и проход с ней приходит сразу.
 */
function noteFinishSeen(): void {
  const visible = actions.get("finish")?.available() === true;
  if (visible || finishVisible) finishSeenAt = now();
  finishVisible = visible;
}

function handlerFor(kinds: ControlKind[]): HotkeyHandler {
  const shared = kinds.length > 1;
  return (e) => {
    if (shared) noteFinishSeen();
    const ready = kinds.filter((k) => actions.get(k)?.available());
    let acted = false;
    if (ready.length > 1) {
      log.warn(SCOPE, `общая клавиша: доступны ${kinds.join(" и ")} разом — не жмём`);
    } else if (ready.length === 1) {
      const kind = ready[0];
      if (shared && kind === "outcry" && now() - finishSeenAt < FINISH_GUARD_MS) {
        log.info(SCOPE, "общая клавиша: речь только что кончилась — выкрик не жмём");
      } else {
        acted = actions.get(kind)!.press();
        if (acted && kind === "finish") finishSeenAt = now();
      }
    }
    // Сработало — клавиша наша целиком (выкрик на K сайта не должен уйти и
    // сайту вторым выкриком; с координатором выкрик это делает впервые). Не
    // сработало — выкрик, как и раньше, гасит только действие браузера.
    if (acted) {
      e.preventDefault();
      e.stopPropagation();
    } else if (kinds.some((k) => actions.get(k)?.alwaysSwallow)) {
      e.preventDefault();
    }
  };
}

/**
 * Привести привязки к плану. Чужую клавишу (роли, микрофон, клип…) не
 * отнимаем — предупреждаем один раз и ждём, пока освободится: зовётся на
 * каждую смену настроек (update фич), как у действий по цифрам.
 */
function rebind(): void {
  const next = plan();
  const sig = Array.from(next, ([code, kinds]) => `${code}:${kinds.join("+")}`).join(",");
  if (sig !== boundSig) {
    bound.forEach((b) => b.off?.());
    bound = new Map();
    warned = new Set();
    boundSig = sig;
    for (const [code, kinds] of next) bound.set(code, { kinds, handler: handlerFor(kinds), off: null });
  }
  for (const [code, b] of bound) {
    if (keyboard.isBoundTo(code, b.handler)) continue;
    if (keyboard.isBound(code)) {
      if (!warned.has(code)) {
        warned.add(code);
        log.warn(SCOPE, `клавиша ${code} занята другой функцией — ${b.kinds.join(" и ")} без неё`);
      }
      b.off = null;
      continue;
    }
    b.off = keyboard.register(code, b.handler);
  }
  // Общая клавиша: следим (только читаем DOM), когда конец речи был на
  // месте, — ловит и смену кнопок по таймеру, до которой нажатие не дошло.
  const sharedNow = Array.from(bound.values()).some((b) => b.kinds.length > 1);
  if (sharedNow && !offWatch) offWatch = onDomChange(noteFinishSeen);
  else if (!sharedNow && offWatch) {
    offWatch();
    offWatch = null;
  }
}

/** Фича сообщает свою клавишу; null — фича выключена. */
export function setControlKey(kind: ControlKind, action: ControlAction, code: string | null): void {
  if (code) {
    actions.set(kind, action);
    codes.set(kind, code);
  } else {
    actions.delete(kind);
    codes.delete(kind);
  }
  rebind();
}

/** Клавиша, которая СЕЙЧАС нажмёт это действие; "" — нет. Для подсказок на кнопках. */
export function controlKeyCode(kind: ControlKind): string {
  const code = codes.get(kind);
  const b = code ? bound.get(code) : undefined;
  return code && b && keyboard.isBoundTo(code, b.handler) ? code : "";
}

/** Тестовый шов: забыть время последнего конца речи. */
export function resetFinishGuard(): void {
  finishSeenAt = -Infinity;
  finishVisible = false;
}
