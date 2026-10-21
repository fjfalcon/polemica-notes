// @vitest-environment jsdom
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
const room = readFileSync("tests/fixtures/bundle-snippets/room-roles.txt", "utf8");
const start = room.indexOf('Zd="undefined"');
const end = room.indexOf("var _h=gh;", start);
const factory = new Function("window", "document", "navigator", `var ${room.slice(start, end)}; return gh;`);
let hk: any;
let clean: Array<() => void>;
const codes: Record<string, number> = { d: 68, v: 86, ptt: 192, ctrl: 17, meta: 91, shift: 16, alt: 18 };
function ev(type: string, key: string, props: KeyboardEventInit = {}, target: EventTarget = document, altGraph = false) {
  const e = new KeyboardEvent(type, { key: key === "meta" ? "Meta" : key, keyCode: codes[key], bubbles: true, cancelable: true, ...props });
  if (altGraph) Object.defineProperty(e, "getModifierState", { value: (k: string) => k === "AltGraph" });
  target.dispatchEvent(e);
}
beforeEach(() => {
  clean = [];
  const wrap = (target: Window | Document) => ({
    addEventListener(type: string, fn: EventListener, options?: boolean) { target.addEventListener(type, fn, options); clean.push(() => target.removeEventListener(type, fn, options)); },
  });
  hk = factory(wrap(window), wrap(document), navigator);
});
afterEach(() => { clean.forEach(fn => fn()); document.body.replaceChildren(); });
test("exact key set: physical PTT blocks D, releasing PTT restores ordinary D", () => {
  let n = 0; hk("d", () => n++);
  ev("keydown", "ptt"); ev("keydown", "d"); expect(n).toBe(0);
  ev("keyup", "d"); ev("keyup", "ptt"); ev("keydown", "d"); expect(n).toBe(1);
});
test("filter is before pressed-state, permits readonly, does not inspect activeElement", () => {
  let n = 0; hk("d", () => n++);
  const input = document.createElement("input"); document.body.append(input); input.focus();
  ev("keydown", "d", {}, input); expect(hk.getPressedKeyCodes()).toEqual([]); expect(n).toBe(0);
  input.readOnly = true; ev("keydown", "d", {}, input); expect(n).toBe(1);
  ev("keyup", "d", {}, input); input.readOnly = false;
  ev("keydown", "d", {}, document); expect(n).toBe(2);
});
test("repeats toggle natively; modifier registration does not accept plain D", () => {
  let n = 0; hk("ctrl+d, command+d", () => n++);
  ev("keydown", "d"); expect(n).toBe(0); ev("keyup", "d");
  ev("keydown", "d", { ctrlKey: true }); ev("keydown", "d", { ctrlKey: true, repeat: true }); expect(n).toBe(2);
});
test("Meta-tail permits Cmd+D after PTT; Meta-up clears all pressed keys", () => {
  let n = 0; hk("command+d", () => n++);
  ev("keydown", "ptt"); ev("keydown", "meta", { metaKey: true }); ev("keydown", "d", { metaKey: true }); expect(n).toBe(1);
  ev("keyup", "meta"); expect(hk.getPressedKeyCodes()).toEqual([]);
});
test("keyup dispatch exists and is opt-in; default keydown handler is not called on keyup", () => {
  let down = 0, up = 0;
  hk("d", () => down++); hk("d", { keydown: false, keyup: true }, () => up++);
  ev("keydown", "d"); expect([down, up]).toEqual([1, 0]);
  ev("keyup", "d"); expect([down, up]).toEqual([1, 1]); expect(hk.getPressedKeyCodes()).toEqual([]);
});
test("focus resets, blur does not, registration also resets; IME229 is not pressed", () => {
  hk("d", () => {}); ev("keydown", "ptt"); window.dispatchEvent(new Event("blur")); expect(hk.getPressedKeyCodes()).toEqual([192]);
  window.dispatchEvent(new Event("focus")); expect(hk.getPressedKeyCodes()).toEqual([]);
  ev("keydown", "ptt"); hk("v", () => {}); expect(hk.getPressedKeyCodes()).toEqual([]);
  ev("keydown", "d", { keyCode: 229 }); expect(hk.getPressedKeyCodes()).toEqual([]);
});
test("AltGraph synthesizes ctrl+alt, not plain D", () => {
  let n = 0; hk("d", () => n++); ev("keydown", "d", {}, document, true);
  expect(n).toBe(0); expect(hk.getPressedKeyCodes()).toEqual([17, 18, 68]);
});
test("actual native V callback honors togglingStreamAvailable, not unconditional fuzz video counter", () => {
  const pos = room.indexOf("var t={v:function(){", room.indexOf("addHotKeys:function"));
  const stop = room.indexOf(",m:function", pos);
  const body = room.slice(pos + "var t={v:".length, stop);
  let n = 0;
  const site = { $store: { state: { togglingStreamAvailable: false, videoTrackAvailable: true } }, toggleStreamStatus: () => n++ };
  const cb = new Function("e", `return ${body};`)(site);
  hk("v", cb); ev("keydown", "v"); ev("keyup", "v"); expect(n).toBe(0);
  site.$store.state.togglingStreamAvailable = true; ev("keydown", "v"); expect(n).toBe(1);
});
