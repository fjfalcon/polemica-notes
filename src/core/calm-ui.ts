/**
 * Упражнения для успокоения — общий интерфейс (просьба владельца 11.11.2026,
 * перенос с его сайта fjtilt: ТОЛЬКО упражнения, без КПТ и дневников).
 *
 * Монтируется в два места:
 *  - вкладка «Тильт» попапа;
 *  - окно по кнопке «У меня тильт» на странице поиска сайта (tilt-button).
 * Поэтому стили — свои, внутри модуля, под классом-корнем `.pn-calm`: на
 * странице сайта его CSS не должен ни ломать наши узлы, ни задевать свои.
 *
 * Список из шести упражнений → по клику плеер: дыхание с «дышащим» кругом,
 * заземление 5-4-3-2-1 по шагам, пошаговые таймеры (STOP, сканирование тела).
 * Ничего не сохраняет, в сеть не ходит.
 *
 * Анимация и таймеры живут, только пока корень «на экране» (решает
 * вызывающий через isActive): ушли на другую вкладку попапа, закрыли окно или
 * свернули страницу — дыхание встаёт на паузу, время шага не идёт.
 */
import {
  BREATH_ORDER,
  BREATH_PATTERNS,
  CALM_TOOLS,
  GROUNDING_STEPS,
  phaseAt,
  type CalmTool,
  type TimedStep,
} from "@shared/calm";

const STYLE_ID = "pn-calm-style";
const TEAL = "#4ec9b0";

/** Стили модуля. Каждое свойство кнопок задано явно: CSS сайта на `button` не должен протечь. */
export const CALM_CSS = `
.pn-calm{color:#e6e9f0;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-align:left}
.pn-calm *{box-sizing:border-box}
.pn-calm .pn-calm-intro{font-size:12px;color:#8b93a7;margin:2px 0 10px}
.pn-calm .pn-calm-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pn-calm button{font:inherit;letter-spacing:normal;text-transform:none;line-height:1.3;margin:0;box-shadow:none;outline-offset:2px}
.pn-calm button.pn-calm-card{display:block;width:100%;text-align:left;padding:10px;border-radius:10px;cursor:pointer;color:#e6e9f0;background:#1b2233;border:1px solid rgba(255,255,255,.08)}
.pn-calm button.pn-calm-card:hover{border-color:rgba(78,201,176,.5)}
.pn-calm .pn-calm-card-title{font-weight:600;font-size:12px}
.pn-calm .pn-calm-card-sub{font-size:11px;color:#8b93a7;margin-top:2px}
.pn-calm .pn-calm-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.pn-calm button.pn-calm-back{background:none;border:none;color:#8b93a7;cursor:pointer;padding:0}
.pn-calm button.pn-calm-back:hover{color:#e6e9f0}
.pn-calm .pn-calm-head-title{font-size:12px;color:#8b93a7;margin-left:auto}
.pn-calm .pn-calm-body{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px}
.pn-calm .pn-calm-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:5px}
.pn-calm button.pn-calm-chip{padding:4px 8px;border-radius:12px;cursor:pointer;font-size:11px;color:#e6e9f0;background:transparent;border:1px solid rgba(255,255,255,.12)}
.pn-calm button.pn-calm-chip.pn-calm-on{border-color:rgba(78,201,176,.7);color:${TEAL}}
.pn-calm .pn-calm-stage{position:relative;width:180px;height:180px;display:flex;align-items:center;justify-content:center}
.pn-calm .pn-calm-circle{position:absolute;border-radius:50%;background:radial-gradient(circle at 50% 40%,rgba(78,201,176,.35),rgba(78,201,176,.08));border:2px solid rgba(78,201,176,.5)}
.pn-calm .pn-calm-center{position:relative}
.pn-calm .pn-calm-phase{font-size:15px;font-weight:600}
.pn-calm .pn-calm-count{font-size:32px;font-weight:700;font-variant-numeric:tabular-nums}
.pn-calm .pn-calm-step-count{color:${TEAL}}
.pn-calm .pn-calm-cycle,.pn-calm .pn-calm-note{font-size:12px;color:#8b93a7;max-width:290px}
.pn-calm .pn-calm-controls{display:flex;gap:8px}
.pn-calm button.pn-calm-btn{padding:7px 12px;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px;color:#fff;background:rgba(255,255,255,.1)}
.pn-calm button.pn-calm-btn:hover{filter:brightness(1.15)}
.pn-calm button.pn-calm-btn.pn-calm-primary{background:#3b82f6;min-width:150px;margin-top:6px}
.pn-calm .pn-calm-big{font-size:52px;font-weight:700;color:${TEAL};line-height:1}
.pn-calm .pn-calm-prompt{font-size:15px;max-width:290px}
.pn-calm .pn-calm-step-title{font-size:16px;font-weight:600}
.pn-calm .pn-calm-done-mark{font-size:30px;color:${TEAL}}
.pn-calm .pn-calm-done-title{font-size:15px;font-weight:600}
.pn-calm .pn-calm-progress{display:flex;gap:5px;margin-top:6px}
.pn-calm .pn-calm-progress span{width:22px;height:5px;border-radius:3px;background:#1b2233}
.pn-calm .pn-calm-progress span.pn-calm-on{background:${TEAL}}
`;

/** Стили — один раз на документ (идемпотентно). */
export function ensureCalmStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CALM_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

const button = (cls: string, text: string, onClick: () => void): HTMLButtonElement => {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

export interface CalmHandle {
  /** Остановить анимацию и таймеры (закрыли окно). */
  stop(): void;
}

/**
 * Смонтировать упражнения в root. isActive — «корень сейчас на экране»:
 * проверяется на каждом тике; false — дыхание на паузе, время шага стоит.
 */
export function mountCalm(root: HTMLElement, isActive: () => boolean): CalmHandle {
  ensureCalmStyles(root.ownerDocument);
  root.classList.add("pn-calm");
  const visible = () => isActive() && document.visibilityState === "visible";
  let stopCurrent: () => void = () => {};

  const showList = (): void => {
    stopCurrent();
    stopCurrent = () => {};
    root.replaceChildren();
    root.appendChild(
      el("div", "pn-calm-intro", "Сначала помоги телу: выбери упражнение и сделай его прямо сейчас — минута-две."),
    );
    const grid = el("div", "pn-calm-grid");
    for (const tool of CALM_TOOLS) {
      const card = button("pn-calm-card", "", () => showTool(tool));
      card.dataset.calmTool = tool.id;
      card.append(el("div", "pn-calm-card-title", tool.title), el("div", "pn-calm-card-sub", tool.subtitle));
      grid.appendChild(card);
    }
    root.appendChild(grid);
  };

  const showTool = (tool: CalmTool): void => {
    stopCurrent();
    root.replaceChildren();
    const head = el("div", "pn-calm-head");
    head.append(button("pn-calm-back", "← Назад", showList), el("div", "pn-calm-head-title", tool.title));
    const body = el("div", "pn-calm-body");
    root.append(head, body);
    if (tool.kind === "breathing") stopCurrent = breathing(body, tool.pattern, visible);
    else if (tool.kind === "grounding") stopCurrent = grounding(body);
    else stopCurrent = steps(body, tool.steps, visible);
  };

  showList();
  return { stop: () => stopCurrent() };
}

function breathing(body: HTMLElement, initial: string, visible: () => boolean): () => void {
  let patternId = BREATH_PATTERNS[initial] ? initial : "478";
  let elapsed = 0;
  let running = true;
  let last: number | null = null;
  let raf = 0;

  const chips = el("div", "pn-calm-chips");
  const stage = el("div", "pn-calm-stage");
  const circle = el("div", "pn-calm-circle");
  const label = el("div", "pn-calm-phase");
  const count = el("div", "pn-calm-count");
  const center = el("div", "pn-calm-center");
  center.append(label, count);
  stage.append(circle, center);
  const cycle = el("div", "pn-calm-cycle");
  const controls = el("div", "pn-calm-controls");
  const toggle = button("pn-calm-btn", "Пауза", () => (running ? pause() : start()));
  const reset = button("pn-calm-btn", "Сначала", () => {
    elapsed = 0;
    last = null;
    draw();
  });
  controls.append(toggle, reset);
  body.append(chips, stage, cycle, controls);

  const renderChips = (): void => {
    chips.replaceChildren();
    for (const id of BREATH_ORDER) {
      chips.appendChild(
        button(`pn-calm-chip${id === patternId ? " pn-calm-on" : ""}`, BREATH_PATTERNS[id].title, () => {
          patternId = id;
          elapsed = 0;
          renderChips();
          draw();
          start();
        }),
      );
    }
  };

  const draw = (): void => {
    const s = phaseAt(BREATH_PATTERNS[patternId], elapsed);
    const size = 70 + s.scale * 110; // px: круг вписан в сцену 180 px
    circle.style.width = circle.style.height = `${size}px`;
    if (label.textContent !== s.phase.label) label.textContent = s.phase.label;
    const sec = String(s.secondsLeft);
    if (count.textContent !== sec) count.textContent = sec;
    const c = `Цикл ${s.cycle + 1}`;
    if (cycle.textContent !== c) cycle.textContent = c;
  };

  const tick = (ts: number): void => {
    if (!visible()) {
      pause();
      return;
    }
    // Скрытая вкладка браузера rAF не крутит: первый кадр после возврата
    // принёс бы всё скрытое время — дыхание прыгнуло бы в случайную фазу
    // (ревью). Большой разрыв (скрытая вкладка, долгий кадр сайта) не
    // считаем: дыхание продолжается с той же точки, без «Продолжить».
    if (last !== null && ts - last <= 500) elapsed += (ts - last) / 1000;
    last = ts;
    draw();
    raf = requestAnimationFrame(tick);
  };

  function start(): void {
    cancelAnimationFrame(raf);
    running = true;
    last = null;
    toggle.textContent = "Пауза";
    raf = requestAnimationFrame(tick);
  }

  function pause(): void {
    cancelAnimationFrame(raf);
    running = false;
    last = null;
    toggle.textContent = "Продолжить";
  }

  renderChips();
  draw();
  start();
  return () => cancelAnimationFrame(raf);
}

function grounding(body: HTMLElement): () => void {
  let index = 0;
  const render = (): void => {
    body.replaceChildren();
    if (index >= GROUNDING_STEPS.length) {
      body.append(
        el("div", "pn-calm-done-mark", "✓"),
        el("div", "pn-calm-done-title", "Ты здесь и сейчас"),
        el("div", "pn-calm-note", "Внимание вернулось в тело и в момент. Если ещё штормит — повтори или подыши."),
        button("pn-calm-btn", "Пройти снова", () => {
          index = 0;
          render();
        }),
      );
      return;
    }
    const step = GROUNDING_STEPS[index];
    body.append(
      el("div", "pn-calm-note", "Не торопись. Назови про себя или вслух:"),
      el("div", "pn-calm-big", String(step.n)),
      el("div", "pn-calm-prompt", step.prompt),
      button("pn-calm-btn pn-calm-primary pn-calm-next", "Готово, дальше", () => {
        index++;
        render();
      }),
      progress(GROUNDING_STEPS.length, index),
    );
  };
  render();
  return () => {};
}

function steps(body: HTMLElement, list: TimedStep[], visible: () => boolean): () => void {
  let index = 0;
  let left = list[0]?.seconds ?? 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const render = (): void => {
    body.replaceChildren();
    if (index >= list.length) {
      body.append(
        el("div", "pn-calm-done-mark", "✓"),
        el("div", "pn-calm-done-title", "Готово"),
        button("pn-calm-btn", "Пройти снова", () => go(0)),
      );
      return;
    }
    const step = list[index];
    body.append(
      el("div", "pn-calm-count pn-calm-step-count", String(left)),
      el("div", "pn-calm-step-title", step.title),
      el("div", "pn-calm-note", step.detail),
      button("pn-calm-btn pn-calm-primary pn-calm-next", "Дальше →", () => go(index + 1)),
      progress(list.length, index),
    );
  };

  const go = (i: number): void => {
    stop();
    index = i;
    left = list[i]?.seconds ?? 0;
    render();
    if (index >= list.length) return;
    timer = setInterval(() => {
      if (!visible()) return; // не на экране — время шага не идёт
      left--;
      if (left <= 0) go(index + 1);
      else {
        const c = body.querySelector(".pn-calm-step-count");
        if (c) c.textContent = String(left);
      }
    }, 1000);
  };

  go(0);
  return stop;
}

function progress(total: number, index: number): HTMLElement {
  const bar = el("div", "pn-calm-progress");
  for (let i = 0; i < total; i++) bar.appendChild(el("span", i <= index ? "pn-calm-on" : ""));
  return bar;
}
