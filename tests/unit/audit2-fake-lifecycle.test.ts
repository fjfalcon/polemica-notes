// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы второго внешнего аудита видимости ролей (docs/audit-role-stream-2-2026-10-21.md),
// перенесены как регрессионные после перехода на «одну власть» (21.10.2026).
// Independent audit2 probes. Production modules (including DOM observer,
// keyboard, faker, auto-start, role-pin and OBS panel) are real.
import { beforeEach, afterEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: unknown) => void>,
  scene: "night",
  persisted: false,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async () => seam.persisted ? { obs_auto_scene_state: {
      sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now(),
    } } : {},
    set: async () => {}, remove: async () => {},
  }, sync: { set: async () => {} } },
  runtime: { id: "audit2", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (msg: unknown) => void) => {
    seam.messages.push(fn);
    return () => { seam.messages = seam.messages.filter((x) => x !== fn); };
  },
  sendRuntime: async (msg: { command: string; data?: { sceneName: string } }) => {
    if (msg.command === "get_status") return { success: true, data: {
      connected: true, sessionId: "s", currentScene: seam.scene, scenes: [],
    } };
    if (msg.command === "set_scene") {
      seam.scene = msg.data!.sceneName;
      queueMicrotask(() => obsEvent("obs_scene_changed", seam.scene));
    }
    return { success: true };
  },
  broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn(),
}));

import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { pinOwnRole, sweepOrphanPins, releasePins, liftPins, restoreLiftedPins } from "@content/role-pin";
import { onDomChange } from "@core/dom";

const settings = {
  obs_enabled: true, obs_auto_mode_enabled: true,
  obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false,
  enable_role_faker: true,
};
const ctx = (patch: Partial<typeof settings> = {}) => ({ settings: { ...settings, ...patch } }) as never;
const own = () => document.querySelector<HTMLElement>(".my-role")!;
const peer = () => document.querySelector<HTMLElement>(".peer")!;
const use = () => own().querySelector("use")!;
const tip = () => own().querySelector<HTMLElement>(".tooltip .content span")!;
const vis = (el: Element) => getComputedStyle(el).visibility;
const href = () => use().getAttribute("href");
function key(code: string, type = "keydown") {
  document.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(),
    bubbles: true, cancelable: true }));
}
function obsEvent(eventType: string, data: unknown) {
  seam.messages.forEach((fn) => fn({ type: "obs_event", eventType, data }));
}
function siteToggle(e: KeyboardEvent) {
  if (e.code !== "KeyD" || e.ctrlKey) return;
  const hide = own().style.display !== "none";
  queueMicrotask(() => document.querySelectorAll<HTMLElement>(".player__role")
    .forEach((el) => { el.style.display = hide ? "none" : ""; }));
}
async function tick(ms: number) { await vi.advanceTimersByTimeAsync(ms); }

let clockEpoch = 0;
beforeEach(() => {
  vi.useFakeTimers();
  // SharedDomObserver deliberately retains lastFlushAt across unsubscribe;
  // do not run a new test's performance clock backwards underneath it.
  vi.advanceTimersByTime(++clockEpoch * 100_000);
  vi.setSystemTime(1_800_000_000_000);
  seam.scene = "night";
  seam.persisted = true;
  document.body.innerHTML = `
    <div class="player my-player"><span class="player__role role my-role">
      <svg><use href="/sprite.svg#sheriff"></use></svg>
      <div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div>
    </span></div>
    <div class="player"><span class="player__role role peer"><svg><use href="/sprite.svg#mafia"></use></svg></span></div>
    <div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>`;
  document.addEventListener("keydown", siteToggle);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 20, height: 20, top: 0, left: 0, right: 20, bottom: 20, x: 0, y: 0, toJSON() {},
  });
});
afterEach(() => {
  document.removeEventListener("keydown", siteToggle);
  autoStartFeature.disable();
  roleFakerFeature.disable();
  obsPanelFeature.disable();
  releasePins();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-pn-role-faked");
});

test("control: live hidden/visible pins survive both feature-enable orphan sweeps", async () => {
  pinOwnRole("hidden");
  autoStartFeature.enable(ctx());
  expect(own().style.visibility).toBe("hidden");
  expect(document.documentElement.hasAttribute("data-pn-own-role-hidden")).toBe(true);
  sweepOrphanPins();
  expect(own().style.visibility).toBe("hidden");
  liftPins();
  sweepOrphanPins();
  restoreLiftedPins();
  expect(own().style.visibility).toBe("hidden");
  pinOwnRole("visible");
  await obsPanelFeature.enable(ctx({ obs_auto_mode_enabled: false }));
  // OBS intentionally releases pins on its disabled auto-mode startup;
  // the orphan sweep itself must not strip a currently owned marker.
  pinOwnRole("visible");
  sweepOrphanPins();
  expect(own().style.visibility).toBe("visible");
});

test("control: F + own root replacement + visible OBS pin remains fake after healing", async () => {
  autoStartFeature.enable(ctx());
  roleFakerFeature.enable(ctx());
  await obsPanelFeature.enable(ctx());
  await tick(6000);
  key("KeyF");
  const fresh = own().cloneNode(true) as HTMLElement;
  fresh.removeAttribute("style");
  fresh.removeAttribute("data-pn-role-pin");
  fresh.removeAttribute("data-original-role");
  fresh.removeAttribute("data-original-role-name");
  fresh.removeAttribute("data-original-sprite-base");
  fresh.querySelector("use")!.setAttribute("href", "/sprite.svg#sheriff");
  own().replaceWith(fresh);
  expect(vis(fresh)).toBe("hidden");
  await tick(5000);
  expect(href()).toContain("#godfather");
  expect(vis(peer())).toBe("hidden");
  key("KeyE");
  expect(href()).toContain("#sheriff");
});

test("HIGH: new true role patched under live F must be the role restored by E", async () => {
  roleFakerFeature.enable(ctx());
  key("KeyF");
  await tick(600);
  // Actual site's RoomIcon patches namespaced xlink, while the role span
  // vnode retains constant key=5 when old and new role are both truthy.
  use().setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/sprite.svg#mafia");
  tip().textContent = "Ваша роль - Мафия";
  own().classList.add("mafia");
  await tick(600);
  expect(href()).toContain("#godfather");
  key("KeyE");
  await tick(5000);
  expect(href(), "E restores the currently assigned role, not the old sheriff snapshot").toBe("/sprite.svg#mafia");
  expect(tip().textContent).toBe("Ваша роль - Мафия");
});

test("BLOCKER candidate: fake root shield must also cover real tooltip patched by Vue before observer flush", async () => {
  // Live style.css: .player__role .tooltip[data-v-79273408]{display:none}
  // and .player__role:hover .tooltip[data-v-79273408]{display:block}.
  // jsdom has no pointer hover, so a test class substitutes only :hover.
  const hoverCss = document.createElement("style");
  hoverCss.textContent = ".player__role .tooltip{display:none}.player__role.audit2-hover .tooltip{display:block}";
  document.head.appendChild(hoverCss);
  own().classList.add("audit2-hover");
  roleFakerFeature.enable(ctx());
  key("KeyF");
  // Let the actual observer flush F's own mutations, then patch the role
  // just after a flush: its 250ms throttle provides a real >=frame window.
  await tick(600);
  let flushed = false;
  const off = onDomChange(() => { flushed = true; });
  own().classList.add("audit2-before-flush");
  for (let i = 0; i < 300 && !flushed; i++) await tick(1);
  off();
  expect(flushed, "actual observer flush boundary reached").toBe(true);
  const text = tip();
  use().setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/sprite.svg#mafia");
  text.textContent = "Ваша роль - Мафия";
  own().classList.add("mafia");
  await tick(50);
  expect(getComputedStyle(own().querySelector(".tooltip")!).display).toBe("block");
  const leaked = text.textContent === "Ваша роль - Мафия" && vis(text) !== "hidden";
  await tick(600);
  expect(text.textContent, "the later real observer does repair the tooltip").toBe("Ваша роль - Дон");
  expect(leaked, "while hovering, real role tooltip is not guarded by use:not([href$=fake])").toBe(false);
});

test("control: enabling auto-start while F is live keeps fake shield; pin-visible does not reveal notice", async () => {
  roleFakerFeature.enable(ctx());
  key("KeyF");
  pinOwnRole("visible");
  autoStartFeature.enable(ctx());
  expect(isRoleFaked()).toBe(true);
  expect(document.documentElement.hasAttribute("data-pn-role-faked")).toBe(true);
  expect(href()).toContain("#godfather");
  const notice = document.createElement("div");
  notice.className = "notifications-block";
  notice.innerHTML = '<div class="roleReveal">Игрок является мафией</div>';
  own().parentElement!.appendChild(notice);
  expect(vis(notice.firstElementChild!)).toBe("hidden");
  await tick(600);
  expect(vis(peer())).toBe("hidden");
});

test("control: orphan fake cleanup leaves a currently-owned hidden pin and its shield intact", () => {
  own().setAttribute("data-original-role", "sheriff");
  own().setAttribute("data-original-sprite-base", "/sprite.svg");
  use().setAttribute("href", "/sprite.svg#godfather");
  peer().style.setProperty("visibility", "hidden", "important");
  peer().setAttribute("data-pn-fake-hidden", "");
  pinOwnRole("hidden");
  roleFakerFeature.enable(ctx());
  expect(href()).toBe("/sprite.svg#sheriff");
  expect(own().style.visibility).toBe("hidden");
  expect(own().getAttribute("data-pn-role-pin")).toBe("hidden");
  expect(document.documentElement.hasAttribute("data-pn-own-role-hidden")).toBe(true);
  expect(peer().style.visibility).toBe("");
});

test("control: F+V; disable autoscenes + phase-hide while held; E and release converge", async () => {
  const initial = { auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: true };
  autoStartFeature.enable(ctx(initial));
  roleFakerFeature.enable(ctx(initial));
  await obsPanelFeature.enable(ctx(initial));
  await tick(6000);
  obsEvent("obs_scene_changed", "day");
  key("KeyF");
  key("KeyV");
  expect(isPeeking()).toBe(true);
  expect(isRoleFaked()).toBe(true);
  obsPanelFeature.update!(ctx({ ...initial, obs_auto_mode_enabled: false }));
  autoStartFeature.update!(ctx({ obs_auto_mode_enabled: false }));
  roleFakerFeature.disable();
  key("KeyV", "keyup");
  await tick(5000);
  expect(href()).toContain("#sheriff");
  expect(isRoleFaked()).toBe(false);
  expect(isPeeking()).toBe(false);
  expect(vis(own())).toBe(vis(peer()));
});

test("control: native hidden remains native hidden across F/E and individual faker disable", async () => {
  own().style.display = "none";
  peer().style.display = "none";
  roleFakerFeature.enable(ctx());
  key("KeyF");
  key("KeyE");
  key("KeyF");
  roleFakerFeature.disable();
  await tick(600);
  expect(own().style.display).toBe("none");
  expect(peer().style.display).toBe("none");
  expect(href()).toContain("#sheriff");
});

