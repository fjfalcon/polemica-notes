// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №4, H05: печать «в» в заметке и отвергнутая сайтом комбинация
// не «команда ролей» — первое скрытое монтирование не отменяет наш более новый показ.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit4" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";
// Настоящие hotkeys-js и vShow сайта — из сохранённых фрагментов бандла.
const hotkeysSrc = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const factory = new Function("window", "document", "navigator", `var ${hotkeysSrc.slice(0, hotkeysSrc.indexOf("var _h=gh;"))}; return gh;`);
const rolesSrc = readFileSync("tests/fixtures/bundle-snippets/room-roles.txt", "utf8");
const c = rolesSrc.indexOf("za={beforeMount"), haEnd = 'e.style.display=t?e._vod:"none"}';
const vShow = new Function(`const ${rolesSrc.slice(c, rolesSrc.indexOf(haEnd, c) + haEnd.length)}; return za;`)();
let hk: any, flag: boolean;
const hidden = () => !!document.getElementById("polemica-role-hide");
function press(target: EventTarget, init: KeyboardEventInit = {}) {
 for (const type of ["keydown", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code: "KeyD", key: "в", keyCode: 68, ...init }));
}
function mount() {
 const r = document.createElement("span"); r.className = "player__role role my-role mafia";
 vShow.beforeMount(r, { value: flag }, {}); document.querySelector(".player")!.append(r);
 vShow.mounted(r, { value: flag }, {});
 return r;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000); resetRolePinForTest(); });
afterEach(() => { autoStartFeature.disable(); hk?.unbind(); document.body.replaceChildren(); vi.clearAllTimers(); vi.useRealTimers(); });

test.each(["control-no-extra-command", "typing-D-100ms", "typing-D-1000ms", "PTT-blocked-CtrlD"])("first mount respects latest own show: %s", async mode => {
 flag = true; hk = factory(window, document, navigator);
 hk("ctrl+d, command+d", () => { flag = !flag; });
 document.body.innerHTML = '<div class="roller"><div class="new-stage">Идет набор игроков</div></div><div class="player my-player"></div><textarea></textarea>';
 autoStartFeature.enable({ settings: { auto_accept_enabled: false, skip_start_screen_enabled: false, auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV" } } as never);
 await vi.advanceTimersByTimeAsync(1000);
 press(document, { ctrlKey: true }); // Native accepted hide, no roles yet.
 expect(flag).toBe(false);
 await vi.advanceTimersByTimeAsync(1000);
 press(document); // Our more recent explicit show.
 expect(hidden()).toBe(false);
 await vi.advanceTimersByTimeAsync(1000);
 if (mode.startsWith("typing")) {
   const input = document.querySelector("textarea")!; input.focus(); press(input); input.blur();
 } else if (mode.startsWith("PTT")) {
   document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Backquote", key: "`", keyCode: 192 }));
   press(document, { ctrlKey: true });
   document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "Backquote", key: "`", keyCode: 192 }));
 }
 expect(flag, "the later input did NOT toggle the site's flag").toBe(false);
 expect(hidden()).toBe(false);
 await vi.advanceTimersByTimeAsync(mode.endsWith("1000ms") ? 1000 : 100);
 const r = mount(); await vi.advanceTimersByTimeAsync(12000);
 expect(hidden(), "unchanged native false must not cancel our later Show just because ordinary typing/rejected combo happened").toBe(false);
});
