// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №4: B03 (сцена старой сессии), C01 (устаревший GetSceneList),
// B04 (ночная сцена не выбрана), H01–H04. Настоящие obs-client/obs-panel/auto-start.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: any) => unknown>, client: null as any,
  persisted: false, actualScene: "night", refuse: false,
  lists: [] as Array<(v: any) => void>, deferLists: false,
  sent: [] as string[], deferStatus: false, statuses: [] as Array<() => void>,
  deferNightReply: false, nightReplies: [] as Array<() => void>,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async (keys: any) => {
      const data: any = { obs_connection_state: { ...seam.client.getStatus(), timestamp: Date.now() } };
      if (seam.persisted) data.obs_auto_scene_state = { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() };
      return Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, data[k]])) : { ...keys, ...data };
    }, set: async () => {}, remove: async () => { seam.persisted = false; },
  }, sync: { set: async () => {} } },
  runtime: { id: "audit4", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: any) => { seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); }; },
  sendRuntime: async (msg: any) => {
    if (msg.type !== "obs_command") return;
    if (msg.command === "get_status") {
      const snapshot = { success: true, data: seam.client.getStatus() };
      if (seam.deferStatus) await new Promise<void>(resolve => seam.statuses.push(resolve));
      return snapshot;
    }
    if (msg.command === "set_scene") {
      seam.sent.push(msg.data.sceneName);
      if (seam.refuse) return { success: true, data: { ignored: "not_owner" } };
      await seam.client.setCurrentScene(msg.data.sceneName);
      if (msg.data.sceneName === "night" && seam.deferNightReply) await new Promise<void>(resolve => seam.nightReplies.push(resolve));
      return { success: true };
    }
  },
  broadcastToGameTabs: async (msg: any) => { seam.messages.forEach(fn => fn(msg)); },
  sendToActiveTabStrict: vi.fn(),
}));

import { autoStartFeature, isPeeking } from "@content/features/auto-start";
import { obsPanelFeature } from "@content/panels/obs-panel";
import { resetRolePinForTest } from "@content/role-pin";
import { ObsClient } from "../../src/background/obs-client";

const settings = {
  obs_enabled: true, obs_auto_mode_enabled: true, obs_day_scene: "day", obs_night_scene: "night", obs_floating_panel_enabled: false,
  auto_accept_enabled: false, skip_start_screen_enabled: false, disable_webcam_clicks: true,
  auto_hide_roles_enabled: false, role_phase_auto_switch_enabled: false, hotkey_role_hide: "KeyD", hotkey_role_peek: "KeyV",
};
const ctx = (over: Partial<typeof settings> = {}) => ({ settings: { ...settings, ...over } }) as never;
const roles = () => [...document.querySelectorAll<HTMLElement>(".player__role")];
const visible = () => roles().map(el => { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none"; });
const phase = (p: "day" | "night") => { document.querySelector(".substage.current")!.textContent = p === "day" ? "День | речь игрока" : "Ночь | ход мафии"; };
function scene(name: string) {
  seam.actualScene = name;
  (seam.client as any).handleEvent({ eventType: "CurrentProgramSceneChanged", eventData: { sceneName: name } });
}
const down = (code: string) => document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
const up = (code: string) => document.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
const press = (code: string) => { down(code); up(code); };
function update(over: Partial<typeof settings>) { autoStartFeature.update!(ctx(over)); obsPanelFeature.update!(ctx(over)); }
async function boot(over: Partial<typeof settings> = {}) {
  autoStartFeature.enable(ctx(over)); await obsPanelFeature.enable(ctx(over));
  await vi.advanceTimersByTimeAsync(6500);
  expect(visible()).toEqual([true, true]);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  history.replaceState(null, "", "/game/1");
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} });
  seam.client = new ObsClient();
  Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s" });
  seam.persisted = false; seam.actualScene = "night"; seam.refuse = false; seam.deferLists = false; seam.lists = []; seam.sent = [];
  seam.deferStatus = false; seam.statuses = [];
  seam.deferNightReply = false; seam.nightReplies = [];
  vi.spyOn(seam.client as any, "request").mockImplementation((type: any, data: any) => {
    if (type === "GetSceneList") {
      if (seam.deferLists) return new Promise(resolve => seam.lists.push(resolve));
      return Promise.resolve({ scenes: [], currentProgramSceneName: seam.actualScene });
    }
    if (type === "SetCurrentProgramScene") { scene(data.sceneName); return Promise.resolve({}); }
    return Promise.resolve({});
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.innerHTML = "";
});

test("stale GetSceneList NIGHT after a newer DAY event must not reopen captured roles", async () => {
  await boot(); seam.deferLists = true;
  // Другая вкладка — владелец эфира: наша автосмена NIGHT не выполняется,
  // видимость решает только правда OBS (иначе расширение само честно
  // вернуло бы NIGHT и показ был бы законным).
  seam.refuse = true;
  const list = seam.client.requestSceneList(); // snapshot NIGHT is in flight
  scene("day");
  expect(visible()).toEqual([false, false]);
  seam.lists.shift()!({ scenes: [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: "night" });
  await list;
  await vi.advanceTimersByTimeAsync(3500);
  const at3500 = visible();
  await vi.advanceTimersByTimeAsync(12000);
  expect(seam.actualScene).toBe("day");
  expect(visible(), "GetSceneList is a stale snapshot, not a new NIGHT event").toEqual([false, false]);
});

test("reconnect: the previous session NIGHT does not authorize a show before the new GetSceneList", async () => {
  let socket: any;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor() { socket = this; }
    send() {}
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket);
  // This is the real unplanned-disconnect path, not manual disconnect(),
  // which clears currentScene separately.
  (seam.client as any).handleConnectionLost();
  seam.actualScene = "day"; // streamer changes Program while connection is down
  seam.deferLists = true;
  const connect = seam.client.connect("ws://localhost:4455");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  socket.onmessage({ data: JSON.stringify({ op: 2, d: {} }) });
  await connect;
  expect(seam.lists).toHaveLength(1); // new session GetSceneList not answered yet
  expect(seam.client.getStatus().connected).toBe(true);
  expect(seam.client.getStatus().currentScene, "сцена старой сессии — не правда новой").toBeNull();
  seam.refuse = true; // как выше: наша NIGHT-команда не меняет эфир
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  expect(visible()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(6500); // within production's 10s request timeout
  expect(seam.actualScene).toBe("day");
  expect(visible(), "old socket NIGHT is not confirmation about the new connected session").toEqual([false, false]);
});

test("a game day while OBS auto is OFF must end the old manual-night epoch", async () => {
  const phaseSetting = { role_phase_auto_switch_enabled: true };
  await boot(phaseSetting);
  press("KeyD"); expect(visible()).toEqual([false, false]);
  update({ ...phaseSetting, obs_auto_mode_enabled: false });
  phase("day"); await vi.advanceTimersByTimeAsync(10000);
  expect(visible()).toEqual([false, false]);
  phase("night");
  update(phaseSetting); // reenable at new game night; OBS remains on private NIGHT
  await vi.advanceTimersByTimeAsync(12000);
  expect(visible(), "hide from the previous game night must not suppress the new night show").toEqual([true, true]);
});

test.each(["not_owner", "no_day_scene"])("queued nightShow under V must not survive a subsequent beforeDayScene: %s", async mode => {
  await boot(); scene("day");
  down("KeyV"); expect(isPeeking()).toBe(true);
  scene("night"); await vi.advanceTimersByTimeAsync(3500); // nightShow queued under V
  seam.refuse = mode === "not_owner"; // legitimate owner in another tab refuses this automatic DAY
  if (mode === "no_day_scene") update({ obs_day_scene: "" });
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  if (mode === "not_owner") expect(seam.sent).toContain("day");
  up("KeyV"); await vi.advanceTimersByTimeAsync(16);
  const after16 = visible();
  await vi.advanceTimersByTimeAsync(12000);
  expect(visible(), "day beforeDayScene supersedes the nightShow queued under V").toEqual([false, false]);
});

test("stale disconnected panel-status response must not erase reconnected NIGHT", async () => {
  await boot(); seam.client.disconnect();
  await vi.advanceTimersByTimeAsync(50);
  for (let i = 0; i < 10; i++) document.body.insertAdjacentHTML("beforeend", '<div class="player desktop-version"></div>');
  seam.deferStatus = true;
  update({ obs_floating_panel_enabled: true });
  expect(seam.statuses).toHaveLength(1); // requestOBSStatus, captured disconnected
  Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s2" });
  seam.messages.forEach(fn => fn({ type: "obs_event", eventType: "obs_scenes_updated", data: { scenes: [], currentScene: "night" } }));
  await vi.advanceTimersByTimeAsync(6500);
  expect(visible()).toEqual([true, true]);
  seam.statuses.shift()!(); // old negative status arrives after the live reconnected event
  await vi.advanceTimersByTimeAsync(12000);
  expect(seam.client.getStatus().currentScene).toBe("night");
  expect(visible(), "newer reconnected NIGHT must survive an older disconnected status response").toEqual([true, true]);
});

test("successful old NIGHT continuation must not schedule night-show after the phase became DAY", async () => {
  phase("day"); scene("day");
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500);
  expect(visible()).toEqual([false, false]);
  seam.deferNightReply = true;
  phase("night"); await vi.advanceTimersByTimeAsync(2500);
  expect(seam.nightReplies).toHaveLength(1);
  expect(seam.actualScene).toBe("night"); // command actually executed; only runtime reply is delayed
  seam.refuse = true;
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  expect(visible()).toEqual([false, false]);
  seam.nightReplies.shift()!(); // old success must not resurrect its old phase
  await vi.advanceTimersByTimeAsync(3100);
  const after3100 = visible();
  await vi.advanceTimersByTimeAsync(12000);
  expect(visible(), "the callback belongs to a game night that has already ended").toEqual([false, false]);
});

test("CONTROL fresh GetSceneList after DAY agrees with event and stays hidden", async () => {
  await boot(); scene("day"); seam.refuse = true;
  await seam.client.requestSceneList(); await vi.advanceTimersByTimeAsync(5000);
  expect(visible()).toEqual([false, false]);
});

test("CONTROL a normally observed day resets the OBS manual-night epoch", async () => {
  await boot({ role_phase_auto_switch_enabled: true }); press("KeyD");
  phase("day"); await vi.advanceTimersByTimeAsync(10000);
  phase("night"); await vi.advanceTimersByTimeAsync(12000);
  expect(visible()).toEqual([true, true]);
});

test("CONTROL no queued nightShow under V: subsequent DAY stays hidden even without a day scene", async () => {
  await boot(); scene("day"); down("KeyV"); expect(isPeeking()).toBe(true);
  update({ obs_day_scene: "" });
  scene("night"); await vi.advanceTimersByTimeAsync(100); // no nightShow yet
  phase("day"); await vi.advanceTimersByTimeAsync(2500);
  up("KeyV"); await vi.advanceTimersByTimeAsync(12000);
  expect(visible()).toEqual([false, false]);
});

test("CONTROL game day while OBS auto OFF, no old manual decision: new night opens", async () => {
  const phaseSetting = { role_phase_auto_switch_enabled: true };
  await boot(phaseSetting);
  update({ ...phaseSetting, obs_auto_mode_enabled: false });
  phase("day"); await vi.advanceTimersByTimeAsync(10000);
  phase("night"); update(phaseSetting); await vi.advanceTimersByTimeAsync(12000);
  expect(visible()).toEqual([true, true]);
});

test("B04: auto ON with unconfigured NIGHT must not reveal roles while OBS is disconnected", async () => {
  Object.assign(seam.client, { isConnected: false, currentScene: null, sessionId: null });
  seam.actualScene = "day"; // Program can keep capturing the game independently of WebSocket
  const over = { auto_hide_roles_enabled: true, obs_night_scene: "" };
  autoStartFeature.enable(ctx(over)); await obsPanelFeature.enable(ctx(over));
  await vi.advanceTimersByTimeAsync(16);
  expect(visible()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(6500);
  expect(seam.client.getStatus().connected).toBe(false);
  expect(seam.sent).toEqual([]);
  expect(visible(), "effective auto mode is ON; no confirmed private NIGHT, even if its name is blank").toEqual([false, false]);
});

test("B04: explicitly clearing NIGHT then disconnecting does not authorize role show", async () => {
  await boot({ auto_hide_roles_enabled: true });
  scene("day"); expect(visible()).toEqual([false, false]);
  update({ auto_hide_roles_enabled: true, obs_night_scene: "" }); // ordinary blank select change in popup
  seam.client.disconnect();
  await vi.advanceTimersByTimeAsync(16);
  const after16 = visible();
  await vi.advanceTimersByTimeAsync(6500);
  expect(seam.actualScene).toBe("day");
  expect(seam.client.getStatus().connected).toBe(false);
  expect(visible(), "clearing a scene setting is not manual Show; disconnected Program is still DAY").toEqual([false, false]);
});
