// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  queuePort: vi.fn(), postgamePort: vi.fn(), queueResult: vi.fn(), postgameResult: vi.fn(),
  queueAuth: vi.fn(), postgameAuth: vi.fn(), queueResume: vi.fn(), postgameResume: vi.fn(),
}));
vi.mock("@core/env", () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } } }));
vi.mock("@core/log", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@content/features/queue-requeue", () => ({ setDirectRequeuePort: mocks.queuePort,
  noteDirectRequeueResult: mocks.queueResult, canResumeDirectSearch: mocks.queueAuth, directResumeFinished: mocks.queueResume }));
vi.mock("@content/features/postgame-search", () => ({ setDirectPostgamePort: mocks.postgamePort,
  notePostgameDirectResult: mocks.postgameResult, canPostgameDirectAct: mocks.postgameAuth, postgameDirectResumeFinished: mocks.postgameResume }));
import { setupDirectRequeue } from "@content/direct-requeue-transport";
interface Port { prepare(): void; cancel(): void; start(at: number): boolean; resume(at: number, queued: boolean): void; enterGame(): boolean }
let queue: Port, postgame: Port;
let commands: { op: string; epoch: number; signalAt: number }[] = [];
beforeAll(() => {
  window.addEventListener("pn-direct-requeue-command", event => commands.push(JSON.parse((event as CustomEvent<string>).detail)));
  setupDirectRequeue(); queue = mocks.queuePort.mock.calls[0][0]; postgame = mocks.postgamePort.mock.calls[0][0];
});
beforeEach(() => {
  queue.cancel(); postgame.cancel(); commands = []; vi.clearAllMocks();
  mocks.queueAuth.mockReturnValue(true); mocks.postgameAuth.mockReturnValue(true);
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
});
afterEach(() => { queue.cancel(); postgame.cancel(); vi.restoreAllMocks(); });
function report(state: string, epoch = commands.at(-1)!.epoch) {
  window.dispatchEvent(new MessageEvent("message", { source: window,
    data: { source: "pn-direct-requeue", epoch, state, id: "request", signalAt: 123, at: 200 } }));
}
async function prepare(port: Port) {
  port.prepare(); document.querySelector<HTMLScriptElement>('script[src$="direct-requeue-page.js"]')?.dispatchEvent(new Event("load"));
  await Promise.resolve(); report("ready");
}
test("queue cleanup cannot cancel prepared postgame; one start consumes readiness", async () => {
  await prepare(postgame); const count = commands.length; queue.cancel(); expect(commands).toHaveLength(count);
  expect(postgame.start(123)).toBe(true); expect(commands.at(-1)?.op).toBe("quit-start");
  expect(postgame.start(123)).toBe(false); report("queued");
  expect(mocks.postgameResult).toHaveBeenCalledWith("queued", 123, undefined, 200, undefined, undefined);
  expect(mocks.queueResult).not.toHaveBeenCalled();
});
test("postgame cannot steal an active queue connection and late old ready cannot start it", async () => {
  await prepare(queue); const oldEpoch = commands.at(-1)!.epoch;
  postgame.prepare(); expect(postgame.start(123)).toBe(false);
  queue.cancel(); postgame.prepare(); await Promise.resolve(); report("ready", oldEpoch);
  expect(postgame.start(123)).toBe(false); report("ready"); expect(postgame.start(123)).toBe(true);
});
test("late async authority from a cancelled postgame cannot grant a new owner", async () => {
  let grant!: (ok: boolean) => void; mocks.postgameAuth.mockReturnValue(new Promise<boolean>(resolve => { grant = resolve; }));
  await prepare(postgame); report("authorize-quit");
  postgame.cancel(); await prepare(queue); grant(true); await Promise.resolve();
  expect(window.postMessage).not.toHaveBeenCalled();
});
test("queue owner cannot authorize postgame quit; current postgame routes async gates", async () => {
  await prepare(queue); report("authorize-quit"); await Promise.resolve();
  expect(mocks.postgameAuth).not.toHaveBeenCalled();
  expect(window.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }), location.origin);
  queue.cancel(); await prepare(postgame); report("authorize-start"); await Promise.resolve();
  expect(mocks.postgameAuth).toHaveBeenCalledWith(123, "start");
  expect(window.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true }), location.origin);
});
test("found game enters once and resume results reach only their owner", async () => {
  await prepare(postgame); report("found"); expect(postgame.enterGame()).toBe(true); expect(postgame.enterGame()).toBe(false);
  report("resume-restored"); expect(mocks.postgameResume).toHaveBeenCalledWith("restored", 123);
  expect(mocks.queueResume).not.toHaveBeenCalled();
});
test("conflicting resume is refused without destroying the active owner", async () => {
  await prepare(queue); postgame.resume(123, true);
  expect(mocks.postgameResume).toHaveBeenCalledWith("refused", 123); expect(queue.start(123)).toBe(true);
});

test("BFCache return cannot reuse PAGE readiness disposed at pagehide", async () => {
  await prepare(postgame); const oldEpoch = commands.at(-1)!.epoch;
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  report("ready", oldEpoch); expect(postgame.start(123)).toBe(false);
  await prepare(postgame); expect(postgame.start(123)).toBe(true);
});
