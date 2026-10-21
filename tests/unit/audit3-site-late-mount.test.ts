// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// Настоящий SharedDomObserver: немедленный приём флага и обычный rAF/250ms-проход.
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit3" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";

const room = readFileSync("tests/fixtures/bundle-snippets/room-roles.txt", "utf8");
const hotkeyStart = room.indexOf('Zd="undefined"');
const hotkeyEnd = room.indexOf("var _h=gh;", hotkeyStart);
const factory = new Function("window", "document", "navigator", `var ${room.slice(hotkeyStart, hotkeyEnd)}; return gh;`);
const showStart = room.indexOf("za={beforeMount");
const showEnd = room.indexOf("const qa=", showStart);
const vShow = new Function(`const ${room.slice(showStart, showEnd)}; return za;`)();
let hotkeys: any;
let nativeFlag: boolean;
let useModifier = false;
const hidden = () => !!document.getElementById("polemica-role-hide");
const settle = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
function key(type: string, code: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key: code.slice(3).toLowerCase(), keyCode: code.charCodeAt(3), ...init }));
}
function press(code = "KeyD") { key("keydown", code); key("keyup", code); }
function mount() {
  const role = document.createElement("span");
  role.className = "player__role role mafia";
  vShow.beforeMount(role, { value: nativeFlag }, {});
  document.querySelector(".player")!.append(role);
  vShow.mounted(role, { value: nativeFlag }, {});
}
function install(flag: boolean, phase: boolean, autoHide: boolean, existing = false) {
  nativeFlag = flag;
  hotkeys = factory(window, document, navigator);
  hotkeys(useModifier ? "ctrl+d, command+d" : "d", () => { nativeFlag = !nativeFlag; });
  document.body.innerHTML = '<div class="stage"><div class="substage current">Ход мафии</div></div><div class="player"></div>';
  if (existing) mount();
  autoStartFeature.enable({ settings: { auto_accept_enabled: false, skip_start_screen_enabled: false, auto_hide_roles_enabled: autoHide, role_phase_auto_switch_enabled: phase, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV" } } as never);
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000); resetRolePinForTest(); useModifier = false; });
afterEach(() => { autoStartFeature.disable(); hotkeys?.unbind(); document.body.replaceChildren(); vi.clearAllTimers(); vi.useRealTimers(); });

test("control: known native-hidden flag, D-show then a newly mounted hidden role stays shown", async () => {
  install(false, false, false, true);
  await settle(); expect(hidden()).toBe(true);
  press(); await settle(); expect(hidden()).toBe(false);
  mount(); await settle(12000);
  expect(hidden()).toBe(false);
});
test("control: unknown native-visible flag, late first mount does not invent a hide", async () => {
  install(true, true, false);
  await settle(8000); expect(hidden()).toBe(false);
  mount(); await settle(12000);
  expect(hidden()).toBe(false);
});
test("NEW: night show completed before first native-hidden role mounts, must not hide again", async () => {
  install(false, true, false);
  await settle(8000); expect(hidden()).toBe(false);
  mount(); await settle(12000);
  console.log("AUDIT3 LATE NIGHT ROLE", { nativeFlag, hideCss: hidden(), inlineDisplay: document.querySelector<HTMLElement>(".player__role")!.style.display });
  expect(hidden(), "first mount with an unchanged false native flag is not a NEW site-hide decision after our night-show").toBe(false);
});
test("NEW: explicit D-show before first role mounts must survive its native-hidden mount", async () => {
  install(false, false, true);
  await settle(1000); expect(hidden()).toBe(true);
  press(); await settle(); expect(hidden()).toBe(false);
  await settle(1000); mount(); await settle(12000);
  console.log("AUDIT3 LATE ROLE AFTER MANUAL SHOW", { nativeFlag, hideCss: hidden() });
  expect(hidden(), "a late role did not change the site's false flag and must not cancel the player's later D-show").toBe(false);
});
test("NEW: ordinary lobby native Ctrl+D hide then our D show, game role arrival must respect latest show", async () => {
  useModifier = true;
  install(true, false, true); // Обычный лобби: roleDisplay начинается с true, роли ещё нет.
  document.querySelector(".stage")!.outerHTML = '<div class="new-stage"><div class="new-stage__name">Голосование за начало игры</div></div>';
  await settle(1000); expect(hidden()).toBe(true);
  key("keydown", "KeyD", { ctrlKey: true }); key("keyup", "KeyD");
  await settle(1000); expect(nativeFlag).toBe(false);
  press(); await settle(); expect(hidden()).toBe(false); // Более новое ручное решение показать.
  await settle(1000);
  document.querySelector(".new-stage")!.outerHTML = '<div class="stage"><div class="substage current">Раздача карт</div></div>';
  mount(); await settle(12000); // Началась раздача; сайт не меняет свой флаг.
  console.log("AUDIT3 LOBBY CTRL+D -> D -> FIRST ROLE", { nativeFlag, hideCss: hidden() });
  expect(hidden(), "roleDisplay remained false across game start; a new role must not override the latest explicit show").toBe(false);
});
