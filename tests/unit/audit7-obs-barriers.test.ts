// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №7: B01 (D/V в кадре pre-day), B03 (повторный уход под V), H01 (застрявшая подпись при вкл).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const wire = vi.hoisted(() => ({
  listeners: new Set<any>(), scene: "night", refuse: false, client: null as any,
  sent: [] as Array<{ scene: string; visible: boolean[]; at: number }>,
  visible: (() => [] as boolean[]),
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { set: async () => {} } },
  runtime: { id: "audit7-obs", getManifest: () => ({ version: "9.68.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (f: any) => { wire.listeners.add(f); return () => wire.listeners.delete(f); },
  sendRuntime: async (msg: any) => {
    if (msg.command === "get_status") return { success: true, data: wire.client ? wire.client.getStatus() : { connected: true, currentScene: wire.scene, sessionId: "s", scenes: [] } };
    if (msg.command === "set_scene") {
      if (wire.client) { await wire.client.setCurrentScene(msg.data.sceneName); return { success: true }; }
      wire.sent.push({ scene: msg.data.sceneName, visible: wire.visible(), at: Date.now() });
      if (wire.refuse) return { success: true, data: { ignored: "not_owner" } };
      wire.scene = msg.data.sceneName;
      for (const f of wire.listeners) f({ type: "obs_event", eventType: "obs_scene_changed", data: wire.scene });
      return { success: true };
    }
  },
  broadcastToGameTabs: async (msg: any) => { await Promise.resolve(); for (const f of wire.listeners) f(msg); }, sendToActiveTabStrict: vi.fn(),
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";
import { domObserver } from "@core/dom";
import { ObsClient } from "../../src/background/obs-client";
const defaults = {
  obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
};
let settings = { ...defaults };
const ctx = () => ({ settings }) as never;
const visible = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
});
const wait = (n: number) => vi.advanceTimersByTimeAsync(n);
async function micro() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function stage(current: string, next = "") {
  document.querySelector(".substage.current")!.textContent = current;
  document.querySelector(".substage.next")!.textContent = next;
}
function update(patch: Partial<typeof settings>) {
  settings = { ...settings, ...patch }; autoStartFeature.update!(ctx()); obsPanelFeature.update!(ctx());
}
function key(code: string, type = "keydown") { document.dispatchEvent(new KeyboardEvent(type, { code, keyCode: code.charCodeAt(3), bubbles: true, cancelable: true })); }
async function boot() { autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx()); await wait(6500); expect(visible()).toEqual([true, true]); }
async function barrier() {
  stage("День | Речь игрока", "День | Голосование");
  for (let i = 0; i < 2000 && document.querySelector<HTMLElement>(".my-role")!.style.visibility !== "hidden"; i++) await wait(1);
  expect(document.querySelector<HTMLElement>(".my-role")!.style.visibility).toBe("hidden");
  expect(wire.sent.filter(x => x.scene === "day")).toHaveLength(0);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000);
  Object.assign(domObserver, { lastFlushAt: 0, lastSlowLog: 0 });
  settings = { ...defaults }; wire.scene = "night"; wire.refuse = false; wire.sent = []; wire.visible = visible; wire.client = null;
  history.replaceState(null, "", "/game/1"); document.head.innerHTML = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div><div class="substage next">Ночь | Стрельба</div></div></div>
    <div class="player my-player"><span class="player__role role my-role">SELF</span></div><div class="player"><span class="player__role role">PEER</span></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  wire.client?.disconnect(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.innerHTML = "";
});

test.each(["KeyD", "KeyV"])("pre-day must remain hidden if %s starts during render wait", async code => {
  await boot(); await barrier(); await wait(10);
  key(code); if (code === "KeyD") key(code, "keyup");
  if (code === "KeyV") expect(isPeeking()).toBe(true);
  await wait(25);
  expect.soft(wire.sent.find(x => x.scene === "day")?.visible).toEqual([false, false]);
  await wait(12000);
  expect(visible(), "post-DAY whole table should stay safe").toEqual([false, false]);
});

test("stale day label arising inside confirmation delay must retain private NIGHT", async () => {
  await boot(); stage("День | Речь игрока", "День | Голосование");
  // First evaluation is after the ordinary 150ms debounce, confirmation 350ms later.
  await wait(400); stage("День | Речь игрока", "Ночь | Стрельба");
  await wait(6000);
  expect.soft(wire.sent.filter(x => x.scene === "day")).toHaveLength(0);
  expect.soft(wire.scene).toBe("night");
  expect.soft(visible(), "stale label leaves unwanted hiding throughout the night").toEqual([true, true]);
  stage("Ночь | Стрельба", "День | Речь игрока"); await wait(6000);
  expect(visible()).toEqual([true, true]);
});

test("reenable with stale DAY label must not treat remembered NIGHT as a new day", async () => {
  await boot(); update({ obs_auto_mode_enabled: false });
  stage("День | Речь игрока", "Ночь | Стрельба"); await wait(50);
  update({ obs_auto_mode_enabled: true }); await wait(6000);
  expect.soft(wire.sent.filter(x => x.scene === "day")).toHaveLength(0);
  expect.soft(wire.scene).toBe("night");
  expect(visible()).toEqual([true, true]);
});

async function realTransport() {
  class Socket {
    static OPEN = 1; readyState = 1;
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { queueMicrotask(() => this.receive(0, { obsWebSocketVersion: "5.6.3", rpcVersion: 1 })); }
    receive(op: number, d: any) { this.onmessage?.({ data: JSON.stringify({ op, d }) }); }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg.op === 1) queueMicrotask(() => this.receive(2, { negotiatedRpcVersion: 1 }));
      if (msg.op !== 6) return;
      const d = msg.d;
      const changing = d.requestType === "SetCurrentProgramScene";
      if (changing) {
        wire.sent.push({ scene: d.requestData.sceneName, visible: visible(), at: Date.now() });
        wire.scene = d.requestData.sceneName;
      }
      const reply = () => {
        if (changing) this.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: wire.scene } });
        this.receive(7, { requestId: d.requestId, requestType: d.requestType, requestStatus: { result: true, code: 100 }, responseData:
          d.requestType === "GetSceneList" ? { scenes: [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: wire.scene } : {} });
      };
      if (changing) setTimeout(reply, 200); else queueMicrotask(reply);
    }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal("WebSocket", Socket);
  wire.client = new ObsClient(); await wire.client.connect("ws://localhost:4455"); await micro();
}

test.each(["KeyD", "KeyV"])("REAL ObsClient pre-day %s input during wait is safe before any scene echo", async code => {
  await realTransport(); await boot(); await barrier(); await wait(10);
  key(code); if (code === "KeyD") key(code, "keyup");
  await wait(40);
  expect(wire.scene).toBe("day");
  expect.soft(wire.sent.find(x => x.scene === "day")?.visible).toEqual([false, false]);
  expect.soft(visible(), "actual DAY before its delayed event/ACK").toEqual([false, false]);
  await wait(12000);
  expect(visible(), "after real event, ACK and repeated heal").toEqual([false, false]);
});

test('REAL ObsClient repeated departure under same safe-started V must protect after native menu Show',async()=>{
 await realTransport();await boot();
 const nativeMenu=(show:boolean)=>{const b=document.createElement('button');b.textContent=show?'Показать роли':'Скрыть роли';b.onclick=()=>queueMicrotask(()=>document.querySelectorAll<HTMLElement>('.player__role').forEach(el=>el.style.display=show?'':'none'));document.body.appendChild(b);b.click();b.remove();};
 const scene=(name:string)=>{wire.scene=name;(wire.client as any).socket.receive(5,{eventType:'CurrentProgramSceneChanged',eventIntent:4,eventData:{sceneName:name}});};
 nativeMenu(false);await wait(10);expect(visible()).toEqual([false,false]);
 key('KeyV');expect(isPeeking()).toBe(true);expect(visible()).toEqual([true,true]);
 scene('day');await wait(250);expect(visible(),'first departure fails safe').toEqual([false,false]);
 scene('night');await wait(4000);
 nativeMenu(true);await wait(10);expect(visible(),'explicit site menu Show on returned private scene').toEqual([true,true]);
 scene('day');await wait(100);
 expect.soft(visible(),'second DAY while same V remains held must close table again').toEqual([false,false]);
  await wait(12000);expect(visible(),'peer cannot remain in second public DAY').toEqual([false,false]);
});
