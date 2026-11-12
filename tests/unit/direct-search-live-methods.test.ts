/** Actual downloaded site methods are the independent baseline. All latency values
 * below are controlled model inputs, not measurements of an authenticated game.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DirectSearch, type PreparedConfig, type SearchSocket } from "@content/page/direct-search";
import fixture from "../fixtures/search-start-methods.json";
import { SITE_STATE_REQUEST } from "./site-search-request";

const config: PreparedConfig = { endpoint: "https://game.polemicagame.com/search", request: {
  gameMode: "league", role: "player", userId: 7, censorship: ["standard"],
} };
const print = console.log.bind(console);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

interface Record { name: string; at: number; payload?: unknown }
function server(name: string, request: (name: string, payload: unknown) => void, restoredTime?: number) {
  const handlers = new Map<string, Set<(value: any) => void>>();
  const deliver = (event: string, value?: any) => { for (const handler of [...(handlers.get(event) ?? [])]) handler(value); };
  const socket: SearchSocket = {
    connected: false,
    on(event, handler) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(handler); return this; },
    removeListener(event, handler) { handlers.get(event)?.delete(handler); },
    disconnect() { socket.connected = false; deliver("disconnect"); },
    emit(event, payload) {
      if (event === "start_game_search") request(name, payload);
      return this;
    },
  };
  const connect = () => { setTimeout(() => { socket.connected = true; deliver("session_initialized", restoredTime === undefined ? null : { timeInSearch: restoredTime }); }, 150); return socket; };
  return { socket, connect, deliver };
}

function actualSite(name: string, request: (name: string, payload: unknown) => void, restoredTime?: number) {
  const transport = server(name, request, restoredTime);
  const io = () => () => transport.connect();
  // br — socket.io сайта, _r — его сброс флага «перезагрузить при обрыве» (сборка 12.11.2026).
  const connect = new Function("br", "_r", `return (${fixture.methods.connectSocketAndStartSearch})`)(io, () => {});
  const start = new Function(`return (${fixture.methods.startSearch})`)();
  const p: any = {
    user: { id: config.request.userId }, $root: { isUserLogin: () => true, showModal: vi.fn() },
    searchServiceUrl: config.endpoint, gameType: "league", role: "player", isVerified: true, isBanned: false,
    isIniSearch: false, isSearching: false, selectedCensorshipModes: ["standard"], acceptingPhase: { processing: false },
    toggleViewSearching(value: boolean) { p.isSearching = value; }, setIsShowQuiz: vi.fn(), startStopwatch: vi.fn(),
    censorshipModesUpdate: vi.fn(), dropAcceptingPhase: vi.fn(), storeChangeUserInGame: vi.fn(), notifyServerIsDown: vi.fn(),
    startSearch: start, connectSocketAndStartSearch: connect, disconnectSocket() { p.socket?.disconnect(); },
  };
  return { p, ...transport };
}

test("DIRECT_RACE: controlled preconnection versus the site's real manual-start path", () => {
  const requests: Record[] = [], acknowledgments: Record[] = [];
  let stoppedAt = 0;
  const transports = new Map<string, ReturnType<typeof server>>();
  const requested = (name: string, payload: unknown) => {
    requests.push({ name, at: Date.now() - stoppedAt, payload });
    setTimeout(() => {
      transports.get(name)!.deliver("on_start_game_search", { success: true });
      acknowledgments.push({ name, at: Date.now() - stoppedAt });
    }, 40);
  };
  const automatic = server("direct", requested); transports.set("direct", automatic);
  const ideal = actualSite("manual-0ms", requested); transports.set("manual-0ms", ideal);
  const manual = actualSite("manual-200ms", requested); transports.set("manual-200ms", manual);
  const factory = vi.fn((_settings: PreparedConfig) => automatic.connect());
  const result = vi.fn();
  const direct = new DirectSearch(config, factory, result);
  direct.prepare(); vi.advanceTimersByTime(150); stoppedAt = Date.now();
  expect(requests).toEqual([]); expect(direct.ready()).toBe(true);
  direct.start(); ideal.p.startSearch(); setTimeout(() => manual.p.startSearch(), 200);
  vi.advanceTimersByTime(500);
  expect(requests.map(({ name, at }) => ({ name, at }))).toEqual([
    { name: "direct", at: 0 }, { name: "manual-0ms", at: 150 }, { name: "manual-200ms", at: 350 },
  ]);
  expect(acknowledgments).toEqual([{ name: "direct", at: 40 }, { name: "manual-0ms", at: 190 }, { name: "manual-200ms", at: 390 }]);
  // This equality is against the payload constructed by the actual site's method.
  expect(requests[0].payload).toEqual(requests[1].payload);
  expect(Object.keys(requests[0].payload as object).sort()).toEqual(["censorship", "gameMode", "role", "userId"]);
  expect(result).toHaveBeenCalledWith("queued");

  direct.dispose(); ideal.p.disconnectSocket(); manual.p.disconnectSocket();
  const resumed = actualSite("resume", requested, 1000); resumed.p.startSearch(); vi.advanceTimersByTime(150);
  expect(requests).toHaveLength(3); expect(resumed.p.isSearching).toBe(true); expect(resumed.p.searchState.timeInSearch).toBe(1000);
  print("DIRECT_RACE=" + JSON.stringify({ assumptions: { socketHandshakeMs: 150, replyMs: 40, manualReactionMs: 200 },
    requests: requests.map(({ name, at }) => ({ name, at })), acknowledgments, restoredTimeInSearch: resumed.p.searchState.timeInSearch }));
  resumed.p.disconnectSocket();
});

/** Minimal runner for the generator state machine embedded in this one real fixture.
 * It preserves its actual branches/awaits; it does not rewrite the API predicate.
 */
function asyncHelpers() {
  const runtime = {
    mark: (fn: Function) => fn,
    wrap(step: (context: any) => unknown) {
      let done = false;
      const context = { next: 0, prev: 0, sent: undefined as unknown,
        stop() { done = true; }, abrupt(_type: string, value: unknown) { done = true; return value; } };
      return { next(value?: unknown) { context.sent = value; return { value: step(context), done }; } };
    },
  };
  const helper = (fn: Function) => function (this: unknown, ...args: unknown[]) {
    const iterator = fn.apply(this, args);
    return new Promise((resolve, reject) => {
      const advance = (value?: unknown) => {
        try { const next = iterator.next(value); if (next.done) resolve(next.value); else Promise.resolve(next.value).then(advance, reject); }
        catch (error) { reject(error); }
      };
      advance();
    });
  };
  return { runtime: () => runtime, helper };
}

test("the real API connected:false startup can enqueue, while direct preparation never executes that lifecycle", async () => {
  const requests: unknown[] = [];
  const site = actualSite("ordinary-site", (_name, payload) => requests.push(payload));
  const fetchSearch = vi.fn(async (_url: string, _init: unknown) => ({ json: async () => ({ connected: false }) }));
  const { runtime, helper } = asyncHelpers();
  site.p.newGameService = { httpUrl: "https://game.polemicagame.com" };
  const actualCheck = new Function("s", "o", "fetch", `return (${fixture.methods.checkIfUserInSearch})`)(helper, runtime, fetchSearch);
  const beforeMountRecovery = vi.fn(() => actualCheck.call(site.p));

  const explicit = server("direct", (_name, payload) => requests.push(payload));
  const direct = new DirectSearch(config, () => explicit.connect(), vi.fn());
  direct.prepare(); vi.advanceTimersByTime(150);
  expect(fetchSearch).not.toHaveBeenCalled(); expect(beforeMountRecovery).not.toHaveBeenCalled(); expect(requests).toEqual([]);

  // Positive control: execute the downloaded method, as ordinary beforeMount does.
  await beforeMountRecovery(); vi.advanceTimersByTime(150);
  expect(fetchSearch).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1);
  // С 12.11.2026 сайт узнаёт игрока по куке: пустое тело и credentials:"include".
  // direct-requeue-page.test.ts сверяет свой запрос с этим же образцом.
  expect(fetchSearch.mock.calls[0]).toEqual(["https://game.polemicagame.com/api/search/me", SITE_STATE_REQUEST]);
  expect(requests[0]).toEqual(config.request);
  expect(direct.ready()).toBe(true); // independent warm protocol still did not enqueue
  direct.dispose(); site.p.disconnectSocket();
});
