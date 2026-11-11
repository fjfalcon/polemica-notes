// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №6: B01 (DAY под V), B02 (повтор DAY через список сцен), H02, M01, хвост pre-day.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: any) => unknown>, scene: "night", connected: true, session: "s",
  persisted: null as any, holdStatus: false, statuses: [] as Array<() => void>,
  holdRestore: false, restores: [] as Array<() => void>,
  holdAck: false, acks: [] as Array<() => void>,
  holdSaves: false, saves: [] as Array<() => void>,
  refuse: false,
  client: null as any, failPublic: false,
  sent: [] as Array<{ scene: string; visible: boolean[]; at: number }>,
  visible: (() => [] as boolean[]),
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async (keys: string[]) => {
      const data: any = {
        obs_connection_state: { connected: seam.connected, currentScene: seam.scene, sessionId: seam.session, timestamp: Date.now(), scenes: [] },
        obs_auto_scene_state: seam.persisted,
      };
      if (seam.holdRestore && keys.includes("obs_auto_scene_state")) await new Promise<void>(r => seam.restores.push(r));
      return Object.fromEntries(keys.map(k => [k, data[k]]));
    },
    set: async (data: any) => {
      if (seam.holdSaves) await new Promise<void>(r => seam.saves.push(r));
      if (data.obs_auto_scene_state) seam.persisted = data.obs_auto_scene_state;
    }, remove: async () => {},
  }, sync: { set: async () => {} } },
  runtime: { id: "audit6-obs", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: any) => { seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); }; },
  sendRuntime: async (msg: any) => {
    if (msg.type !== "obs_command") return;
    if (msg.command === "get_status") {
      const data = seam.client ? seam.client.getStatus() : { connected: seam.connected, currentScene: seam.scene, sessionId: seam.session, scenes: [] };
      if (seam.holdStatus) await new Promise<void>(r => seam.statuses.push(r));
      return { success: true, data };
    }
    if (msg.command === "set_scene") {
      if (seam.client) {
        await seam.client.setCurrentScene(msg.data.sceneName);
        return { success: true };
      }
      seam.sent.push({ scene: msg.data.sceneName, visible: seam.visible(), at: Date.now() });
      if (seam.refuse) return { success: true, data: { ignored: "not_owner" } };
      seam.scene = msg.data.sceneName;
      seam.messages.forEach(fn => fn({ type: "obs_event", eventType: "obs_scene_changed", data: seam.scene }));
      if (seam.holdAck) await new Promise<void>(r => seam.acks.push(r));
      return { success: true };
    }
  },
  broadcastToGameTabs: async (msg: any) => { await Promise.resolve(); seam.messages.forEach(fn => fn(msg)); },
  sendToActiveTabStrict: vi.fn(),
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
const visibility = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
});
const event = (eventType: string, data?: any) => seam.messages.forEach(fn => fn({ type: "obs_event", eventType, data }));
function scene(name: string) { seam.scene = name; event("obs_scene_changed", name); }
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
  let socket: any;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { socket = this; queueMicrotask(() => this.receive(0, { obsWebSocketVersion: "5.6.3", rpcVersion: 1 })); }
    receive(op: number, d: any) { this.onmessage?.({ data: JSON.stringify({ op, d }) }); }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg.op === 1) queueMicrotask(() => this.receive(2, { negotiatedRpcVersion: 1 }));
      if (msg.op !== 6) return;
      const d = msg.d;
      const failure = d.requestType === "SetCurrentProgramScene" && d.requestData.sceneName === "day" && seam.failPublic;
      if (d.requestType === "SetCurrentProgramScene") {
        seam.sent.push({ scene: d.requestData.sceneName, visible: visibility(), at: Date.now() });
        if (!failure) seam.scene = d.requestData.sceneName;
      }
      queueMicrotask(() => {
        if (d.requestType === "SetCurrentProgramScene" && !failure) this.receive(5, {
          eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: seam.scene },
        });
        this.receive(7, {
          requestId: d.requestId, requestType: d.requestType,
          requestStatus: { result: !failure, code: failure ? 600 : 100, comment: failure ? "Scene not found" : "" },
          responseData: d.requestType === "GetSceneList" ? { scenes: seam.failPublic ? [{ sceneName: "night" }] : [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: seam.scene } : {},
        });
      });
    }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal("WebSocket", Socket);
  seam.client = new ObsClient(); await seam.client.connect("ws://localhost:4455"); await microtasks();
  return (name: string) => {
    seam.scene = name;
    socket.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: name } });
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  Object.assign(domObserver, { lastFlushAt: 0, lastSlowLog: 0 });
  settings = { ...defaults }; seam.messages = []; seam.scene = "night"; seam.session = "s"; seam.connected = true;
  seam.persisted = null; seam.holdStatus = false; seam.statuses = []; seam.holdRestore = false; seam.restores = [];
  seam.holdAck = false; seam.acks = []; seam.sent = []; seam.visible = visibility;
  seam.holdSaves = false; seam.saves = [];
  seam.refuse = false;
  seam.client = null; seam.failPublic = false;
  history.replaceState(null, "", "/game/1"); document.head.innerHTML = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role">SELF</span></div>
    <div class="player"><span class="player__role role peer">PEER</span></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.innerHTML = "";
});

test("first get_status await must not let stale DAY phase overwrite confirmed live NIGHT", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdStatus = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); expect(seam.statuses).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(6500);
  expect(visibility()).toEqual([true, true]);
  // Another room/tab shares OBS session and the persisted phase key; even a
  // not_owner tab writes its detected phase before requesting the scene.
  expect(seam.persisted.currentTimeOfDay).toBe("night");
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.statuses.shift()!(); await enabling; await vi.advanceTimersByTimeAsync(100);
  expect(seam.sent.some(x => x.scene === "day"), "startup snapshot preceded live night confirmation").toBe(false);
  expect(visibility()).toEqual([true, true]);
});

test("CONTROL delay second storage await is cancelled by phaseEpoch", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdRestore = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await microtasks(); expect(seam.restores).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  expect(seam.persisted.currentTimeOfDay).toBe("night");
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.restores.shift()!(); await enabling; await vi.advanceTimersByTimeAsync(100);
  expect(seam.sent.some(x => x.scene === "day")).toBe(false);
  expect(visibility()).toEqual([true, true]);
});

test("settled night must survive late initial status then stale DAY restore without unrelated hide", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdStatus = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.statuses.shift()!(); await enabling;
  const trace: any[] = [];
  for (const gap of [0, 100, 1900, 2000, 4000]) {
    await vi.advanceTimersByTimeAsync(gap);
    trace.push({ at: Date.now() - 1_800_000_006_500, scene: seam.scene, visible: visibility() });
  }
  expect(trace.every(x => x.visible.every(Boolean)), "no DAY packet or manual action occurred").toBe(true);
});

test.each([0, 1, 16, 100, 299])("CONTROL own gap %sms and NIGHT return eventually show both", async gap => {
  await boot(); const own = document.querySelector(".my-player")!; own.remove();
  scene("day"); await microtasks();
  document.body.append(own.cloneNode(true));
  await vi.advanceTimersByTimeAsync(gap); scene("night");
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
});

test.each([0, 1, 16, 100, 299])("CONTROL actual DAY %sms before timer wins over pending nightShow", async lead => {
  settings.role_phase_auto_switch_enabled = true;
  await boot(); scene("day"); await microtasks(); scene("night");
  await vi.advanceTimersByTimeAsync(3000 - lead);
  phase("day"); await microtasks();
  await vi.advanceTimersByTimeAsync(lead + 16);
  expect(visibility()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([false, false]);
});

test("CONTROL V before pre-day barrier remains fail-closed when public command is sent", async () => {
  await boot(); scene("day"); await microtasks(); scene("night");
  down("KeyV"); expect(isPeeking()).toBe(true);
  await vi.advanceTimersByTimeAsync(3500);
  phase("day"); await vi.advanceTimersByTimeAsync(1000);
  expect(seam.sent.filter(x => x.scene === "day").every(x => x.visible.every(v => !v))).toBe(true);
  expect(visibility()).toEqual([false, false]);
  up("KeyV"); await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([false, false]);
});

test("CONTROL first status delay alone is masked by successfully saved live NIGHT", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdStatus = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  expect(seam.persisted.currentTimeOfDay).toBe("night");
  seam.statuses.shift()!(); await enabling; await vi.advanceTimersByTimeAsync(100);
  expect(seam.sent.some(x => x.scene === "day")).toBe(false);
  expect(visibility()).toEqual([true, true]);
});

test("delayed first status with pending live NIGHT save accepts obsolete persisted DAY", async () => {
  seam.persisted = { sessionId: "s", currentTimeOfDay: "day", timestamp: Date.now() };
  seam.holdStatus = true; seam.holdSaves = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  expect(seam.saves.length).toBeGreaterThan(0);
  seam.statuses.shift()!(); await enabling; await vi.advanceTimersByTimeAsync(100);
  expect(seam.sent.some(x => x.scene === "day")).toBe(false);
});

test("scene-list retry of known DAY must pre-hide after private manual Show", async () => {
  await boot(); seam.refuse = true;
  phase("day"); await vi.advanceTimersByTimeAsync(1000);
  expect(seam.scene).toBe("night"); expect(visibility()).toEqual([false, false]);
  down("KeyD"); up("KeyD"); expect(visibility()).toEqual([false, true]);
  const oldCommands = seam.sent.length;
  seam.refuse = false;
  event("obs_scenes_updated", { scenes: [], currentScene: "night" });
  await microtasks(); await vi.advanceTimersByTimeAsync(50); // pre-day кадр перед командой
  const retried = seam.sent.slice(oldCommands);
  expect(retried.find(x => x.scene === "day")?.visible, "automatic public-scene retry has the same pre-hide duty as original transition").toEqual([false, false]);
});

test("REAL TRANSPORT scene creation retries public DAY with peer still visible after private Show", async () => {
  seam.failPublic = true;
  await connectRealClient(); await boot();
  phase("day"); await vi.advanceTimersByTimeAsync(1000);
  expect(seam.scene).toBe("night"); expect(visibility()).toEqual([false, false]);
  down("KeyD"); up("KeyD"); expect(visibility()).toEqual([false, true]);
  const oldCommands = seam.sent.length;
  seam.failPublic = false;
  await seam.client.requestSceneList(); await microtasks(); await vi.advanceTimersByTimeAsync(50); // pre-day кадр
  const retried = seam.sent.slice(oldCommands);
  const trace: any[] = [{ ms: 0, scene: seam.scene, visible: visibility() }];
  for (const gap of [16, 84, 1900, 10000]) {
    await vi.advanceTimersByTimeAsync(gap);
    trace.push({ ms: trace.at(-1).ms + gap, scene: seam.scene, visible: visibility() });
  }
  expect(retried.find(x => x.scene === "day")?.visible).toEqual([false, false]);
  expect(trace.every(x => x.visible.every((v: boolean) => !v))).toBe(true);
});

test("CONTROL REAL TRANSPORT retry without private manual Show stays hidden", async () => {
  seam.failPublic = true; await connectRealClient(); await boot();
  phase("day"); await vi.advanceTimersByTimeAsync(1000);
  const oldCommands = seam.sent.length; seam.failPublic = false;
  await seam.client.requestSceneList(); await vi.advanceTimersByTimeAsync(12000);
  expect(seam.sent.slice(oldCommands).find(x => x.scene === "day")?.visible).toEqual([false, false]);
  expect(seam.scene).toBe("day"); expect(visibility()).toEqual([false, false]);
});

test.each(["off", "off-on", "route"])("probe old pre-day await tail crosses %s", async mode => {
  await boot(); phase("day");
  // Locate the live pre-day barrier through the actual DOM side effect,
  // not an exported/internal production callback or fixed fake timestamp.
  for (let i = 0; i < 2000 && (document.querySelector<HTMLElement>(".my-role")!.style.visibility !== "hidden" || seam.sent.some(x => x.scene === "day")); i++) {
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(document.querySelector<HTMLElement>(".my-role")!.style.visibility).toBe("hidden");
  const atBarrier = Date.now(); const commandsAtBarrier = seam.sent.length;
  expect(seam.sent.some(x => x.scene === "day")).toBe(false);
  if (mode === "route") {
    history.pushState(null, "", "/game/2");
    phase("night"); await microtasks();
  } else {
    update({ obs_auto_mode_enabled: false });
    if (mode === "off-on") {
      phase("night"); await microtasks();
      update({ obs_auto_mode_enabled: true });
    }
  }
  await vi.advanceTimersByTimeAsync(35);
  expect(seam.sent.slice(commandsAtBarrier).some(x => x.scene === "day"), "old awaited day intent belongs to the previous lifecycle/game").toBe(false);
});

test.each(["manual-day", "disconnect"])("REAL TRANSPORT %s while V held must hide whole table, not only own", async transition => {
  const program = await connectRealClient(); await boot();
  down("KeyD"); up("KeyD"); expect(visibility()).toEqual([false, false]);
  down("KeyV"); expect(isPeeking()).toBe(true); expect(visibility()).toEqual([true, true]);
  if (transition === "manual-day") program("day");
  else seam.client.disconnect();
  await microtasks();
  const trace: any[] = [{ ms: 0, visible: visibility() }];
  for (const gap of [16, 84, 1900, 10000]) {
    await vi.advanceTimersByTimeAsync(gap);
    trace.push({ ms: trace.at(-1).ms + gap, visible: visibility() });
  }
  up("KeyV"); await vi.advanceTimersByTimeAsync(16);
  expect(visibility()).toEqual([false, false]);
  expect(trace.every(x => x.visible.every((v: boolean) => !v)), "unsafe transition under already-active peek has explicit priority over V").toBe(true);
});

test.each([0, 1, 16, 100, 299])("REAL TRANSPORT lifted own-pin and pending night show: public DAY +%sms under V", async gap => {
  const program = await connectRealClient(); await boot();
  program("day"); await microtasks(); expect(visibility()).toEqual([false, false]);
  program("night"); await microtasks();
  // NIGHT is now confirmed in OBS; role owner is still in its 3s show delay.
  expect(seam.client.getStatus().currentScene).toBe("night");
  down("KeyV"); expect(isPeeking()).toBe(true); expect(visibility()).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(gap);
  program("day"); await microtasks(); await vi.advanceTimersByTimeAsync(16);
  const exposed = visibility();
  up("KeyV");
  expect(exposed, "public-scene transition occurred after V started on confirmed NIGHT").toEqual([false, false]);
});

test("SPA CONTRACT initial status await captures the new route epoch too late", async () => {
  settings.auto_hide_roles_enabled = true;
  seam.holdStatus = true;
  autoStartFeature.enable(ctx()); const enabling = obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true, true]);
  expect(seam.persisted.currentTimeOfDay).toBe("night"); // genuine old-room save, not injected foreign state
  history.pushState(null, "", "/game/2");
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current"></div></div></div>
    <div class="player my-player"><span class="player__role role my-role">NEW SELF</span></div>
    <div class="player"><span class="player__role role peer">NEW PEER</span></div>`;
  await microtasks(); expect(visibility()).toEqual([false, false]);
  seam.statuses.shift()!(); await enabling; await vi.advanceTimersByTimeAsync(16);
  expect(visibility(), "no live phase of the new room was ever recognized").toEqual([false, false]);
});

test.each(["fresh-viewer", "own-disappears"])("REAL TRANSPORT persistent missing own-role %s must not lose private-scene return", async mode => {
  const program = await connectRealClient();
  if (mode === "fresh-viewer") {
    document.querySelector(".my-player")!.remove();
    autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
    await vi.advanceTimersByTimeAsync(6500); expect(visibility()).toEqual([true]);
  } else {
    await boot(); document.querySelector(".my-player")!.remove(); await microtasks();
    expect(visibility()).toEqual([true]);
  }
  program("day"); await microtasks(); expect(visibility()).toEqual([false]);
  program("night"); await vi.advanceTimersByTimeAsync(12000);
  expect(visibility(), "all remaining targets are peers; scene safety is confirmed, no manual hide/new game occurred").toEqual([true]);
});
