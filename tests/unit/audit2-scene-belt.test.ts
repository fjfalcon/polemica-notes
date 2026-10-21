// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы второго внешнего аудита видимости ролей (docs/audit-role-stream-2-2026-10-21.md),
// перенесены как регрессионные после перехода на «одну власть» (21.10.2026).
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(m: any) => void>, scene: "night", persisted: false,
  dom: [] as Array<(m: any[]) => void>,
}));
vi.mock("@core/dom", () => ({ onDomChangeImmediate: (fn: any) => { const mo = new MutationObserver(fn); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] }); return () => mo.disconnect(); },  onDomChange: (fn: (m: any[]) => void) => {
  seam.dom.push(fn); return () => { seam.dom = seam.dom.filter(x => x !== fn); };
}, safeClick: () => true, isVisible: () => true }));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async () => seam.persisted ? { obs_auto_scene_state: { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() } } : {},
    set: async () => {}, remove: async () => {},
  }, sync: { set: async () => {} } },
  runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (m: any) => void) => { seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); }; },
  sendRuntime: async (msg: any) => {
    if (msg.command === "get_status") return { success: true, data: { connected: true, sessionId: "s", currentScene: seam.scene, scenes: [] } };
    if (msg.command === "set_scene") setTimeout(() => scene(msg.data.sceneName), 200);
    return { success: true };
  }, broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
import { autoStartFeature } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";

const settings = {
  obs_enabled: false, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
};
const ctx = (over: Partial<typeof settings> = {}) => ({ settings: { ...settings, ...over } }) as never;
const keyCode = (c: string) => c === "Backquote" ? 192 : c === "ControlLeft" ? 17 : c.charCodeAt(3);
const down = (c: string, init: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { code: c, keyCode: keyCode(c), key: c.slice(3).toLowerCase(), bubbles: true, cancelable: true, ...init }));
const up = (c: string) => document.dispatchEvent(new KeyboardEvent("keyup", { code: c, keyCode: keyCode(c), bubbles: true }));
const press = (c: string, init: KeyboardEventInit = {}) => { down(c, init); up(c); };
const scene = (s: string) => { seam.scene = s; seam.messages.forEach(fn => fn({ type: "obs_event", eventType: "obs_scene_changed", data: s })); };
const phase = (s: "day" | "night") => { document.querySelector(".substage.current")!.textContent = s === "night" ? "Ночь | ход мафии" : "День | речь игрока"; };
const roles = () => [...document.querySelectorAll<HTMLElement>(".player__role")];
const visible = () => roles().map(el => {
  const css = getComputedStyle(el);
  return css.display !== "none" && css.visibility !== "hidden" && css.opacity !== "0";
});
const cssHide = () => !!document.getElementById("polemica-role-hide");
let cleanupSite = () => {};
function installSite(initial: boolean, modifier = false) {
  const site = { flag: initial, toggles: 0 };
  let downKeys = new Set<number>();
  let queued = false;
  const flush = () => { queued = false; roles().forEach(el => el.style.display = site.flag ? "" : "none"); };
  const onDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    downKeys.add(e.keyCode);
    if (e.ctrlKey) downKeys.add(17); else downKeys.delete(17);
    const want = modifier ? [17, 68] : [68];
    if (want.length === downKeys.size && want.every(k => downKeys.has(k))) {
      e.preventDefault(); // как обёртка хоткеев сайта
      site.flag = !site.flag; site.toggles++;
      if (!queued) { queued = true; queueMicrotask(flush); }
    }
  };
  const onUp = (e: KeyboardEvent) => { downKeys.delete(e.keyCode); if (!e.ctrlKey) downKeys.delete(17); };
  const focus = () => { downKeys = new Set(); };
  document.addEventListener("keydown", onDown); document.addEventListener("keyup", onUp); window.addEventListener("focus", focus);
  cleanupSite = () => { document.removeEventListener("keydown", onDown); document.removeEventListener("keyup", onUp); window.removeEventListener("focus", focus); };
  flush();
  return site;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  document.body.className = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 20, height: 20 } as DOMRect);
  seam.scene = "night"; seam.persisted = false;
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest(); cleanupSite();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.head.innerHTML = "";
});

test.each([1, 50, 100, 149])("PROBE H-A: Ctrl+D at +%dms after V-up must not leave belt permanently hiding roles", async (gap) => {
  const site = installSite(false, true);
  autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV");
  await vi.advanceTimersByTimeAsync(gap);
  press("KeyD", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(12_000);
  
  expect(visible(), `native=${site.flag}; CSS=${cssHide()}`).toEqual([true, true]);
});

test.each([1, 50, 100, 149])("PROBE H-B: repeated V at +%dms must not promote transient belt into persistent CSS", async (gap) => {
  const site = installSite(false, true);
  autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV");
  await vi.advanceTimersByTimeAsync(gap);
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV");
  await vi.advanceTimersByTimeAsync(1_000);
  
  press("KeyD", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(12_000);
  
  expect(visible(), `CSS=${cssHide()}`).toEqual([true, true]);
});

test("CONTROL: ordinary D at +100ms cancels restore and removes belt", async () => {
  const site = installSite(false);
  autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(100);
  press("KeyD"); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([true, true]);
});

test.each([false, true])("PROBE B-C: native-hide acknowledgement must not drop scene protection of reveal notice (phase=%s)", async (phaseSwitch) => {
  const site = installSite(true);
  seam.persisted = true;
  const opts = ctx({ obs_enabled: true, role_phase_auto_switch_enabled: phaseSwitch });
  autoStartFeature.enable(opts); await obsPanelFeature.enable(opts);
  await vi.advanceTimersByTimeAsync(6_000);
  press("KeyD"); await vi.advanceTimersByTimeAsync(40);
  
  down("KeyV"); await vi.advanceTimersByTimeAsync(40);
  scene("day"); await vi.advanceTimersByTimeAsync(40);
  up("KeyV");
  expect(cssHide(), "scene is unsafe: CSS exists immediately after V-up").toBe(true);
  await vi.advanceTimersByTimeAsync(200);
  const notice = document.createElement("div");
  notice.className = "notification-element roleReveal";
  notice.textContent = "Игрок является мафией";
  const wrapper = document.createElement("div"); wrapper.className = "notifications-block player__notifications-block";
  wrapper.append(notice); document.querySelectorAll(".player")[1].append(wrapper);
  // Deliver the actual observer batch for the fresh notification: neither
  // production subscriber should be assumed asleep just because DOM is mocked.
  seam.dom.forEach(fn => fn([{ type: "childList", target: wrapper.parentElement, addedNodes: [wrapper], removedNodes: [] }]));
  
  const trace = [getComputedStyle(notice).visibility];
  await vi.advanceTimersByTimeAsync(1_600); trace.push(getComputedStyle(notice).visibility);
  await vi.advanceTimersByTimeAsync(100); trace.push(getComputedStyle(notice).visibility);
  expect(trace, "scene=day; reveal at V-up +200/+1800/+1900ms (last sample after scene heal)").toEqual(["hidden", "hidden", "hidden"]);
});

test.each([150, 151, 300, 600])("CONTROL: after belt acknowledgement (+%dms), native Ctrl+D shows normally", async gap => {
  const site = installSite(false, true); autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(gap);
  press("KeyD", { ctrlKey: true }); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([true, true]);
});

test("PROBE H-E: menu Show roles during native restore must cancel delayed re-hide", async () => {
  const site = installSite(false);
  autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(100);
  const menu = document.createElement("button"); menu.textContent = "Показать роли"; document.body.append(menu);
  // Same native toggle as the site's menu handler, not the extension's D route.
  menu.addEventListener("click", () => {
    // Native menu commits updateRoleDisplay; model via a direct independent flag flip.
    site.flag = !site.flag;
    queueMicrotask(() => roles().forEach(el => el.style.display = site.flag ? "" : "none"));
  });
  menu.click(); await vi.advanceTimersByTimeAsync(12_000);
  
  expect(visible()).toEqual([true, true]);
});

test("PROBE H-A-remap: original site D after remapping our hide key also strands belt", async () => {
  const site = installSite(false); autoStartFeature.enable(ctx({ hotkey_role_hide: "KeyG" }));
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(100);
  press("KeyD"); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([true, true]);
});

test.each([150, 300, 600])("CONTROL: repeated V at +%dms after completed native restore does not strand CSS", async gap => {
  const site = installSite(false, true); autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(gap);
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(1_000);
  press("KeyD", { ctrlKey: true }); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([true, true]);
});

test.each([1, 50, 100, 149, 150, 300, 450, 600])("CONTROL: manual plain D at +%dms during blocked restore wins without later re-hide", async gap => {
  const site = installSite(false); autoStartFeature.enable(ctx());
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); down("Backquote"); up("KeyV"); await vi.advanceTimersByTimeAsync(gap);
  press("KeyD"); up("Backquote"); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([true, true]);
});

test.each([false, true])("CONTROL: disabling last setting during V returns only original native hide=%s", async nativeHidden => {
  const site = installSite(!nativeHidden); autoStartFeature.enable(ctx({ auto_hide_roles_enabled: true }));
  down("KeyV"); await vi.advanceTimersByTimeAsync(40);
  autoStartFeature.update!(ctx());
  await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([!nativeHidden, !nativeHidden]);
});

test("CONTROL: manual hide this night cancels pending auto-show even after 600ms repeated peek", async () => {
  const site = installSite(true); autoStartFeature.enable(ctx({ role_phase_auto_switch_enabled: true }));
  await vi.advanceTimersByTimeAsync(2_000);
  press("KeyD"); await vi.advanceTimersByTimeAsync(40);
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(600);
  down("KeyV"); await vi.advanceTimersByTimeAsync(40); up("KeyV"); await vi.advanceTimersByTimeAsync(12_000);
   expect(visible()).toEqual([false, false]);
});
