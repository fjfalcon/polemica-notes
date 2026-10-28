/**
 * Закрытие вкладки-владельца и заявка другой вкладки на автосцену.
 *
 * Очистка владения в tabs.onRemoved читает запись и удаляет её; если это идёт
 * мимо очереди владения, заявка соседней вкладки успевает записать себя между
 * чтением и удалением, и запоздалая очистка стирает уже нового владельца.
 * Здесь настоящий background, хранилище в памяти и задержка чтения по команде.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const gate = vi.hoisted(() => ({
  holdOwnerRead: false,
  failOwnerRead: false,
  failOwnerRemove: false,
  held: [] as (() => void)[],
  writes: [] as string[],
}));
const wiring = vi.hoisted(() => ({
  onMessage: [] as ((msg: unknown, sender: unknown) => unknown)[],
  onRemoved: [] as ((tabId: number, info: unknown) => void)[],
  pingAnswer: new Map<number, unknown>(),
  pending: [] as ((v: unknown) => void)[],
  pings: [] as number[],
}));

vi.mock("@core/env", () => {
  const ownerKey = "obs_scene_owner";
  const snapshot = (defaults: Record<string, unknown> | string[] | string) => {
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
  };
  return {
    browser: {
      storage: {
        local: {
          get: vi.fn((defaults: Record<string, unknown> | string[] | string) => {
            const value = snapshot(defaults);
            const asksOwner =
              typeof defaults === "object" && !Array.isArray(defaults) && ownerKey in defaults;
            if (asksOwner && gate.failOwnerRead) {
              gate.failOwnerRead = false;
              return Promise.reject(new Error("storage недоступен"));
            }
            if (asksOwner && gate.holdOwnerRead) {
              gate.holdOwnerRead = false;
              return new Promise((resolve) => gate.held.push(() => resolve(value)));
            }
            return Promise.resolve(value);
          }),
          set: vi.fn(async (patch: Record<string, unknown>) => {
            if (ownerKey in patch) {
              gate.writes.push(`set:${(patch[ownerKey] as { tabId?: number } | null)?.tabId}`);
            }
            Object.assign(store.data, patch);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            if (list.includes(ownerKey)) {
              if (gate.failOwnerRemove) {
                gate.failOwnerRemove = false;
                throw new Error("storage недоступен");
              }
              gate.writes.push("remove");
            }
            for (const key of list) delete store.data[key];
          }),
        },
        sync: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
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
        onRemoved: {
          addListener: (fn: (typeof wiring.onRemoved)[number]) => wiring.onRemoved.push(fn),
        },
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    },
  };
});
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
  applyTagOps: vi.fn(async () => undefined),
  mergeNotesViaCoordinator: vi.fn(async () => undefined),
  migrateViaCoordinator: vi.fn(async () => undefined),
}));

const OWNER_KEY = "obs_scene_owner";
const OWNER = 7;
const ASKER = 9;

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
            msg.d?.requestType === "GetSceneList"
              ? { scenes: [], currentProgramSceneName: "Сцена" }
              : {},
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

async function flush(times = 60): Promise<void> {
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
  gate.writes.length = 0;
  return socket;
}

function setScene(tabId: number): Promise<{ success: boolean; data?: unknown; error?: string }> {
  for (const fn of wiring.onMessage) {
    const res = fn(
      { type: "obs_command", command: "set_scene", data: { sceneName: "Ночь", manual: false } },
      { tab: { id: tabId } },
    );
    if (res !== undefined) return res as never;
  }
  throw new Error("обработчик obs_command не найден");
}

function closeTab(tabId: number): void {
  for (const fn of wiring.onRemoved) fn(tabId, { windowId: 1, isWindowClosing: false });
}

function releaseHeld(): void {
  for (const resolve of gate.held.splice(0)) resolve();
}

const ownerTab = () => (store.data[OWNER_KEY] as { tabId?: number } | undefined)?.tabId;

beforeEach(() => {
  vi.useFakeTimers();
  store.data = {};
  gate.holdOwnerRead = false;
  gate.failOwnerRead = false;
  gate.failOwnerRemove = false;
  gate.held.length = 0;
  gate.writes.length = 0;
  wiring.onMessage.length = 0;
  wiring.onRemoved.length = 0;
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

describe("закрытие вкладки-владельца и заявка соседней вкладки", () => {
  test("задержанная очистка не стирает владельца, записанного после закрытия", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };

    gate.holdOwnerRead = true;
    closeTab(OWNER);
    await flush();
    expect(gate.held).toHaveLength(1);

    const reply = setScene(ASKER);
    await flush();
    releaseHeld();
    await flush();
    await reply;
    await flush();

    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual(["remove", `set:${ASKER}`]);
  });

  test("закрытие во время опроса владельца: очистка идёт после заявки и её не трогает", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };
    wiring.pingAnswer.set(OWNER, "hang");

    const reply = setScene(ASKER);
    await flush();
    expect(wiring.pings).toEqual([OWNER]);

    closeTab(OWNER);
    await flush();
    await vi.advanceTimersByTimeAsync(1600);
    await reply;
    await flush();

    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual([`set:${ASKER}`]);
  });

  test("закрытие чужой вкладки не трогает владельца и сцену", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };
    wiring.pingAnswer.set(OWNER, { owning: true });

    closeTab(42);
    await flush();
    const res = await setScene(ASKER);
    await flush();

    expect(res.data).toEqual({ ignored: "not_owner" });
    expect(ownerTab()).toBe(OWNER);
    expect(obs.scenes).toEqual([]);
    expect(gate.writes).toEqual([]);
  });

  test("повторное событие закрытия владельца не стирает нового владельца", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };

    closeTab(OWNER);
    closeTab(OWNER);
    await flush();
    await setScene(ASKER);
    await flush();
    closeTab(OWNER);
    await flush();

    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual(["remove", `set:${ASKER}`]);
  });
});

describe("сбой хранилища при очистке не отравляет очередь владения", () => {
  test("чтение отказало — следующая заявка решается по обычным правилам", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };

    gate.failOwnerRead = true;
    closeTab(OWNER);
    await flush();
    await setScene(ASKER);
    await flush();

    expect(wiring.pings).toEqual([OWNER]);
    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual([`set:${ASKER}`]);
  });

  test("удаление отказало — следующая заявка решается по обычным правилам", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };

    gate.failOwnerRemove = true;
    closeTab(OWNER);
    await flush();
    await setScene(ASKER);
    await flush();

    expect(wiring.pings).toEqual([OWNER]);
    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual([`set:${ASKER}`]);
  });
});

describe("поздний ответ владельца после таймаута опроса", () => {
  test("заявка уже записана — поздний ответ и закрытие старой вкладки её не меняют", async () => {
    const obs = await bootConnected();
    store.data[OWNER_KEY] = { tabId: OWNER, ts: Date.now() - 1000 };
    wiring.pingAnswer.set(OWNER, "hang");

    const reply = setScene(ASKER);
    await vi.advanceTimersByTimeAsync(1600);
    await reply;
    for (const resolve of wiring.pending.splice(0)) resolve({ owning: true });
    await flush();
    closeTab(OWNER);
    await flush();

    expect(ownerTab()).toBe(ASKER);
    expect(obs.scenes).toEqual(["Ночь"]);
    expect(gate.writes).toEqual([`set:${ASKER}`]);
  });
});
