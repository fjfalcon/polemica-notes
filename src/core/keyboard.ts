/**
 * Единый keyboard-роутер. Раньше role-faker/pause-hotkey/auto-start каждый
 * вешали свой keydown(capture) и конфликтовали (D блокировался в одном месте,
 * обрабатывался в другом). Теперь один слушатель и явная регистрация хоткеев.
 *
 * Поддерживает раскладко-независимость через event.code (KeyF == и F, и А).
 */
import { log } from "./log";

export type HotkeyHandler = (e: KeyboardEvent) => void;

interface Binding {
  code: string;
  handler: HotkeyHandler;
  preventDefault: boolean;
  /** Глушить автоповторы для сайта (обработчик на них и так не зовётся). */
  swallowRepeat: () => boolean;
}

/**
 * Может ли эта физическая клавиша дать символ в поле ввода.
 * F1..F12, Escape и стрелки — не могут, поэтому такой хоткей (например пауза на F8)
 * должен работать и когда курсор стоит в чате.
 */
export function producesText(code: string): boolean {
  return /^(Key|Digit|Numpad|Minus|Equal|Bracket|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Space|Intl)/.test(
    code,
  );
}

/**
 * Клавиши, которые в поле ввода РЕДАКТИРУЮТ текст, хотя символа не дают:
 * Enter (новая строка), Tab, Backspace/Delete, стрелки, Home/End/PageUp/Down.
 * Назначенный на них хоткей в чате/заметке срабатывал на каждом переводе
 * строки — hide=Enter открывал роли стола (внешний аудит №2, B04).
 * F-клавиши и Escape сюда не входят: пауза на F8 работает и из чата.
 */
export function editsText(code: string): boolean {
  return (
    producesText(code) ||
    /^(Enter|NumpadEnter|Tab|Backspace|Delete|Arrow|Home|End|PageUp|PageDown|Insert)/.test(code)
  );
}

/**
 * Код клавиши, которую сайт держит под свой тумблер ролей (hotkeys-js `d`).
 * Любая наша привязка на неё забирает клавишу у сайта целиком: иначе сброс
 * подмены или выкрик на D переключали флаг ролей сайта и открывали стол
 * (внешний аудит №2, B03).
 */
const SITE_ROLE_TOGGLE_CODE = "KeyD";

/** Пользователь печатает — в поле ввода, в textarea или в contenteditable. */
export function isTypingContext(e: KeyboardEvent): boolean {
  const candidates: Array<EventTarget | null> = [e.target, document.activeElement];
  for (const c of candidates) {
    if (!(c instanceof HTMLElement)) continue;
    const tag = c.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (c.isContentEditable) return true;
  }
  return false;
}

class KeyboardRouter {
  private bindings = new Map<string, Binding>();
  private started = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const b = this.bindings.get(e.code);
    const watchers = this.observers.get(e.code);
    if (!b && !watchers) return;

    // Хоткеи привязаны к event.code (физической клавише) ради раскладко-независимости.
    // Обратная сторона: в русской раскладке KeyF — это «а», KeyD — «в», KeyE — «у».
    // Без этих проверок фраза в игровом чате перещёлкивала подменённую роль и
    // снимала скрытие роли — то есть показывала её на стриме.
    if (isTypingContext(e) && editsText(e.code)) return;
    // Включившееся «зажатие» — клавиша целиком наша, в любых сочетаниях и
    // повторах: Ctrl/Alt-повтор удерживаемой V доходил до сайта, и hotkeys-js
    // считал V зажатой навсегда (внешний аудит №2, B02).
    if (this.swallowed.has(e.code)) e.stopPropagation();
    // Наблюдатели видят то, что НЕ забирает наш хоткей: клавишу без
    // привязки и любые сочетания с Ctrl/Cmd — их получит сайт (у опции
    // «хоткеи с модификатором» Ctrl/Cmd+D — его тумблер ролей), а фича
    // обязана знать о ручном действии и может его заглушить.
    const modified = e.ctrlKey || e.metaKey;
    if (watchers && (!b || modified)) for (const w of watchers) this.call(w, e);
    if (!b) return;
    // Ctrl+F / Cmd+D и прочие сочетания принадлежат браузеру и сайту, не нам.
    if (e.altKey || modified) return;
    if (e.code === SITE_ROLE_TOGGLE_CODE) e.stopPropagation();
    // Зажатая клавиша не должна гнать обработчик с частотой автоповтора. А
    // сайту — и подавно: у hotkeys-js нет защиты от повтора, и зажатый D
    // переключал флаг ролей на КАЖДОМ повторе — мигание в эфире.
    if (e.repeat) {
      if (b.swallowRepeat()) e.stopPropagation();
      return;
    }

    if (b.preventDefault) e.preventDefault();
    this.call(b.handler, e);
  };

  private call(handler: HotkeyHandler | undefined, e: KeyboardEvent): void {
    if (!handler) return;
    try {
      handler(e);
    } catch (err) {
      log.error("keyboard", "handler threw", e.code, err);
    }
  }

  private ensureStarted() {
    if (this.started) return;
    // capture=true: перехватываем раньше обработчиков сайта
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.started = true;
  }

  /** Клавиши-«зажатия», которые сейчас нажаты: чтобы отпуск был ровно один. */
  private held = new Set<string>();
  /** Зажатия, чьё нажатие сайт не видел: отпускание и повторы — тоже. */
  private swallowed = new Set<string>();
  private holds = new Map<string, { down: () => boolean | void; up: () => void }>();

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === SITE_ROLE_TOGGLE_CODE && this.bindings.has(e.code)) e.stopPropagation();
    const wasSwallowed = this.swallowed.has(e.code);
    if (this.releaseHold(e.code) && wasSwallowed) e.stopPropagation();
  };

  /**
   * Страховка от «залипшей» клавиши: alt-tab, потеря фокуса или сворачивание
   * вкладки съедают keyup, и режим «подсмотреть» остался бы включённым — то
   * есть роль уехала бы в эфир. Ровно то, от чего фича и защищает.
   */
  private onBlur = () => {
    for (const code of Array.from(this.held)) this.releaseHold(code);
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.onBlur();
  };

  private releaseHold(code: string): boolean {
    this.swallowed.delete(code);
    if (!this.held.delete(code)) return false;
    try {
      this.holds.get(code)?.up();
    } catch (err) {
      log.error("keyboard", "hold release threw", code, err);
    }
    return true;
  }

  /**
   * Клавиша-«зажатие»: `down` на нажатии, `up` на отпускании И на любой
   * потере фокуса. Нужна там, где показ чего-либо на экране должен жить
   * ровно столько, сколько человек держит палец (роли у стримера).
   *
   * Клавиша-«зажатие» сайту НЕ отдаётся (21.10.2026): hotkeys-js сайта
   * срабатывает, только если множество зажатых клавиш совпадает с сочетанием
   * ЦЕЛИКОМ. Пока V виден сайту зажатым, наш синтетический D для него —
   * «V+D» и молча не срабатывает; alt-tab с зажатой V оставлял V «зажатой»
   * у сайта до возврата фокуса, и возврат скрытия после «подсмотреть»
   * сдавался — роли оставались в эфире. Но только когда `down` РЕАЛЬНО
   * включил режим: вернул false (подсматривать нечего — например, лобби) —
   * клавиша целиком отдаётся сайту, его `v` (тумблер камеры) работает.
   */
  registerHold(code: string, down: () => boolean | void, up: () => void): () => void {
    this.ensureStarted();
    this.holds.set(code, { down, up });
    const unregister = this.register(
      code,
      (e) => {
        if (this.held.has(code)) return;
        this.held.add(code);
        if (down() === false) return;
        this.swallowed.add(code);
        e.stopPropagation();
      },
      { preventDefault: true, swallowRepeat: () => this.swallowed.has(code) },
    );
    return () => {
      this.releaseHold(code);
      this.holds.delete(code);
      unregister();
    };
  }

  private observers = new Map<string, Set<HotkeyHandler>>();

  /**
   * Наблюдать клавишу, которую наш хоткей НЕ забирает (нет привязки, или
   * нажата с Ctrl/Cmd), — включая автоповторы (e.repeat): наблюдатель сам
   * решает, глушить ли их для сайта. Гейт набора текста — как у хоткеев.
   */
  observe(code: string, handler: HotkeyHandler): () => void {
    this.ensureStarted();
    let set = this.observers.get(code);
    if (!set) this.observers.set(code, (set = new Set()));
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0 && this.observers.get(code) === set) this.observers.delete(code);
    };
  }

  /**
   * Зарегистрировать хоткей по физической клавише (event.code, напр. "KeyF", "F8").
   * Возвращает функцию отписки.
   */
  register(
    code: string,
    handler: HotkeyHandler,
    opts: {
      preventDefault?: boolean;
      /** Глушить для сайта автоповторы (true или решение на момент повтора). */
      swallowRepeat?: boolean | (() => boolean);
    } = {},
  ): () => void {
    this.ensureStarted();
    // Одна клавиша — один обработчик: попап не мешает назначить двум фичам одну
    // и ту же клавишу, и тогда вторая молча вытесняла первую. Хотя бы фиксируем.
    if (this.bindings.has(code)) log.warn("keyboard", "hotkey collision, rebinding", code);
    this.bindings.set(code, {
      code,
      handler,
      preventDefault: opts.preventDefault ?? false,
      swallowRepeat:
        typeof opts.swallowRepeat === "function"
          ? opts.swallowRepeat
          : () => opts.swallowRepeat === true,
    });
    return () => {
      if (this.bindings.get(code)?.handler === handler) this.bindings.delete(code);
    };
  }
}

export const keyboard = new KeyboardRouter();

/** Чисто модификаторные клавиши — не годятся как самостоятельный хоткей. */
export function isModifierCode(code: string): boolean {
  return /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code);
}

/** Человекочитаемая подпись для KeyboardEvent.code (для UI настроек). */
export function formatKeyCode(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3); // KeyP → P
  if (code.startsWith("Digit")) return code.slice(5); // Digit5 → 5
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return code.slice(5); // ArrowUp → Up
  const named: Record<string, string> = {
    Escape: "Esc",
    Space: "Space",
    Enter: "Enter",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Tab: "Tab",
  };
  return named[code] ?? code; // F1..F12 и прочее — как есть
}
