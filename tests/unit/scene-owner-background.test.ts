/**
 * Владение автосценой через настоящий background: set_scene от вкладки идёт
 * через decideAndClaim, опрос владельца и запись владения в storage.local.
 * Чистая decideSceneOwnership проверена в scene-owner.test.ts; здесь —
 * что background действительно спрашивает владельца и уважает ответ.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const wiring = vi.hoisted(() => ({
  onMessage: [] as ((msg: unknown, sender: unknown) => unknown)[],
  /** Ответ вкладки на obs_scene_owner_ping: значение, "hang" или отказ канала. */
  pingAnswer: new Map<number, unknown>(),
  pending: [] as ((v: unknown) => void)[],
  pings: [] as number[],
}));

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (defaults: Record<string, unknown> | string[] | string) => {
          if (typeof defaults === "string") {
            return defaults in store.data ? { [defaults]: store.data[defaults] } : {};
          }
          if (Array.isArray(defaults)) {
            const out: Record<string, unknown> = {};
            for (const key of defaults) if (key in store.data) out[key] = store.data[key];
            return out;
          }
          const out: Record<string, unknown> = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = key in store.data ? store.data[key] : fallback;
          }
          return out;
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(store.data, patch);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store.data[key];
        }),
      },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
    },
    alarms: {
      get: vi.fn(async () => null),
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      getAll: vi.fn(async () => []),
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      getURL: vi.fn(() => ""),
      sendMessage: vi.fn(async () => undefined),
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    },
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setPersist: vi.fn() },
}));
vi.mock("@core/errors", () => ({ installErrorCapture: vi.fn() }));
vi.mock("@core/messaging", () => ({
  onMessage: vi.fn((fn: (typeof wiring.onMessage)[number]) => {
    wiring.onMessage.push(fn);
    return () => undefined;
  }),
  sendToTab: vi.fn((tabId: number, msg: { type?: string }) => {
    if (msg?.type !== "obs_scene_owner_ping") return Promise.resolve(undefined);
    wiring.pings.push(tabId);
    const answer = wiring.pingAnswer.get(tabId);
    if (answer === "hang") return new Promise((resolve) => wiring.pending.push(resolve));
    return Promise.resolve(answer);
  }),
  sendRuntime: vi.fn(async () => undefined),
  broadcastToGameTabs: vi.fn(async () => undefined),
}));
vi.mock("@core/settings", () => ({
  getSettings: vi.fn(async () => settings.current),
  getSetting: vi.fn(async (key: string) => settings.current[key]),
  onSettingsChanged: vi.fn(() => () => undefined),
}));
vi.mock("../../src/background/onboarding", () => ({ handleInstalled: vi.fn() }));
vi.mock("../../src/background/notes-coordinator", () => ({
  applyNoteOps: vi.fn(async () => undefined),
  mergeNotesViaCoordinator: vi.fn(async () => undefined),
}));

import { OWNER_TTL_MS } from "../../src/background/scene-owner";

const OWNER_KEY = "obs_scene_owner";
const OWNER = 7;
const ASKER = 9;

/** Двойник OBS: хендшейк и смена сцены. */
class FakeObs {
  static last: FakeObs | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readonly scenes: string[] = [];

  constructor(public readonly url: string) {
    FakeObs.last = this;
  }

  send(data: string): void {
    const msg = JSON.parse(data) as {
      op: number;
      d?: { requestType?: string; requestId?: number; requestData?: Record<string, unknown> };
    };
    if (msg.op === 1) {
      this.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
      return;
    }
    if (msg.op !== 6) return;
    if (msg.d?.requestType === "SetCurrentProgramScene") {
      this.scenes.push(String(msg.d.requestData?.sceneName));
    }
    this.onmessage?.({
      data: JSON.stringify({
        op: 7,
        d: {
          requestId: msg.d?.requestId,
          requestStatus: { result: true },
          responseData:
            msg.d?.requestType === "GetSceneList" ? { scenes: [], currentProgramSceneName: "Сцена" } : {},
        },
      }),
    });
  }

  close(code = 1000, reason = ""): void {
    this.onclose?.({ code, reason });
  }

  hello(): void {
    this.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  }
}

async function flush(times = 40): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function bootConnected(): Promise<FakeObs> {
  vi.resetModules();
  await import("../../src/background/index");
  await flush();
  const socket = FakeObs.last;
  if (!socket) throw new Error("background не открыл сокет OBS");
  socket.hello();
  await flush();
  return socket;
}

function setScene(
  tabId: number,
  manual = false,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  for (const fn of wiring.onMessage) {
    const res = fn(
      { type: "obs_command", command: "set_scene", data: { sceneName: "Ночь", manual } },
      { tab: { id: tabId } },
    );
    if (res !== undefined) return res as never;
  }
  throw new Error("обработчик obs_command не найден");
}

const fresh = () => ({ tabId: OWNER, ts: Date.now() - 1000 });
const stale = () => ({ tabId: OWNER, ts: Date.now() - OWNER_TTL_MS - 1 });

beforeEach(() => {
  vi.useFakeTimers();
  store.data = {};
  wiring.onMessage.length = 0;
  wiring.pingAnswer.clear();
  wiring.pending.length = 0;
  wiring.pings.length = 0;
  settings.current = {
    extension_enabled: true,
    obs_enabled: true,
    obs_host: "ws://localhost:4455",
    obs_password: "",
    debug_logging_enabled: false,
  };
  FakeObs.last = null;
  vi.stubGlobal("WebSocket", FakeObs as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("set_scene: background спрашивает владельца", () => {
  test("запись протухла, владелец отвечает «веду» — опрошен, сцена не меняется", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = stale();
    wiring.pingAnswer.set(OWNER, { owning: true });

    const res = await setScene(ASKER);

    expect(wiring.pings).toEqual([OWNER]);
    expect(res.data).toEqual({ ignored: "not_owner" });
    expect(obs.scenes).toEqual([]);
    expect((store.data[OWNER_KEY] as { tabId: number }).tabId).toBe(OWNER);
  });

  test("владелец ответил «не веду» — сцена переходит сразу", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = fresh();
    wiring.pingAnswer.set(OWNER, { owning: false });

    await setScene(ASKER);

    expect(obs.scenes).toEqual(["Ночь"]);
    expect((store.data[OWNER_KEY] as { tabId: number }).tabId).toBe(ASKER);
  });

  test("канал отказал (вкладки нет) — сцена переходит и при свежей записи", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = fresh();

    await setScene(ASKER);

    expect(wiring.pings).toEqual([OWNER]);
    expect(obs.scenes).toEqual(["Ночь"]);
  });

  test("ручной клик проходит без опроса владельца", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = fresh();
    wiring.pingAnswer.set(OWNER, { owning: true });

    await setScene(ASKER, true);

    expect(wiring.pings).toEqual([]);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect((store.data[OWNER_KEY] as { tabId: number }).tabId).toBe(ASKER);
  });

  test("ответ без булева owning — как молчание: свежая запись держит сцену", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = fresh();
    wiring.pingAnswer.set(OWNER, { owning: "yes" });

    const res = await setScene(ASKER);

    expect(res.data).toEqual({ ignored: "not_owner" });
    expect(obs.scenes).toEqual([]);
  });
});

describe("set_scene: владелец не отвечает", () => {
  test("до таймаута решения нет; после — свежая запись держит сцену", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = fresh();
    wiring.pingAnswer.set(OWNER, "hang");

    let settled = false;
    const reply = setScene(ASKER).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1400);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    const res = await reply;
    expect(res.data).toEqual({ ignored: "not_owner" });
    expect(obs.scenes).toEqual([]);
  });

  test("после таймаута протухшая запись переходит к просящей вкладке", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = stale();
    wiring.pingAnswer.set(OWNER, "hang");

    const reply = setScene(ASKER);
    await vi.advanceTimersByTimeAsync(1600);
    await reply;

    expect(obs.scenes).toEqual(["Ночь"]);
    expect((store.data[OWNER_KEY] as { tabId: number }).tabId).toBe(ASKER);
  });

  test("на границе TTL молчание сцену не отдаёт", async () => {
    const obs = await bootConnected();
    wiring.pingAnswer.set(OWNER, "hang");
    // Возраст записи ровно TTL: background берёт время до опроса.
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - OWNER_TTL_MS };

    const reply = setScene(ASKER);
    await vi.advanceTimersByTimeAsync(1600);
    const res = await reply;

    expect(res.data).toEqual({ ignored: "not_owner" });
    expect(obs.scenes).toEqual([]);
  });

  test("поздний ответ владельца не отменяет принятое решение", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = stale();
    wiring.pingAnswer.set(OWNER, "hang");

    const reply = setScene(ASKER);
    await vi.advanceTimersByTimeAsync(1600);
    await reply;
    for (const resolve of wiring.pending) resolve({ owning: true });
    await flush();

    expect(obs.scenes).toEqual(["Ночь"]);
    expect((store.data[OWNER_KEY] as { tabId: number }).tabId).toBe(ASKER);
  });
});
