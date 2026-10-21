// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5, B02/H01: команда ролей сайту — только ПРИНЯТАЯ им
// (preventDefault его обёртки хоткеев); настоящий hotkeys-js сайта.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("@core/env", () => ({ browser: { runtime: { id: "audit5" }, storage: { local: { get: async () => ({}), set: async () => {} } } } }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
vi.mock("@content/panels/obs-panel", () => ({ obsAutoScenesActive: () => false, nightSceneSafeForRoleShow: () => true, setRoleSceneGateListener: () => () => {} }));
import { autoStartFeature } from "@content/features/auto-start";
import { roleFakerFeature } from "@content/features/role-faker";
import { releasePins } from "@content/role-pin";
const src = readFileSync("tests/fixtures/bundle-snippets/room-hotkeys.txt", "utf8").split("\n").slice(1).join("\n");
const factory = new Function("window", "document", "navigator", `var ${src.slice(0, src.indexOf("var _h=gh;"))}; return gh;`);
let hk: any, flag: boolean, toggles: number;
const hidden = () => !!document.getElementById("polemica-role-hide");
const tick = (ms = 1) => vi.advanceTimersByTimeAsync(ms);
function key(code: string, type = "keydown", extra: KeyboardEventInit = {}, target: EventTarget = document) {
 const keyCode = code.startsWith("Key") ? code.charCodeAt(3) : ({ Backquote:192, MetaLeft:91, ControlLeft:17 } as Record<string, number>)[code] || 0;
 target.dispatchEvent(new KeyboardEvent(type, { bubbles:true, cancelable:true, code, key:code === "MetaLeft" ? "Meta" : code, keyCode, which:keyCode, ...extra }));
}
function press(code: string, extra: KeyboardEventInit = {}, target: EventTarget = document) { key(code,"keydown",extra,target); key(code,"keyup",extra,target); }
function mount() {
 document.querySelector(".players")!.innerHTML = '<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div><div class="player"><span class="player__role role peer"><svg><use href="#mafia"></use></svg></span></div>';
 applyFlag();
}
function applyFlag() { document.querySelectorAll<HTMLElement>(".player__role").forEach(el => el.style.display=flag ? "" : "none"); }
function install(shortcut: string) {
 hk(shortcut, () => { toggles++; flag=!flag; queueMicrotask(applyFlag); return false; }); // как обёртка сайта
}
function enable() {
 autoStartFeature.enable({ settings: { auto_accept_enabled:false, skip_start_screen_enabled:false, auto_hide_roles_enabled:true, role_phase_auto_switch_enabled:false, hotkey_role_hide:"KeyH", hotkey_role_peek:"KeyV" } } as never);
}
function picture() { return Array.from(document.querySelectorAll(".player__role")).map(el => { const s=getComputedStyle(el); return s.display!=="none" && s.visibility!=="hidden" && s.opacity!=="0"; }); }
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000);
 document.head.replaceChildren(); document.body.className="";
 document.body.innerHTML='<div class="roller"><div class="new-stage">Идет набор игроков</div></div><div class="players"></div><textarea></textarea>';
 hk=factory(window,document,navigator); flag=false; toggles=0;
});
afterEach(async () => {
 roleFakerFeature.disable(); autoStartFeature.disable(); releasePins(); hk.unbind();
 window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus"));
 await Promise.resolve(); vi.clearAllTimers(); vi.useRealTimers(); document.head.replaceChildren(); document.body.replaceChildren();
});

test.each(["control", "swallowed-hide-held", "typed-key-held", "meta-tail"])("accepted native Show must take effect: %s", async mode => {
 install("ctrl+d,command+d"); mount(); enable(); await tick(1000);
 expect(picture()).toEqual([false,false]);
 if(mode === "swallowed-hide-held") {
  press("KeyH"); await tick(1000); // our Show while native flag stays false
  key("KeyH"); // our Hide, swallowed before native dispatcher
  expect(hk.getPressedKeyCodes()).toEqual([]);
 } else if(mode === "typed-key-held") {
  const ta=document.querySelector("textarea")!; ta.focus(); key("KeyQ","keydown",{},ta); ta.blur();
  expect(hk.getPressedKeyCodes()).toEqual([]);
 } else if(mode === "meta-tail") {
  key("Backquote"); key("MetaLeft","keydown",{metaKey:true});
 }
 await tick(1000);
 press("KeyD",mode === "meta-tail" ? {metaKey:true} : {ctrlKey:true});
 await tick(16);
 expect(toggles,"real native matcher accepted exactly one Show").toBe(1);
 expect(flag).toBe(true);
 const first=picture();
 await tick(12000);
 expect({first,settled:picture()},"accepted site Show must persist after settling").toEqual({first:[true,true],settled:[true,true]});
});

test.each(["control", "wrong-profile-ctrlD", "wrong-profile-late-mount", "both-ctrl-meta"])("rejected native combination must not invalidate own Show before mount: %s", async mode => {
 flag=true;
 install(mode === "both-ctrl-meta" ? "ctrl+d,command+d" : "d");
 enable(); await tick(1000);
 press("KeyD",mode === "both-ctrl-meta" ? {ctrlKey:true} : {}); // actually accepted native Hide, before roles exist
 expect(toggles).toBe(1); expect(flag).toBe(false);
 await tick(1000); press("KeyH"); // explicit newer Show; native is still false
 expect(hidden()).toBe(false); await tick(1000);
 if(mode !== "control") press("KeyD",mode === "both-ctrl-meta" ? {ctrlKey:true,metaKey:true} : {ctrlKey:true});
 expect(toggles,"real native dispatcher rejected this later combo").toBe(1);
 expect(flag).toBe(false);
 await tick(mode === "wrong-profile-late-mount" ? 1000 : 100); mount(); await tick(16);
 const first=picture(); await tick(12000);
 expect({first,settled:picture()},"unchanged old native false must not erase our newer Show").toEqual({first:[true,true],settled:[true,true]});
});

test("conditional non-QWERTY: site keyCode D on physical KeyJ must adopt accepted Show", async () => {
 install("d"); mount(); enable(); await tick(1000);
 press("KeyJ",{key:"d",keyCode:68,which:68}); await tick(16);
 expect(toggles).toBe(1); expect(flag).toBe(true);
 expect(picture()).toEqual([true,true]);
});

test.each(["ctrl", "meta", "typed-then-released", "extra-key-rejected"])("native acceptance controls: %s", async mode => {
 install("ctrl+d,command+d"); mount(); enable(); await tick(1000);
 if(mode === "typed-then-released") {
  const ta=document.querySelector("textarea")!; ta.focus(); press("KeyQ",{},ta); ta.blur();
 }
 if(mode === "extra-key-rejected") key("Backquote");
 press("KeyD",mode === "meta" ? {metaKey:true} : {ctrlKey:true}); await tick(16);
 const accepted=mode !== "extra-key-rejected";
 expect(toggles).toBe(accepted ? 1 : 0); expect(flag).toBe(accepted);
 expect(picture()).toEqual([accepted,accepted]);
});

test("site Hide is adopted even with a phantom held key", async () => {
 flag=true; install("ctrl+d"); mount(); enable(); await tick(1000); press("KeyH");
 const ta=document.querySelector("textarea")!; ta.focus(); key("KeyQ","keydown",{},ta); ta.blur();
 press("KeyD",{ctrlKey:true}); await tick(16);
 expect(toggles).toBe(1); expect(flag).toBe(false); expect(picture()).toEqual([false,false]);
});
