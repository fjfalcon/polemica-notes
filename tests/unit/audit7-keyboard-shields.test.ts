// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/7" }
// Independent controls; actual router, observer, pin, faker and auto-start.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit7-shields" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@core/messaging", () => ({ sendRuntime: async () => ({ success: true }), onMessage: () => () => {} }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { releasePins, pinOwnRole, pinHolds, liftPins, restoreLiftedPins, sweepOrphanPins } from "@content/role-pin";

const cfg = (patch = {}) => ({ settings: { auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true, auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyH", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE", ...patch } }) as never;
const wait = (ms = 16) => vi.advanceTimersByTimeAsync(ms);
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}, target: EventTarget = document) { target.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), keyCode: code.charCodeAt(3), which: code.charCodeAt(3), bubbles: true, cancelable: true, ...extra })); }
function tap(code: string) { key(code); key(code, "keyup"); }
const own = () => document.querySelector<HTMLElement>(".my-role")!;
const peer = () => document.querySelector<HTMLElement>(".peer")!;
const visible = (el: Element) => { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
const href = () => own().querySelector("use")!.getAttribute("href");
let epoch = 0;
function freshOwn(role = "civilian") {
  const el = document.createElement("span"); el.className = "player__role role my-role";
  el.innerHTML = `<svg><use href="#${role}"></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - Мирный</span></div></div>`;
  own().replaceWith(el); return el;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.advanceTimersByTime(++epoch * 100000); vi.setSystemTime(1_990_000_000_000); document.head.replaceChildren();
  document.body.innerHTML = '<div class="stage"><div class="substage current">Речь игрока</div></div><div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div></span></div><div class="player"><span class="player__role role peer"><svg><use href="#mafia"></use></svg></span></div>';
});
afterEach(async () => { window.dispatchEvent(new Event("blur")); roleFakerFeature.disable(); autoStartFeature.disable(); releasePins(); await Promise.resolve(); vi.clearAllTimers(); vi.useRealTimers(); document.head.replaceChildren(); document.body.replaceChildren(); });

test.each([0, 16, 500])("fake own remount shield + E restores current true role with reconcile gap=%d", async gap => {
  autoStartFeature.enable(cfg({ auto_hide_roles_enabled: false })); roleFakerFeature.enable(cfg()); tap("KeyF");
  expect(href()).toContain("#godfather"); const fresh = freshOwn();
  expect(visible(fresh), "synchronous before observer, not sampled after repair").toBe(false);
  await wait(gap); tap("KeyE");
  expect(isRoleFaked()).toBe(false); expect(href()).toBe("#civilian"); expect(visible(own())).toBe(true); expect(visible(peer())).toBe(true);
});

test("fake new-use and tooltip shield applies before regular observer repairs", async () => {
  autoStartFeature.enable(cfg({ auto_hide_roles_enabled: false })); roleFakerFeature.enable(cfg()); tap("KeyF");
  own().querySelector("svg")!.innerHTML = '<use href="#civilian"></use>';
  own().querySelector(".content span")!.textContent = "Ваша роль - Мирный";
  expect(getComputedStyle(own().querySelector("use")!).visibility).toBe("hidden");
  expect(getComputedStyle(own().querySelector(".content span")!).visibility).toBe("hidden");
  await wait(500); expect(href()).toBe("#godfather");
  tap("KeyE"); expect(href()).toBe("#civilian");
});

test.each([false, true])("F/E do not remove a live own hidden pin, fake-first=%s", async fakeFirst => {
  autoStartFeature.enable(cfg({ auto_hide_roles_enabled: false })); roleFakerFeature.enable(cfg());
  if (fakeFirst) tap("KeyF");
  pinOwnRole("hidden"); if (!fakeFirst) tap("KeyF");
  expect(pinHolds("hidden")).toBe(true); expect(visible(own())).toBe(false); expect(visible(peer())).toBe(false);
  tap("KeyE"); expect(href()).toBe("#sheriff"); expect(pinHolds("hidden")).toBe(true); expect(visible(own())).toBe(false); expect(visible(peer())).toBe(true);
  releasePins(); expect(visible(own())).toBe(true);
});

test("peek rebinding releases previous hold exactly once without keyup opening stale state", async () => {
  autoStartFeature.enable(cfg()); roleFakerFeature.enable(cfg()); key("KeyV"); expect(isPeeking()).toBe(true);
  autoStartFeature.update!(cfg({ hotkey_role_peek: "KeyK" }));
  expect(isPeeking()).toBe(false); expect(visible(own())).toBe(false);
  key("KeyK"); expect(isPeeking()).toBe(true); key("KeyV", "keyup"); expect(isPeeking()).toBe(true);
  key("KeyK", "keyup"); await wait(12000); expect(isPeeking()).toBe(false); expect(visible(own())).toBe(false); expect(visible(peer())).toBe(false);
});

test.each(["blur", "hidden", "typing-keyup"])("active V releases after %s and F never lifts peer shield", async end => {
  autoStartFeature.enable(cfg()); roleFakerFeature.enable(cfg()); tap("KeyF"); key("KeyV"); expect(isPeeking()).toBe(true);
  expect(visible(own())).toBe(true); expect(visible(peer())).toBe(false);
  if (end === "blur") window.dispatchEvent(new Event("blur"));
  if (end === "hidden") { const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); spy.mockRestore(); }
  if (end === "typing-keyup") { const ta = document.createElement("textarea"); document.body.append(ta); ta.focus(); key("KeyV", "keyup", {}, ta); ta.blur(); }
  await wait(12000); expect(isPeeking()).toBe(false); expect(visible(own())).toBe(false); expect(visible(peer())).toBe(false);
  tap("KeyE"); expect(href()).toBe("#sheriff"); expect(visible(own())).toBe(false); expect(visible(peer())).toBe(false);
});

test("orphan sweep does not remove active lifted pin and restore covers replacement node", () => {
  autoStartFeature.enable(cfg({ auto_hide_roles_enabled: false })); pinOwnRole("hidden"); liftPins(); sweepOrphanPins();
  expect(pinHolds("hidden")).toBe(true); const fresh = freshOwn(); expect(visible(fresh)).toBe(true);
  restoreLiftedPins(); expect(visible(fresh)).toBe(false); expect(pinHolds("hidden")).toBe(true);
  releasePins(); expect(visible(fresh)).toBe(true);
});
