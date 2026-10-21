// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Случайные сценарии против ТОЧНОЙ модели сайта (требование владельца
 * 21.10.2026: «на стримах роли не должны появляться или исчезать сами по
 * себе — ровно как задумано»).
 *
 * Модель сверена с бандлом комнаты (room/bundle/main.js, 21.10.2026; второй
 * раз — внешним аудитом):
 *  • флаг Vuex `roleDisplay` (старт true), мутация `updateRoleDisplay` —
 *    всегда переворот; её дёргают хоткей `d` и пункт меню;
 *  • каждая роль — `<span class="player__role role">` под `v-show`: на
 *    монтировании и на СМЕНЕ флага Vue пишет `display` (флаш в микрозадаче),
 *    других inline-стилей не трогает;
 *  • хоткеи — hotkeys-js на document: keyCode, множество зажатых клавиш
 *    должно СОВПАСТЬ с сочетанием целиком; фильтр полей ввода стоит ДО
 *    добавления клавиши; keyup убирает клавишу; `focus` окна очищает
 *    множество; `v` — тумблер видео игрока;
 *  • фазу сайт показывает разметкой этапов (.substage.current), а НЕ
 *    классами body — фаза меняется текстом этапа, через настоящие детекторы.
 *
 * Наш код — настоящий: auto-start, role-pin, keyboard-роутер. obs-panel и
 * role-faker замоканы (гейт ночной сцены — управляемый флаг): пин, его щит и
 * подмена проверяются своими тестами.
 *
 * Свойства, проверяемые на КАЖДОМ снимке (50–250 мс) и после каждого шага:
 *  1. никакого зеркала: своя роль и сокомандники всегда в одном состоянии;
 *  2. ничего не меняется само; за одно действие роль меняется не больше раза;
 *  3. D (наша клавиша скрытия) переворачивает всё; V показывает всё и
 *     возвращает ровно как было; потеря фокуса = отпускание;
 *  4. эфир не на ночной сцене и игрок с тех пор не показывал роли руками —
 *     все роли скрыты; день при автосмене и без ручного показа — скрыты;
 *  5. серии действий с паузами 0–300 мс: только V/push-to-talk/перерисовки
 *     поверх скрытых ролей — после серии роли скрыты.
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
const obs = vi.hoisted(() => ({
  safe: true,
  listener: null as null | ((reason: "gate" | "beforeDayScene") => void),
}));
vi.mock("@content/panels/obs-panel", () => ({
  nightSceneSafeForRoleShow: () => obs.safe,
  setRoleSceneGateListener: (fn: (reason: "gate" | "beforeDayScene") => void) => {
    obs.listener = fn;
    // heal-опрос obs-panel уведомляет гейт каждые 2 с.
    const poll = setInterval(() => obs.listener?.("gate"), 2_000);
    return () => {
      clearInterval(poll);
      if (obs.listener === fn) obs.listener = null;
    };
  },
}));

import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";

// ─────────────────────────── модель сайта ───────────────────────────

const KC = { ctrl: 17, shift: 16, alt: 18, meta: 91 } as const;

function keyCodeOf(code: string): number {
  const m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  if (code === "Backquote") return 192;
  return 0;
}

interface SiteModel {
  roleDisplay: boolean;
  videoToggles: number;
  dispose(): void;
}

function installSite(initialFlag: boolean, useModifier: boolean): SiteModel {
  const site: SiteModel = { roleDisplay: initialFlag, videoToggles: 0, dispose: () => {} };
  let downKeys: number[] = [];
  let flushQueued = false;
  const flush = () => {
    flushQueued = false;
    for (const el of document.querySelectorAll<HTMLElement>(".player__role")) {
      el.style.display = site.roleDisplay ? "" : "none";
    }
  };
  const commitToggle = () => {
    site.roleDisplay = !site.roleDisplay;
    if (!flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  };
  const combo = (key: number) => (useModifier ? [[KC.ctrl, key], [KC.meta, key]] : [[key]]);
  const handlers: Array<{ keys: number[][]; fn: () => void }> = [
    { keys: combo(68), fn: commitToggle },
    { keys: combo(86), fn: () => site.videoToggles++ },
  ];
  const syncModifiers = (e: KeyboardEvent) => {
    const flags: Array<[boolean, number]> = [
      [e.ctrlKey, KC.ctrl],
      [e.shiftKey, KC.shift],
      [e.altKey, KC.alt],
      [e.metaKey, KC.meta],
    ];
    for (const [on, code] of flags) {
      const i = downKeys.indexOf(code);
      if (on && i < 0) downKeys.push(code);
      else if (!on && i >= 0) downKeys.splice(i, 1);
    }
  };
  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement &&
    (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    // Фильтр hotkeys-js стоит ДО добавления клавиши в зажатые.
    if (editable(e.target)) return;
    const code = e.keyCode || keyCodeOf(e.code);
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
    const i = downKeys.indexOf(e.keyCode || keyCodeOf(e.code));
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

/** v-show на монтировании. */
function mountRole(site: SiteModel, cls: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `player__role role ${cls}`;
  el.innerHTML = `<svg><use href="#${cls}"></use></svg>`;
  if (!site.roleDisplay) el.style.display = "none";
  return el;
}

function buildTable(site: SiteModel): void {
  document.body.innerHTML = `
    <div class="stage"><div class="substage current"></div></div>
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

/** Фаза — текстом текущего этапа, как у сайта (детекторы — настоящие). */
function setPhase(phase: "day" | "night"): void {
  const el = document.querySelector(".substage.current");
  if (el) el.textContent = phase === "night" ? "Ход мафии" : "Речь игрока";
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

function keyEvent(type: string, code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, {
    code,
    key: code.replace(/^Key/, "").toLowerCase(),
    keyCode: keyCodeOf(code),
    bubbles: true,
    cancelable: true,
    ...init,
  });
}
const down = (code: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(keyEvent("keydown", code, init));
const up = (code: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(keyEvent("keyup", code, init));
const press = (code: string) => {
  down(code);
  up(code);
};
/** Зажатая клавиша: нажатие, 3 автоповтора (чётное число — ловит утечку повторов), отпускание. */
const pressHeld = (code: string, init: KeyboardEventInit = {}) => {
  down(code, init);
  for (let i = 0; i < 3; i++) down(code, { ...init, repeat: true });
  up(code, { ...init, ctrlKey: false, metaKey: false });
};
const blurWindow = () => window.dispatchEvent(new Event("blur"));
const focusWindow = () => window.dispatchEvent(new Event("focus"));

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

type Simple =
  | "wait"
  | "rerender"
  | "hide"
  | "hideHeld"
  | "siteD"
  | "ctrlD"
  | "ctrlDHeld"
  | "Vdown"
  | "Vup"
  | "Vtap"
  | "blur"
  | "focus"
  | "day"
  | "night"
  | "pttDown"
  | "pttUp"
  | "sceneOff"
  | "sceneOn"
  | "autoHideOff"
  | "autoHideOn"
  | "phaseOff"
  | "phaseOn";
/** Серия действий с короткими паузами — окна таймеров, которые шаг 12 с не видит. */
type Burst = { burst: Simple[]; gap: number };
type Action = Simple | Burst;

interface RunConfig {
  /** Опция профиля «хоткеи с модификатором»: сайт слушает только Ctrl+D. */
  useModifier: boolean;
  autoHide: boolean;
  phaseSwitch: boolean;
  initialFlag: boolean;
  phase: "day" | "night";
  /** Наша клавиша скрытия и «подсмотреть» (переназначаемые). */
  hideKey: "KeyD" | "KeyG";
  peekKey: "KeyV" | "KeyD";
}

const same = (a: boolean[], b: boolean[]) => a.every((v, i) => v === b[i]);
const all = (s: boolean[], v: boolean) => s.every((x) => x === v);
const bits = (s: boolean[]) => s.map(Number).join("");

/** Сценарий: случайный (по seed) или заданный списком действий. */
async function runScenario(
  seed: number,
  steps: number,
  scripted?: { cfg: RunConfig; actions: Action[] },
): Promise<void> {
  const r = rng(seed);
  const hideKey = r() < 0.75 ? "KeyD" : "KeyG";
  const random: RunConfig = {
    useModifier: r() < 0.3,
    autoHide: r() < 0.6,
    phaseSwitch: r() < 0.6,
    initialFlag: r() < 0.7,
    phase: r() < 0.5 ? "day" : "night",
    hideKey,
    peekKey: hideKey === "KeyG" && r() < 0.5 ? "KeyD" : "KeyV",
  };
  const cfg = { ...(scripted?.cfg ?? random) };
  if (scripted) steps = scripted.actions.length;
  obs.safe = true;
  document.getElementById("polemica-role-hide")?.remove();
  vi.setSystemTime(new Date(1_800_000_000_000 + seed * 1_000_000));
  const site = installSite(cfg.initialFlag, cfg.useModifier);
  buildTable(site);
  setPhase(cfg.phase);
  let phase = cfg.phase;
  const settings = () =>
    ({
      settings: {
        auto_accept_enabled: false,
        auto_hide_roles_enabled: cfg.autoHide,
        role_phase_auto_switch_enabled: cfg.phaseSwitch,
        hotkey_role_hide: cfg.hideKey,
        hotkey_role_peek: cfg.peekKey,
      },
    }) as never;
  autoStartFeature.enable(settings());
  const log: string[] = [`seed=${seed} ${JSON.stringify(cfg)}`];
  const fail = (msg: string) => {
    throw new Error(`${msg}\n${log.join("\n")}`);
  };

  /** Шаг = действие + 12 с жизни; снимок каждые 50–250 мс; зеркало — на каждом. */
  const settle = async (trace: boolean[][], ms = 12_000): Promise<void> => {
    await Promise.resolve();
    trace.push(snapshot());
    for (let t = 0; t < ms; ) {
      const dt = t < 1_000 ? 50 : 250;
      await vi.advanceTimersByTimeAsync(Math.min(dt, ms - t));
      t += dt;
      const snap = snapshot();
      if (!all(snap, snap[0])) fail(`зеркало в момент +${t} мс: ${bits(snap)}`);
      trace.push(snap);
    }
  };

  // B09: авто-скрытие прячет СРАЗУ, без единого открытого кадра.
  if (cfg.autoHide && !all(snapshot(), false)) fail("авто-скрытие не спрятало роли сразу при включении");

  let held = false;
  let blurred = false;
  let ptt = false;
  let beforePeek: boolean[] | null = null;
  let phaseChangedDuringHold = false;
  let settingsOffDuringHold = false;
  let sceneChangedDuringHold = false;
  /** Флаг сайта до нажатия V: его скрытие отпускание возвращает всегда. */
  let flagAtPeek = true;
  let nightStartStep = phase === "night" ? 0 : -1;
  let dayStartStep = phase === "day" ? 0 : -1;
  let lastManualStep = -2;
  let beforeSceneOff: boolean[] | null = null;
  let sceneOffManual = -3;
  let sceneUnsafeStep = -1;
  let step = 0;

  const peekActiveNow = () => held && beforePeek !== null && !all(beforePeek, true);
  const showDueNow = () => cfg.phaseSwitch && phase === "night" && lastManualStep < nightStartStep;
  const markManual = () => {
    if (!peekActiveNow()) lastManualStep = step + 1;
  };

  /** Выполнить действие и обновить учёт оракула. */
  const perform = async (action: Simple, pre: boolean[], seat: number): Promise<void> => {
    switch (action) {
      case "wait":
        break;
      case "rerender":
        rerender(site, seat);
        break;
      case "hide":
      case "hideHeld":
        if (blurred) focusWindow(), (blurred = false), (ptt = false);
        markManual();
        if (action === "hide") press(cfg.hideKey);
        else pressHeld(cfg.hideKey);
        break;
      case "siteD":
        // Физический D сайта поверх переназначенной клавиши скрытия.
        if (blurred) focusWindow(), (blurred = false), (ptt = false);
        markManual();
        press("KeyD");
        break;
      case "ctrlD":
      case "ctrlDHeld":
        if (blurred) focusWindow(), (blurred = false), (ptt = false);
        markManual();
        if (action === "ctrlD") {
          down("KeyD", { ctrlKey: true });
          up("KeyD");
        } else pressHeld("KeyD", { ctrlKey: true });
        break;
      case "Vdown":
        flagAtPeek = site.roleDisplay;
        down(cfg.peekKey);
        held = true;
        beforePeek = pre;
        phaseChangedDuringHold = false;
        settingsOffDuringHold = false;
        sceneChangedDuringHold = false;
        break;
      case "Vup":
        up(cfg.peekKey);
        held = false;
        break;
      case "Vtap":
        down(cfg.peekKey);
        await vi.advanceTimersByTimeAsync(40);
        up(cfg.peekKey);
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
        down("Backquote");
        ptt = true;
        break;
      case "pttUp":
        up("Backquote");
        ptt = false;
        break;
      case "day":
      case "night":
        if (phase !== action) {
          phaseChangedDuringHold = true;
          if (action === "night") nightStartStep = step + 1;
          else dayStartStep = step + 1;
          beforeSceneOff = null;
        }
        phase = action;
        setPhase(action);
        break;
      case "sceneOff":
        // Уже не на ночной сцене — это лишь повторное уведомление гейта.
        if (obs.safe) {
          sceneChangedDuringHold = true;
          // Под активным V подписчик молчит — «как было до ухода» не определено.
          beforeSceneOff = peekActiveNow() ? null : pre;
          sceneOffManual = lastManualStep;
          sceneUnsafeStep = step + 1;
        }
        obs.safe = false;
        obs.listener?.("gate");
        break;
      case "sceneOn":
        if (!obs.safe) sceneChangedDuringHold = true;
        obs.safe = true;
        obs.listener?.("gate");
        break;
      case "autoHideOff":
      case "autoHideOn":
      case "phaseOff":
      case "phaseOn": {
        const wasHiding = cfg.autoHide || cfg.phaseSwitch;
        if (action === "autoHideOff") cfg.autoHide = false;
        if (action === "autoHideOn") cfg.autoHide = true;
        if (action === "phaseOff") cfg.phaseSwitch = false;
        if (action === "phaseOn") {
          if (!cfg.phaseSwitch) {
            if (phase === "night") nightStartStep = step + 1;
            else dayStartStep = step + 1;
          }
          cfg.phaseSwitch = true;
        }
        if (wasHiding && !(cfg.autoHide || cfg.phaseSwitch)) {
          settingsOffDuringHold = held;
          // «Как было до ухода сцены» включало скрытие от настроек — его выключили.
          beforeSceneOff = null;
        }
        if (cfg.autoHide || cfg.phaseSwitch) settingsOffDuringHold = false;
        autoStartFeature.update(settings());
        break;
      }
    }
  };

  const pickSimple = (pool: Simple[]) => pool[Math.floor(r() * pool.length)];

  try {
    await settle([]);
    for (let i = 0; i < steps; i++) {
      step = i;
      const pre = snapshot();
      const cssBefore = !!document.getElementById("polemica-role-hide");
      const options: Simple[] = ["wait", "rerender", "hide", "day", "night"];
      if (held) options.push("Vup", "Vup", "blur");
      else if (!blurred) options.push("Vdown", "Vdown", "Vtap");
      if (blurred) options.push("focus", "focus", "focus");
      if (!blurred) options.push(ptt ? "pttUp" : "pttDown");
      options.push(obs.safe ? "sceneOff" : "sceneOn", "hideHeld");
      // D уже зажат как «подсмотреть» — второй раз его не нажать.
      if (!(held && cfg.peekKey === "KeyD")) options.push("ctrlD", "ctrlDHeld");
      if (cfg.hideKey !== "KeyD" && cfg.peekKey !== "KeyD") options.push("siteD");
      options.push(
        cfg.autoHide ? "autoHideOff" : "autoHideOn",
        cfg.phaseSwitch ? "phaseOff" : "phaseOn",
      );
      let action: Action;
      if (scripted) action = scripted.actions[i];
      else if (!held && !blurred && r() < 0.15) {
        const pool: Simple[] = ["Vdown", "Vup", "pttDown", "pttUp", "rerender", "hide", "sceneOff", "wait"];
        const n = 2 + Math.floor(r() * 3);
        action = { burst: Array.from({ length: n }, () => pickSimple(pool)), gap: Math.floor(r() * 300) };
      } else action = pickSimple(options);
      const seat = Math.floor(r() * 3);
      const peekActive = peekActiveNow();
      const pttAtStep = ptt;
      const videoBefore = site.videoToggles;
      const prevPhase = phase;
      const label = typeof action === "string" ? action : `burst[${action.burst.join(",")}]@${action.gap}`;
      log.push(`#${i} ${label}${label === "rerender" ? `(${seat})` : ""} pre=${bits(pre)}`);

      const trace: boolean[][] = [];
      if (typeof action !== "string") {
        // ─── серия: под-действия с короткими паузами, затем жизнь ───
        const burstPre = pre;
        const burstShowDue = showDueNow();
        let onlyHidingKinds = true;
        for (const sub of action.burst) {
          if (sub === "Vdown" && held) continue;
          if (sub === "Vup" && !held) continue;
          if (sub === "pttDown" && ptt) continue;
          if (sub === "pttUp" && !ptt) continue;
          if (!["Vdown", "Vup", "pttDown", "pttUp", "rerender", "sceneOff", "wait"].includes(sub)) {
            onlyHidingKinds = false;
          }
          await perform(sub, snapshot(), seat);
          await vi.advanceTimersByTimeAsync(action.gap);
          const snap = snapshot();
          if (!all(snap, snap[0])) fail(`зеркало внутри серии: ${bits(snap)}`);
        }
        if (held) await perform("Vup", snapshot(), seat);
        if (ptt) await perform("pttUp", snapshot(), seat);
        beforePeek = null;
        await settle(trace);
        const post = trace[trace.length - 1];
        log[log.length - 1] += ` post=${bits(post)} flag=${site.roleDisplay}`;
        // 5. Поверх скрытых ролей одни V/PTT/перерисовки/уход сцены — скрыты.
        if (onlyHidingKinds && all(burstPre, false) && !(burstShowDue && obs.safe) && !all(post, false)) {
          fail("после серии V/PTT роли остались открыты");
        }
      } else {
        await perform(action, pre, seat);
        await settle(trace);
        const post = trace[trace.length - 1];
        log[log.length - 1] += ` post=${bits(post)} flag=${site.roleDisplay}`;

        // 2. Мигание: каждая роль меняется за шаг не больше одного раза.
        for (let k = 0; k < post.length; k++) {
          let flips = 0;
          for (let t = 1; t < trace.length; t++) if (trace[t][k] !== trace[t - 1][k]) flips++;
          const startDiff = trace[0][k] !== pre[k] ? 1 : 0;
          if (flips + startDiff > 1) fail(`мигание роли ${k} за шаг «${action}»`);
        }
        const expectSame = () => {
          if (!same(pre, post)) fail(`само изменилось на «${action}»`);
        };
        // V без подсматривания отдана сайту и зажата: для hotkeys-js D — «V+D».
        const vHeldBySite = held && !peekActive && cfg.peekKey === "KeyV";
        switch (action) {
          case "wait":
          case "rerender":
          case "focus":
          case "pttDown":
          case "pttUp":
            expectSame();
            break;
          case "hide":
          case "hideHeld":
            if (peekActive) expectSame();
            else if (!pttAtStep && !vHeldBySite && same(pre, post)) fail(`${action}: D ничего не сделал`);
            break;
          case "siteD":
          case "ctrlD":
          case "ctrlDHeld": {
            // Тумблер сайта (у ctrlD — только при опции модификатора); под
            // нашим CSS не виден. Повторы не должны его дёргать (чётное число).
            const siteToggles = action === "siteD" ? !cfg.useModifier : cfg.useModifier;
            if (peekActive || !siteToggles) expectSame();
            else if (!pttAtStep && !vHeldBySite && !cssBefore && same(pre, post)) {
              fail(`${action}: тумблер сайта не сработал (или сработал чётное число раз)`);
            }
            break;
          }
          case "Vdown":
            if (!pttAtStep && !all(post, true)) fail("V не показал роли");
            break;
          case "Vtap":
            if (!same(pre, post) && !(showDueNow() && obs.safe && all(post, true))) {
              fail("касание V изменило роли");
            }
            break;
          case "Vup":
          case "blur": {
            if (!peekActive) {
              expectSame();
              break;
            }
            const showDue = showDueNow();
            const sceneRestore =
              obs.safe &&
              beforeSceneOff !== null &&
              sceneOffManual === lastManualStep &&
              !showDue &&
              !(cfg.phaseSwitch && phase === "day");
            if (!obs.safe) {
              // Сцена главнее всего: не на ночной — скрыто.
              if (!all(post, false)) fail("после V роли остались видны не на ночной сцене");
            } else if (sceneChangedDuringHold && !sceneRestore) {
              // Сцена ушла/вернулась под V: исход — по решениям игрока за это
              // время; безопасность (не ночная — скрыто) проверена выше.
            } else if (settingsOffDuringHold) {
              // Скрытие выключили под V: наше не возвращается, сайта — да.
              if (!all(post, flagAtPeek)) fail("после V вернулось выключенное скрытие (или не вернулось скрытие сайта)");
            } else if (sceneRestore) {
              if (!same(beforeSceneOff!, post)) fail("после V не вернулось как было до ухода со сцены");
              beforeSceneOff = null;
            } else if (showDue && !pttAtStep) {
              if (!all(post, true)) fail("ночью показ положен, а после V роли скрыты");
            } else if (showDue && all(post, true)) {
              // Зажатая клавиша могла сорвать D сайта, но роли видны на
              // ночной сцене — как ночью и задумано.
            } else if (!phaseChangedDuringHold && !same(beforePeek!, post)) {
              fail(`после V не вернулось как было: было ${bits(beforePeek!)}`);
            }
            if (phaseChangedDuringHold && phase === "day" && cfg.phaseSwitch && !all(post, false)) {
              fail("V держали через смену на день — роли не спрятались");
            }
            beforePeek = null;
            break;
          }
          case "day":
          case "night": {
            if (held || prevPhase === action) {
              if (!held) expectSame();
              break;
            }
            if (action === "day" && cfg.phaseSwitch && !all(post, false)) fail("день не спрятал роли");
            if (action === "night" && cfg.phaseSwitch && obs.safe && !pttAtStep && !all(post, true)) {
              fail("ночь не показала роли");
            }
            if (!cfg.phaseSwitch) expectSame();
            break;
          }
          case "sceneOff":
            if (!peekActive && !all(post, false)) fail("эфир ушёл с ночной сцены — роли стола видны");
            break;
          case "sceneOn": {
            if (peekActive) {
              if (!same(pre, post) && !all(post, true)) fail("сцена под V изменила роли");
              break;
            }
            const showDue = showDueNow();
            if (showDue) {
              if (!pttAtStep && !all(post, true)) fail("вернулись на ночную сцену — роли не показались");
            } else if (
              beforeSceneOff &&
              sceneOffManual === lastManualStep &&
              !(cfg.phaseSwitch && phase === "day")
            ) {
              if (!same(beforeSceneOff, post)) fail("вернулись на ночную сцену — не как было до ухода");
            }
            beforeSceneOff = null;
            break;
          }
          case "autoHideOff":
          case "phaseOff":
            if (peekActive) break;
            if (cfg.autoHide || cfg.phaseSwitch) {
              // Осталась другая прячущая настройка — её скрытие не снимается (B08).
              if (action === "autoHideOff") expectSame();
            } else if (!obs.safe) {
              // Эфир не на ночной сцене: сценовое скрытие — не от этих настроек.
              expectSame();
            } else if (!pttAtStep && !vHeldBySite && !all(post, true)) {
              fail("выключили последнее скрытие — роли не показались");
            }
            break;
          case "autoHideOn":
            if (!peekActive && !all(post, false)) fail("включили авто-скрытие — роли видны");
            break;
          case "phaseOn":
            if (peekActive || prevPhase !== phase) break;
            if (phase === "day" && !all(post, false)) fail("включили автосмену днём — роли видны");
            if (phase === "night" && obs.safe && !pttAtStep && !vHeldBySite && !all(post, true)) {
              fail("включили автосмену ночью — роли не показались (H03)");
            }
            break;
        }
        // V сайту — только когда подсматривать нечего (лобби: тумблер камеры).
        if ((action === "Vdown" || action === "Vtap") && !all(pre, true) && site.videoToggles > videoBefore) {
          fail("V дошла до сайта при включившемся «подсмотреть»");
        }
      }

      // 4. Глобальная безопасность после шага.
      const post = snapshot();
      const peekNow = peekActiveNow();
      if (!obs.safe && !peekNow && lastManualStep < sceneUnsafeStep && !all(post, false)) {
        fail("эфир не на ночной сцене, игрок роли не показывал — а они видны");
      }
      if (
        cfg.phaseSwitch &&
        phase === "day" &&
        !peekNow &&
        lastManualStep < dayStartStep &&
        !all(post, false)
      ) {
        fail("день при автосмене, игрок роли не показывал — а они видны");
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
 * Последовательности, найденные случайным прогоном и внешним аудитом
 * 21.10.2026 — закреплены сценариями (идут в каждом прогоне).
 */
describe("скрытие ролей: найденные сценарии", () => {
  const base: RunConfig = {
    useModifier: false,
    autoHide: true,
    phaseSwitch: true,
    initialFlag: true,
    phase: "night",
    hideKey: "KeyD",
    peekKey: "KeyV",
  };
  const siteHidden: Partial<RunConfig> = {
    autoHide: false,
    phaseSwitch: false,
    initialFlag: false,
    phase: "day",
  };
  const cases: Array<[string, Partial<RunConfig>, Action[]]> = [
    ["ночь: спрятал D → V → отпустил — роли не появляются сами", {}, ["hide", "Vdown", "Vup", "wait"]],
    [
      "эфир ушёл с ночной сцены, игрок показал-спрятал D — возврат сцены не открывает роли",
      {},
      ["sceneOff", "hide", "hide", "sceneOn", "wait"],
    ],
    ["ночь, сцена не ночная: V не оставляет роли на дневной сцене", {}, ["sceneOff", "Vdown", "Vup"]],
    ["скрыто сайтом: alt-tab с зажатой V — роли спрятаны", siteHidden, ["Vdown", "blur", "wait", "focus"]],
    [
      "скрыто сайтом: push-to-talk зажат при отпускании V — роли спрятаны",
      siteHidden,
      ["Vdown", "pttDown", "Vup", "Vdown", "pttUp", "Vup"],
    ],
    ["хоткеи с модификатором: D и V работают", { ...siteHidden, useModifier: true }, ["hide", "hide", "Vdown", "Vup"]],
    ["зажатый D (автоповтор) — один переворот, без мигания", { phase: "day" }, ["hideHeld", "hideHeld", "wait"]],
    [
      "ночь: игрок показал-спрятал D, эфир ушёл с ночной сцены — сокомандники скрыты; вернулся — как было",
      {},
      ["hide", "hide", "sceneOff", "sceneOn", "wait"],
    ],
    [
      "хоткеи с модификатором: Ctrl+D ночью — ручное решение, V и сцена его не переигрывают",
      { useModifier: true },
      ["ctrlD", "Vdown", "Vup", "sceneOff", "sceneOn", "wait"],
    ],
    ["касание V — всё как было", { phase: "day" }, ["Vtap", "hide", "Vtap", "wait"]],
    [
      "ночная сцена вернулась, пока V зажата — после отпускания как было до ухода",
      {},
      ["hide", "hide", "sceneOff", "Vdown", "sceneOn", "Vup", "wait"],
    ],
    ["день: сцена OBS и перерисовки ничего не меняют сами", { phase: "day" }, ["rerender", "wait"]],
    // ─── внешний аудит 21.10.2026 ───
    [
      "B01: V → PTT → отпустил → V снова через 50 мс → всё отпустил — роли скрыты",
      siteHidden,
      [{ burst: ["Vdown", "pttDown", "Vup", "Vdown", "pttUp", "Vup"], gap: 50 }, "wait"],
    ],
    [
      "B02: подсматривание на D (скрытие на G) — после отпускания всё скрыто",
      { ...siteHidden, hideKey: "KeyG", peekKey: "KeyD" },
      ["Vdown", "Vup", "wait"],
    ],
    [
      "B03: скрытие на G, ночью спрятал исходным D сайта — V его не переигрывает",
      { hideKey: "KeyG" },
      ["siteD", "Vdown", "Vup", "wait"],
    ],
    [
      "B04: зажатый Ctrl+D при опции модификатора — один переворот",
      { ...siteHidden, initialFlag: true, useModifier: true },
      ["ctrlDHeld", "wait"],
    ],
    [
      "B07: одни автосцены (без автосмены), уход с ночной сцены — скрыто всё",
      { autoHide: false, phaseSwitch: false },
      ["sceneOff", "wait", "sceneOn"],
    ],
    [
      "B08: днём выключили авто-скрытие при автосмене — дневное скрытие остаётся",
      { phase: "day" },
      ["autoHideOff", "wait"],
    ],
    [
      "B09/H05: авто-скрытие вкл → V → выкл → отпустил — выключенное не возвращается",
      { ...siteHidden, initialFlag: true },
      ["autoHideOn", "Vdown", "autoHideOff", "Vup", "wait"],
    ],
    [
      "H01: V вернул скрытие сайта → D через 100 мс показал — показ не гаснет",
      siteHidden,
      [{ burst: ["Vdown", "Vup", "hide"], gap: 100 }, "wait"],
    ],
    [
      "H03: выключили автосмену до ночного показа, включили в ту же ночь — показ возобновляется",
      { autoHide: false, phase: "day" },
      [{ burst: ["night", "phaseOff"], gap: 1_500 }, "phaseOn", "wait"],
    ],
    [
      "H04: ручное решение ночью → уход сцены → сцена вернулась — всё как было",
      { autoHide: false },
      ["hide", "hide", "sceneOff", "sceneOn", "wait"],
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
  down("KeyV");
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot()).toEqual([true, true, true]);
  autoStartFeature.disable();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "выключили — роли показаны, а не спрятаны поздним D").toEqual([true, true, true]);
  up("KeyV");
  focusWindow();
  site.dispose();
});

test("зритель без своей роли: V показывает скрытые сайтом роли и возвращает (H07)", async () => {
  vi.setSystemTime(new Date(1_950_000_000_000));
  const site = installSite(false, false);
  document.body.innerHTML = `
    <div class="stage"><div class="substage current">Речь игрока</div></div>
    <div class="player" data-seat="2"></div><div class="player" data-seat="3"></div>`;
  const seats = document.querySelectorAll(".player");
  seats[0].appendChild(mountRole(site, "godfather"));
  seats[1].appendChild(mountRole(site, "mafia"));
  autoStartFeature.enable({
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot()).toEqual([false, false]);
  down("KeyV");
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot(), "V показал роли стола").toEqual([true, true]);
  up("KeyV");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "отпустил — скрыто, как было").toEqual([false, false]);
  autoStartFeature.disable();
  site.dispose();
});

test("H01: V вернул скрытие сайта → D через 100 мс показал — показ держится", async () => {
  vi.setSystemTime(new Date(1_960_000_000_000));
  const site = installSite(false, false);
  buildTable(site);
  setPhase("day");
  autoStartFeature.enable({
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  down("KeyV");
  await vi.advanceTimersByTimeAsync(100);
  up("KeyV");
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot(), "отпустили — скрыто").toEqual([false, false, false]);
  press("KeyD");
  await vi.advanceTimersByTimeAsync(12_000);
  expect(snapshot(), "ручной показ не гасит запоздалый возврат").toEqual([true, true, true]);
  autoStartFeature.disable();
  site.dispose();
});

test("сценовое скрытие: самолечение и сброс при выключении фичи", async () => {
  vi.setSystemTime(new Date(1_970_000_000_000));
  const site = installSite(true, false);
  buildTable(site);
  setPhase("night");
  const opts = {
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never;
  autoStartFeature.enable(opts);
  await vi.advanceTimersByTimeAsync(1_000);
  obs.safe = false;
  obs.listener?.("gate");
  expect(snapshot(), "ушли с ночной сцены — скрыто").toEqual([false, false, false]);
  // CSS снял не игрок (чужой путь) — самолечение на следующем уведомлении.
  document.getElementById("polemica-role-hide")?.remove();
  obs.listener?.("gate");
  expect(snapshot(), "самолечение").toEqual([false, false, false]);
  // Выключили/включили фичу на НЕ ночной сцене — состояние не «уже спрятано».
  autoStartFeature.disable();
  expect(snapshot()).toEqual([true, true, true]);
  autoStartFeature.enable(opts);
  obs.listener?.("gate");
  expect(snapshot(), "после перевключения сцена снова прячет").toEqual([false, false, false]);
  autoStartFeature.disable();
  site.dispose();
});
