// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы второго внешнего аудита видимости ролей (docs/audit-role-stream-2-2026-10-21.md),
// перенесены как регрессионные после перехода на «одну власть» (21.10.2026).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/dom", () => ({ onDomChangeImmediate: (fn: any) => { const mo = new MutationObserver(fn); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] }); return () => mo.disconnect(); },  onDomChange: vi.fn(() => () => {}), safeClick: vi.fn(() => true), isVisible: vi.fn(() => true) }));
vi.mock("@core/env", () => ({ browser: { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } }, runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/messaging", () => ({ onMessage: vi.fn(() => () => {}), sendRuntime: vi.fn(async () => ({ success: true })), broadcastToGameTabs: vi.fn(), sendToActiveTabStrict: vi.fn() }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature } from "@content/features/auto-start";
import { resetRolePinForTest } from "@content/role-pin";

const bundle = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const hotkeysCode = bundle.slice(bundle.indexOf("function eh(e,t,i)"), bundle.indexOf("var _h=gh;") + "var _h=gh;".length);
let flag = true;
let hotkeys: any;
function commit() {
  flag = !flag;
  queueMicrotask(() => document.querySelectorAll<HTMLElement>(".player__role").forEach(el => { el.style.display = flag ? "" : "none"; }));
}
function key(type: string, code = "KeyD", extra: KeyboardEventInit = {}, target: EventTarget = document) {
  const kc = code === "Backquote" ? 192 : code === "MetaLeft" ? 91 : code === "KeyX" ? 88 : 68;
  target.dispatchEvent(new KeyboardEvent(type, { code, key: code === "MetaLeft" ? "Meta" : "d", keyCode: kc, which: kc, bubbles: true, cancelable: true, ...extra }));
}
function visible() {
  return [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => el.style.display !== "none" && el.style.visibility !== "hidden" && !document.getElementById("polemica-role-hide"));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_900_000_000_000)); resetRolePinForTest(); flag = true;
  document.body.innerHTML = '<div class="stage"><div class="substage current">Ход мафии</div></div><div class="player my-player"><span class="player__role role my-role mafia"><svg><use href="#mafia"></use></svg></span></div><div class="player"><span class="player__role role godfather"><svg><use href="#godfather"></use></svg></span></div>';
  hotkeys = new Function("window", "document", "var Zd=false;" + hotkeysCode + ";return gh;")(window, document);
  hotkeys("d", commit);
});
afterEach(() => { autoStartFeature.disable(); hotkeys.unbind(); vi.clearAllTimers(); vi.useRealTimers(); });
function enable() { autoStartFeature.enable({ settings: { auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: true, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV" } } as never); }
test.each(["hint", "text"])("AUDIT: menu %s click is a manual hide, V should restore it", async (part) => {
  enable(); await vi.advanceTimersByTimeAsync(12_000);
  expect(visible()).toEqual([true, true]);
  const li = document.createElement("li"); li.innerHTML = '<span class="text">Скрыть роли</span><span class="hint">D</span>'; document.body.append(li); li.addEventListener("click", commit);
  li.querySelector<HTMLElement>(`.${part}`)!.click(); await vi.advanceTimersByTimeAsync(200);
  expect(visible()).toEqual([false, false]);
  key("keydown", "KeyV", { keyCode: 86, which: 86 }); await vi.advanceTimersByTimeAsync(100);
  key("keyup", "KeyV", { keyCode: 86, which: 86 }); await vi.advanceTimersByTimeAsync(2_000);
  console.log("AUDIT menu after V", { part, flag, visible: visible() });
  expect(visible()).toEqual([false, false]);
});
test("AUDIT: readonly-input D is a manual hide, V should restore it", async () => {
  enable(); await vi.advanceTimersByTimeAsync(12_000);
  const input = document.createElement("input"); input.readOnly = true; document.body.append(input); input.focus();
  key("keydown", "KeyD", {}, input); key("keyup", "KeyD", {}, input); await vi.advanceTimersByTimeAsync(200);
  // Поле только для чтения — не ввод (как у фильтра сайта): D в нём — наша
  // клавиша скрытия, сайту не уходит (аудит №7, C02).
  expect(flag).toBe(true); expect(visible()).toEqual([false, false]); input.blur();
  key("keydown", "KeyV", { keyCode: 86, which: 86 }); await vi.advanceTimersByTimeAsync(100);
  key("keyup", "KeyV", { keyCode: 86, which: 86 }); await vi.advanceTimersByTimeAsync(2_000);
  console.log("AUDIT readonly after V", { flag, visible: visible() });
  expect(visible()).toEqual([false, false]);
});
test("AUDIT real dispatcher Meta tail discards earlier PTT unlike fuzz model", () => {
  let count = 0; hotkeys("command+d", () => count++);
  key("keydown", "Backquote"); key("keydown", "MetaLeft", { metaKey: true }); key("keydown", "KeyD", { metaKey: true });
  console.log("AUDIT Meta tail", { pressed: hotkeys.getPressedKeyCodes(), count });
  expect(count).toBe(1);
});
test.each([false, true])("AUDIT roleReveal after hide (CSS=%s)", async (css) => {
  autoStartFeature.enable({ settings: { auto_hide_roles_enabled: css, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV" } } as never);
  await vi.advanceTimersByTimeAsync(2_000);
  if (!css) { key("keydown"); key("keyup"); } await vi.advanceTimersByTimeAsync(200);
  expect(visible()).toEqual([false, false]);
  const notices = document.createElement("div"); notices.className = "player__notifications-block notifications-block";
  notices.innerHTML = '<span class="notification-element roleReveal"><span>Игрок является мафией</span></span>';
  document.querySelectorAll(".player")[1].append(notices);
  const computed = getComputedStyle(notices.querySelector(".roleReveal")!);
  console.log("AUDIT native hidden roleReveal", { roles: visible(), css: !!document.getElementById("polemica-role-hide"), visibility: computed.visibility, display: computed.display, opacity: computed.opacity });
  expect(computed.visibility).toBe("hidden");
});
