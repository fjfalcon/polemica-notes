// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
/**
 * Восьмой аудит, §2.2: замена пробы рендерера раунда 5 потеряла проверку
 * «скрытие, ПРИНЯТОЕ настоящим hotkeys-js сайта, держится после V». Здесь —
 * настоящие hotkeys-js и vShow из фрагментов бандла и обёртка Room.addHotKeys
 * (`return event.preventDefault(),n(),!1`, профиль модификатора ctrl/command).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit8" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({
  obsAutoScenesActive: () => false,
  nightSceneSafeForRoleShow: () => true,
  setRoleSceneGateListener: () => () => {},
}));
import { autoStartFeature } from "@content/features/auto-start";

const hotkeysSrc = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const factory = new Function("window", "document", "navigator", `var ${hotkeysSrc.slice(0, hotkeysSrc.indexOf("var _h=gh;"))}; return gh;`);
const rolesSrc = readFileSync("tests/fixtures/bundle-snippets/room-roles.txt", "utf8");
const c = rolesSrc.indexOf("za={beforeMount");
const haEnd = 'e.style.display=t?e._vod:"none"}';
const vShow = new Function(`const ${rolesSrc.slice(c, rolesSrc.indexOf(haEnd, c) + haEnd.length)}; return za;`)();

let hk: any;
let roleDisplay = true;
const roles = () => [...document.querySelectorAll<HTMLElement>(".player__role")];
const snap = () =>
  roles().map((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  });
const key = (type: string, code: string, keyCode: number, init: KeyboardEventInit = {}, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code, keyCode, ...init }));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_900_000_000_000);
  roleDisplay = true;
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | Проверки</div></div></div>
    <div class="player my-player"></div><div class="player"></div><textarea></textarea>`;
  for (const holder of document.querySelectorAll(".player")) {
    const r = document.createElement("span");
    r.className = "player__role role";
    vShow.beforeMount(r, { value: roleDisplay }, {});
    holder.append(r);
  }
  hk = factory(window, document, navigator);
  // Room.addHotKeys при useHotKeysModifier: «ctrl+d, command+d» и обёртка сайта.
  hk("ctrl+d, command+d", (e: KeyboardEvent) => {
    e.preventDefault();
    const old = roleDisplay;
    roleDisplay = !roleDisplay;
    queueMicrotask(() => roles().forEach((r) => vShow.updated(r, { value: roleDisplay, oldValue: old }, {})));
    return false;
  });
  autoStartFeature.enable({
    settings: {
      auto_accept_enabled: false,
      skip_start_screen_enabled: false,
      auto_hide_roles_enabled: true,
      role_phase_auto_switch_enabled: true,
      hotkey_role_hide: "KeyD",
      hotkey_role_peek: "KeyV",
    },
  } as never);
  await vi.advanceTimersByTimeAsync(3500);
  expect(snap(), "ночной показ").toEqual([true, true]);
});
afterEach(() => {
  autoStartFeature.disable();
  hk?.unbind();
  window.dispatchEvent(new Event("focus"));
  vi.clearAllTimers();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

test.each(["control-simple-CmdD", "Meta-tail-PTT", "typed-key-held-across-focus"])(
  "принятое сайтом скрытие держится после V: %s",
  async (mode) => {
    if (mode === "Meta-tail-PTT") key("keydown", "Backquote", 192);
    if (mode === "typed-key-held-across-focus") {
      const input = document.querySelector("textarea")!;
      input.focus();
      key("keydown", "KeyA", 65, {}, input);
      input.blur();
    }
    const ctrl = mode === "typed-key-held-across-focus";
    const mod = ctrl ? { ctrlKey: true } : { metaKey: true };
    key("keydown", ctrl ? "ControlLeft" : "MetaLeft", ctrl ? 17 : 91, mod);
    key("keydown", "KeyD", 68, mod);
    key("keyup", "KeyD", 68, mod);
    key("keyup", ctrl ? "ControlLeft" : "MetaLeft", ctrl ? 17 : 91);
    if (mode === "Meta-tail-PTT") key("keyup", "Backquote", 192);
    if (mode === "typed-key-held-across-focus") key("keyup", "KeyA", 65);
    await vi.advanceTimersByTimeAsync(16);
    expect(roleDisplay, "сайт принял команду").toBe(false);
    expect(snap()).toEqual([false, false]);
    key("keydown", "KeyV", 86);
    await vi.advanceTimersByTimeAsync(100);
    expect(snap(), "V показывает").toEqual([true, true]);
    key("keyup", "KeyV", 86);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(snap(), "ручное скрытие этой ночи, а не ночной автопоказ").toEqual([false, false]);
  },
);
