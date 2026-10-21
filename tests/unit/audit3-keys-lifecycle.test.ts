// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
// Independent audit: only new tests; production and older tests untouched.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit3-keys", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => false,
  nightSceneSafeForRoleShow: () => true,
  setRoleSceneGateListener: () => () => {},
}));

import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { pinOwnRole, releasePins } from "@content/role-pin";

const room = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
const hotkeysFactory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
let hotkeys: any;
let settings: Record<string, unknown>;
let epoch = 0;
const own = () => document.querySelector<HTMLElement>(".my-role")!;
const peer = () => document.querySelector<HTMLElement>(".peer")!;
const use = () => own().querySelector("use")!;
const tip = () => own().querySelector(".tooltip span")!;
const tick = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
const keycodes: Record<string, number> = {
  KeyD: 68, KeyE: 69, KeyF: 70, KeyG: 71, KeyV: 86,
  F6: 117, F8: 119, ControlLeft: 17, AltLeft: 18,
};
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent(type, {
    code, key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
    keyCode: keycodes[code], which: keycodes[code], bubbles: true, cancelable: true, ...extra,
  });
  target.dispatchEvent(event);
  return event;
}
function press(code: string) { key(code); key(code, "keyup"); }
function visible(el: HTMLElement) {
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.opacity !== "0" && style.display !== "none";
}
const picture = () => [visible(own()), visible(peer())];
function enable(patch: Record<string, unknown> = {}) {
  settings = {
    auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
    auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false,
    hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE",
    ...patch,
  };
  autoStartFeature.enable({ settings } as never);
  roleFakerFeature.enable({ settings } as never);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.advanceTimersByTime(++epoch * 100_000);
  vi.setSystemTime(1_900_000_000_000);
  document.body.innerHTML = `
    <div class="player my-player"><span class="player__role role my-role sheriff">
      <svg><use href="/sprite.svg#sheriff"></use></svg>
      <div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div>
    </span></div>
    <div class="player"><span class="player__role role peer mafia"><svg><use href="/sprite.svg#mafia"></use></svg></span></div>
    <div class="stage"><div class="substage current">Речь игрока</div></div>`;
  for (const icon of document.querySelectorAll("use")) {
    const href = icon.getAttribute("href")!;
    icon.removeAttribute("href");
    icon.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
  }
  hotkeys = hotkeysFactory(window, document, navigator);
  hotkeys("d", () => {
    const hidden = own().style.display !== "none";
    queueMicrotask(() => document.querySelectorAll<HTMLElement>(".player__role")
      .forEach(el => { el.style.display = hidden ? "none" : ""; }));
  });
});
afterEach(async () => {
  roleFakerFeature.disable();
  autoStartFeature.disable();
  releasePins();
  hotkeys.unbind();
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  vi.clearAllTimers(); vi.useRealTimers();
  document.head.replaceChildren(); document.body.replaceChildren();
  document.documentElement.removeAttribute("data-pn-role-faked");
});

test("AUDIT3-IME: hide=F6 must not reveal roles for an IME conversion key in textarea", async () => {
  enable({ auto_hide_roles_enabled: true, hotkey_role_hide: "F6" });
  const input = document.createElement("textarea"); document.body.append(input); input.focus();
  expect(picture()).toEqual([false, false]);
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "かな" }));
  key("F6", "keydown", { key: "Process", isComposing: true, keyCode: 229, which: 229 }, input);
  await tick(16);
  const after16ms = picture();
  await tick(12_000);
  expect({ after16ms, after12s: picture() }, "composition is text editing, not an explicit show-role command")
    .toEqual({ after16ms: [false, false], after12s: [false, false] });
});

test.each(["Enter", "Tab", "ArrowLeft", "Backspace", "Delete", "Home"])(
  "AUDIT3-EDIT: active F with hide=%s must not cancel textarea editing",
  code => {
    enable({ hotkey_role_hide: code }); press("KeyF");
    expect(isRoleFaked()).toBe(true);
    const input = document.createElement("textarea"); document.body.append(input); input.focus();
    const event = key(code, "keydown", {}, input);
    expect(event.defaultPrevented, "router typing gate must not be undone by faker's separate blocker").toBe(false);
  },
);

test("AUDIT3-QUICK-E: E before the throttled DOM subscriber must restore the new true role", async () => {
  enable(); press("KeyF"); await tick(600);
  use().setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/sprite.svg#mafia");
  tip().textContent = "Ваша роль - Мафия";
  own().classList.replace("sheriff", "mafia");
  press("KeyE");
  await tick(600);
  expect(use().getAttribute("href"), "new server role must not be overwritten by a stale F snapshot").toBe("/sprite.svg#mafia");
});

test("control: ordinary textarea D/V/F/E and IME letter codes do not change roles", async () => {
  enable({ auto_hide_roles_enabled: true });
  const input = document.createElement("textarea"); document.body.append(input); input.focus();
  for (const code of ["KeyD", "KeyV", "KeyF", "KeyE"]) {
    key(code, "keydown", { isComposing: true, keyCode: 229, which: 229 }, input);
    key(code, "keyup", {}, input);
  }
  await tick(600);
  expect(picture()).toEqual([false, false]); expect(isRoleFaked()).toBe(false); expect(isPeeking()).toBe(false);
});

test("control: F never opens CSS-hidden roles; V lifts hiding but not the fake peer shield", async () => {
  enable({ auto_hide_roles_enabled: true });
  press("KeyF"); expect(picture()).toEqual([false, false]);
  key("KeyV"); expect(picture()).toEqual([true, false]);
  key("KeyV", "keyup"); expect(picture()).toEqual([false, false]);
  press("KeyE"); expect(picture()).toEqual([false, false]);
  press("KeyD"); expect(picture()).toEqual([true, true]);
});

test("control: changing peek key while held returns CSS and own pin immediately", async () => {
  enable({ auto_hide_roles_enabled: true }); pinOwnRole("hidden");
  key("KeyV"); expect(picture()).toEqual([true, true]);
  settings = { ...settings, hotkey_role_peek: "KeyG" };
  autoStartFeature.update!({ settings } as never);
  expect(isPeeking()).toBe(false); expect(picture()).toEqual([false, false]);
  key("KeyV", "keyup"); key("KeyG"); expect(picture()).toEqual([true, true]);
  window.dispatchEvent(new Event("blur")); expect(picture()).toEqual([false, false]);
});

test("control: a valid hide/peek key swap through a free key leaves both bindings working", async () => {
  enable({ auto_hide_roles_enabled: true });
  for (const patch of [{ hotkey_role_hide: "KeyG" }, { hotkey_role_peek: "KeyD" }, { hotkey_role_hide: "KeyV" }]) {
    settings = { ...settings, ...patch };
    autoStartFeature.update!({ settings } as never); roleFakerFeature.update!({ settings } as never);
  }
  key("KeyD"); expect(isPeeking()).toBe(true); expect(picture()).toEqual([true, true]);
  key("KeyD", "keyup"); expect(picture()).toEqual([false, false]);
  press("KeyV"); expect(picture()).toEqual([true, true]);
});

test("control: active peek suppresses site m/l/g/k/r/digits/F1-F10 on a rebound hold", () => {
  enable({ auto_hide_roles_enabled: true });
  for (const [code, name, kc] of [
    ...["m", "l", "g", "k", "r"].map(x => [`Key${x.toUpperCase()}`, x, x.toUpperCase().charCodeAt(0)]),
    ...Array.from({ length: 10 }, (_, n) => [`Digit${n}`, String(n), 48 + n]),
    ...Array.from({ length: 10 }, (_, n) => [`F${n + 1}`, `f${n + 1}`, 112 + n]),
  ] as Array<[string, string, number]>) {
    let calls = 0; hotkeys(name, () => calls++);
    settings = { ...settings, hotkey_role_peek: code };
    autoStartFeature.update!({ settings } as never);
    key(code, "keydown", { keyCode: kc, which: kc });
    key(code, "keydown", { keyCode: kc, which: kc, repeat: true, ctrlKey: true });
    key(code, "keyup", { keyCode: kc, which: kc });
    expect(calls, name).toBe(0); expect(picture()).toEqual([false, false]);
    hotkeys.unbind(name);
  }
});

test("control: independent faker disable preserves CSS and pin and restores role and peers", () => {
  enable({ auto_hide_roles_enabled: true }); pinOwnRole("hidden"); press("KeyF");
  roleFakerFeature.disable(); expect(isRoleFaked()).toBe(false);
  expect(use().getAttribute("href")).toBe("/sprite.svg#sheriff"); expect(picture()).toEqual([false, false]);
  press("KeyD"); expect(picture()).toEqual([false, true]);
  key("KeyV"); expect(picture()).toEqual([true, true]);
  key("KeyV", "keyup"); expect(picture()).toEqual([false, true]);
});
