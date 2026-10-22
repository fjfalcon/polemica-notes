// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №4 (независимый контроль): настоящий ObsClient — pending/op:6/op:7,
// onclose(1006), attemptReconnect. Бывшие свидетели дефектов B03/H01/H02/H04 обращены.
// Independent controls: asynchronous messages, real request timers, storage snapshots.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(() => ({
  listeners: [] as Array<(m: any) => unknown>, client: null as any,
  storage: {} as Record<string, any>, actual: "night", sent: [] as any[],
  replies: [] as Array<() => void>, holdNight: false,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async (keys: any) => {
      await Promise.resolve();
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in transport.storage).map(k => [k, structuredClone(transport.storage[k])]));
      return { ...keys, ...structuredClone(transport.storage) };
    },
    set: async (data: any) => { Object.assign(transport.storage, structuredClone(data)); },
    remove: async (keys: any) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete transport.storage[k]; },
  }, sync: { set: async () => {} } },
  runtime: { id: "control-obs", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: any) => { transport.listeners.push(fn); return () => { transport.listeners = transport.listeners.filter(f => f !== fn); }; },
  sendRuntime: async (msg: any) => {
    await Promise.resolve();
    if (msg.type !== "obs_command") return;
    if (msg.command === "get_status") return { success: true, data: transport.client.getStatus() };
    if (msg.command === "set_scene") {
      await transport.client.setCurrentScene(msg.data.sceneName);
      return { success: true };
    }
  },
  broadcastToGameTabs: async (msg: any) => { await Promise.resolve(); for (const listener of transport.listeners) await listener(msg); },
  sendToActiveTabStrict: vi.fn(),
}));
import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { ObsClient } from "../../src/background/obs-client";
import { resetRolePinForTest } from "@content/role-pin";

const options = {
  obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: true, role_phase_auto_switch_enabled: true, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
};
let settings = { ...options };
const context = () => ({ settings }) as never;
const update = (patch: Partial<typeof settings>) => { settings = { ...settings, ...patch }; autoStartFeature.update!(context()); obsPanelFeature.update!(context()); };
const visibility = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map(el => {
  const s = getComputedStyle(el); return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
});
const phase = (name: "day" | "night") => { document.querySelector(".substage.current")!.textContent = name === "night" ? "Ночь | Проверки" : "День | Речь игрока"; };
const down = (code: string) => document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
const up = (code: string) => document.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
const microtasks = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 1;
  onopen: any; onmessage: any; onerror: any; onclose: any;
  holdList = false;
  listRequest: any;
  constructor() { Socket.all.push(this); }
  receive(op: number, d: any) { this.onmessage?.({ data: JSON.stringify({ op, d }) }); }
  hello() { this.receive(0, { obsWebSocketVersion: "5.6.3", rpcVersion: 1 }); }
  send(raw: string) {
    const msg = JSON.parse(raw); transport.sent.push(msg);
    if (msg.op === 1) queueMicrotask(() => this.receive(2, { negotiatedRpcVersion: 1 }));
    if (msg.op !== 6) return;
    if (msg.d.requestType === "GetSceneList") {
      this.listRequest = msg.d;
      if (!this.holdList) queueMicrotask(() => this.replyList());
    } else if (msg.d.requestType === "GetStreamStatus") {
      // Настоящий OBS отвечает сразу; эфир в этих сценариях не идёт.
      queueMicrotask(() => this.receive(7, { requestId: msg.d.requestId, requestType: "GetStreamStatus", requestStatus: { result: true, code: 100 }, responseData: { outputActive: false } }));
    } else if (msg.d.requestType === "SetCurrentProgramScene") {
      transport.actual = msg.d.requestData.sceneName;
      queueMicrotask(() => {
        this.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: transport.actual } });
        const reply = () => this.receive(7, { requestId: msg.d.requestId, requestType: msg.d.requestType, requestStatus: { result: true, code: 100 }, responseData: {} });
        if (transport.holdNight && msg.d.requestData.sceneName === "night") transport.replies.push(reply);
        else reply();
      });
    }
  }
  replyList() {
    const d = this.listRequest;
    this.listRequest = null;
    this.receive(7, { requestId: d.requestId, requestType: "GetSceneList", requestStatus: { result: true, code: 100 }, responseData: { scenes: [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: transport.actual } });
  }
  program(name: string) { transport.actual = name; this.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: name } }); }
  close() { this.readyState = 3; }
  lose() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}
async function connect() {
  const pending = transport.client.connect("ws://localhost:4455");
  await microtasks();
  const socket = Socket.all.at(-1)!;
  socket.hello(); await microtasks(); await pending;
  return socket;
}
async function boot() { autoStartFeature.enable(context()); await obsPanelFeature.enable(context()); await vi.advanceTimersByTimeAsync(6500); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1800000000000);
  settings = { ...options };
  transport.listeners = []; transport.storage = {}; transport.actual = "night"; transport.sent = []; transport.replies = []; transport.holdNight = false;
  transport.client = new ObsClient(); Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  document.head.innerHTML = "";
  document.body.innerHTML = '<div class="roller"><div class="stage"><div class="substage current">Ночь | Проверки</div></div></div><div class="player my-player"><span class="player__role role my-role">SELF</span></div><div class="player"><span class="player__role role">PEER</span></div>';
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 100, toJSON() {} });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test("B03: real reconnect — the old session NIGHT is not the new session's scene; no show on actual DAY", async () => {
  const old = await connect();
  expect(transport.client.getStatus().currentScene).toBe("night");
  const oldSession = transport.client.getStatus().sessionId;
  old.lose();
  await microtasks();
  expect(transport.storage.obs_connection_state.currentScene).toBeNull();
  transport.actual = "day";
  await vi.advanceTimersByTimeAsync(2000); // real automatic reconnect, not a manually forced new client
  const fresh = Socket.all.at(-1)!;
  expect(fresh).not.toBe(old);
  fresh.holdList = true;
  fresh.hello(); await microtasks();
  expect(transport.client.getStatus().connected).toBe(true);
  expect(transport.client.getStatus().sessionId).not.toBe(oldSession);
  expect(transport.client.getStatus().currentScene).toBeNull();
  expect(transport.storage.obs_connection_state.currentScene).toBeNull();
  expect(fresh.listRequest.requestType).toBe("GetSceneList");
  await boot();
  expect(fresh.listRequest).toBeTruthy();
  // Сцена неизвестна — автосмена честно шлёт NIGHT; показ только после неё.
  expect(transport.actual === "day" && visibility().some(Boolean)).toBe(false);
  // Resolve before timeout; no old response after a newer event is needed.
  fresh.replyList(); await microtasks();
});

test("B03 control: confirmed new-session scene does not leave visible roles on actual DAY", async () => {
  const old = await connect(); old.lose(); await microtasks();
  transport.actual = "day";
  await vi.advanceTimersByTimeAsync(2000);
  Socket.all.at(-1)!.hello(); await microtasks(); // actual DAY list is delivered before enable
  expect(transport.client.getStatus().currentScene).toBe("day");
  await boot();
  expect(transport.actual === "day" && visibility().some(Boolean)).toBe(false);
});

test("H01: a real game day with OBS auto OFF ends the old manual-night epoch", async () => {
  await connect(); await boot(); expect(visibility()).toEqual([true, true]);
  down("KeyD"); up("KeyD"); expect(visibility()).toEqual([false, false]);
  update({ obs_auto_mode_enabled: false });
  phase("day"); await vi.advanceTimersByTimeAsync(10000);
  phase("night"); update({ obs_auto_mode_enabled: true });
  await vi.advanceTimersByTimeAsync(12000);
  expect(transport.actual).toBe("night");
  expect(visibility(), "D прошлой ночи не решает за новую").toEqual([true, true]);
  // Real day with auto ON ends stale epoch; following night is shown.
  phase("day"); await vi.advanceTimersByTimeAsync(10000);
  phase("night"); await vi.advanceTimersByTimeAsync(12000);
  expect(visibility()).toEqual([true, true]);
});

test("H02: nightShow queued under V does not survive the next game day (real OBS transport, no day scene)", async () => {
  settings.obs_day_scene = "";
  const socket = await connect(); await boot();
  socket.program("day"); await microtasks();
  down("KeyV"); expect(isPeeking()).toBe(true);
  socket.program("night"); await vi.advanceTimersByTimeAsync(3500);
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  up("KeyV"); await vi.advanceTimersByTimeAsync(12000);
  expect(transport.actual).toBe("night");
  expect(visibility()).toEqual([false, false]);
});

test("H02 control without a completed show queued under V: the same DAY keeps both roles hidden", async () => {
  settings.obs_day_scene = "";
  const socket = await connect(); await boot();
  socket.program("day"); await microtasks();
  down("KeyV"); socket.program("night"); await vi.advanceTimersByTimeAsync(100);
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  up("KeyV"); await vi.advanceTimersByTimeAsync(12000);
  expect(visibility()).toEqual([false, false]);
});

test("H04: a late successful NIGHT ACK after the game day does not schedule a night show", async () => {
  settings.obs_day_scene = "";
  transport.actual = "day"; phase("day");
  await connect(); await boot(); expect(visibility()).toEqual([false, false]);
  transport.holdNight = true;
  phase("night"); await vi.advanceTimersByTimeAsync(2500);
  expect(transport.replies).toHaveLength(1);
  expect((transport.client as any).pending.size).toBe(1); // real op:7 ACK, not a held fake runtime reply
  expect(transport.actual).toBe("night");
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  expect(visibility()).toEqual([false, false]);
  transport.replies.shift()!();
  await vi.advanceTimersByTimeAsync(3100);
  const transient = visibility();
  await vi.advanceTimersByTimeAsync(12000);
  expect(transient).toEqual([false, false]);
  expect(visibility()).toEqual([false, false]);
  expect(transport.actual).toBe("night");
});

test("H04 control with promptly completed NIGHT ACK: subsequent day keeps both roles hidden", async () => {
  settings.obs_day_scene = "";
  transport.actual = "day"; phase("day"); await connect(); await boot();
  phase("night"); await vi.advanceTimersByTimeAsync(2500);
  phase("day"); await vi.advanceTimersByTimeAsync(17000);
  expect(transport.actual).toBe("night");
  expect(visibility()).toEqual([false, false]);
});
