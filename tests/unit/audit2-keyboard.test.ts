// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы второго внешнего аудита видимости ролей (docs/audit-role-stream-2-2026-10-21.md),
// перенесены как регрессионные после перехода на «одну власть» (21.10.2026).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/dom", () => ({ onDomChangeImmediate: (fn: any) => { const mo = new MutationObserver(fn); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] }); return () => mo.disconnect(); },  onDomChange: vi.fn(() => () => {}), safeClick: vi.fn(), isVisible: () => true }));
vi.mock("@core/env", () => ({ browser: { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
const markSynthetic = (_e: Event) => {};
const isSynthetic = (_e: Event) => false;
const dispatchNativeRoleToggle = () => {};
import { pinOwnRole, resetRolePinForTest } from "@content/role-pin";
import { showToast } from "@core/toast";
import { outcryHotkeyFeature } from "@content/features/outcry-hotkey";

// Exact, unmodified embedded hotkeys-js from the already-downloaded room bundle.
const room = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
if (start < 0 || end < 0) throw new Error("hotkeys extraction boundary missing");
const hotkeysFactory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
let hotkeys: any;
let roleDisplay = false;
let videoToggles = 0;
let settings: Record<string, unknown>;
let cleanup: Array<() => void> = [];

function apply() {
  document.querySelectorAll<HTMLElement>(".player__role").forEach(el => el.style.display = roleDisplay ? "" : "none");
}
function toggle() { roleDisplay = !roleDisplay; queueMicrotask(apply); }
function install(modifier = false, initial = false) {
  hotkeys = hotkeysFactory(window, document, navigator);
  roleDisplay = initial;
  hotkeys(modifier ? "ctrl+d,command+d" : "d", toggle);
  hotkeys(modifier ? "ctrl+v,command+v" : "v", () => videoToggles++);
  document.body.innerHTML = `<div class="stage"><div class="substage current">Речь игрока</div></div>
    <div class="player my-player"><span class="player__role role my-role mafia"><svg><use href="#mafia"></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - Мафия</span></div></div></span></div>
    <div class="player"><span class="player__role role godfather"><svg><use href="#godfather"></use></svg></span></div>`;
  apply();
}
function enable(patch: Record<string, unknown> = {}) {
  settings = { auto_accept_enabled: false, skip_start_screen_enabled: false, auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE", ...patch };
  autoStartFeature.enable({ settings } as never);
}
const codes: Record<string, number> = { KeyD: 68, KeyV: 86, KeyG: 71, KeyF: 70, KeyE: 69, ControlLeft: 17, AltLeft: 18, ShiftLeft: 16, CapsLock: 20, Backquote: 192, F8: 119 };
function key(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
  return target.dispatchEvent(new KeyboardEvent(type, { code, key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code, keyCode: codes[code], which: codes[code], bubbles: true, cancelable: true, ...init }));
}
const down = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document) => key("keydown", code, init, target);
const up = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document) => key("keyup", code, init, target);
const press = (code: string, init: KeyboardEventInit = {}) => { down(code, init); up(code, init); };
const settle = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
function snapshot() {
  return [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000);
  videoToggles = 0; cleanup = [];
  resetRolePinForTest();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 20, width: 20, height: 20, toJSON() {} });
});
afterEach(async () => {
  window.dispatchEvent(new Event("focus"));
  outcryHotkeyFeature.disable(); roleFakerFeature.disable(); autoStartFeature.disable();
  hotkeys?.unbind(); cleanup.forEach(fn => fn());
  await Promise.resolve();
  resetRolePinForTest(); document.body.replaceChildren();
  document.getElementById("polemica-role-hide")?.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

test.each([false, true])("control standard D/V, repeats, remap, own day pin modifier=%s", async modifier => {
  install(modifier); enable();
  down("KeyV"); await settle(); expect(snapshot()).toEqual([true, true]);
  down("KeyV", { repeat: true }); up("KeyV"); await settle(1000);
  expect(snapshot()).toEqual([false, false]); expect(videoToggles).toBe(0);
  press("KeyD"); await settle(); expect(snapshot()).toEqual([true, true]);
  down("KeyD", { repeat: true }); await settle(); expect(snapshot()).toEqual([true, true]); up("KeyD");
  pinOwnRole("hidden"); press("KeyD"); await settle(); expect(snapshot()).toEqual([false, false]);
  press("KeyD"); await settle(); expect(snapshot()).toEqual([false, true]);
});

test.each(["ctrlKey", "altKey", "metaKey"] as const)("RED active V with later %s repeat must not poison site's held keys", async modifier => {
  install(true); enable();
  down("KeyV"); await settle(); expect(snapshot()).toEqual([true, true]);
  // V is still physically held; press a modifier, then the OS repeats V.
  const modCode = modifier === "ctrlKey" ? "ControlLeft" : modifier === "altKey" ? "AltLeft" : "MetaLeft";
  down(modCode, { [modifier]: true, keyCode: modifier === "metaKey" ? 91 : codes[modCode] });
  down("KeyV", { [modifier]: true, repeat: true });
  up("KeyV", { [modifier]: true });
  up(modCode, { keyCode: modifier === "metaKey" ? 91 : codes[modCode] });
  await settle(2000);
  expect(snapshot(), "fail-safe hide after release").toEqual([false, false]);
  // Ordinary next peek has no modifiers or PTT: it must show roles again.
  down("KeyV"); await settle(1000);
  console.log("MODIFIER TRACE", modifier, { held: hotkeys.getPressedKeyCodes(), videoToggles, peeking: isPeeking(), snapshot: snapshot() });
  expect(snapshot(), "next peek can lift fail-safe CSS").toEqual([true, true]);
  up("KeyV"); await settle(1000);
  expect(snapshot()).toEqual([false, false]);
  press("KeyD"); await settle(50); expect(snapshot()).toEqual([true, true]);
  press("KeyD"); await settle(12000);
  console.log("FAILED HIDE TRACE", modifier, { held: hotkeys.getPressedKeyCodes(), flag: roleDisplay, snapshot: snapshot() });
  expect(snapshot(), "D must hide again: stale V must not block the native toggle").toEqual([false, false]);
});

test("RED site menu show at V-up+100ms must cancel older native-hide retry", async () => {
  install(); enable(); down("KeyV"); await settle(50); up("KeyV");
  await settle(100); expect(roleDisplay).toBe(false);
  const menu = document.createElement("button"); menu.textContent = "Показать роли";
  menu.addEventListener("click", toggle); document.body.append(menu); menu.click();
  await settle(1); expect(roleDisplay, "menu changed native flag to show").toBe(true);
  await settle(12000);
  console.log("MENU TRACE", { flag: roleDisplay, snapshot: snapshot() });
  expect(snapshot(), "newer explicit site menu show must persist").toEqual([true, true]);
});

test.each([false, true])("control native D after remap counts as manual night decision modifier=%s", async modifier => {
  install(modifier, true); enable({ hotkey_role_hide: "KeyG", role_phase_auto_switch_enabled: true });
  document.querySelector(".substage.current")!.textContent = "Ход мафии";
  await settle(6000); expect(snapshot()).toEqual([true, true]);
  press("KeyD", modifier ? { ctrlKey: true } : {}); await settle(50);
  expect(snapshot()).toEqual([false, false]);
  down("KeyV"); await settle(50); up("KeyV"); await settle(12000);
  expect(snapshot()).toEqual([false, false]);
});

test("control faker D no-op with toast and peer still hidden; fake V priority; E reset", async () => {
  install(false, true); enable(); roleFakerFeature.enable({ settings } as never);
  press("KeyF"); expect(isRoleFaked()).toBe(true); expect(snapshot()).toEqual([true, false]);
  vi.mocked(showToast).mockClear(); press("KeyD"); await settle();
  expect(snapshot()).toEqual([true, false]); expect(showToast).toHaveBeenCalled();
  down("KeyV"); await settle(50); up("KeyV"); await settle(1000);
  expect(snapshot()).toEqual([true, false]);
  press("KeyE"); expect(snapshot()).toEqual([true, true]);
});

test("control PTT release, blur, Shift/Russian, textarea and synthetic markers", async () => {
  install(); enable();
  down("KeyV", { key: "м", shiftKey: true }); await settle(50);
  expect(snapshot()).toEqual([true, true]);
  down("Backquote"); up("KeyV"); await settle(2000);
  expect(snapshot()).toEqual([false, false]); up("Backquote");
  down("KeyV"); await settle(50); window.dispatchEvent(new Event("blur"));
  await settle(1000); expect(snapshot()).toEqual([false, false]);
  const input = document.createElement("textarea"); document.body.append(input); input.focus();
  down("KeyD", { key: "в" }, input); down("KeyV", { key: "м" }, input);
  expect(isPeeking()).toBe(false); input.blur();
});

test("diagnostic duplicate hide/peek stored configuration: last registration wins", async () => {
  install(); enable({ hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyD" });
  down("KeyD"); await settle(50); up("KeyD"); await settle(1000);
  // Popup disallows this configuration. Runtime does not promise two handlers.
  expect(isPeeking()).toBe(false); expect(snapshot()).toEqual([true, true]);
});

test("control empty V reaches site; ordinary key holds do not linger", async () => {
  install(false, true); enable();
  press("KeyV"); await settle(); expect(videoToggles).toBe(1);
  press("CapsLock"); press("KeyD", { key: "D" }); await settle();
  expect(snapshot()).toEqual([false, false]); expect(hotkeys.getPressedKeyCodes()).toEqual([]);
});

test("RED supported reset=D with hide=G must not expose natively hidden true roles", async () => {
  install(false, false);
  enable({ hotkey_role_hide: "KeyG", hotkey_role_reset: "KeyD" });
  roleFakerFeature.enable({ settings } as never);
  press("KeyF"); await settle(50);
  expect(isRoleFaked()).toBe(true); expect(snapshot()).toEqual([false, false]);
  press("KeyD"); await settle(1000);
  console.log("RESET=D TRACE", { faked: isRoleFaked(), flag: roleDisplay, snapshot: snapshot() });
  expect(isRoleFaked()).toBe(false);
  expect(snapshot(), "resetting fake is not a command to show hidden actual roles").toEqual([false, false]);
});

test("RED supported fake=D with hide=G must not hide already visible fake role", async () => {
  install(false, true);
  enable({ hotkey_role_hide: "KeyG", hotkey_role_fake: "KeyD" });
  roleFakerFeature.enable({ settings } as never);
  press("KeyD"); await settle(1000);
  console.log("FAKE=D TRACE", { faked: isRoleFaked(), flag: roleDisplay, snapshot: snapshot() });
  expect(isRoleFaked()).toBe(true);
  expect(snapshot(), "fake shortcut must not also toggle site's visibility").toEqual([true, false]);
});

test("RED supported hide=Enter must not show roles while typing newline in notes/chat", async () => {
  install(false, false); enable({ hotkey_role_hide: "Enter" });
  const input = document.createElement("textarea"); document.body.append(input); input.focus();
  down("Enter", { key: "Enter", keyCode: 13, which: 13 }, input);
  up("Enter", { key: "Enter", keyCode: 13, which: 13 }, input);
  await settle(1000);
  console.log("INPUT ENTER TRACE", { flag: roleDisplay, snapshot: snapshot() });
  expect(snapshot(), "ordinary textarea newline is not an explicit role-display decision").toEqual([false, false]);
});

test("RED supported outcry=D with hide=G must not reveal roles when outcry is unavailable", async () => {
  install(false, false); enable({ hotkey_role_hide: "KeyG", outcry_hotkey_code: "KeyD" });
  outcryHotkeyFeature.enable({ settings } as never);
  press("KeyD"); await settle(1000);
  console.log("OUTCRY=D TRACE", { flag: roleDisplay, snapshot: snapshot() });
  expect(snapshot(), "unavailable outcry must not secretly turn into show roles").toEqual([false, false]);
});
