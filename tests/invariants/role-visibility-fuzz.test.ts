// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Случайные сценарии против ТОЧНОЙ модели сайта и ЭТАЛОННОЙ модели замысла
 * (требование владельца 21.10.2026: «на стримах роли не должны появляться
 * или исчезать сами — ровно как задумано»).
 *
 * Механизм — «одна власть» (решение владельца после двух внешних аудитов):
 * видимостью ролей управляет только наш CSS; скрытие сайта нейтрализовано
 * правилом стилей, решения игрока на сайте принимаются в наш слой.
 *
 * Модель сайта (room/bundle/main.js, сверена дважды внешним аудитом):
 *  • флаг Vuex `roleDisplay`, мутация — всегда переворот; хоткей `d`
 *    (или `ctrl+d, command+d` при опции модификатора) и меню;
 *  • `v-show` на каждой роли: display пишется в микрозадаче флаша Vue;
 *  • hotkeys-js на document: точное совпадение множества зажатых клавиш,
 *    фильтр полей ввода ДО добавления клавиши, focus окна очищает множество;
 *  • фаза — разметкой этапов (.substage.current), детекторы — настоящие.
 * Немедленный подписчик наблюдателя — настоящий MutationObserver (микрозадача,
 * до кадра), как в @core/dom.
 *
 * Автосцены OBS (вариант прогона): сцена идёт за фазой — день: «перед
 * дневной сценой» + сцена не ночная; ночь: ночная сцена + через 3 с nightShow
 * (obs-panel снял пин своей роли). Стример может уйти с ночной сцены и
 * вернуться. Пин своей роли не моделируется (его тесты — obs-role-integration).
 *
 * После каждого шага (действие + 12 с жизни, снимки каждые 50–250 мс):
 *  1. никакого зеркала — на каждом снимке;
 *  2. за шаг роль меняет видимость не больше раза;
 *  3. итог совпадает с эталонной моделью замысла (Spec ниже);
 *  4. серии V/push-to-talk/перерисовок с паузами 0–300 мс роли не открывают.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn(() => () => {}),
  onDomChangeImmediate: (fn: (muts: MutationRecord[]) => void) => {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => mo.disconnect();
  },
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
type GateReason = "gate" | "beforeDayScene" | "nightShow";
/** Автосцены OBS: включены ли, ночная ли сцена, подписчик auto-start. */
const obs = vi.hoisted(() => ({
  auto: false,
  safe: true,
  listener: null as null | ((reason: GateReason, info?: { nightSince?: number }) => void),
}));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => obs.auto,
  nightSceneSafeForRoleShow: () => !obs.auto || obs.safe,
  setRoleSceneGateListener: (fn: (reason: GateReason, info?: { nightSince?: number }) => void) => {
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
  /** Клавиши, которые hotkeys-js сайта считает зажатыми. */
  downKeys: () => number[];
  dispose(): void;
}

function installSite(initialFlag: boolean, useModifier: boolean): SiteModel {
  let downKeys: number[] = [];
  const site: SiteModel = {
    roleDisplay: initialFlag,
    videoToggles: 0,
    downKeys: () => downKeys,
    dispose: () => {},
  };
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

function setPhase(phase: "day" | "night"): void {
  const el = document.querySelector(".substage.current");
  if (el) el.textContent = phase === "night" ? "Ход мафии" : "Речь игрока";
}

/**
 * Видит ли зритель роль: display сайта (если не нейтрализован нашим правилом),
 * наш CSS-тег, inline-слой, пин.
 */
function visible(el: HTMLElement): boolean {
  // Вычисленный стиль (jsdom учитывает !important и каскад): «тег на месте»
  // не доказывает скрытие — пустое правило с тем же id прошло бы (аудит №3).
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
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
  hideKey: "KeyD" | "KeyG";
  peekKey: "KeyV" | "KeyD";
  /** Автосцены OBS. */
  obs: boolean;
}

/**
 * ЭТАЛОН замысла: одна власть — флаг «скрыто» для ВСЕГО стола.
 *  • наш D и решение игрока на сайте (его D/Ctrl+D, если сайт его принял) —
 *    переворот, ручное; V — показ на удержание, отпускание — как было, кроме
 *    «ночной показ положен и сцена ночная»;
 *  • автосмена: день — скрыто; ночь — через 3 с показано, если игрок этой
 *    ночью не трогал роли руками;
 *  • автосцены: не ночная сцена — скрыто (самолечение, пока игрок не показал
 *    руками); ночная сцена — через 3 с показано, если игрок этой ночью не
 *    трогал роли, иначе снимается только сценовое скрытие;
 *  • авто-скрытие при включении — скрыто; выключили последнюю прячущую
 *    настройку — показано, если скрытие было автоматическим.
 */
interface Spec {
  hidden: boolean;
  reason: "manual" | "auto" | null;
  manualStep: number;
  /** Шаг начала ночи для автосмены (auto-start) и для OBS (nightSince). */
  nightStartAuto: number;
  nightStartObs: number;
  sceneHide: { cssPre: boolean; manualStep: number } | null;
  peek: { reason: "manual" | "auto"; clearedBySettings: boolean } | null;
}

const all = (s: boolean[], v: boolean) => s.every((x) => x === v);
const bits = (s: boolean[]) => s.map(Number).join("");

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
    obs: r() < 0.5,
  };
  const cfg = { ...(scripted?.cfg ?? random) };
  if (scripted) steps = scripted.actions.length;
  obs.auto = cfg.obs;
  obs.safe = !cfg.obs || cfg.phase === "night";
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
  const log: string[] = [`seed=${seed} ${JSON.stringify(cfg)}`];
  const fail = (msg: string) => {
    throw new Error(`${msg}\n${log.join("\n")}`);
  };

  // ── автосцены OBS: сцена за фазой, nightShow через 3 с на ночной сцене ──
  let nightShowTimer: ReturnType<typeof setTimeout> | null = null;
  let nightSinceMs = Date.now();
  const scheduleNightShow = () => {
    if (nightShowTimer) clearTimeout(nightShowTimer);
    nightShowTimer = setTimeout(() => {
      nightShowTimer = null;
      if (obs.auto && obs.safe && phase === "night") {
        obs.listener?.("nightShow", { nightSince: nightSinceMs });
      }
    }, 3_000);
  };
  const obsPhase = (p: "day" | "night") => {
    if (!obs.auto) return;
    if (p === "day") {
      obsNightKnown = false;
      if (nightShowTimer) clearTimeout(nightShowTimer);
      nightShowTimer = null;
      obs.listener?.("beforeDayScene");
      obs.safe = false;
      obs.listener?.("gate");
    } else {
      nightSinceMs = Date.now();
      obs.safe = true;
      obs.listener?.("gate");
      scheduleNightShow();
    }
  };

  let step = 0;
  const spec: Spec = {
    hidden: false,
    reason: null,
    manualStep: -2,
    nightStartAuto: -1,
    nightStartObs: -1,
    sceneHide: null,
    peek: null,
  };
  const hideSpec = (reason: "manual" | "auto") => {
    if (reason === "manual" || !spec.hidden) spec.reason = reason;
    spec.hidden = true;
  };
  const showSpec = () => {
    spec.hidden = false;
    spec.reason = null;
  };
  const unsafeNow = () => obs.auto && !obs.safe;
  /** Ночь OBS «известна» (nightShow уже был с начала этой ночи). */
  let obsNightKnown = false;
  const autoShowDue = () =>
    obs.auto
      ? obsNightKnown && spec.manualStep < spec.nightStartObs
      : cfg.phaseSwitch && phase === "night" && spec.manualStep < spec.nightStartAuto;
  /** Сценовое правило после действия (самолечение, создание сценового скрытия). */
  const specSceneSync = () => {
    if (spec.peek || !unsafeNow()) return;
    if (spec.sceneHide) {
      if (spec.sceneHide.manualStep === spec.manualStep && !spec.hidden) hideSpec("auto");
      return;
    }
    spec.sceneHide = { cssPre: spec.hidden, manualStep: spec.manualStep };
    if (!spec.hidden) hideSpec("auto");
  };
  const specNightShow = () => {
    // OBS: ночная сцена подтверждена.
    obsNightKnown = true;
    const had = spec.sceneHide;
    spec.sceneHide = null;
    if (spec.manualStep < spec.nightStartObs) showSpec();
    else if (had && !had.cssPre && spec.hidden && spec.reason !== "manual") showSpec();
  };
  let obsNightShowPendingUnderPeek = false;

  // Включение: решение сайта «скрыто» принимается сразу; авто-скрытие прячет.
  autoStartFeature.enable(settings());
  await Promise.resolve();
  // Скрытие сайта принято как «ручное» по причине (настройки его не снимают),
  // но не как ручное действие этой ночи.
  if (!cfg.initialFlag) hideSpec("manual");
  if (cfg.autoHide) {
    hideSpec("auto");
    if (!all(snapshot(), false)) fail("авто-скрытие не спрятало роли сразу при включении");
  }
  if (cfg.phaseSwitch) {
    if (phase === "day") hideSpec("auto");
    else spec.nightStartAuto = 0;
  }
  if (obs.auto) {
    if (phase === "night") {
      spec.nightStartObs = 0;
      nightSinceMs = Date.now();
      scheduleNightShow();
    } else {
      obs.listener?.("gate");
      specSceneSync();
    }
  }

  let held = false;
  let blurred = false;
  let ptt = false;

  /** Settle: 12 с жизни, снимки, зеркало на каждом. */
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

  /** Сайт примет свой D сейчас? (точное совпадение множества клавиш). */
  const siteAcceptsD = (modified: boolean) => {
    if (modified !== cfg.useModifier) return false;
    const extra = site.downKeys().filter((k) => ![KC.ctrl, KC.meta, 68].includes(k));
    return extra.length === 0;
  };

  /** Выполнить действие, обновив эталон. */
  const perform = async (action: Simple, seat: number): Promise<void> => {
    switch (action) {
      case "wait":
        break;
      case "rerender":
        rerender(site, seat);
        break;
      case "hide":
      case "hideHeld":
        if (blurred) focusWindow(), (blurred = false), (ptt = false);
        if (!spec.peek) {
          spec.manualStep = step;
          if (spec.hidden) showSpec();
          else hideSpec("manual");
        }
        if (action === "hide") press(cfg.hideKey);
        else pressHeld(cfg.hideKey);
        break;
      case "siteD":
      case "ctrlD":
      case "ctrlDHeld": {
        if (blurred) focusWindow(), (blurred = false), (ptt = false);
        const modified = action !== "siteD";
        const accepted = !spec.peek && siteAcceptsD(modified);
        if (accepted) {
          spec.manualStep = step;
          // Сайт перевернул флаг — наш слой принимает его решение.
          if (site.roleDisplay) hideSpec("manual");
          else showSpec();
        }
        if (action === "siteD") press("KeyD");
        else if (action === "ctrlD") {
          down("KeyD", { ctrlKey: true });
          up("KeyD");
        } else pressHeld("KeyD", { ctrlKey: true });
        break;
      }
      case "Vdown":
        if (spec.hidden) spec.peek = { reason: spec.reason ?? "auto", clearedBySettings: false };
        down(cfg.peekKey);
        held = true;
        break;
      case "Vup":
      case "blur":
        if (action === "Vup") up(cfg.peekKey);
        else blurWindow(), (blurred = true);
        held = false;
        if (spec.peek) {
          const { reason, clearedBySettings } = spec.peek;
          spec.peek = null;
          const rehide = !(autoShowDue() && !unsafeNow());
          if (!rehide || clearedBySettings) showSpec();
          else {
            spec.hidden = true;
            spec.reason = reason;
          }
          triggers.add("release");
          specSceneSync();
          if (obsNightShowPendingUnderPeek) {
            obsNightShowPendingUnderPeek = false;
            if (obs.auto && obs.safe && phase === "night") specNightShow();
          }
        }
        break;
      case "Vtap":
        down(cfg.peekKey);
        await vi.advanceTimersByTimeAsync(40);
        up(cfg.peekKey);
        break;
      case "focus":
        focusWindow();
        blurred = false;
        ptt = false;
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
      case "night": {
        const changed = phase !== action;
        phase = action;
        setPhase(action);
        if (!changed) break;
        if (action === "night") triggers.add("night");
        if (action === "night") {
          if (cfg.phaseSwitch) spec.nightStartAuto = step;
          spec.nightStartObs = step;
        } else if (cfg.phaseSwitch && !spec.peek) hideSpec("auto");
        obsPhase(action);
        if (action === "day") specSceneSync();
        break;
      }
      case "sceneOff":
        if (!obs.auto || phase !== "night" || !obs.safe) break;
        obs.safe = false;
        if (nightShowTimer) clearTimeout(nightShowTimer);
        nightShowTimer = null;
        obs.listener?.("gate");
        specSceneSync();
        break;
      case "sceneOn":
        if (!obs.auto || phase !== "night" || obs.safe) break;
        triggers.add("sceneOn");
        obs.safe = true;
        obs.listener?.("gate");
        scheduleNightShow();
        break;
      case "autoHideOff":
      case "autoHideOn":
      case "phaseOff":
      case "phaseOn": {
        const wasHiding = cfg.autoHide || cfg.phaseSwitch;
        const wasPhase = cfg.phaseSwitch;
        if (action === "autoHideOff") cfg.autoHide = false;
        if (action === "autoHideOn") cfg.autoHide = true;
        if (action === "phaseOff") cfg.phaseSwitch = false;
        if (action === "phaseOn") cfg.phaseSwitch = true;
        autoStartFeature.update?.(settings());
        // Включили авто-скрытие посреди игры — решение игрока «прятать».
        if (action === "autoHideOn") {
          spec.manualStep = step;
          // CSS теперь держит и настройка — сценой не снимается (аудит №3, B04).
          if (spec.sceneHide) spec.sceneHide.cssPre = true;
        }
        if (action === "autoHideOn" && !spec.peek) hideSpec("auto");
        // Скрытие снова включили под V — на отпускании оно действует.
        if ((action === "autoHideOn" || action === "phaseOn") && spec.peek) {
          spec.peek.clearedBySettings = false;
        }
        if (action === "phaseOn" && !wasPhase) triggers.add("phaseOn");
        if (action === "phaseOn" && !wasPhase) {
          if (phase === "day") {
            if (!spec.peek) hideSpec("auto");
          } else spec.nightStartAuto = step;
        }
        if (wasHiding && !(cfg.autoHide || cfg.phaseSwitch)) {
          if (spec.sceneHide) {
            spec.sceneHide = {
              cssPre: false,
              manualStep: spec.hidden ? spec.manualStep : spec.sceneHide.manualStep,
            };
          } else if (spec.peek) {
            if (spec.peek.reason === "auto") spec.peek.clearedBySettings = true;
          } else if (spec.reason !== "manual") showSpec();
        }
        break;
      }
    }
  };

  /** Поводы отложенных эффектов, накопленные за шаг (в т.ч. внутри серии). */
  const triggers = new Set<"night" | "sceneOn" | "phaseOn" | "release">();
  /** Отложенные эффекты шага (за 12 с жизни): ночной показ, nightShow OBS. */
  const resolveDeferred = () => {
    const t = new Set(triggers);
    triggers.clear();
    const nightShowFired = obs.auto && obs.safe && phase === "night" && (t.has("night") || t.has("sceneOn"));
    if (nightShowFired) {
      if (spec.peek) {
        obsNightShowPendingUnderPeek = true;
        obsNightKnown = true;
      } else specNightShow();
    }
    // Ночной показ автосмены (без автосцен) — РАЗОВОЕ событие: начало ночи,
    // включение автосмены ночью, перевзвод на отпускании V.
    const trigger = t.has("night") || t.has("phaseOn") || t.has("release");
    if (!obs.auto && trigger && autoShowDue() && !spec.peek) showSpec();
  };

  const pickSimple = (pool: Simple[]) => pool[Math.floor(r() * pool.length)];

  try {
    await settle([]);
    // Ночь при включении: показ (автосмена или автосцены) уже отработал.
    if (phase === "night" && !obs.auto && autoShowDue()) showSpec();
    if (phase === "night" && obs.auto && obs.safe) specNightShow();
    const post0 = snapshot();
    if (!all(post0, !spec.hidden)) {
      fail(`исходное состояние не по замыслу: ${bits(post0)}, ждали ${Number(!spec.hidden)}`);
    }

    for (let i = 0; i < steps; i++) {
      step = i + 1;
      const pre = snapshot();
      const options: Simple[] = ["wait", "rerender", "hide", "day", "night", "hideHeld"];
      if (held) options.push("Vup", "Vup", "blur");
      else if (!blurred) options.push("Vdown", "Vdown", "Vtap");
      if (blurred) options.push("focus", "focus", "focus");
      if (!blurred) options.push(ptt ? "pttUp" : "pttDown");
      if (obs.auto && phase === "night") options.push(obs.safe ? "sceneOff" : "sceneOn");
      if (!(held && cfg.peekKey === "KeyD")) options.push("ctrlD", "ctrlDHeld");
      if (cfg.hideKey !== "KeyD" && cfg.peekKey !== "KeyD") options.push("siteD");
      options.push(cfg.autoHide ? "autoHideOff" : "autoHideOn", cfg.phaseSwitch ? "phaseOff" : "phaseOn");
      let action: Action;
      if (scripted) action = scripted.actions[i];
      else if (!held && !blurred && r() < 0.15) {
        const pool: Simple[] = ["Vdown", "Vup", "pttDown", "pttUp", "rerender", "wait", "hide", "day", "night", "ctrlD"];
        if (obs.auto) pool.push("sceneOff", "sceneOn");
        const n = 2 + Math.floor(r() * 3);
        action = { burst: Array.from({ length: n }, () => pickSimple(pool)), gap: Math.floor(r() * 300) };
      } else action = pickSimple(options);
      const seat = Math.floor(r() * 3);
      const label = typeof action === "string" ? action : `burst[${action.burst.join(",")}]@${action.gap}`;
      log.push(`#${step} ${label}${label === "rerender" ? `(${seat})` : ""} pre=${bits(pre)}`);
      const trace: boolean[][] = [];
      const videoBefore = site.videoToggles;

      if (typeof action !== "string") {
        for (const sub of action.burst) {
          if (sub === "Vdown" && held) continue;
          if (sub === "Vup" && !held) continue;
          if (sub === "pttDown" && ptt) continue;
          if (sub === "pttUp" && !ptt) continue;
          // D уже зажат как «подсмотреть» — второй раз его не нажать.
          if (sub === "ctrlD" && held && cfg.peekKey === "KeyD") continue;
          await perform(sub, seat);
          await vi.advanceTimersByTimeAsync(action.gap);
          const snap = snapshot();
          if (!all(snap, snap[0])) fail(`зеркало внутри серии: ${bits(snap)}`);
        }
        if (held) await perform("Vup", seat);
        if (ptt) await perform("pttUp", seat);
        await settle(trace);
        resolveDeferred();
      } else {
        await perform(action, seat);
        await settle(trace);
        resolveDeferred();
        // Мигание: каждая роль меняется за шаг не больше одного раза.
        for (let k = 0; k < pre.length; k++) {
          let flips = trace[0][k] !== pre[k] ? 1 : 0;
          for (let t = 1; t < trace.length; t++) if (trace[t][k] !== trace[t - 1][k]) flips++;
          if (flips > 1) fail(`мигание роли ${k} за шаг «${action}»`);
        }
        if ((action === "Vdown" || action === "Vtap") && !all(pre, true) && site.videoToggles > videoBefore) {
          fail("V дошла до сайта при включившемся «подсмотреть»");
        }
      }
      const post = snapshot();
      log[log.length - 1] += ` post=${bits(post)} spec=${Number(!spec.hidden)}${spec.peek ? "(V)" : ""} flag=${site.roleDisplay}`;
      // Под V — только зеркало (проверено на снимках); итог — на отпускании.
      if (spec.peek) continue;
      if (!all(post, !spec.hidden)) {
        fail(`итог не по замыслу после «${label}»: видно ${bits(post)}, ждали ${Number(!spec.hidden)}`);
      }
    }
  } finally {
    if (nightShowTimer) clearTimeout(nightShowTimer);
    focusWindow();
    autoStartFeature.disable();
    site.dispose();
  }
}

beforeEach(() => {
  obs.auto = false;
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
    `${SEEDS} сценариев × 25 шагов — итог всегда по замыслу`,
    async () => {
      for (let seed = 1; seed <= SEEDS; seed++) await runScenario(seed * 7919, 25);
    },
    600_000,
  );
});

/**
 * Последовательности, найденные случайным прогоном и тремя аудитами
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
    obs: false,
  };
  const siteHidden: Partial<RunConfig> = {
    autoHide: false,
    phaseSwitch: false,
    initialFlag: false,
    phase: "day",
  };
  const obsOnly: Partial<RunConfig> = { obs: true, autoHide: false, phaseSwitch: false };
  const cases: Array<[string, Partial<RunConfig>, Action[]]> = [
    ["ночь: спрятал D → V → отпустил — роли не появляются сами", {}, ["hide", "Vdown", "Vup", "wait"]],
    ["скрыто сайтом: alt-tab с зажатой V — роли спрятаны", siteHidden, ["Vdown", "blur", "wait", "focus"]],
    [
      "скрыто сайтом: push-to-talk зажат при отпускании V — роли спрятаны",
      siteHidden,
      ["Vdown", "pttDown", "Vup", "Vdown", "pttUp", "Vup"],
    ],
    ["хоткеи с модификатором: D и V работают", { ...siteHidden, useModifier: true }, ["hide", "hide", "Vdown", "Vup"]],
    ["зажатый D (автоповтор) — один переворот", { phase: "day" }, ["hideHeld", "hideHeld", "wait"]],
    ["касание V — всё как было", { phase: "day" }, ["Vtap", "hide", "Vtap", "wait"]],
    ["день: перерисовки ничего не меняют сами", { phase: "day" }, ["rerender", "wait"]],
    [
      "аудит-1 B01: V → PTT → отпустил → V снова через 50 мс — роли скрыты",
      siteHidden,
      [{ burst: ["Vdown", "pttDown", "Vup", "Vdown", "pttUp", "Vup"], gap: 50 }, "wait"],
    ],
    [
      "аудит-1 B02: подсматривание на D (скрытие на G) — после отпускания скрыто",
      { ...siteHidden, hideKey: "KeyG", peekKey: "KeyD" },
      ["Vdown", "Vup", "wait"],
    ],
    [
      "аудит-1 B03: скрытие на G, ночью спрятал исходным D сайта — V его не переигрывает",
      { hideKey: "KeyG" },
      ["siteD", "Vdown", "Vup", "wait"],
    ],
    [
      "аудит-1 B04: зажатый Ctrl+D при опции модификатора — один переворот",
      { ...siteHidden, initialFlag: true, useModifier: true },
      ["ctrlDHeld", "wait"],
    ],
    ["аудит-1 B08: днём выключили авто-скрытие при автосмене — скрытие остаётся", { phase: "day" }, ["autoHideOff", "wait"]],
    [
      "аудит-1 H05: авто-скрытие вкл → V → выкл → отпустил — выключенное не возвращается",
      { ...siteHidden, initialFlag: true },
      ["autoHideOn", "Vdown", "autoHideOff", "Vup", "wait"],
    ],
    [
      "аудит-1 H03: выключили автосмену до ночного показа, включили в ту же ночь — показ",
      { autoHide: false, phase: "day" },
      [{ burst: ["night", "phaseOff"], gap: 1_500 }, "phaseOn", "wait"],
    ],
    // ─── автосцены OBS ───
    ["одни автосцены: день — скрыто, ночь — видно всё (решение владельца, H04)", obsOnly, ["day", "night"]],
    ["автосцены + авто-скрытие: ночь на ночной сцене — видно всё (аудит-2 H04)", { ...obsOnly, autoHide: true }, ["night", "wait"]],
    ["автосцены: уход с ночной сцены — скрыто всё; возврат — видно всё", { obs: true, phaseSwitch: false }, ["sceneOff", "wait", "sceneOn"]],
    [
      "автосцены: ночью спрятал D, ушёл и вернулся на ночную сцену — остаётся скрыто",
      { obs: true },
      ["hide", "sceneOff", "sceneOn", "wait"],
    ],
    [
      "автосцены: показал-спрятал D после ухода сцены — возврат не открывает",
      { obs: true },
      ["sceneOff", "hide", "hide", "sceneOn", "wait"],
    ],
    [
      "автосцены: ночная сцена вернулась под V — после отпускания всё видно",
      { obs: true, autoHide: false },
      ["sceneOff", "Vdown", "sceneOn", "wait", "Vup"],
    ],
    [
      "под V выключили и снова включили авто-скрытие, ночной показ отработал — отпускание прячет",
      { autoHide: true, phaseSwitch: false, phase: "night" },
      ["Vdown", "autoHideOff", "autoHideOn", "phaseOn", "phaseOff", "Vup"],
    ],
    [
      "день и ночь под V за 0,6 с, отпустил — ночной показ новой ночи",
      { useModifier: true, autoHide: false, phaseSwitch: true, initialFlag: true, phase: "night" },
      ["autoHideOn", "wait", { burst: ["Vdown", "day", "night"], gap: 288 }, "wait"],
    ],
    // ─── второй внешний аудит ───
    [
      "аудит-2 B02: Ctrl-повтор удерживаемой V не мешает D скрыть",
      { ...siteHidden, useModifier: true },
      ["Vdown", "ctrlDHeld", "Vup", "Vtap", "hide", "hide", "wait"],
    ],
    [
      "аудит-2 H01–H03: V вернул скрытие → Ctrl+D сайта через 100 мс показал — держится",
      { ...siteHidden, useModifier: true },
      [{ burst: ["Vdown", "Vup", "ctrlD"], gap: 100 }, "wait"],
    ],
    [
      "аудит-2 H02: V → V через 50 мс → Ctrl+D показал — не остаётся вечного CSS",
      { ...siteHidden, useModifier: true },
      [{ burst: ["Vdown", "Vup", "Vdown", "Vup"], gap: 50 }, "ctrlD", "wait"],
    ],
  ];
  test.each(cases)("%s", async (_name, over, actions) => {
    await runScenario(1, 0, { cfg: { ...base, ...over }, actions });
  });
});

test("выключение фичи с зажатой V — роли ведёт снова сайт", async () => {
  vi.setSystemTime(new Date(1_900_000_000_000));
  const site = installSite(false, false);
  buildTable(site);
  setPhase("day");
  autoStartFeature.enable({
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "скрыто (решение сайта принято)").toEqual([false, false, false]);
  down("KeyV");
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot()).toEqual([true, true, true]);
  autoStartFeature.disable();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "без нашего слоя — флаг сайта («скрыто»)").toEqual([false, false, false]);
  up("KeyV");
  focusWindow();
  site.dispose();
});

test("зритель без своей роли: V показывает скрытые сайтом роли и возвращает", async () => {
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

test("сайт сам скрыл роли (зритель при подключении) — скрыто и у нас, до кадра", async () => {
  vi.setSystemTime(new Date(1_960_000_000_000));
  const site = installSite(true, false);
  buildTable(site);
  setPhase("day");
  autoStartFeature.enable({
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot()).toEqual([true, true, true]);
  // on_connect_room: canSeeRolesAsViewer — сайт переворачивает флаг без игрока.
  site.roleDisplay = false;
  for (const el of document.querySelectorAll<HTMLElement>(".player__role")) el.style.display = "none";
  await Promise.resolve(); // микрозадача MutationObserver — до кадра
  expect(snapshot(), "нейтрализатор не показал программное скрытие сайта").toEqual([false, false, false]);
  autoStartFeature.disable();
  site.dispose();
});

test("H01: V вернул скрытие → D через 100 мс показал — показ держится", async () => {
  vi.setSystemTime(new Date(1_970_000_000_000));
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
  expect(snapshot(), "ручной показ держится").toEqual([true, true, true]);
  autoStartFeature.disable();
  site.dispose();
});

test("сайт сам переворачивает флаг на «показано» без игрока — роли остаются скрыты", async () => {
  vi.setSystemTime(new Date(1_980_000_000_000));
  const site = installSite(true, false);
  buildTable(site);
  setPhase("day");
  autoStartFeature.enable({
    settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false },
  } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  press("KeyD"); // игрок прячет роли нашим D
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot()).toEqual([false, false, false]);
  // Программный переворот (зритель при реконнекте): скрыто → показано → скрыто → показано.
  for (const flag of [false, true]) {
    site.roleDisplay = flag;
    for (const el of document.querySelectorAll<HTMLElement>(".player__role")) el.style.display = flag ? "" : "none";
    await Promise.resolve();
  }
  await vi.advanceTimersByTimeAsync(2_000);
  expect(snapshot(), "показ сайта без действия игрока не принимается").toEqual([false, false, false]);
  autoStartFeature.disable();
  site.dispose();
});
