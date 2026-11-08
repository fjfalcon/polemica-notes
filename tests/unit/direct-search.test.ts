import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DirectSearch, type PreparedConfig, type SearchOutcome, type SearchSocket } from "@content/page/direct-search";

const config: PreparedConfig = {
  endpoint: "https://game.polemicagame.com/search",
  request: { gameMode: "league", role: "player", userId: 7, authKey: "test-only", censorship: ["standard"] },
};
let handlers: Map<string, Set<(value: unknown) => void>>;
let socket: SearchSocket;
let wire: ReturnType<typeof vi.fn<SearchSocket["emit"]>>;
let factory: ReturnType<typeof vi.fn<(settings: PreparedConfig) => SearchSocket>>;
let result: ReturnType<typeof vi.fn<(state: SearchOutcome) => void>>;
let search: DirectSearch;
function deliver(event: string, value?: unknown): void {
  for (const callback of [...(handlers.get(event) ?? [])]) callback(value);
}
function connected(value: unknown = null): void { socket.connected = true; deliver("session_initialized", value); }
function ready(): void { expect(search.prepare()).toBe(true); connected(); }
const searchRequests = () => wire.mock.calls.filter(([event]) => event === "start_game_search");
const stateChecks = () => wire.mock.calls.filter(([event]) => event === "check_if_user_is_in_game");

beforeEach(() => {
  vi.useFakeTimers(); handlers = new Map();
  wire = vi.fn<SearchSocket["emit"]>();
  result = vi.fn<(state: SearchOutcome) => void>();
  socket = {
    connected: false,
    emit: wire,
    on: vi.fn((event, callback) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(callback);
    }),
    removeListener: vi.fn((event, callback) => handlers.get(event)?.delete(callback)),
    disconnect: vi.fn(() => { socket.connected = false; }),
  };
  factory = vi.fn<(settings: PreparedConfig) => SearchSocket>(() => socket);
  search = new DirectSearch(config, factory, result);
});
afterEach(() => { search.dispose(); vi.useRealTimers(); });

describe("controlled direct search protocol", () => {
  test("preparation and session initialization never enqueue before authorized start", () => {
    expect(search.start()).toBe(false);
    expect(search.prepare()).toBe(true);
    expect(factory).toHaveBeenCalledExactlyOnceWith(config);
    expect(search.ready()).toBe(false);
    vi.advanceTimersByTime(150); connected();
    expect(search.ready()).toBe(true);
    expect(wire).not.toHaveBeenCalled();
    expect(result.mock.calls).toEqual([["ready"]]);
    expect(search.start()).toBe(true);
    expect(wire).toHaveBeenCalledExactlyOnceWith("start_game_search", config.request);
    expect(wire.mock.calls[0][1]).toBe(config.request);
  });

  test("prepare and start cannot create duplicate sockets or requests", () => {
    ready(); expect(search.prepare()).toBe(false);
    expect(search.start()).toBe(true); expect(search.start()).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1); expect(wire).toHaveBeenCalledTimes(1);
  });

  test("no framework lifecycle, API poll, DOM click or credentials reconstruction exists in preparation", () => {
    const beforeMount = vi.fn(), apiSearchMe = vi.fn(() => ({ connected: false }));
    const settings = Object.assign({}, config, { beforeMount, checkIfUserInSearch: apiSearchMe });
    search = new DirectSearch(settings, factory, result);
    ready(); vi.advanceTimersByTime(5000);
    expect(beforeMount).not.toHaveBeenCalled(); expect(apiSearchMe).not.toHaveBeenCalled();
    expect(wire).not.toHaveBeenCalled(); expect(socket.emit).toBe(wire);
  });

  test.each([0, 1500, null, "unexpected"])("an existing server search (%s) is not silently taken over", time => {
    search.prepare(); connected({ timeInSearch: time });
    expect(search.ready()).toBe(false); expect(search.start()).toBe(false);
    expect(result.mock.calls).toEqual([["existing-search"]]);
    expect(socket.disconnect).toHaveBeenCalledTimes(1); expect(wire).not.toHaveBeenCalled();
  });

  test("an inherited timeInSearch is not treated as the server's own queue record", () => {
    search.prepare(); connected(Object.create({ timeInSearch: 1500 }));
    expect(result.mock.calls).toEqual([["ready"]]); expect(wire).not.toHaveBeenCalled();
  });

  test("a stale ready flag cannot send on a socket that is no longer connected", () => {
    ready(); socket.connected = false;
    expect(search.ready()).toBe(false); expect(search.start()).toBe(false); expect(wire).not.toHaveBeenCalled();
  });

  test("enqueue success requires server ACK, not a successful emit", () => {
    ready(); search.start();
    expect(result.mock.calls).toEqual([["ready"], ["sent"]]);
    deliver("on_start_game_search", { success: true });
    expect(result.mock.calls).toEqual([["ready"], ["sent"], ["queued"]]);
    deliver("on_start_game_search", { success: true });
    expect(result.mock.calls.filter(([state]) => state === "queued")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1); // membership poll survives ACK
  });

  test("in_game retries use the same payload, stay within budget three and deduplicate replies", () => {
    ready(); search.start();
    for (let i = 0; i < 3; i++) {
      deliver("on_start_game_search", { illegalState: "in_game" });
      deliver("on_start_game_search", { illegalState: "in_game" });
      vi.advanceTimersByTime(500);
    }
    expect(searchRequests()).toHaveLength(3);
    for (const [event, request] of searchRequests()) { expect(event).toBe("start_game_search"); expect(request).toBe(config.request); }
    expect(result.mock.calls.at(-1)).toEqual(["refused"]); expect(vi.getTimerCount()).toBe(0);
  });

  test("ACK cancels an already scheduled in_game retry", () => {
    ready(); search.start(); deliver("on_start_game_search", { illegalState: "in_game" });
    deliver("on_start_game_search", { success: true }); vi.advanceTimersByTime(1000);
    expect(searchRequests()).toHaveLength(1); expect(stateChecks()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1); // only the membership poll remains
  });

  test.each([null, undefined, {}, { success: "true" }, { illegalState: "game_search" }])("a malformed/refused ACK is not success: %j", payload => {
    ready(); search.start(); deliver("on_start_game_search", payload);
    expect(result.mock.calls.at(-1)).toEqual(["refused"]);
    expect(result.mock.calls.some(([state]) => state === "queued")).toBe(false);
  });

  test.each(["disconnect", "connect_error", "connect_timeout", "connection_refused"])("%s before start aborts readiness, without search", event => {
    search.prepare(); deliver(event);
    expect(result.mock.calls).toEqual([["unavailable"]]); expect(search.start()).toBe(false); expect(wire).not.toHaveBeenCalled();
  });

  test.each(["disconnect", "connect_error", "connect_timeout", "connection_refused"])("%s while awaiting ACK is terminal and bounded", event => {
    ready(); search.start(); deliver(event); vi.advanceTimersByTime(20_000);
    expect(result.mock.calls.at(-1)).toEqual(["refused"]);
    expect(result.mock.calls.filter(([state]) => state === "refused")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("handshake and ACK have separate finite deadlines", () => {
    search.prepare(); vi.advanceTimersByTime(9999); expect(result).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(result.mock.calls).toEqual([["unavailable"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("ACK silence stops at eight seconds", () => {
    ready(); search.start(); vi.advanceTimersByTime(7999);
    expect(result.mock.calls.at(-1)).toEqual(["sent"]);
    vi.advanceTimersByTime(1); expect(result.mock.calls.at(-1)).toEqual(["refused"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an assigned game before ACK is handled directly; late ACK never causes a reload outcome", () => {
    ready(); search.start(); deliver("on_game_found", { gameId: "42", dynamicFilling: true });
    deliver("on_start_game_search", { success: true });
    expect(search.foundGame()).toEqual({ gameId: 42, dynamicFilling: true });
    expect(result.mock.calls).toEqual([["ready"], ["sent"], ["found"]]); expect(vi.getTimerCount()).toBe(0);
  });

  test("back-to-back ACK and game-found retain both ordered outcomes", () => {
    ready(); search.start(); deliver("on_start_game_search", { success: true });
    deliver("on_game_found", { gameId: 42, dynamicFilling: "true" });
    expect(result.mock.calls).toEqual([["ready"], ["sent"], ["queued"], ["found"]]);
    expect(search.foundGame()).toEqual({ gameId: 42, dynamicFilling: "true" });
  });

  test("game-found during preparation is ignored instead of navigating from a standby", () => {
    search.prepare(); deliver("on_game_found", { gameId: 42 });
    expect(search.foundGame()).toBeNull(); expect(result).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled();
  });

  test.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "oops"])("invalid found game id %s is refused", gameId => {
    ready(); search.start(); deliver("on_game_found", { gameId });
    expect(search.foundGame()).toBeNull(); expect(result.mock.calls.at(-1)).toEqual(["refused"]);
  });

  test("cancel before start removes listeners and never calls stop_game_search", () => {
    search.prepare(); search.cancel(); connected(); deliver("on_game_found", { gameId: 42 });
    expect(search.start()).toBe(false); expect(result).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled();
    expect([...handlers.values()].every(set => set.size === 0)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  test("cancel during retry prevents every remaining request", () => {
    ready(); search.start(); deliver("on_start_game_search", { illegalState: "in_game" }); search.cancel();
    vi.advanceTimersByTime(20_000); expect(wire).toHaveBeenCalledTimes(1); expect(result.mock.calls.at(-1)).toEqual(["sent"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("cleanup retains the site's independent listener", () => {
    const siteHandler = vi.fn(); socket.on("disconnect", siteHandler);
    search.prepare(); search.cancel(); deliver("disconnect"); expect(siteHandler).toHaveBeenCalledTimes(1);
  });

  test("factory or transport exceptions give an honest terminal failure", () => {
    factory.mockImplementation(() => { throw new Error("factory unavailable"); });
    expect(search.prepare()).toBe(false); expect(result.mock.calls).toEqual([["unavailable"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("emit exceptions are not reported as sent or queued", () => {
    ready(); wire.mockImplementation(() => { throw new Error("socket gone"); }); search.start();
    expect(result.mock.calls).toEqual([["ready"], ["refused"]]); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("application membership poll", () => {
  test("starts 4 ms after explicit start, repeats every 7000 ms and survives ACK", () => {
    ready(); vi.advanceTimersByTime(5000); expect(stateChecks()).toEqual([]);
    search.start(); vi.advanceTimersByTime(3); expect(stateChecks()).toEqual([]);
    vi.advanceTimersByTime(1); expect(stateChecks()).toEqual([["check_if_user_is_in_game", { userId: 7 }]]);
    deliver("on_start_game_search", { success: true });
    vi.advanceTimersByTime(6999); expect(stateChecks()).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(stateChecks()).toHaveLength(2);
    expect(searchRequests()).toHaveLength(1);
    expect(result.mock.calls.filter(([state]) => state === "queued")).toHaveLength(1);
    search.dispose(); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(14_000); expect(stateChecks()).toHaveLength(2);
  });

  test("found cancels the membership poll, including before ACK", () => {
    ready(); search.start(); vi.advanceTimersByTime(4); expect(stateChecks()).toHaveLength(1);
    deliver("on_game_found", { gameId: 42 }); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(14_000); expect(stateChecks()).toHaveLength(1);
  });

  test("cancel before the first poll prevents every membership read", () => {
    ready(); search.start(); vi.advanceTimersByTime(3); search.cancel();
    vi.advanceTimersByTime(14_000); expect(stateChecks()).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  test("a membership emit error while awaiting ACK refuses and clears all timers", () => {
    ready(); search.start(); wire.mockImplementation(event => { if (event === "check_if_user_is_in_game") throw Error("closed"); });
    vi.advanceTimersByTime(4); expect(result.mock.calls.at(-1)).toEqual(["refused"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a membership error after ACK disposes without emitting a contradictory outcome", () => {
    ready(); search.start(); deliver("on_start_game_search", { success: true });
    wire.mockImplementation(event => { if (event === "check_if_user_is_in_game") throw Error("closed"); });
    vi.advanceTimersByTime(4); expect(result.mock.calls).toEqual([["ready"], ["sent"], ["queued"]]);
    expect(socket.disconnect).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
