// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Audit-only probes; real keyboard/faker/auto-start/observer and embedded site dispatcher.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit4-keys", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true,
  setRoleSceneGateListener: () => () => {},
}));
vi.mock("@core/messaging", () => ({ sendRuntime: async () => ({ success: true }), onMessage: () => () => {} }));

import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { outcryHotkeyFeature } from "@content/features/outcry-hotkey";
import { pauseHotkeyFeature } from "@content/features/pause-hotkey";
import { obsClipFeature } from "@content/features/obs-clip";
import { pinOwnRole, releasePins } from "@content/role-pin";

const room = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
const factory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
let hotkeys: any;
let settings: Record<string, unknown>;
let nativeFlag = true;
let epoch = 0;
const xlink = "http://www.w3.org/1999/xlink";
const own = () => document.querySelector<HTMLElement>(".my-role")!;
const peer = () => document.querySelector<HTMLElement>(".peer")!;
const use = () => own().querySelector("use")!;
const tick = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
function kc(code: string): number {
  if (code.startsWith("Key")) return code.charCodeAt(3);
  if (code.startsWith("Digit")) return code.charCodeAt(5);
  if (/^F\d+$/.test(code)) return 111 + Number(code.slice(1));
  return ({ CapsLock: 20, ControlLeft: 17, AltLeft: 18, MetaLeft: 91, ShiftLeft: 16, Enter: 13, Tab: 9, ArrowLeft: 37, Backspace: 8, Delete: 46, Home: 36 } as Record<string, number>)[code] || 0;
}
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent(type, { code, key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
    keyCode: kc(code), which: kc(code), bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event);
  return event;
}
function press(code: string, extra: KeyboardEventInit = {}, target: EventTarget = document) {
  key(code, "keydown", extra, target); key(code, "keyup", extra, target);
}
function visible(el: Element): boolean {
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
}
const picture = () => [visible(own()), visible(peer())];
function enable(patch: Record<string, unknown> = {}) {
  settings = { auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
    auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false,
    hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE",
    pause_hotkey_code: "F8", outcry_hotkey_code: "KeyC", obs_clip_hotkey_code: "F9", obs_clip_minutes: 1,
    ...patch };
  autoStartFeature.enable({ settings } as never); roleFakerFeature.enable({ settings } as never);
}
function update(patch: Record<string, unknown>) {
  settings = { ...settings, ...patch };
  autoStartFeature.update!({ settings } as never); roleFakerFeature.update!({ settings } as never);
}
function applyFlag() { document.querySelectorAll<HTMLElement>(".player__role").forEach(el => { el.style.display = nativeFlag ? "" : "none"; }); }
function installNative(modifier = false) {
  hotkeys("d,ctrl+d,command+d", () => {}); hotkeys.unbind();
  hotkeys(modifier ? "ctrl+d,command+d" : "d", () => { nativeFlag = !nativeFlag; queueMicrotask(applyFlag); return false; });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.advanceTimersByTime(++epoch * 100_000); vi.setSystemTime(1_900_000_000_000);
  nativeFlag = true;
  document.body.innerHTML = `<div class="player my-player"><span class="player__role role my-role sheriff"><svg><use></use></svg><div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div></span></div>
    <div class="player"><span class="player__role role peer mafia"><svg><use></use></svg></span></div>
    <div class="stage"><div class="substage current">Речь игрока</div></div>`;
  use().setAttributeNS(xlink, "xlink:href", "/sprite.svg#sheriff");
  peer().querySelector("use")!.setAttributeNS(xlink, "xlink:href", "/sprite.svg#mafia");
  hotkeys = factory(window, document, navigator); installNative();
});
afterEach(async () => {
  outcryHotkeyFeature.disable(); pauseHotkeyFeature.disable(); obsClipFeature.disable();
  roleFakerFeature.disable(); autoStartFeature.disable(); releasePins(); hotkeys.unbind();
  window.dispatchEvent(new Event("focus")); await Promise.resolve();
  vi.clearAllTimers(); vi.useRealTimers(); document.head.replaceChildren(); document.body.replaceChildren();
  document.documentElement.removeAttribute("data-pn-role-faked");
});

test.each([0, 1, 16, 300, 600])("five fake cycles and reset retain true native NS role, gap=%d", async gap => {
  enable();
  for (const icon of ["godfather", "mafia", "sheriff", "civilian", "player", "godfather"]) {
    press("KeyF"); await tick(gap);
    expect(use().getAttribute("href")).toBe(`/sprite.svg#${icon}`);
    expect(picture()).toEqual([true, false]);
  }
  press("KeyE"); await tick(600);
  expect(use().getAttribute("href")).toBe("/sprite.svg#sheriff");
  expect(own().querySelector(".tooltip span")!.textContent).toBe("Ваша роль - Шериф");
  expect(picture()).toEqual([true, true]);
});

const remaps = [
  ...["m", "l", "g", "k", "r"].map(x => [`Key${x.toUpperCase()}`, x]),
  ...Array.from({ length: 10 }, (_, n) => [`Digit${n}`, String(n)]),
  ...Array.from({ length: 10 }, (_, n) => [`F${n + 1}`, `f${n + 1}`]),
] as Array<[string, string]>;
test.each(remaps)("hide/peek/fake/reset remain visually coherent at %s (%s)", async (code, native) => {
  // Move all other extension assignments away first: only legal distinct configs.
  enable({ hotkey_role_hide: "KeyH", hotkey_role_peek: "KeyP", hotkey_role_fake: "KeyB", hotkey_role_reset: "KeyN" });
  let calls = 0; hotkeys(native, () => calls++);
  update({ hotkey_role_hide: code });
  press(code); await tick(); expect(picture()).toEqual([false, false]);
  key(code, "keydown", { repeat: true }); key(code, "keyup"); expect(picture()).toEqual([false, false]);
  expect(calls).toBe(0); press(code); expect(picture()).toEqual([true, true]);
  update({ hotkey_role_hide: "KeyH", hotkey_role_peek: code }); press("KeyH");
  key(code); expect(isPeeking()).toBe(true); expect(picture()).toEqual([true, true]);
  for (const mod of [{ repeat: true }, { repeat: true, ctrlKey: true }, { repeat: true, altKey: true }, { repeat: true, metaKey: true }]) key(code, "keydown", mod);
  key(code, "keyup"); expect(picture()).toEqual([false, false]); expect(calls).toBe(0);
  update({ hotkey_role_peek: "KeyP", hotkey_role_fake: code }); press("KeyH");
  press(code); await tick(600); expect(isRoleFaked()).toBe(true); expect(picture()).toEqual([true, false]);
  press("KeyN"); expect(picture()).toEqual([true, true]);
  update({ hotkey_role_fake: "KeyB", hotkey_role_reset: code }); press("KeyB"); press(code);
  expect(isRoleFaked()).toBe(false); expect(use().getAttribute("href")).toBe("/sprite.svg#sheriff");
  expect(picture()).toEqual([true, true]);
});

test.each([false, true])("D/V modifiers, Russian, CapsLock, repeat, chat and composition modifier=%s", async modifier => {
  installNative(modifier); enable({ auto_hide_roles_enabled: true });
  for (const flags of [{}, { shiftKey: true }, { key: "М", shiftKey: true }, { key: "м" }]) {
    key("KeyV", "keydown", flags); expect(picture()).toEqual([true, true]);
    key("KeyV", "keydown", { repeat: true, ctrlKey: true }); key("KeyV", "keyup");
    expect(picture()).toEqual([false, false]);
  }
  press("CapsLock"); press("KeyD", { key: "В" }); expect(picture()).toEqual([true, true]);
  press("KeyD"); expect(picture()).toEqual([false, false]);
  for (const tag of ["input", "textarea", "select"]) {
    const field = document.createElement(tag); document.body.append(field); field.focus();
    for (const code of ["KeyD", "KeyV", "KeyF", "KeyE"]) press(code, { key: "в" }, field);
    expect(picture()).toEqual([false, false]); expect(isRoleFaked()).toBe(false); expect(isPeeking()).toBe(false);
    field.remove();
  }
  for (const code of ["F1", "F6", "F8", "F10"]) {
    update({ hotkey_role_hide: code });
    for (const flags of [{ isComposing: true }, { keyCode: 229, which: 229 }]) press(code, flags);
    expect(picture()).toEqual([false, false]);
  }
  update({ hotkey_role_hide: "KeyD" });
  press("KeyF"); key("KeyV"); expect(picture()).toEqual([true, false]);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, repeat: true }, { altKey: true, repeat: true }]) press("KeyD", extra);
  await tick(600); expect(picture()).toEqual([true, false]);
  window.dispatchEvent(new Event("blur")); expect(picture()).toEqual([false, false]);
});

test("ordinary extra features, distinct remaps, isolated faker teardown preserve hold and pin", async () => {
  enable({ auto_hide_roles_enabled: true });
  outcryHotkeyFeature.enable({ settings } as never); pauseHotkeyFeature.enable({ settings } as never); obsClipFeature.enable({ settings } as never);
  pinOwnRole("hidden"); press("KeyF"); key("KeyV");
  expect(picture()).toEqual([true, false]);
  roleFakerFeature.disable(); expect(isPeeking()).toBe(true); expect(picture()).toEqual([true, true]);
  key("KeyV", "keyup"); expect(picture()).toEqual([false, false]);
  press("KeyD"); expect(picture()).toEqual([false, true]);
  await tick(600); expect(use().getAttribute("href")).toBe("/sprite.svg#sheriff");
});

test("F+root/use rerender shields and orphan sweep preserve current hidden pin", async () => {
  enable(); press("KeyF"); await tick(600);
  const fresh = own().cloneNode(true) as HTMLElement;
  for (const a of ["data-original-role", "data-original-role-name", "data-original-sprite-base"]) fresh.removeAttribute(a);
  fresh.querySelector("use")!.setAttribute("href", "/sprite.svg#sheriff"); own().replaceWith(fresh);
  expect(getComputedStyle(fresh).visibility).toBe("hidden");
  await tick(600); expect(use().getAttribute("href")).toBe("/sprite.svg#godfather");
  // Check the actual CSS rule, not jsdom's broken namespaced attribute selector.
  own().querySelector("svg")!.innerHTML = '<use href="/sprite.svg#sheriff"></use>';
  expect(document.getElementById("pn-role-fake-shield")!.textContent).toContain('use:not([href$="#godfather"])');
  expect(getComputedStyle(use()).visibility).toBe("hidden");
  await tick(600); expect(use().getAttribute("href")).toBe("/sprite.svg#godfather");
  press("KeyE"); pinOwnRole("hidden");
  own().setAttribute("data-original-role", "sheriff"); own().setAttribute("data-original-sprite-base", "/sprite.svg");
  use().setAttribute("href", "/sprite.svg#godfather");
  peer().setAttribute("data-pn-fake-hidden", ""); peer().style.setProperty("visibility", "hidden", "important");
  document.documentElement.setAttribute("data-pn-role-faked", "");
  roleFakerFeature.disable(); roleFakerFeature.enable({ settings } as never);
  expect(use().getAttribute("href")).toBe("/sprite.svg#sheriff");
  expect(own().style.visibility).toBe("hidden"); expect(peer().style.visibility).toBe("");
  expect(document.documentElement.hasAttribute("data-pn-role-faked")).toBe(false);
});
