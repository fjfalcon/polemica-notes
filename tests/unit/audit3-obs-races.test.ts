// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  messages: [] as Array<(msg: any) => unknown>,
  client: null as any,
  persisted: false,
  deferredNight: false,
  deferredRuntimeNight: false,
  pendingNight: [] as Array<() => void>,
  commands: [] as string[],
}));
vi.mock("@core/dom", () => ({
  onDomChangeImmediate: (fn: (muts: MutationRecord[]) => void) => {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  },
  onDomChange: () => () => {}, safeClick: () => true, isVisible: () => true,
}));
vi.mock("@core/env", () => ({ browser: {
  storage: { local: {
    get: async (keys: string[] | Record<string, unknown>) => {
      const data: Record<string, unknown> = {
        obs_connection_state: { ...seam.client?.getStatus(), timestamp: Date.now() },
      };
      if (seam.persisted) data.obs_auto_scene_state = { sessionId: "s", currentTimeOfDay: "night", timestamp: Date.now() };
      return Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, data[k]])) : { ...keys, ...data };
    }, set: async () => {}, remove: async () => { seam.persisted = false; },
  }, sync: { set: async () => {} } },
  runtime: { id: "x", getManifest: () => ({ version: "9.67.0" }) },
} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: (msg: any) => unknown) => {
    seam.messages.push(fn); return () => { seam.messages = seam.messages.filter(x => x !== fn); };
  },
  sendRuntime: async (msg: any) => {
    if (msg.type !== "obs_command") return;
    if (msg.command === "get_status") return { success: true, data: seam.client.getStatus() };
    if (msg.command === "set_scene") {
      seam.commands.push(msg.data.sceneName);
      const result = await seam.client.setCurrentScene(msg.data.sceneName);
      if (msg.data.sceneName === "night" && seam.deferredRuntimeNight) {
        await new Promise<void>(resolve => seam.pendingNight.push(resolve));
      }
      return { success: true, data: result };
    }
    return { success: true };
  },
  broadcastToGameTabs: async (msg: any) => { seam.messages.forEach(fn => fn(msg)); },
  sendToActiveTabStrict: vi.fn(),
}));
vi.mock("@content/features/role-faker", () => ({ isRoleFaked: () => false }));

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
function emit(eventType: string, data: unknown) { seam.messages.forEach(fn => fn({ type: "obs_event", eventType, data })); }
function scene(name: string) { (seam.client as any).handleEvent({ eventType: "CurrentProgramSceneChanged", eventData: { sceneName: name } }); }
const down = (code: string) => document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
const up = (code: string) => document.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
const press = (code: string) => { down(code); up(code); };
async function boot(persisted = false) {
  seam.persisted = persisted;
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500);
  expect(visible()).toEqual([true, true]);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  document.body.innerHTML = `<div class="roller"><div class="stage"><div class="substage current">Ночь | ход мафии</div></div></div>
    <div class="player my-player"><span class="player__role role my-role"></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
  seam.client = new ObsClient();
  Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s" });
  seam.persisted = false; seam.deferredNight = false; seam.deferredRuntimeNight = false; seam.pendingNight = []; seam.commands = [];
  vi.spyOn(seam.client as any, "request").mockImplementation((type: any, data: any) => {
    if (type === "SetCurrentProgramScene" && data.sceneName === "night" && seam.deferredNight) {
      return new Promise(resolve => seam.pendingNight.push(() => resolve({})));
    }
    return Promise.resolve({});
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("blur")); autoStartFeature.disable(); obsPanelFeature.disable(); resetRolePinForTest();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.head.innerHTML = "";
});

test.each([0, 50, 149, 1000].flatMap(gap => ["websocket", "runtime"].map(channel => ({ gap, channel }))))("RED ACK: $channel response arrives +$gap ms after newer DAY", async ({ gap, channel }) => {
  phase("day"); Object.assign(seam.client, { currentScene: "day" });
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(6500);
  seam.deferredNight = channel === "websocket";
  seam.deferredRuntimeNight = channel === "runtime";
  phase("night");
  await vi.advanceTimersByTimeAsync(2000);
  expect(seam.pendingNight).toHaveLength(1);
  scene("night");
  await vi.advanceTimersByTimeAsync(50);
  scene("day");
  expect(visible()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(gap);
  seam.pendingNight.shift()!();
  await vi.advanceTimersByTimeAsync(3100);
  const after3100 = visible();
  await vi.advanceTimersByTimeAsync(12000);
  console.log("ACK trace", { channel, gap, backgroundScene: seam.client.getStatus().currentScene, after3100, after15100: visible(), commands: seam.commands });
  expect(seam.client.getStatus().currentScene, "background ACK epoch protection does work").toBe("day");
  expect(visible(), "actual OBS is DAY; content must not trust older successful NIGHT response").toEqual([false, false]);
});

test.each([false, true])("manual hide survives night→day→night in same night (restored=%s)", async restored => {
  await boot(restored);
  press("KeyD"); expect(visible()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(50); scene("day");
  await vi.advanceTimersByTimeAsync(50); scene("night");
  await vi.advanceTimersByTimeAsync(3100);
  console.log("same-night trace", { restored, visible: visible() });
  expect(visible(), "manual hide during same night must win over safe-scene return").toEqual([false, false]);
});

test("RED disconnect: manual hide survives reconnect without game phase changing", async () => {
  await boot(); press("KeyD");
  await vi.advanceTimersByTimeAsync(50); seam.client.disconnect();
  await vi.advanceTimersByTimeAsync(50);
  Object.assign(seam.client, { isConnected: true, currentScene: "night", sessionId: "s2" });
  emit("obs_connected", null);
  emit("obs_scenes_updated", { scenes: [], currentScene: "night" });
  await vi.advanceTimersByTimeAsync(6500);
  console.log("reconnect trace", { visible: visible() });
  expect(visible(), "same game night; reconnect is not permission to undo manual hide").toEqual([false, false]);
});

test.each([false, true])("settings: enabling auto-hide with scene gate already closed=%s is manual hide this night", async alreadyClosed => {
  await boot();
  if (alreadyClosed) { scene("day"); expect(visible()).toEqual([false, false]); }
  await vi.advanceTimersByTimeAsync(50);
  autoStartFeature.update!(ctx({ auto_hide_roles_enabled: true }));
  obsPanelFeature.update!(ctx({ auto_hide_roles_enabled: true }));
  if (!alreadyClosed) scene("day");
  await vi.advanceTimersByTimeAsync(50); scene("night");
  await vi.advanceTimersByTimeAsync(3100);
  expect(visible(), "auto-hide ON mid-game is a manual hide by documented intent").toEqual([false, false]);
});

test("CONTROL live night: manual hide in first 3s pending window is not overwritten", async () => {
  autoStartFeature.enable(ctx({ auto_hide_roles_enabled: true }));
  await obsPanelFeature.enable(ctx({ auto_hide_roles_enabled: true }));
  await vi.advanceTimersByTimeAsync(1700);
  // CSS is already hidden by auto-hide: explicitly show then hide this night.
  press("KeyD"); press("KeyD");
  await vi.advanceTimersByTimeAsync(12000);
  expect(visible()).toEqual([false, false]);
});

test.each([100, 499, 500, 501, 600])("manual hide +%dms into already-live night survives initial OBS phase confirmation", async gap => {
  autoStartFeature.enable(ctx()); await obsPanelFeature.enable(ctx());
  await vi.advanceTimersByTimeAsync(gap);
  // Initial unknown-scene CSS already hides: show, then explicitly hide.
  press("KeyD"); press("KeyD");
  expect(visible()).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(6500);
  expect(visible(), "the game was night throughout; phase recognition is not a new night").toEqual([false, false]);
});

test("RED V/settings: disabling only OBS while V held does not restore its obsolete scene hide", async () => {
  await boot(); scene("day"); down("KeyV"); expect(isPeeking()).toBe(true);
  await vi.advanceTimersByTimeAsync(50); obsPanelFeature.update!(ctx({ obs_auto_mode_enabled: false }));
  await vi.advanceTimersByTimeAsync(50); up("KeyV");
  await vi.advanceTimersByTimeAsync(12000);
  expect(visible(), "no remaining hide setting and no manual hide").toEqual([true, true]);
});

