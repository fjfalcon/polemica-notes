// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/7" }
// Внешний аудит №7: readonly-поле, потерянный keyup, чужой cancel+stop.
// Audit-only probes: production untouched. Actual hotkeys-js, router, faker,
// role-pin and SharedDomObserver; bounded microtask v-show renderer.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit7-keyboard" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@core/messaging", () => ({ sendRuntime: async () => ({ success: true }), onMessage: () => () => {} }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { releasePins } from "@content/role-pin";
import { keyboard } from "@core/keyboard";

const fixture = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const factory = new Function("window", "document", "navigator", `var ${fixture.slice(0, fixture.indexOf("var _h=gh;"))}; return gh;`);
let hk: any, flag: boolean, toggles: number, video: number;
let cleanup: Array<() => void> = [];
let epoch = 0;
const wait = (ms = 16) => vi.advanceTimersByTimeAsync(ms);
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}, target: EventTarget = document) {
  const kc = code === "ControlLeft" ? 17 : code === "MetaLeft" ? 91 : code.charCodeAt(3);
  const e = new KeyboardEvent(type, { code, key: code === "MetaLeft" ? "Meta" : code.slice(3).toLowerCase(), keyCode: kc, which: kc, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(e); return e;
}
function tap(code: string, extra: KeyboardEventInit = {}, target: EventTarget = document) { const e = key(code, "keydown", extra, target); key(code, "keyup", extra, target); return e; }
const roles = () => [...document.querySelectorAll<HTMLElement>(".player__role")];
const paint = () => roles().forEach(el => { el.style.display = flag ? "" : "none"; });
function mount() {
  document.querySelector(".players")!.innerHTML = '<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role"><svg><use href="#mafia"></use></svg></span></div>';
  paint();
}
const picture = () => roles().map(el => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"; });
function install(shortcut = "d") {
  hk(shortcut, (e: KeyboardEvent) => { e.preventDefault(); toggles++; flag = !flag; queueMicrotask(paint); return false; });
  hk(shortcut.includes("ctrl+") ? "ctrl+v,command+v" : "v", (e: KeyboardEvent) => { e.preventDefault(); video++; return false; });
}
function enable(patch = {}) {
  const settings = { auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true, auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyH", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE", ...patch };
  autoStartFeature.enable({ settings } as never); roleFakerFeature.enable({ settings } as never);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.advanceTimersByTime(++epoch * 100000); vi.setSystemTime(1_990_000_000_000);
  document.head.replaceChildren(); document.body.className = "";
  document.body.innerHTML = '<div class="stage"><div class="substage current">Речь игрока</div></div><div class="players"></div>';
  flag = false; toggles = video = 0; hk = factory(window, document, navigator);
});
afterEach(async () => {
  cleanup.forEach(fn => fn()); cleanup = [];
  window.dispatchEvent(new Event("blur")); roleFakerFeature.disable(); autoStartFeature.disable(); releasePins(); hk.unbind();
  window.dispatchEvent(new Event("focus")); await Promise.resolve(); vi.clearAllTimers(); vi.useRealTimers();
  document.head.replaceChildren(); document.body.replaceChildren();
});

test.each(["KeyD", "KeyH"])("accepted modified native D keyup must not poison later native V, hide=%s", async hide => {
  flag = true; install("ctrl+d,command+d"); mount(); enable({ hotkey_role_hide: hide, auto_hide_roles_enabled: false }); await wait(1000);
  key("ControlLeft", "keydown", { ctrlKey: true });
  tap("KeyD", { ctrlKey: true });
  key("ControlLeft", "keyup"); await wait();
  expect({ toggles, flag, picture: picture() }).toEqual({ toggles: 1, flag: false, picture: [false, false] });
  const afterRelease = hk.getPressedKeyCodes();
  // Make the empty hold hand V back to the site's lobby-camera shortcut.
  roles().forEach(el => el.remove());
  tap(hide); // explicit newer Show clears the manual CSS, no native command
  key("ControlLeft", "keydown", { ctrlKey: true });
  tap("KeyV", { ctrlKey: true }); key("ControlLeft", "keyup"); await wait();
  expect({ afterRelease, video }, "D was accepted, so its real keyup belongs to native dispatcher too").toEqual({ afterRelease: [], video: 1 });
});

// stop=true — чужой обработчик, повторяющий обёртку сайта: принятое ограничение (аудит №7, C03).
test.each([false])("BOUNDARY unrelated cancel+stop is not native acceptance, stop=%s", async stop => {
  flag = true; install(); enable(); await wait(1000);
  tap("KeyD"); await wait(1000); expect({ toggles, flag }).toEqual({ toggles: 1, flag: false });
  tap("KeyH"); await wait(1000); // Newer explicit Show, still no roots.
  const other = (e: KeyboardEvent) => { if (e.ctrlKey) { e.preventDefault(); if (stop) e.stopPropagation(); } };
  document.addEventListener("keydown", other);
  cleanup.push(() => document.removeEventListener("keydown", other));
  tap("KeyD", { ctrlKey: true }); // Native plain-D profile rejects.
  expect(toggles).toBe(1);
  await wait(1000); mount(); await wait(); const first = picture(); await wait(12000);
  expect({ first, settled: picture() }, "another listener's canceled stopped event is not a role command").toEqual({ first: [true, true], settled: [true, true] });
});

test.each([false, true])("held V remains invisible to site after focus moves into readonly input, readonly=%s", async readOnly => {
  install(); mount(); enable(); await wait(1000); key("KeyV"); expect(isPeeking()).toBe(true);
  const input = document.createElement("input"); input.readOnly = readOnly; document.body.append(input); input.focus();
  key("KeyV", "keydown", { repeat: true }, input);
  key("KeyV", "keyup", {}, input); await wait();
  expect(isPeeking()).toBe(false); expect(picture()).toEqual([false, false]);
  const pressed = hk.getPressedKeyCodes();
  input.blur(); // element focus change is not window blur/focus
  tap("KeyD"); await wait(12000);
  expect({ video, pressed, toggles, picture: picture() }, "an activated hold promised native neither down nor up; later native Show must still work").toEqual({ video: 0, pressed: [], toggles: 1, picture: [true, true] });
});

test.each(["peek", "fake", "repeat"])("logical D with physical non-D remains protected: %s", async mode => {
  install(); mount(); enable(); await wait(1000);
  if (mode === "peek") key("KeyV");
  if (mode === "fake") tap("KeyF");
  tap("KeyJ", { keyCode: 68, which: 68, key: "d", repeat: mode === "repeat" }); await wait();
  if (mode === "peek") key("KeyV", "keyup");
  if (mode === "fake") tap("KeyE");
  await wait(12000); expect({ toggles, picture: picture() }).toEqual({ toggles: 0, picture: [false, false] });
});

test.each(["peek", "fake", "repeat"])("privacy: ordinary physical D stays protected after readonly focus: %s", async mode => {
  if (mode === "repeat") flag = true;
  install("ctrl+d,command+d"); mount(); enable(); await wait(1000);
  if (mode === "peek") key("KeyV");
  if (mode === "fake") tap("KeyF");
  if (mode === "repeat") { key("KeyD", "keydown", { ctrlKey: true }); await wait(); expect({ toggles, flag }).toEqual({ toggles: 1, flag: false }); }
  const input = document.createElement("input"); input.readOnly = true; document.body.append(input); input.focus();
  tap("KeyD", { ctrlKey: true, repeat: mode === "repeat" }, input); await wait();
  if (mode === "peek") key("KeyV", "keyup", {}, input);
  input.blur();
  if (mode === "fake") tap("KeyE");
  const first = picture(); await wait(12000);
  expect({ toggles, flag, first, settled: picture() }, "readonly is accepted by native filter but must not bypass protected V/F/repeat").toEqual({ toggles: mode === "repeat" ? 1 : 0, flag: false, first: [false, false], settled: [false, false] });
});

test.each([false, true])("privacy: peek remapped D cannot reach native role toggle on readonly repeat, readonly=%s", async readOnly => {
  install(); mount(); enable({ hotkey_role_peek: "KeyD" }); await wait(1000);
  key("KeyD"); expect(isPeeking()).toBe(true); expect(picture()).toEqual([true, true]);
  const input = document.createElement("input"); input.readOnly = readOnly; document.body.append(input); input.focus();
  key("KeyD", "keydown", { repeat: true }, input); await wait();
  key("KeyD", "keyup", {}, input);
  const first = picture(); await wait(12000);
  expect({ toggles, flag, first, settled: picture() }).toEqual({ toggles: 0, flag: false, first: [false, false], settled: [false, false] });
});

test("newer rejected command does not erase accepted command before zero timer", async () => {
  flag = true; install(); enable(); await wait(1000); tap("KeyH"); await wait(1000);
  tap("KeyD"); await Promise.resolve(); tap("KeyD", { ctrlKey: true }); await Promise.resolve();
  mount(); await wait(12000); expect({ toggles, flag, picture: picture() }).toEqual({ toggles: 1, flag: false, picture: [false, false] });
});

test("capture collision with configured hide D cannot reveal under F", async () => {
  install(); mount(); enable({ hotkey_role_hide: "KeyD" }); await wait(1000); tap("KeyF"); expect(isRoleFaked()).toBe(true);
  tap("KeyD"); tap("KeyD", { ctrlKey: true }); await wait();
  tap("KeyE"); await wait(12000); expect({ toggles, picture: picture() }).toEqual({ toggles: 0, picture: [false, false] });
});

test("clean control independent observer fallback and bound non-D logical D", async () => {
  install(); mount(); enable(); await wait(1000); const on = vi.fn();
  cleanup.push(keyboard.register("KeyJ", on, { preventDefault: true }));
  tap("KeyJ", { keyCode: 68, which: 68, key: "d" }); await wait();
  expect(on).toHaveBeenCalledTimes(1); expect({ toggles, picture: picture() }).toEqual({ toggles: 0, picture: [false, false] });
});
