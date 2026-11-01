// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Внешний аудит №7, H01: эпоха ночи не теряется сырым распознаванием застрявшей подписи.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const wire = vi.hoisted(() => ({ listeners: new Set<any>(), scene: "night", client: null as any, sent: [] as string[] }));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { set: async () => {} } },
  runtime: { id: "audit7-obs-epoch", getManifest: () => ({ version: "9.68.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (f: any) => { wire.listeners.add(f); return () => wire.listeners.delete(f); },
  sendRuntime: async (msg: any) => {
    if (msg.command === "get_status") return { success: true, data: wire.client.getStatus() };
    if (msg.command === "set_scene") { await wire.client.setCurrentScene(msg.data.sceneName); return { success: true }; }
  },
  broadcastToGameTabs: async (msg: any) => { await Promise.resolve(); for (const f of wire.listeners) f(msg); }, sendToActiveTabStrict: vi.fn(),
}));
import { autoStartFeature } from "@content/features/auto-start";
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
function stage(current: string, next: string) {
  document.querySelector(".substage.current")!.textContent = current;
  document.querySelector(".substage.next")!.textContent = next;
}
function update(enabled: boolean) {
  settings = { ...settings, obs_auto_mode_enabled: enabled }; autoStartFeature.update!(ctx()); obsPanelFeature.update!(ctx());
}
async function realTransport() {
  class Socket {
    static OPEN = 1; readyState = 1; onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { queueMicrotask(() => this.receive(0, { obsWebSocketVersion: "5.6.3", rpcVersion: 1 })); }
    receive(op: number, d: any) { this.onmessage?.({ data: JSON.stringify({ op, d }) }); }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg.op === 1) queueMicrotask(() => this.receive(2, { negotiatedRpcVersion: 1 }));
      if (msg.op !== 6) return;
      const d = msg.d, changing = d.requestType === "SetCurrentProgramScene";
      if (changing) { wire.scene = d.requestData.sceneName; wire.sent.push(wire.scene); }
      queueMicrotask(() => {
        if (changing) this.receive(5, { eventType: "CurrentProgramSceneChanged", eventIntent: 4, eventData: { sceneName: wire.scene } });
        this.receive(7, { requestId: d.requestId, requestType: d.requestType, requestStatus: { result: true, code: 100 }, responseData:
          d.requestType === "GetSceneList" ? { scenes: [{ sceneName: "night" }, { sceneName: "day" }], currentProgramSceneName: wire.scene } : {} });
      });
    }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal("WebSocket", Socket); wire.client = new ObsClient(); await wire.client.connect("ws://localhost:4455"); await micro();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000); Object.assign(domObserver, { lastFlushAt: 0, lastSlowLog: 0 });
  settings = { ...defaults }; wire.scene = "night"; wire.client = null; wire.sent = [];
  history.replaceState(null, "", "/game/1"); document.head.innerHTML = "";
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div><div class="substage next">Ночь | Стрельба</div></div></div>
    <div class="player my-player"><span class="player__role role my-role">SELF</span></div><div class="player"><span class="player__role role">PEER</span></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest(); wire.client?.disconnect();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.innerHTML = "";
});

test.each(["control-no-day", "raw-confirm", "raw-reenable"])("REAL ObsClient same-night manual hide survives %s", async mode => {
  await realTransport(); autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx()); await wait(6500);
  expect(visible()).toEqual([true, true]);
  for (const type of ["keydown", "keyup"]) document.dispatchEvent(new KeyboardEvent(type, { code: "KeyD", keyCode: 68, bubbles: true, cancelable: true }));
  await wait(3000); expect(visible()).toEqual([false, false]);
  if (mode === "raw-confirm") {
    stage("День | Речь игрока", "День | Голосование"); await wait(400);
    stage("День | Речь игрока", "Ночь | Стрельба");
  } else if (mode === "raw-reenable") {
    update(false); stage("День | Речь игрока", "Ночь | Стрельба"); await wait(50); update(true);
  }
  await wait(6000);
  // FIXED: застрявшая подпись больше не шлёт DAY ни одним путём (аудит №7, H01).
  expect(wire.sent).not.toContain("day");
  expect(visible()).toEqual([false, false]);
  stage("Ночь | Стрельба", "День | Речь игрока"); await wait(6500);
  expect(wire.scene).toBe("night"); expect(wire.client.getStatus().currentScene).toBe("night");
  expect(visible(), "later packet is this same night; no new manual Show was given").toEqual([false, false]);
});
