import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ResumeSearch, type ResumeClient, type ResumeResult, type ResumeSocket } from "../../src/content/page/resume-search";

function socket() {
  const handlers = new Map<string, Set<(value: unknown) => void>>();
  const value: ResumeSocket = {
    connected: false,
    on: vi.fn((event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    removeListener: vi.fn((event, handler) => handlers.get(event)?.delete(handler)),
  };
  return {
    value,
    fire(event: string, payload?: unknown) { for (const handler of [...(handlers.get(event) ?? [])]) handler(payload); },
    count: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

let client: ResumeClient;
let transport: ReturnType<typeof socket>;
let result: ReturnType<typeof vi.fn<(result: ResumeResult) => void>>;
let authorize: ReturnType<typeof vi.fn<() => boolean | Promise<boolean>>>;
let coordinator: ResumeSearch;
beforeEach(() => {
  vi.useFakeTimers();
  transport = socket();
  result = vi.fn<(result: ResumeResult) => void>();
  authorize = vi.fn<() => boolean | Promise<boolean>>(() => true);
  client = {
    socket: null,
    isSearching: false,
    isIniSearch: false,
    startSearch: vi.fn(() => { client.isIniSearch = true; client.socket = transport.value; }),
    disconnectSocket: vi.fn(() => { client.isIniSearch = false; transport.value.connected = false; }),
  };
  coordinator = new ResumeSearch(client, { authorize, result });
});
afterEach(() => { coordinator.cancel(); vi.useRealTimers(); });
const begin = async () => { coordinator.start(); await vi.advanceTimersByTimeAsync(0); };

describe("ResumeSearch outcomes", () => {
  test("only a valid own timeInSearch proves restoration, including zero", async () => {
    await begin();
    transport.fire("session_initialized", { timeInSearch: 0 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 0 });
    expect(transport.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  test("init without timeInSearch waits for actual ACK; success is a new search", async () => {
    await begin(); transport.fire("session_initialized", null);
    expect(result).not.toHaveBeenCalled();
    transport.fire("on_start_game_search", { success: true });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "new" });
  });

  test("inherited timeInSearch is not evidence", async () => {
    await begin(); transport.fire("session_initialized", Object.create({ timeInSearch: 1000 }));
    expect(result).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "timeout" });
  });

  test.each([-1, Infinity, NaN, "1000", null])("malformed timeInSearch %s fails visibly", async time => {
    await begin(); transport.fire("session_initialized", { timeInSearch: time });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "contract" });
  });

  test("already searching is not mislabeled restored and causes no invocation", async () => {
    client.isSearching = true; await begin();
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "already-searching" });
    expect(client.startSearch).not.toHaveBeenCalled();
  });

  test("an event missed before socket discovery yields only already-searching", async () => {
    vi.mocked(client.startSearch).mockImplementation(() => { client.isSearching = true; client.socket = transport.value; });
    await begin(); expect(result).toHaveBeenCalledExactlyOnceWith({ state: "already-searching" });
  });

  test("server refusal is terminal and never reconnects around the refusal", async () => {
    await begin(); transport.fire("on_start_game_search", { success: false, illegalState: "game_search" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "server" });
    expect(client.startSearch).toHaveBeenCalledTimes(1);
  });

  test("connection_refused is a visible terminal outcome", async () => {
    await begin(); transport.fire("connection_refused");
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "server" });
  });

  test("an assigned game ends recovery without starting or quitting another search", async () => {
    client.isFoundGame = true; await begin();
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "game" });
    expect(client.startSearch).not.toHaveBeenCalled(); expect(client.disconnectSocket).not.toHaveBeenCalled();
  });

  test("the server can confirm an assigned game after an acknowledged handoff", async () => {
    coordinator = new ResumeSearch(client, { authorize, result, confirmedQueue: true });
    await begin(); transport.fire("on_start_game_search", { success: false, illegalState: "in_game" });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "game" });
    expect(client.disconnectSocket).not.toHaveBeenCalled();
  });

  test("in_game after a cold/refused handoff does not prove a new assignment", async () => {
    await begin(); transport.fire("on_start_game_search", { success: false, illegalState: "in_game" });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "server" });
    expect(client.disconnectSocket).not.toHaveBeenCalled();
    expect(transport.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  test("the old SSR userInGame flag alone never proves that a new game was assigned", async () => {
    client.userInGame = true; await begin();
    expect(client.startSearch).toHaveBeenCalledTimes(1); expect(result).not.toHaveBeenCalled();
    transport.fire("session_initialized", { timeInSearch: 1500 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 1500 });
  });
});

describe("ResumeSearch liveness and cancellation", () => {
  test("socket creation may happen asynchronously; deadline does not disappear", async () => {
    vi.mocked(client.startSearch).mockImplementation(() => { client.isIniSearch = true; });
    await begin(); await vi.advanceTimersByTimeAsync(500);
    client.socket = transport.value; await vi.advanceTimersByTimeAsync(50);
    transport.fire("session_initialized", { timeInSearch: 2500 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 2500 });
  });

  test("no socket or network event still terminates at total deadline", async () => {
    vi.mocked(client.startSearch).mockImplementation(() => { client.isIniSearch = true; });
    await begin(); await vi.advanceTimersByTimeAsync(10_000);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an initialized socket without search outcome still times out", async () => {
    await begin(); transport.fire("session_initialized", {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "timeout" }); expect(transport.count()).toBe(0);
  });

  test("a replacement socket detaches the previous generation and keeps the absolute deadline", async () => {
    await begin(); const replacement = socket(); client.socket = replacement.value;
    await vi.advanceTimersByTimeAsync(50);
    expect(transport.count()).toBe(0); transport.fire("session_initialized", { timeInSearch: 200 });
    expect(result).not.toHaveBeenCalled();
    replacement.fire("session_initialized", { timeInSearch: 350 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 350 });
    expect(replacement.count()).toBe(0);
  });

  test("a changed client method fails visibly and still cleans the deadline", async () => {
    vi.mocked(client.startSearch).mockImplementation(() => { throw new Error("client changed"); });
    await begin(); expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "contract" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("pending authorization is bounded by deadline and cannot act afterwards", async () => {
    let release!: (value: boolean) => void;
    authorize.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    coordinator.start(); await vi.advanceTimersByTimeAsync(10_000); release(true); await Promise.resolve();
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "timeout" }); expect(client.startSearch).not.toHaveBeenCalled();
  });

  test("cancel while authorization waits removes all work, even after late permission", async () => {
    let release!: (value: boolean) => void;
    authorize.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    coordinator.start(); coordinator.cancel(); release(true); await Promise.resolve();
    expect(client.startSearch).not.toHaveBeenCalled(); expect(result).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  test("denied authorization gives a terminal deferral without losing the handoff", async () => {
    authorize.mockResolvedValue(false); await begin();
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "deferred" }); expect(client.startSearch).not.toHaveBeenCalled();
  });

  test("authorization errors are visible and no client method runs", async () => {
    authorize.mockRejectedValue(new Error("bridge gone")); await begin();
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "authorization" }); expect(client.startSearch).not.toHaveBeenCalled();
  });

  test("start is idempotent and existing in-flight initialization is reused", async () => {
    client.socket = transport.value; client.isIniSearch = true;
    coordinator.start(); coordinator.start(); await vi.advanceTimersByTimeAsync(0);
    expect(client.startSearch).not.toHaveBeenCalled();
    transport.fire("session_initialized", { timeInSearch: 200 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 200 });
  });
});

describe("ResumeSearch reconnect budget", () => {
  test.each(["connect_error", "disconnect", "connect_timeout"])("one authorized reconnect after %s", async event => {
    await begin(); transport.fire(event);
    expect(transport.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(authorize).toHaveBeenCalledTimes(2); expect(client.startSearch).toHaveBeenCalledTimes(2);
    transport.fire("session_initialized", { timeInSearch: 1000 });
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "restored", timeInSearch: 1000 });
  });

  test("repeated network failures stop after one reconnect", async () => {
    await begin(); transport.fire("connect_error"); transport.fire("disconnect");
    await vi.advanceTimersByTimeAsync(250); transport.fire("connect_error");
    expect(client.startSearch).toHaveBeenCalledTimes(2);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "connection" }); expect(vi.getTimerCount()).toBe(0);
  });

  test("reconnect requires fresh authorization; cancellation prevents the second start", async () => {
    await begin(); authorize.mockResolvedValue(false); transport.fire("disconnect");
    await vi.advanceTimersByTimeAsync(250);
    expect(client.startSearch).toHaveBeenCalledTimes(1); expect(result).toHaveBeenCalledExactlyOnceWith({ state: "deferred" });
  });

  test("retry delay remains within the original 10 second budget", async () => {
    await begin(); await vi.advanceTimersByTimeAsync(9900); transport.fire("connect_error");
    await vi.advanceTimersByTimeAsync(100);
    expect(result).toHaveBeenCalledExactlyOnceWith({ state: "timeout" }); expect(client.startSearch).toHaveBeenCalledTimes(1);
  });

  test("connected idle client is reinitialized only once using site methods", async () => {
    transport.value.connected = true; client.socket = transport.value;
    await begin(); expect(client.disconnectSocket).toHaveBeenCalledTimes(1); expect(client.startSearch).toHaveBeenCalledTimes(1);
    transport.fire("connect_error"); expect(result).toHaveBeenCalledExactlyOnceWith({ state: "refused", reason: "connection" });
  });

  test("teardown removes only coordinator handlers, retaining the site's handler", async () => {
    const siteHandler = vi.fn(); transport.value.on("disconnect", siteHandler);
    await begin(); coordinator.cancel();
    expect(transport.count()).toBe(1); transport.fire("disconnect"); expect(siteHandler).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
