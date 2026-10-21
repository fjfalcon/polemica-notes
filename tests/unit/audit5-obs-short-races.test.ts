// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №5: B03 (устаревшее восстановление фазы), H02, H03, §4.2, C06.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: any) => unknown>, client: null as any,
  actualScene: "night", refuse: false, sent: [] as string[],
  persisted: null as any, holdRestore: false, restores: [] as Array<() => void>,
  holdRemove: false, removes: [] as Array<() => void>,
  outbound: [] as Array<{ scene: string; visible: boolean[] }>,
  holdSceneEvents: false, sceneEvents: [] as Array<() => void>,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async (keys: any) => {
      const data: any = { obs_connection_state: { ...seam.client.getStatus(), timestamp: Date.now() }, obs_auto_scene_state: seam.persisted };
      if (seam.holdRestore && Array.isArray(keys) && keys.includes("obs_auto_scene_state")) await new Promise<void>(r => seam.restores.push(r));
      return Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, data[k]])) : { ...keys, ...data };
    },
    set: async () => {},
    remove: async () => { if (seam.holdRemove) await new Promise<void>(r => seam.removes.push(r)); seam.persisted = null; },
  }, sync: { set: async () => {} } },
  runtime: { id: "audit5-obs", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: any) => { seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); }; },
  sendRuntime: async (msg: any) => {
    if (msg.type !== "obs_command") return;
    if (msg.command === "get_status") return { success: true, data: seam.client.getStatus() };
    if (msg.command === "set_scene") {
      seam.sent.push(msg.data.sceneName);
      if (seam.refuse) return { success: true, data: { ignored: "not_owner" } };
      await seam.client.setCurrentScene(msg.data.sceneName);
      return { success: true };
    }
  },
  broadcastToGameTabs: async (msg: any) => {
    if (seam.holdSceneEvents && msg.eventType === "obs_scene_changed") await new Promise<void>(r => seam.sceneEvents.push(r));
    await Promise.resolve(); seam.messages.forEach(fn => fn(msg));
  },
  sendToActiveTabStrict: vi.fn(),
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";
import { ObsClient } from "../../src/background/obs-client";
import { domObserver } from "@core/dom";
const defaults = {
  obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
};
let settings = { ...defaults };
const ctx = () => ({ settings }) as never;
const visibility = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
});
function scene(name: string) {
  seam.actualScene = name;
  (seam.client as any).handleEvent({ eventType: "CurrentProgramSceneChanged", eventData: { sceneName: name } });
}
const phase = (p: "day" | "night") => { document.querySelector(".substage.current")!.textContent = p === "day" ? "День | речь игрока" : "Ночь | ход мафии"; };
function update(patch: Partial<typeof settings>) { settings = { ...settings, ...patch }; autoStartFeature.update!(ctx()); obsPanelFeature.update!(ctx()); }
const down = (code: string) => document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
const up = (code: string) => document.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
async function microtasks() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function boot() {
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
}
async function connectRealClient() {
  let connectedSocket: any;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { connectedSocket = this; queueMicrotask(() => this.receive(0, { obsWebSocketVersion: "5.6.3", rpcVersion: 1 })); }
    receive(op: number, d: any) { this.onmessage?.({ data: JSON.stringify({ op, d }) }); }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg.op === 1) queueMicrotask(() => this.receive(2, { negotiatedRpcVersion: 1 }));
      if (msg.op !== 6) return;
      const d = msg.d;
      if (d.requestType === "SetCurrentProgramScene") {
        seam.outbound.push({ scene: d.requestData.sceneName, visible: visibility() });
        seam.actualScene = d.requestData.sceneName;
      }
      queueMicrotask(() => {
        if (d.requestType === "SetCurrentProgramScene") this.receive(5, {
          eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: seam.actualScene },
        });
        this.receive(7, {
          requestId: d.requestId, requestType: d.requestType, requestStatus: { result: true, code: 100 },
          responseData: d.requestType === "GetSceneList" ? { scenes: [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: seam.actualScene } : {},
        });
      });
    }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal("WebSocket", Socket);
  seam.client = new ObsClient();
  await seam.client.connect("ws://localhost:4455"); await microtasks();
  return (name: string) => {
    seam.actualScene = name;
    connectedSocket.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: name } });
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  // performance.now restarts at 0 between fake-clock tests; production's clock does not.
  Object.assign(domObserver, { lastFlushAt: 0, lastSlowLog: 0 });
  settings = { ...defaults }; seam.messages = []; seam.actualScene = "night"; seam.refuse = false; seam.sent = [];
  seam.persisted = null; seam.holdRestore = false; seam.restores = []; seam.holdRemove = false; seam.removes = [];
  seam.outbound = []; seam.holdSceneEvents = false; seam.sceneEvents = [];
  history.replaceState(null, "", "/game/1"); document.head.innerHTML = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role">SELF</span></div>
    <div class="player"><span class="player__role role peer">PEER</span></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} });
  seam.client = new ObsClient(); Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s" });
  vi.spyOn(seam.client as any, "request").mockImplementation((type: any, data: any) => {
    if (type === "GetSceneList") return Promise.resolve({ scenes: [], currentProgramSceneName: seam.actualScene });
    if (type === "SetCurrentProgramScene") {
      seam.outbound.push({ scene: data.sceneName, visible: visibility() });
      scene(data.sceneName); return Promise.resolve({});
    }
    return Promise.resolve({});
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.innerHTML = "";
});

test.each([0, 1, 16, 100])("RED: missing own-role at public-scene gate, remount before NIGHT +%sms must not lose nightShow", async gap => {
  await boot();
  const own = document.querySelector(".my-player")!;
  own.remove();
  scene("day"); await microtasks();
  expect(visibility()).toEqual([false]);
  const fresh = own.cloneNode(true);
  document.body.append(fresh);
  if (gap) await vi.advanceTimersByTimeAsync(gap);
  scene("night"); await microtasks();
  await vi.advanceTimersByTimeAsync(12000);
  expect(seam.actualScene).toBe("night");
  expect(visibility(), "fresh own-role returns, but no manual hide or new game occurred").toEqual([true, true]);
});

test("CONTROL: retaining own-role across the same two scene events opens both", async () => {
  await boot(); scene("day"); await microtasks();
  expect(visibility()).toEqual([false, false]);
  scene("night"); await vi.advanceTimersByTimeAsync(3500);
  expect(visibility()).toEqual([true, true]);
});

// Contract-only: FeatureManager serializes enable/update; not a normal popup path.
test("CONTRACT ONLY: restoring an old persisted night after direct auto OFF reopens autoHide CSS", async () => {
  settings.auto_hide_roles_enabled = true;
  seam.persisted = { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); expect(seam.restores).toHaveLength(1);
  update({ obs_auto_mode_enabled: false });
  expect(visibility()).toEqual([false, false]);
  seam.restores.shift()!(); await enabling;
  expect(visibility(), "OFF cancelled OBS ownership; autoHide still owns privacy").toEqual([false, false]);
});

test("late disconnect storage cleanup must not erase a newer settled private night", async () => {
  await boot(); seam.holdRemove = true;
  seam.client.disconnect(); await microtasks(); expect(seam.removes).toHaveLength(1);
  Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s2" });
  seam.messages.forEach(fn => fn({ type: "obs_event", eventType: "obs_scenes_updated", data: { scenes: [], currentScene: "night" } }));
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  seam.removes.shift()!(); await microtasks();
  const trace = [{ ms: 0, visible: visibility() }];
  for (const gap of [100, 1900, 4000]) {
    await vi.advanceTimersByTimeAsync(gap);
    trace.push({ ms: trace.at(-1)!.ms + gap, visible: visibility() });
  }
  expect(trace, "disconnect continuation belongs to old connection").toEqual([0, 100, 2000, 6000].map(ms => ({ ms, visible: [true, true] })));
});

test("game day in final 100ms of nightShow timer remains hidden", async () => {
  settings.role_phase_auto_switch_enabled = true;
  await boot(); scene("day"); await microtasks(); scene("night");
  await vi.advanceTimersByTimeAsync(2900);
  phase("day"); await microtasks(); expect(visibility()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(116);
  const at116 = visibility();
  await vi.advanceTimersByTimeAsync(1000);
  expect({ at116, settled: visibility() }, "immediate day phase must dominate timer from former night").toEqual({ at116: [false, false], settled: [false, false] });
});

test("CONTROL: game day at least 600ms before the nightShow timer dominates it", async () => {
  settings.role_phase_auto_switch_enabled = true;
  await boot(); scene("day"); await microtasks(); scene("night");
  await vi.advanceTimersByTimeAsync(2400);
  phase("day"); await vi.advanceTimersByTimeAsync(716);
  expect(visibility()).toEqual([false, false]);
});

test("asynchronous persisted restore must not resurrect old NIGHT after live DAY confirmation", async () => {
  settings.role_phase_auto_switch_enabled = true;
  seam.persisted = { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); expect(seam.restores).toHaveLength(1);
  phase("day"); await vi.advanceTimersByTimeAsync(650);
  expect(seam.actualScene).toBe("day"); expect(visibility()).toEqual([false, false]);
  seam.restores.shift()!(); await enabling;
  await vi.advanceTimersByTimeAsync(16);
  expect(seam.actualScene, "live DAY is newer than persisted phase read at startup").toBe("day");
  expect(visibility()).toEqual([false, false]);
});

test("stale DAY restore after live NIGHT reveal must hide peers BEFORE public DAY command", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); expect(seam.restores).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(4000);
  expect(visibility()).toEqual([true, true]); // real live night detector and 3s show fired
  seam.holdSceneEvents = true;
  seam.restores.shift()!(); await enabling;
  await vi.advanceTimersByTimeAsync(100);
  const publicFrame = visibility();
  // FIXED: устаревший снимок не шлёт DAY вовсе; законный — только после pre-day.
  const outbound = seam.outbound.find(x => x.scene === "day") ?? { visible: [false, false] };
  if (seam.actualScene !== "day") expect(publicFrame.length).toBe(2);
  seam.sceneEvents.splice(0).forEach(r => r()); await microtasks();
  expect(seam.outbound.some(x => x.scene === "day"), "stale DAY snapshot after live NIGHT sends nothing").toBe(false);
  expect(visibility(), "live NIGHT stays shown").toEqual([true, true]);
});

test("short DAY restore after manual private Show must pre-hide peers before outbound DAY", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); await vi.advanceTimersByTimeAsync(100);
  down("KeyD"); up("KeyD"); expect(visibility()[1], "peer shown; own may stay under the unknown-phase pin").toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  seam.holdSceneEvents = true;
  seam.restores.shift()!(); await enabling;
  await vi.advanceTimersByTimeAsync(100);
  const publicFrame = visibility();
  // FIXED: устаревший снимок не шлёт DAY вовсе; законный — только после pre-day.
  const outbound = seam.outbound.find(x => x.scene === "day") ?? { visible: [false, false] };
  if (seam.actualScene !== "day") expect(publicFrame.length).toBe(2);
  seam.sceneEvents.splice(0).forEach(r => r()); await microtasks();
  // Инвариант: DAY уходит только со скрытым столом; на DAY кадр скрыт.
  expect({ outbound: outbound.visible, publicFrame: seam.actualScene === "day" ? publicFrame : [false, false] }).toEqual({ outbound: [false, false], publicFrame: [false, false] });
});

test("REAL TRANSPORT: delayed DAY restore bypasses pre-day after live night show", async () => {
  await connectRealClient();
  seam.persisted = { sessionId: seam.client.getStatus().sessionId, currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); await vi.advanceTimersByTimeAsync(4000);
  expect(visibility()).toEqual([true, true]);
  seam.holdSceneEvents = true;
  seam.restores.shift()!(); await enabling;
  await vi.advanceTimersByTimeAsync(100);
  const publicFrame = visibility();
  // FIXED: устаревший снимок не шлёт DAY вовсе; законный — только после pre-day.
  const outbound = seam.outbound.find(x => x.scene === "day") ?? { visible: [false, false] };
  if (seam.actualScene !== "day") expect(publicFrame.length).toBe(2);
  seam.sceneEvents.splice(0).forEach(r => r()); await microtasks();
  // Инвариант: DAY уходит только со скрытым столом; на DAY кадр скрыт.
  expect({ outbound: outbound.visible, publicFrame: seam.actualScene === "day" ? publicFrame : [false, false] }).toEqual({ outbound: [false, false], publicFrame: [false, false] });
});

test("REAL TRANSPORT CONTROL: normal live DAY path hides peers before same delayed scene event", async () => {
  await connectRealClient(); await boot();
  seam.holdSceneEvents = true;
  phase("day"); await vi.advanceTimersByTimeAsync(700);
  expect(seam.actualScene).toBe("day");
  expect(seam.outbound.find(x => x.scene === "day")!.visible).toEqual([false, false]);
  expect(visibility()).toEqual([false, false]);
  seam.sceneEvents.splice(0).forEach(r => r()); await microtasks();
});

test("REAL TRANSPORT: own-role remount in a one-ms DAY gate loses next nightShow", async () => {
  const program = await connectRealClient(); await boot();
  const own = document.querySelector(".my-player")!; own.remove();
  program("day"); await microtasks(); expect(visibility()).toEqual([false]);
  document.body.append(own.cloneNode(true));
  await vi.advanceTimersByTimeAsync(1);
  program("night"); await vi.advanceTimersByTimeAsync(12000);
  expect(seam.client.getStatus().currentScene).toBe("night");
  expect(visibility()).toEqual([true, true]);
});

test("REAL TRANSPORT: background-tab remount with 100ms DAY gate loses nightShow", async () => {
  const program = await connectRealClient(); await boot();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const own = document.querySelector(".my-player")!; own.remove();
  program("day"); await microtasks(); expect(visibility()).toEqual([false]);
  document.body.append(own.cloneNode(true));
  await vi.advanceTimersByTimeAsync(100);
  program("night"); await vi.advanceTimersByTimeAsync(12000);
  expect(seam.client.getStatus().currentScene).toBe("night");
  expect(visibility()).toEqual([true, true]);
});

test("SPA CONTRACT: old pending restore must not show new unknown room before a live phase", async () => {
  settings.auto_hide_roles_enabled = true;
  seam.persisted = { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); await vi.advanceTimersByTimeAsync(600);
  history.pushState(null, "", "/game/2");
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current"></div></div></div>
    <div class="player my-player"><span class="player__role role my-role">NEW SELF</span></div>
    <div class="player"><span class="player__role role peer">NEW PEER</span></div>`;
  await vi.advanceTimersByTimeAsync(300); expect(visibility()).toEqual([false, false]);
  seam.restores.shift()!(); await enabling;
  await vi.advanceTimersByTimeAsync(16);
  expect(visibility(), "new room is still unrecognized; restore belongs to old pathname").toEqual([false, false]);
});

test("probe: V queued nightShow after OBS auto OFF respects remaining autoHide", async () => {
  settings.auto_hide_roles_enabled = true;
  await boot(); scene("day"); await microtasks();
  down("KeyV"); expect(isPeeking()).toBe(true);
  scene("night"); await vi.advanceTimersByTimeAsync(3500);
  update({ obs_auto_mode_enabled: false });
  up("KeyV"); await vi.advanceTimersByTimeAsync(100);
  expect(visibility()).toEqual([true, true]);
});
