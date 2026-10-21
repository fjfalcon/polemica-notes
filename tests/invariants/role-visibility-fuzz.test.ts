// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/room/1" }
/**
 * Случайные сценарии против ТОЧНОЙ модели сайта (требование владельца
 * 21.10.2026: «на стримах роли не должны появляться или исчезать сами по
 * себе — ровно как задумано»).
 *
 * Модель сверена с бандлом комнаты (room/bundle/main.js, 21.10.2026):
 *  • флаг Vuex `roleDisplay` (старт true), мутация `updateRoleDisplay` —
 *    всегда переворот; её дёргают хоткей `d` и пункт меню;
 *  • каждая роль — `<span class="player__role role">` под `v-show`: на
 *    монтировании и на СМЕНЕ флага Vue пишет `display` (асинхронно — флаш
 *    планировщика в микрозадаче), других inline-стилей не трогает;
 *  • хоткеи — hotkeys-js на document: keyCode, множество зажатых клавиш
 *    (`downKeys`) должно СОВПАСТЬ с сочетанием целиком; keyup убирает
 *    клавишу, `focus` окна очищает множество; `v` — тумблер видео игрока.
 *
 * Наш код — настоящий: auto-start, role-pin, keyboard-роутер. Свойства:
 *  1. ничего не меняется само (ожидание, перерисовка узла);
 *  2. никакого мигания: за одно действие роль меняет видимость не больше раза;
 *  3. никакого зеркала: своя роль и сокомандники всегда в одном состоянии;
 *  4. D переворачивает всё; V показывает всё и возвращает ровно как было;
 *     потеря фокуса с зажатой V — то же, что отпускание;
 *  5. смена фазы — ровно по настройкам; V не доходит до тумблера видео сайта.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn(() => () => {}),
  safeClick: vi.fn(() => true),
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/env", () => ({
  browser: {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn(() => () => {}),
  sendRuntime: vi.fn(async () => ({ success: true })),
  broadcastToGameTabs: vi.fn(),
  sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
/** Гейт ночной сцены OBS и подписчик auto-start на его смену. */
const obs = vi.hoisted(() => ({ safe: true, listener: null as null | (() => void) }));
vi.mock("@content/panels/obs-panel", () => ({
  nightSceneSafeForRoleShow: () => obs.safe,
  setRoleSceneGateListener: (fn: () => void) => {
    obs.listener = fn;
    return () => {
      if (obs.listener === fn) obs.listener = null;
    };
  },
}));

import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";

// ─────────────────────────── модель сайта ───────────────────────────

const KEY = { d: 68, v: 86, ctrl: 17, shift: 16, alt: 18, meta: 91 } as const;

interface SiteModel {
  roleDisplay: boolean;
  videoToggles: number;
  flagToggles: number;
  dispose(): void;
}

function codeToKeyCode(e: KeyboardEvent): number {
  if (e.keyCode) return e.keyCode;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1].charCodeAt(0) : 0;
}

function installSite(initialFlag: boolean, useModifier: boolean): SiteModel {
  const site: SiteModel = {
    roleDisplay: initialFlag,
    videoToggles: 0,
    flagToggles: 0,
    dispose: () => {},
  };
  let downKeys: number[] = [];
  let flushQueued = false;
  const flush = () => {
    flushQueued = false;
    for (const el of document.querySelectorAll<HTMLElement>(".player__role")) {
      const vod = (el as HTMLElement & { _vod?: string })._vod ?? "";
      el.style.display = site.roleDisplay ? vod : "none";
    }
  };
  const commitToggle = () => {
    site.roleDisplay = !site.roleDisplay;
    site.flagToggles++;
    if (!flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  };
  const combo = (key: number) =>
    useModifier ? [[KEY.ctrl, key], [KEY.meta, key]] : [[key]];
  const handlers: Array<{ keys: number[][]; fn: () => void }> = [
    { keys: combo(KEY.d), fn: commitToggle },
    { keys: combo(KEY.v), fn: () => site.videoToggles++ },
  ];
  const syncModifiers = (e: KeyboardEvent) => {
    const flags: Array<[boolean, number]> = [
      [e.ctrlKey, KEY.ctrl],
      [e.shiftKey, KEY.shift],
      [e.altKey, KEY.alt],
      [e.metaKey, KEY.meta],
    ];
    for (const [on, code] of flags) {
      const i = downKeys.indexOf(code);
      if (on && i < 0) downKeys.push(code);
      else if (!on && i >= 0) downKeys.splice(i, 1);
    }
  };
  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    const code = codeToKeyCode(e);
    if (!downKeys.includes(code)) downKeys.push(code);
    syncModifiers(e);
    const pressed = [...downKeys].sort().join(",");
    for (const h of handlers) {
      if (h.keys.some((k) => [...k].sort().join(",") === pressed)) h.fn();
    }
  };
  const onKeyUp = (ev: Event) => {
    const e = ev as KeyboardEvent;
    syncModifiers(e);
    const i = downKeys.indexOf(codeToKeyCode(e));
    if (i >= 0) downKeys.splice(i, 1);
  };
  const onFocus = () => {
    downKeys = [];
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("focus", onFocus);
  site.dispose = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("focus", onFocus);
  };
  return site;
}

/** v-show на монтировании: _vod = исходный display, затем флаг. */
function mountRole(site: SiteModel, cls: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `player__role role ${cls}`;
  el.innerHTML = `<svg><use href="#${cls}"></use></svg>`;
  (el as HTMLElement & { _vod?: string })._vod = "";
  if (!site.roleDisplay) el.style.display = "none";
  return el;
}

function buildTable(site: SiteModel): void {
  document.body.innerHTML = `
    <div class="player my-player" data-seat="1"></div>
    <div class="player" data-seat="2"></div>
    <div class="player" data-seat="3"></div>`;
  const seats = document.querySelectorAll(".player");
  seats[0].appendChild(mountRole(site, "my-role mafia"));
  seats[1].appendChild(mountRole(site, "godfather"));
  seats[2].appendChild(mountRole(site, "mafia"));
}

/** Vue пересоздал плитку роли: свежий узел без наших стилей. */
function rerender(site: SiteModel, seat: number): void {
  const holder = document.querySelectorAll(".player")[seat];
  const old = holder.querySelector<HTMLElement>(".player__role")!;
  const cls = old.className.replace("player__role role ", "");
  old.remove();
  holder.appendChild(mountRole(site, cls));
}

/** Видит ли зритель роль: display сайта, наш CSS-тег, inline-слой, пин. */
function visible(el: HTMLElement): boolean {
  if (el.style.display === "none") return false;
  if (el.style.visibility === "hidden" || el.style.opacity === "0") return false;
  const cssHide = !!document.getElementById("polemica-role-hide");
  const pinnedVisible =
    el.style.visibility === "visible" && el.style.getPropertyPriority("visibility") === "important";
  return !(cssHide && !pinnedVisible);
}

function snapshot(): boolean[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".player__role")).map(visible);
}

// ─────────────────────────── пользователь ───────────────────────────

function keyEvent(type: string, code: string, keyCode: number): KeyboardEvent {
  return new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), keyCode, bubbles: true, cancelable: true });
}
const pressD = () => {
  document.dispatchEvent(keyEvent("keydown", "KeyD", KEY.d));
  document.dispatchEvent(keyEvent("keyup", "KeyD", KEY.d));
};
/** Зажатый D: нажатие, 3 автоповтора (чётное число переворотов — ловит утечку повторов), отпускание. */
const holdD = () => {
  document.dispatchEvent(keyEvent("keydown", "KeyD", KEY.d));
  for (let i = 0; i < 3; i++) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", key: "d", keyCode: KEY.d, repeat: true, bubbles: true, cancelable: true }),
    );
  }
  document.dispatchEvent(keyEvent("keyup", "KeyD", KEY.d));
};
/** Ctrl+D игрока: у опции «хоткеи с модификатором» — его D сайта. */
const ctrlD = () => {
  const init = { code: "KeyD", key: "d", keyCode: KEY.d, ctrlKey: true, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", init));
  document.dispatchEvent(new KeyboardEvent("keyup", { ...init, ctrlKey: false }));
};
const holdV = () => document.dispatchEvent(keyEvent("keydown", "KeyV", KEY.v));
const releaseV = () => document.dispatchEvent(keyEvent("keyup", "KeyV", KEY.v));
/** Alt-tab в OBS с зажатой V: keyup не придёт никому. */
/** Push-to-talk стримера: посторонняя клавиша зажата, сайт это помнит. */
const pttDown = () => document.dispatchEvent(keyEvent("keydown", "Backquote", 192));
const pttUp = () => document.dispatchEvent(keyEvent("keyup", "Backquote", 192));
const blurWindow = () => window.dispatchEvent(new Event("blur"));
const focusWindow = () => window.dispatchEvent(new Event("focus"));

function setPhase(phase: "day" | "night"): void {
  document.body.classList.remove("day", "night");
  document.body.classList.add(phase);
}

// ─────────────────────────── прогон ───────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

type Action =
  | "wait"
  | "rerender"
  | "D"
  | "Vdown"
  | "Vup"
  | "blur"
  | "focus"
  | "day"
  | "night"
  | "pttDown"
  | "pttUp"
  | "sceneOff"
  | "sceneOn"
  | "Dhold"
  | "ctrlD"
  | "Vtap";

/** Шаг = действие + 12 с жизни; видимость снимается каждые 50–250 мс. */
async function settle(trace: boolean[][]): Promise<void> {
  await Promise.resolve();
  trace.push(snapshot());
  for (let t = 0; t < 12_000; ) {
    const dt = t < 1_000 ? 50 : 250;
    await vi.advanceTimersByTimeAsync(dt);
    t += dt;
    trace.push(snapshot());
  }
}

const same = (a: boolean[], b: boolean[]) => a.every((v, i) => v === b[i]);
const all = (s: boolean[], v: boolean) => s.every((x) => x === v);

interface RunConfig {
  /** Опция профиля «хоткеи с модификатором»: сайт слушает только Ctrl+D. */
  useModifier: boolean;
  autoHide: boolean;
  phaseSwitch: boolean;
  initialFlag: boolean;
  phase: "day" | "night";
}

/** Сценарий: случайный (по seed) или заданный списком действий. */
async function runScenario(
  seed: number,
  steps: number,
  scripted?: { cfg: RunConfig; actions: Action[] },
): Promise<void> {
  const r = rng(seed);
  const random: RunConfig = {
    useModifier: r() < 0.3,
    autoHide: r() < 0.6,
    phaseSwitch: r() < 0.6,
    initialFlag: r() < 0.7,
    phase: r() < 0.5 ? "day" : "night",
  };
  const cfg = scripted?.cfg ?? random;
  if (scripted) steps = scripted.actions.length;
  obs.safe = true;
  document.getElementById("polemica-role-hide")?.remove();
  vi.setSystemTime(new Date(1_800_000_000_000 + seed * 1_000_000));
  const site = installSite(cfg.initialFlag, cfg.useModifier);
  buildTable(site);
  setPhase(cfg.phase);
  let phase = cfg.phase;
  autoStartFeature.enable({
    settings: {
      auto_accept_enabled: false,
      auto_hide_roles_enabled: cfg.autoHide,
      role_phase_auto_switch_enabled: cfg.phaseSwitch,
      hotkey_role_hide: "KeyD",
      hotkey_role_peek: "KeyV",
    },
  } as never);
  const log: string[] = [`seed=${seed} ${JSON.stringify(cfg)}`];
  const fail = (msg: string) => {
    throw new Error(`${msg}\n${log.join("\n")}`);
  };
  try {
    const initTrace: boolean[][] = [];
    await settle(initTrace);
    let held = false;
    let blurred = false;
    let ptt = false;
    /** Шаги начала ночи и последнего ручного действия (D вне «подсмотреть»). */
    let nightStartStep = phase === "night" ? 0 : -1;
    let lastManualStep = -2;
    let beforeSceneOff: boolean[] | null = null;
    let sceneOffManual = -3;
    /** Состояние до нажатия V и было ли за удержание что-то, кроме ожидания. */
    let beforePeek: boolean[] | null = null;
    let phaseChangedDuringHold = false;
    for (let i = 0; i < steps; i++) {
      const pre = snapshot();
      const options: Action[] = ["wait", "rerender", "D", "day", "night"];
      if (held) options.push("Vup", "Vup", "blur");
      else if (!blurred) options.push("Vdown", "Vdown");
      if (blurred) options.push("focus", "focus", "focus");
      if (!blurred) options.push(ptt ? "pttUp" : "pttDown");
      options.push(obs.safe ? "sceneOff" : "sceneOn", "Dhold", "ctrlD");
      if (!held && !blurred) options.push("Vtap");
      const action = scripted ? scripted.actions[i] : options[Math.floor(r() * options.length)];
      const seat = Math.floor(r() * 3);
      const prevPhase = phase;
      const peekActive = beforePeek !== null && !all(beforePeek, true);
      const pttAtStep = ptt;
      const videoBefore = site.videoToggles;
      log.push(`#${i} ${action}${action === "rerender" ? `(${seat})` : ""} pre=${pre.map(Number).join("")}`);
      switch (action) {
        case "wait":
          break;
        case "rerender":
          rerender(site, seat);
          break;
        case "D":
          if (blurred) focusWindow(), (blurred = false), (ptt = false);
          if (!(beforePeek !== null && !all(beforePeek, true))) lastManualStep = i + 1;
          pressD();
          break;
        case "Vdown":
          holdV();
          held = true;
          beforePeek = pre;
          phaseChangedDuringHold = false;
          break;
        case "Vup":
          releaseV();
          held = false;
          break;
        case "blur":
          blurWindow();
          held = false;
          blurred = true;
          break;
        case "focus":
          focusWindow();
          blurred = false;
          ptt = false; // focus окна очищает зажатые клавиши у сайта
          break;
        case "pttDown":
          pttDown();
          ptt = true;
          break;
        case "pttUp":
          pttUp();
          ptt = false;
          break;
        case "Dhold":
          if (blurred) focusWindow(), (blurred = false), (ptt = false);
          if (!(beforePeek !== null && !all(beforePeek, true))) lastManualStep = i + 1;
          holdD();
          break;
        case "ctrlD":
          if (blurred) focusWindow(), (blurred = false), (ptt = false);
          if (!(beforePeek !== null && !all(beforePeek, true))) lastManualStep = i + 1;
          ctrlD();
          break;
        case "Vtap":
          holdV();
          await vi.advanceTimersByTimeAsync(40);
          releaseV();
          break;
        case "sceneOff":
          // Под активным V подписчик молчит — «как было до ухода» не определено.
          beforeSceneOff = beforePeek !== null && !all(beforePeek, true) ? null : pre;
          sceneOffManual = lastManualStep;
          obs.safe = false;
          obs.listener?.();
          break;
        case "sceneOn":
          // Эфир ушёл с ночной сцены / вернулся на неё: obs-panel зовёт
          // подписчика из healRolePin.
          obs.safe = action === "sceneOn";
          obs.listener?.();
          break;
        case "day":
        case "night":
          if (phase !== action) phaseChangedDuringHold = true;
          if (phase !== action && action === "night") nightStartStep = i + 1;
          if (phase !== action) beforeSceneOff = null;
          phase = action;
          setPhase(action);
          break;
      }
      const trace: boolean[][] = [];
      await settle(trace);
      const post = trace[trace.length - 1];
      log[log.length - 1] += ` post=${post.map(Number).join("")} flag=${site.roleDisplay}`;

      // 2. Мигание: каждая роль меняется за шаг не больше одного раза.
      for (let k = 0; k < post.length; k++) {
        let flips = 0;
        for (let t = 1; t < trace.length; t++) if (trace[t][k] !== trace[t - 1][k]) flips++;
        const startDiff = trace[0][k] !== pre[k] ? 1 : 0;
        if (flips + startDiff > 1) fail(`мигание роли ${k} за шаг «${action}»`);
      }
      // 3. Зеркало: своя и сокомандники всегда вместе.
      if (!all(post, post[0])) fail(`зеркало после «${action}»: ${post.map(Number).join("")}`);
      // 1/4/5. Ожидаемый исход действия.
      const expectSame = () => {
        if (!same(pre, post)) fail(`само изменилось на «${action}»`);
      };
      switch (action) {
        case "wait":
        case "rerender":
        case "focus":
        case "pttDown":
        case "pttUp":
          expectSame();
          break;
        case "Vtap":
          // Коснулся V — всё вернулось как было (ночной показ, если положен,
          // вправе открыть роли).
          if (!same(pre, post) && !(cfg.phaseSwitch && phase === "night" && all(post, true))) {
            fail("касание V изменило роли");
          }
          break;
        case "ctrlD":
          // Тумблер — сайта (у модификатора) или ничего; под нашим CSS не
          // виден. Проверяется зеркалом, миганием и тем, что дальше
          // ночная автоматика не переигрывает это ручное действие.
          if (peekActive) expectSame();
          break;
        case "sceneOff":
        case "sceneOn": {
          const showDue = cfg.phaseSwitch && phase === "night" && lastManualStep < nightStartStep;
          const nightAuto = cfg.phaseSwitch && phase === "night";
          if (!nightAuto) expectSame();
          else if (peekActive) {
            // Под V ничего не прячем; ждавший ночной сцены показ — вправе.
            if (!same(pre, post) && !(action === "sceneOn" && all(post, true))) {
              fail(`сцена под V изменила роли: ${action}`);
            }
          } else if (action === "sceneOff") {
            // Своя роль спрятана пином всегда — значит, и сокомандники.
            if (!all(post, false)) fail("ушли с ночной сцены — роли стола видны");
          } else if (showDue) {
            if (!pttAtStep && !all(post, true)) fail("вернулись на ночную сцену — роли не показались");
          } else if (beforeSceneOff && sceneOffManual === lastManualStep) {
            if (!same(beforeSceneOff, post)) fail("вернулись на ночную сцену — не как было до ухода");
          }
          // Вернулась под V — восстановление случится на отпускании.
          if (action === "sceneOn" && !peekActive) beforeSceneOff = null;
          break;
        }
        case "Dhold":
        case "D":
          // Под активным «подсмотреть» D не действует; V на уже видимых
          // ролях — пустое нажатие, и D работает как обычно.
          if (peekActive) expectSame();
          // С зажатой посторонней клавишей D не работает и у самого сайта.
          // Пустое V (подсматривать было нечего) отдано сайту и зажато — для
          // hotkeys-js это «V+D», D не работает и у самого сайта.
          else if (!pttAtStep && !held && same(pre, post)) fail("D ничего не сделал");
          break;
        case "Vdown":
          if (!pttAtStep && !all(post, true)) fail("V не показал роли");
          break;
        case "Vup":
        case "blur": {
          if (!peekActive) {
            expectSame();
            break;
          }
          // Фаза менялась за удержание (хотя бы туда-обратно) — исход по фазе.
          const changedPhase = phaseChangedDuringHold;
          // Ночной показ положен (автосмена, ночь, руками после наступления
          // ночи не трогали) — после V роли видны, как ночью и задумано.
          const showDue = cfg.phaseSwitch && phase === "night" && lastManualStep < nightStartStep;
          const sceneRestore =
            cfg.phaseSwitch && phase === "night" && obs.safe && beforeSceneOff !== null &&
            sceneOffManual === lastManualStep && !showDue;
          if (sceneRestore) {
            if (!same(beforeSceneOff!, post)) fail("после V не вернулось как было до ухода со сцены");
            beforeSceneOff = null;
          } else if (showDue && !obs.safe) {
            if (!all(post, false)) fail("после V роли остались видны не на ночной сцене");
          } else if (showDue && !pttAtStep) {
            if (!all(post, true)) fail("ночью показ положен, а после V роли скрыты");
          } else if (showDue && all(post, true)) {
            // Зажатая клавиша могла сорвать D сайта, но роли видны на ночной
            // сцене — ровно как ночью задумано.
          } else if (!changedPhase && beforePeek && !same(beforePeek, post)) {
            fail(`после V не вернулось как было: было ${beforePeek.map(Number).join("")}`);
          }
          if (changedPhase && phase === "day" && cfg.phaseSwitch && !all(post, false)) {
            fail("V держали через смену на день — роли не спрятались");
          }
          if (changedPhase && phase === "night" && cfg.phaseSwitch && obs.safe && !pttAtStep && !all(post, true)) {
            fail("V держали через смену на ночь — роли не показались");
          }
          break;
        }
        case "day":
        case "night": {
          if (held || prevPhase === action) {
            if (!held) expectSame();
            break;
          }
          // Фазы ведёт только автосмена; авто-скрытие в одиночку прячет
          // лишь при входе в игру (applyRolePhase гейтится автосменой).
          const hides = action === "day" ? cfg.phaseSwitch : false;
          const shows = action === "night" ? cfg.phaseSwitch && obs.safe : false;
          if (hides && !all(post, false)) fail("день не спрятал роли");
          // Ночной показ — через D сайта; с зажатой посторонней клавишей он
          // не срабатывает и у самого сайта (роль скрыта — не утечка).
          else if (shows && !pttAtStep && !all(post, true)) fail("ночь не показала роли");
          else if (action === "night" && cfg.phaseSwitch && !obs.safe) {
            // Ночь, а эфир не на ночной сцене: показ ждёт сцену.
            if (!all(post, false) && !all(pre, true)) fail("ночь показала роли не на ночной сцене");
          } else if (!hides && !shows) expectSame();
          break;
        }
      }
      if (action === "Vup" || action === "blur") beforePeek = null;
      // V сайту — только когда подсматривать нечего (лобби: тумблер камеры).
      if ((action === "Vdown" || action === "Vtap") && !all(pre, true) && site.videoToggles > videoBefore) {
        fail("V дошла до сайта при включившемся «подсмотреть»");
      }
    }
  } finally {
    focusWindow();
    autoStartFeature.disable();
    site.dispose();
  }
}

beforeEach(() => {
  obs.safe = true;
  document.body.innerHTML = "";
  document.getElementById("polemica-role-hide")?.remove();
  resetRolePinForTest();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_800_000_000_000));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const SEEDS = Number(process.env.ROLE_FUZZ_SEEDS || 60);

describe("скрытие ролей: случайные сценарии на модели сайта", () => {
  test(
    `${SEEDS} сценариев × 25 шагов — ничего не происходит само`,
    async () => {
      for (let seed = 1; seed <= SEEDS; seed++) await runScenario(seed * 7919, 25);
    },
    600_000,
  );
});

/**
 * Последовательности, которые случайный прогон нашёл 21.10.2026 (на 2000
 * сценариях, а не на 60 по умолчанию) — закреплены сценариями.
 */
describe("скрытие ролей: найденные сценарии", () => {
  const base: RunConfig = {
    useModifier: false,
    autoHide: true,
    phaseSwitch: true,
    initialFlag: true,
    phase: "night",
  };
  const cases: Array<[string, Partial<RunConfig>, Action[]]> = [
    ["ночь: спрятал D → V → отпустил — роли не появляются сами", {}, ["D", "Vdown", "Vup", "wait"]],
    [
      "эфир ушёл с ночной сцены, игрок показал-спрятал D — возврат сцены не открывает роли",
      {},
      ["sceneOff", "D", "D", "sceneOn", "wait"],
    ],
    ["ночь, сцена не ночная: V не оставляет роли на дневной сцене", {}, ["sceneOff", "Vdown", "Vup"]],
    [
      "скрыто сайтом: alt-tab с зажатой V — роли спрятаны, а не в эфире",
      { autoHide: false, phaseSwitch: false, initialFlag: false, phase: "day" },
      ["Vdown", "blur", "wait", "focus"],
    ],
    [
      "скрыто сайтом: push-to-talk зажат при отпускании V — роли спрятаны",
      { autoHide: false, phaseSwitch: false, initialFlag: false, phase: "day" },
      ["Vdown", "pttDown", "Vup", "Vdown", "pttUp", "Vup"],
    ],
    [
      "хоткеи с модификатором: D и V работают",
      { useModifier: true, autoHide: false, phaseSwitch: false, initialFlag: false, phase: "day" },
      ["D", "D", "Vdown", "Vup"],
    ],
    ["зажатый D (автоповтор) — один переворот, без мигания", { phase: "day" }, ["Dhold", "Dhold", "wait"]],
    [
      "ночь: игрок показал-спрятал D, эфир ушёл с ночной сцены — сокомандники тоже скрыты; вернулся — как было",
      {},
      ["D", "D", "sceneOff", "sceneOn", "wait"],
    ],
    [
      "хоткеи с модификатором: Ctrl+D ночью — ручное решение, V и сцена его не переигрывают",
      { useModifier: true },
      ["ctrlD", "Vdown", "Vup", "sceneOff", "sceneOn", "wait"],
    ],
    ["касание V — всё как было", { phase: "day" }, ["Vtap", "D", "Vtap", "wait"]],
    [
      "ночная сцена вернулась, пока V зажата — после отпускания как было до ухода",
      {},
      ["D", "D", "sceneOff", "Vdown", "sceneOn", "Vup", "wait"],
    ],
    [
      "день: сцена OBS и перерисовки ничего не меняют сами",
      { phase: "day" },
      ["sceneOff", "rerender", "sceneOn", "rerender", "wait"],
    ],
  ];
  test.each(cases)("%s", async (_name, over, actions) => {
    await runScenario(1, 0, { cfg: { ...base, ...over }, actions });
  });
});

test("выключение фичи с зажатой V над скрытием сайта — роли показаны (adversarial №5)", async () => {
  vi.setSystemTime(new Date(1_900_000_000_000));
  const site = installSite(false, false);
  buildTable(site);
  setPhase("day");
  autoStartFeature.enable({
    settings: {
      auto_hide_roles_enabled: false,
      role_phase_auto_switch_enabled: false,
      hotkey_role_hide: "KeyD",
      hotkey_role_peek: "KeyV",
    },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "скрыто сайтом").toEqual([false, false, false]);
  holdV();
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot()).toEqual([true, true, true]);
  autoStartFeature.disable();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "выключили — роли показаны, а не спрятаны поздним D").toEqual([true, true, true]);
  releaseV();
  focusWindow();
  site.dispose();
});
