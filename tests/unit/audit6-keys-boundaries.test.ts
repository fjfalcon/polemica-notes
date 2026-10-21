// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №6, C02–C04: логический D, чужой preventDefault, два нажатия до таймера.
// Audit-only desired-behaviour probes, not fixes. Conditional reachability is in report.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit6-keys" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@core/messaging", () => ({ sendRuntime: async () => ({ success: true, data: { muted: false } }), onMessage: () => () => {} }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { roleFakerFeature, isRoleFaked } from "@content/features/role-faker";
import { releasePins } from "@content/role-pin";
import { micSyncFeature } from "@content/features/mic-sync";
const src = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const factory = new Function("window", "document", "navigator", `var ${src.slice(0, src.indexOf("var _h=gh;"))}; return gh;`);
let hk: any, flag: boolean, toggles: number, epoch = 0;
let cleanups: Array<() => void> = [];
const tick = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}) {
 const keyCode = code.startsWith("Key") ? code.charCodeAt(3) : 0;
 const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key: code, keyCode, which: keyCode, ...extra });
 document.dispatchEvent(e); return e;
}
function press(code: string, extra: KeyboardEventInit = {}) { const e = key(code, "keydown", extra); key(code, "keyup", extra); return e; }
function applyFlag() { document.querySelectorAll<HTMLElement>(".player__role").forEach(el => el.style.display = flag ? "" : "none"); }
function mount() {
 document.querySelector(".players")!.innerHTML = '<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role peer"><svg><use href="#mafia"></use></svg></span></div>';
 applyFlag();
}
function install(shortcut = "d") { hk(shortcut, () => { toggles++; flag = !flag; queueMicrotask(applyFlag); return false; }); }
function enable(patch = {}) {
 const settings = { auto_accept_enabled: false, skip_start_screen_enabled: false, auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyH", hotkey_role_peek: "KeyV", hotkey_role_fake: "KeyF", hotkey_role_reset: "KeyE", ...patch };
 autoStartFeature.enable({ settings } as never); roleFakerFeature.enable({ settings } as never);
}
function picture() { return Array.from(document.querySelectorAll(".player__role")).map(el => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"; }); }
beforeEach(() => {
 vi.useFakeTimers(); vi.advanceTimersByTime(++epoch * 100000); vi.setSystemTime(1_900_000_000_000);
 document.head.replaceChildren(); document.body.className = "";
 document.body.innerHTML = '<div class="stage"><div class="substage current">Речь игрока</div></div><div class="players"></div>';
 hk = factory(window, document, navigator); flag = false; toggles = 0;
});
afterEach(async () => {
 cleanups.forEach(fn => fn()); cleanups = [];
 micSyncFeature.disable(); roleFakerFeature.disable(); autoStartFeature.disable(); releasePins(); hk.unbind();
 window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus"));
 await Promise.resolve(); vi.clearAllTimers(); vi.useRealTimers(); document.head.replaceChildren(); document.body.replaceChildren();
});

test.each(["peek", "fake", "repeat"])("CONDITIONAL logical D on physical KeyJ must be protected: %s", async mode => {
 install(); mount(); enable(); await tick(1000);
 if (mode === "peek") { key("KeyV"); expect(isPeeking()).toBe(true); }
 if (mode === "fake") { press("KeyF"); expect(isRoleFaked()).toBe(true); }
 press("KeyJ", { key: "d", keyCode: 68, which: 68, repeat: mode === "repeat" });
 await tick(16);
 const nativeToggles = toggles;
 if (mode === "peek") key("KeyV", "keyup");
 if (mode === "fake") press("KeyE");
 await tick(12000);
 expect({ nativeToggles, final: picture() }, "a protected native D must not toggle or cancel restore-hide")
  .toEqual({ nativeToggles: 0, final: [false, false] });
});

test.each(["peek", "fake", "repeat"])("CONTROL physical KeyD is protected: %s", async mode => {
 install(); mount(); enable(); await tick(1000);
 if (mode === "peek") key("KeyV");
 if (mode === "fake") press("KeyF");
 press("KeyD", { repeat: mode === "repeat" }); await tick(16);
 if (mode === "peek") key("KeyV", "keyup");
 if (mode === "fake") press("KeyE");
 await tick(12000);
 expect({ toggles, final: picture() }).toEqual({ toggles: 0, final: [false, false] });
});

test.each([false, true])("CONDITIONAL unrelated document preventDefault must not become a role command: cancel=%s", async cancel => {
 flag = true; install(); enable(); await tick(1000);
 press("KeyD"); await tick(1000); // genuine native Hide, no roles mounted
 expect(toggles).toBe(1); expect(flag).toBe(false);
 press("KeyH"); await tick(1000); // explicit newer own Show
 const unrelated = (e: KeyboardEvent) => { if (cancel && e.ctrlKey) e.preventDefault(); };
 document.addEventListener("keydown", unrelated);
 cleanups.push(() => document.removeEventListener("keydown", unrelated));
 press("KeyD", { ctrlKey: true }); // real hotkeys rejects wrong modifier profile
 expect(toggles).toBe(1); expect(flag).toBe(false);
 await tick(1000); mount(); await tick(16); const first = picture(); await tick(12000);
 expect({ first, settled: picture() }, "rejected Ctrl+D must not erase newer own Show")
  .toEqual({ first: [true, true], settled: [true, true] });
});

// Некэнселябельный синтетический keydown — контракт API, не находка (аудит №6, §4).
test.each([true])("CONTRACT ONLY accepted un-cancelable D: cancelable=%s", async cancelable => {
 install(); mount(); enable(); await tick(1000);
 const e = press("KeyD", { cancelable }); await tick(16);
 expect(toggles).toBe(1); expect(flag).toBe(true);
 expect({ prevented: e.defaultPrevented, final: picture() }).toEqual({ prevented: cancelable, final: [true, true] });
});

test.each([false, true])("SCHEDULING CONDITIONAL pending accepted D survives next rejected D before timer: extra=%s", async extra => {
 flag = true; install(); enable(); await tick(1000);
 press("KeyH"); await tick(1000); // own explicit Show, no roles yet
 const accepted = press("KeyD");
 await Promise.resolve(); // native update and normal microtask checkpoint, still no roles
 expect(accepted.defaultPrevented).toBe(true); expect(flag).toBe(false); expect(toggles).toBe(1);
 if (extra) {
  const rejected = press("KeyD", { ctrlKey: true });
  await Promise.resolve();
  expect(rejected.defaultPrevented).toBe(false); expect(toggles).toBe(1);
 }
 // User-interaction task(s) processed before zero-delay timer; first mount follows.
 mount(); await tick(16); const first = picture(); await tick(12000);
 expect({ first, settled: picture() }, "later rejected D must not delete earlier accepted Hide")
  .toEqual({ first: [false, false], settled: [false, false] });
});

test.each([74, 68])("LAYOUT CONDITIONAL real mic-sync cancellation is not native role acceptance: keyCode=%d", async keyCode => {
 flag = true; install("ctrl+d"); enable(); await tick(1000);
 micSyncFeature.enable({ settings: { mic_sync_enabled: true, obs_enabled: true, mic_sync_input: "Mic/Aux", mic_sync_hotkey: "KeyJ" } } as never);
 press("KeyD", { ctrlKey: true }); await tick(1000); // actual native Hide before roles exist
 expect(toggles).toBe(1); expect(flag).toBe(false);
 press("KeyH"); await tick(1000); // own newer explicit Show
 const e = press("KeyJ", { keyCode, which: keyCode, key: keyCode === 68 ? "d" : "j" });
 expect(e.defaultPrevented, "real mic-sync binding cancels the default").toBe(true);
 expect(toggles, "native modifier profile rejected this unmodified key").toBe(1);
 await tick(1000); mount(); await tick(16); const first = picture(); await tick(12000);
 expect({ first, settled: picture() }, "mic-sync is not a role command and must not erase own Show")
  .toEqual({ first: [true, true], settled: [true, true] });
});
