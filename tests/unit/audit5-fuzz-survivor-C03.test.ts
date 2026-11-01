// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, §F: свидетель мутанта C03 (Ctrl+D сайта под V).
// Independent witness for a fresh audit5 survivor. No production fix.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "audit5-F-C03", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: () => () => {}, sendRuntime: async () => ({}), broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({ nightSceneSafeForRoleShow: () => true, obsAutoScenesActive: () => false, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";

const room = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
if (start < 0 || end < 0) throw new Error("native hotkeys extraction boundary missing");
const nativeFactory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
let native: any;
let nativeFlag = false;
let nativeToggles = 0;
const writeNative = () => document.querySelectorAll<HTMLElement>(".player__role").forEach(el => { el.style.display = nativeFlag ? "" : "none"; });
const key = (type: string, code: string, ctrlKey = false) => document.dispatchEvent(new KeyboardEvent(type, {
  code, key: code === "KeyD" ? "d" : "v", keyCode: code === "KeyD" ? 68 : 86,
  which: code === "KeyD" ? 68 : 86, ctrlKey, bubbles: true, cancelable: true,
}));
const ctrlD = () => { key("keydown", "KeyD", true); key("keyup", "KeyD"); };
const snap = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_990_000_000_000));
  document.body.innerHTML = '<div class="player my-player"><span class="player__role role my-role"></span></div><div class="player"><span class="player__role role"></span></div>';
  nativeFlag = false; nativeToggles = 0; writeNative();
  native = nativeFactory(window, document, navigator);
  native("ctrl+d,command+d", () => { nativeFlag = !nativeFlag; nativeToggles++; queueMicrotask(writeNative); return false; });
  autoStartFeature.enable({ settings: {
    auto_accept_enabled: false, skip_start_screen_enabled: false,
    auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false,
    hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
  } } as never);
});
afterEach(() => {
  autoStartFeature.disable(); native?.unbind(); window.dispatchEvent(new Event("focus"));
  vi.clearAllTimers(); vi.useRealTimers(); document.head.innerHTML = "";
});

test.each(["native-flag", "next-native-command"] as const)("audit5-F C03: blocked Ctrl+D under active V preserves %s", async check => {
  expect(snap()).toEqual([false, false]);
  key("keydown", "KeyV"); await vi.advanceTimersByTimeAsync(16);
  expect(isPeeking()).toBe(true); expect(snap()).toEqual([true, true]);
  ctrlD(); await vi.advanceTimersByTimeAsync(16);
  expect(snap(), "held V alone does not reveal the lost native-state invariant").toEqual([true, true]);
  if (check === "native-flag") {
    expect(nativeToggles, "Ctrl+D must not reach native dispatcher while actual peek is active").toBe(0);
    expect(nativeFlag).toBe(false);
  }
  key("keyup", "KeyV"); await vi.advanceTimersByTimeAsync(100);
  expect(snap()).toEqual([false, false]);
  if (check === "next-native-command") {
    ctrlD(); await vi.advanceTimersByTimeAsync(16);
    expect(snap(), "the next accepted native Ctrl+D must show, not silently keep the table hidden").toEqual([true, true]);
  }
});
