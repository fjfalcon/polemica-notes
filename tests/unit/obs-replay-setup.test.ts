/**
 * replay_setup: повтор после сбоя (O11) и параллельные вкладки (O7/O8).
 *
 * Метка obs_clip_rb_set означает «эта длина уже применена». Если она
 * ставится до перезапуска живого буфера, упавший StopReplayBuffer оставляет
 * метку, повтор видит «не менялось» и буфер живёт со старой длиной до
 * перезапуска OBS. При выключенном буфере метка ставится до старта, как
 * раньше: иначе бут вкладки перетирал бы длину стримера (OBS-6).
 *
 * Импортируется НАСТОЯЩИЙ background/index.ts с настоящим ObsClient
 * (двойник сокета по образцу obs-record-clip.test.ts).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  failNextSetOf: null as string | null,
}));
const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const wiring = vi.hoisted(() => ({
  onMessage: [] as ((msg: unknown, sender: unknown) => unknown)[],
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
          if (store.failNextSetOf !== null && store.failNextSetOf in patch) {
            store.failNextSetOf = null;
            throw new Error("storage.local.set отказал");
          }
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
  sendToTab: vi.fn(async () => undefined),
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

const MARKER = "obs_clip_rb_set";
const RB_TIME = "SimpleOutput/RecRBTime";

/** Двойник OBS: хендшейк, буфер повторов, параметры профиля и отказы. */
class FakeObs {
  static last: FakeObs | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  replayActive = false;
  /** Длина, с которой буфер реально запущен (применяется только стартом). */
  activeLength: string | null = null;
  /** Replay Buffer выключен в настройках OBS → StartReplayBuffer отказывает. */
  replayAllowed = true;
  failNextReplayStop = false;
  failNextReplayStart = false;
  failNextProfileSet = false;
  params = new Map<string, string>([["Output/Mode", "Simple"]]);
  readonly profileWrites: string[] = [];
  readonly requests: string[] = [];

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
    const type = msg.d?.requestType ?? "";
    const rd = msg.d?.requestData ?? {};
    this.requests.push(type);
    let result = true;
    let responseData: Record<string, unknown> = {};
    switch (type) {
      case "GetSceneList":
        responseData = { scenes: [], currentProgramSceneName: "Сцена" };
        break;
      case "GetRecordStatus":
        responseData = { outputActive: false };
        break;
      case "GetReplayBufferStatus":
        responseData = { outputActive: this.replayActive };
        break;
      case "StartReplayBuffer":
        if (this.failNextReplayStart) {
          this.failNextReplayStart = false;
          result = false;
        } else if (!this.replayAllowed || this.replayActive) {
          result = false;
        } else {
          this.replayActive = true;
          this.activeLength = this.params.get(RB_TIME) ?? null;
        }
        break;
      case "StopReplayBuffer":
        if (this.failNextReplayStop || !this.replayActive) {
          this.failNextReplayStop = false;
          result = false;
        } else {
          this.replayActive = false;
          this.activeLength = null;
        }
        break;
      case "GetProfileParameter":
        responseData = {
          parameterValue:
            this.params.get(`${rd.parameterCategory}/${rd.parameterName}`) ?? null,
        };
        break;
      case "SetProfileParameter":
        if (this.failNextProfileSet) {
          this.failNextProfileSet = false;
          result = false;
          break;
        }
        this.params.set(`${rd.parameterCategory}/${rd.parameterName}`, String(rd.parameterValue));
        this.profileWrites.push(String(rd.parameterValue));
        break;
      default:
        break;
    }
    this.onmessage?.({
      data: JSON.stringify({
        op: 7,
        d: {
          requestId: msg.d?.requestId,
          requestStatus: { result, comment: result ? undefined : "отказ OBS" },
          responseData,
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

  count(type: string): number {
    return this.requests.filter((r) => r === type).length;
  }

  reset(): void {
    this.requests.length = 0;
    this.profileWrites.length = 0;
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

async function command(
  cmd: string,
  data?: Record<string, unknown>,
  tabId = 5,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  for (const fn of wiring.onMessage) {
    const res = fn({ type: "obs_command", command: cmd, data }, { tab: { id: tabId } });
    if (res !== undefined) return (await res) as never;
  }
  throw new Error("обработчик obs_command не найден");
}

/** Буфер живёт с длиной 60, которую выставили мы. */
async function bootWithLiveBuffer(): Promise<FakeObs> {
  const obs = await bootConnected();
  const first = await command("replay_setup", { seconds: 60 });
  expect(first.success).toBe(true);
  expect(obs.activeLength).toBe("60");
  expect(store.data[MARKER]).toBe(60);
  obs.reset();
  return obs;
}

beforeEach(() => {
  store.data = {};
  store.failNextSetOf = null;
  wiring.onMessage.length = 0;
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
});

describe("replay_setup: повтор после сбоя (O11)", () => {
  test("отказ StopReplayBuffer: метка не ставится, повтор перезапускает буфер с новой длиной", async () => {
    const obs = await bootWithLiveBuffer();
    obs.failNextReplayStop = true;
    const failed = await command("replay_setup", { seconds: 180 });
    expect(failed.success).toBe(false);
    expect.soft(store.data[MARKER], "метка не опережает перезапуск").toBe(60);
    expect.soft(obs.activeLength, "буфер жив со старой длиной").toBe("60");

    obs.reset();
    const retry = await command("replay_setup", { seconds: 180 });
    expect(retry.success).toBe(true);
    expect(obs.count("StopReplayBuffer"), "повтор останавливает буфер").toBe(1);
    expect(obs.count("StartReplayBuffer"), "повтор запускает буфер").toBe(1);
    expect(obs.replayActive).toBe(true);
    expect(obs.activeLength, "буфер работает с новой длиной").toBe("180");
    expect(store.data[MARKER]).toBe(180);
  });

  test("отказ StartReplayBuffer после удачного стопа: метка не ставится, повтор запускает буфер", async () => {
    const obs = await bootWithLiveBuffer();
    obs.failNextReplayStart = true;
    const failed = await command("replay_setup", { seconds: 180 });
    expect(failed.success).toBe(false);
    expect(obs.replayActive).toBe(false);
    expect(store.data[MARKER], "метка не ставится до удачного старта").toBe(60);

    obs.reset();
    const retry = await command("replay_setup", { seconds: 180 });
    expect(retry.success).toBe(true);
    expect(obs.count("StartReplayBuffer")).toBe(1);
    expect(obs.replayActive).toBe(true);
    expect(obs.activeLength).toBe("180");
    expect(store.data[MARKER]).toBe(180);
  });

  test("отказ записи в профиль: ничего не помечено, повтор пишет профиль снова", async () => {
    const obs = await bootWithLiveBuffer();
    obs.failNextProfileSet = true;
    const failed = await command("replay_setup", { seconds: 180 });
    expect(failed.success).toBe(false);
    expect(store.data[MARKER]).toBe(60);
    expect(obs.count("StopReplayBuffer")).toBe(0);
    expect(obs.activeLength).toBe("60");

    obs.reset();
    const retry = await command("replay_setup", { seconds: 180 });
    expect(retry.success).toBe(true);
    expect(obs.profileWrites).toEqual(["180"]);
    expect(obs.activeLength).toBe("180");
    expect(store.data[MARKER]).toBe(180);
  });

  test("отказ записи метки после удачного перезапуска: ошибка видна, повтор перезапускает и метит", async () => {
    const obs = await bootWithLiveBuffer();
    store.failNextSetOf = MARKER;
    const failed = await command("replay_setup", { seconds: 180 });
    expect(failed.success).toBe(false);
    expect(failed.error).toContain("storage.local.set");
    expect(obs.count("StopReplayBuffer"), "перезапуск прошёл до записи метки").toBe(1);
    expect(obs.count("StartReplayBuffer")).toBe(1);
    expect(obs.activeLength).toBe("180");
    expect(store.data[MARKER]).toBe(60);

    obs.reset();
    const retry = await command("replay_setup", { seconds: 180 });
    expect(retry.success).toBe(true);
    expect(obs.count("StopReplayBuffer")).toBe(1);
    expect(obs.count("StartReplayBuffer")).toBe(1);
    expect(obs.activeLength).toBe("180");
    expect(store.data[MARKER]).toBe(180);
  });

  test("удачный повтор той же длины: ни стопа, ни старта, ни записи профиля — хвост цел", async () => {
    const obs = await bootWithLiveBuffer();
    const again = await command("replay_setup", { seconds: 60 });
    expect(again.success).toBe(true);
    expect(again.data?.restarted).toBe(false);
    expect(obs.count("StopReplayBuffer")).toBe(0);
    expect(obs.count("StartReplayBuffer")).toBe(0);
    expect(obs.count("SetProfileParameter")).toBe(0);
    expect(obs.replayActive).toBe(true);
  });

  test("OBS-6: буфер выключен в OBS — метка всё равно ставится, бут не перетирает длину", async () => {
    const obs = await bootConnected();
    obs.replayAllowed = false;
    const first = await command("replay_setup", { seconds: 60 });
    expect(first.success).toBe(false);
    expect(store.data[MARKER]).toBe(60);
    expect(obs.profileWrites).toEqual(["60"]);

    obs.params.set(RB_TIME, "300");
    obs.reset();
    const second = await command("replay_setup", { seconds: 60 });
    expect(second.success).toBe(false);
    expect(obs.count("SetProfileParameter")).toBe(0);
    expect(obs.params.get(RB_TIME), "значение стримера не тронуто").toBe("300");
  });
});

describe("replay_setup: две вкладки одновременно", () => {
  test("O7: та же длина при живом буфере — ни перезапуска, ни записи профиля, оба ответа успешны", async () => {
    const obs = await bootWithLiveBuffer();
    const [a, b] = await Promise.all([
      command("replay_setup", { seconds: 60 }, 5),
      command("replay_setup", { seconds: 60 }, 9),
    ]);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(obs.count("StopReplayBuffer")).toBe(0);
    expect(obs.count("StartReplayBuffer")).toBe(0);
    expect(obs.count("SetProfileParameter")).toBe(0);
    expect(obs.activeLength).toBe("60");
  });

  test("O8: новая одинаковая длина — одна запись профиля и одна пара стоп/старт", async () => {
    const obs = await bootWithLiveBuffer();
    const [a, b] = await Promise.all([
      command("replay_setup", { seconds: 180 }, 5),
      command("replay_setup", { seconds: 180 }, 9),
    ]);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(obs.profileWrites).toEqual(["180"]);
    expect(obs.count("StopReplayBuffer")).toBe(1);
    expect(obs.count("StartReplayBuffer")).toBe(1);
    expect(obs.replayActive).toBe(true);
    expect(obs.activeLength).toBe("180");
    expect(store.data[MARKER]).toBe(180);
  });
});
