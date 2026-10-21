// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game/1" }
// Independent audit witness: only browser/settings/messaging boundaries mocked.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({
  settings: {} as any,
  settingsListeners: new Set<(patch: any) => void>(),
  messages: new Set<any>(),
  waiting: false,
  release: null as null | (() => void),
  commands: [] as string[],
}));

vi.mock("@core/env", () => ({ browser: {
  storage: {
    local: {
      get: async (keys: any) => {
        if (keys && !Array.isArray(keys) && Object.hasOwn(keys, "playerNotes")) {
          seam.waiting = true;
          await new Promise<void>((resolve) => { seam.release = resolve; });
          return { ...keys, pn_notes_migrated_v1: true };
        }
        return keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
      },
      set: async () => {}, remove: async () => {},
    },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: { id: "audit5-control", getManifest: () => ({ version: "9.67.0" }), getURL: (p: string) => p },
} }));
vi.mock("@core/settings", async (original) => ({
  ...await original<any>(),
  getSettings: async () => seam.settings,
  onSettingsChanged: (fn: (patch: any) => void) => {
    seam.settingsListeners.add(fn);
    return () => seam.settingsListeners.delete(fn);
  },
}));
vi.mock("@core/messaging", () => ({
  onMessage: (fn: any) => { seam.messages.add(fn); return () => seam.messages.delete(fn); },
  sendRuntime: async (m: any) => {
    if (m.command) seam.commands.push(m.command);
    return m.command === "get_status"
      ? { success: true, data: { connected: false, currentScene: null, scenes: [] } }
      : { success: true };
  },
  broadcastToGameTabs: async () => {}, sendToActiveTabStrict: async () => {},
}));

import { DEFAULT_SETTINGS } from "@core/settings";
import { FeatureManager } from "@core/feature";
import { searchFeature } from "@content/features/search";
import { autoStartFeature } from "@content/features/auto-start";
import { autoReadyFeature } from "@content/features/auto-ready";
import { playerNotesFeature } from "@content/features/player-notes";
import { obsPanelFeature, obsAutoScenesActive } from "@content/panels/obs-panel";

const roles = '<div class="player my-player"><span class="player__role role my-role">MAFIA</span></div><div class="player"><span class="player__role role">DON</span></div>';
const visibility = () => [...document.querySelectorAll<HTMLElement>(".player__role")].map((el) => {
  const css = getComputedStyle(el);
  return css.display !== "none" && css.visibility !== "hidden" && css.opacity !== "0";
});
const createManager = () => new FeatureManager().register(
  // All production features BEFORE the blocked notes reader, in their exact order.
  searchFeature, autoStartFeature, autoReadyFeature, playerNotesFeature,
  // Later features cannot execute until notes resolves; OBS is the first protector.
  obsPanelFeature,
);
let boot: Promise<void> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000000000);
  document.head.innerHTML = "";
  document.body.innerHTML = '<div class="roller"><div class="stage"><div class="substage current">День | речь игрока</div></div></div><main id="table"></main>';
  seam.waiting = false;
  seam.release = null;
  seam.commands = [];
  seam.settingsListeners.clear();
  seam.settings = {
    ...DEFAULT_SETTINGS, extension_enabled: true,
    auto_accept_enabled: true, auto_ready_enabled: true,
    skip_start_screen_enabled: false, disable_webcam_clicks: true,
    statistics_enabled: true, auto_hide_roles_enabled: false,
    role_phase_auto_switch_enabled: false,
    obs_enabled: true, obs_auto_mode_enabled: true,
    obs_floating_panel_enabled: false, obs_day_scene: "DAY", obs_night_scene: "NIGHT",
  };
});

afterEach(async () => {
  seam.release?.();
  if (boot) await boot;
  boot = null;
  // Drain an already-enqueued settings sync before tearing down real features.
  await vi.advanceTimersByTimeAsync(0);
  obsPanelFeature.disable();
  playerNotesFeature.disable();
  autoReadyFeature.disable();
  autoStartFeature.disable();
  searchFeature.disable();
  seam.settingsListeners.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function mountWhilePending(manager: FeatureManager) {
  await vi.advanceTimersByTimeAsync(0);
  expect(seam.waiting).toBe(true);
  expect(manager.activeIds()).toEqual(["auto-ready", "auto-start", "player-notes", "search"]);
  expect(obsAutoScenesActive()).toBe(false);
  expect(seam.commands).not.toContain("get_status");
  document.getElementById("table")!.innerHTML = roles;
  // Let the REAL SharedDomObserver's immediate and batched subscriptions run.
  await vi.advanceTimersByTimeAsync(100);
}

async function releaseAndCheckProtected() {
  seam.release!();
  await vi.advanceTimersByTimeAsync(0);
  expect(obsAutoScenesActive()).toBe(true);
  expect(visibility()).toEqual([false, false]);
}

test("actual start: roots mounted DURING pending notes must not escape OBS-only hiding", async () => {
  const manager = createManager();
  boot = manager.start();
  await mountWhilePending(manager);
  expect.soft(visibility(), "OBS-only enabled settings must hide new own AND teammate roots while unrelated storage awaits").toEqual([false, false]);
  await releaseAndCheckProtected();
  await boot;
});

test("actual start then master OFF→ON: newly mounted roots escape until notes resolves", async () => {
  seam.settings.extension_enabled = false;
  const manager = createManager();
  boot = manager.start();
  await boot;
  expect(manager.activeIds()).toEqual([]);
  for (const fn of seam.settingsListeners) fn({ extension_enabled: true });
  await vi.advanceTimersByTimeAsync(50); // manager's real settings coalescer
  await mountWhilePending(manager);
  expect.soft(visibility(), "master enabling does not grant an OBS privacy startup exemption").toEqual([false, false]);
  await releaseAndCheckProtected();
});

test.each(["auto_hide_roles_enabled", "role_phase_auto_switch_enabled"])("CONTROL %s protects roots even while notes is pending", async (key) => {
  seam.settings[key] = true;
  const manager = createManager();
  boot = manager.start();
  await mountWhilePending(manager);
  expect(visibility()).toEqual([false, false]);
});

test("CONTROL statistics disabled reaches OBS and protects later-mounted roots", async () => {
  seam.settings.statistics_enabled = false;
  const manager = createManager();
  boot = manager.start();
  await boot;
  expect(seam.waiting).toBe(false);
  expect(obsAutoScenesActive()).toBe(true);
  document.getElementById("table")!.innerHTML = roles;
  await vi.advanceTimersByTimeAsync(100);
  expect(visibility()).toEqual([false, false]);
});

test("CONTROL OBS disabled legitimately leaves roots visible throughout notes wait", async () => {
  seam.settings.obs_enabled = false;
  const manager = createManager();
  boot = manager.start();
  await mountWhilePending(manager);
  expect(visibility()).toEqual([true, true]);
  seam.release!();
  await boot;
  expect(visibility()).toEqual([true, true]);
});
