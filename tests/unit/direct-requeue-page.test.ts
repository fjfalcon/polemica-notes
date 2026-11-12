// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
let created: any, events = new Map<string, Set<(value: any) => void>>();
const makeSocket = vi.hoisted(() => vi.fn());
vi.mock("@content/page/search-socket", () => ({ connectSearchSocket: makeSocket }));
import { HANDOFF_TTL_MS, bindPort, gameForm, listenForInit } from "@content/page/direct-requeue-page";
import { SITE_STATE_REQUEST } from "./site-search-request";
/** Приватный порт к контент-скрипту — синхронный двойник (транспорт сам — MessageChannel). */
const pagePort = { postMessage: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
function answer(id: unknown, epochOf: unknown, ok: boolean) { pagePort.onmessage!({ data: { authority: true, id, epoch: epochOf, ok } } as MessageEvent); }
let reports: any[], epoch = 0;
const markup = `<meta name="csrf-param" content="_csrf-test"><meta name="csrf-token" content="fake-csrf"><game-search current-user='{"id":7,"mmr":{"value":1200}}' :verification-statuses='{"isVerified":true}' rating-game-search-service-url="https://game.polemicagame.com/search" :new-game-service='{"httpUrl":"https://game.polemicagame.com"}'></game-search>`;
function command(op: string, signalAt = Date.now(), queued = false) {
  pagePort.onmessage!({ data: { op, signalAt, epoch, queued } } as MessageEvent);
}
function fire(name: string, value?: unknown) { for (const cb of [...(events.get(name) || [])]) cb(value); }
function mount() {
  const handlers = new Map<string, (value: any) => void>();
  const p: any = { isIniSearch: false, isSearching: false, startSearch: vi.fn(() => { p.isIniSearch = true; p.socket = sock; }), disconnectSocket: vi.fn() };
  const sock = { connected: true, on: (name: string, cb: (v: any) => void) => handlers.set(name, cb), removeListener: vi.fn() };
  document.body.innerHTML = '<div id="app"></div>'; Object.assign(document.querySelector("#app")!, { __vue__: p });
  return { p, deliver: (name: string, value: any) => handlers.get(name)?.(value) };
}
beforeEach(() => {
  epoch += 10; vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); reports = []; events = new Map();
  created = { connected: true, emit: vi.fn(), on: (name: string, cb: (v: any) => void) => { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(cb); },
    removeListener: (name: string, cb: (v: any) => void) => events.get(name)?.delete(cb), disconnect: vi.fn() };
  makeSocket.mockReset().mockReturnValue(created);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => markup,
    json: async () => ({ queues: { standard: { available: true }, polite: { available: true }, prime: { available: false } } }) })));
  bindPort(pagePort); pagePort.postMessage.mockReset().mockImplementation((data: any) => {
    reports.push(data);
    if (["authorize-resume", "authorize-quit", "authorize-start"].includes(data?.state)) answer(data.id, data.epoch, true);
  });
});
afterEach(() => { epoch++; command("cancel"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
test("подготовка не выполняет HTML/iframe и не отправляет start_game_search", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2); expect(document.querySelector("iframe")).toBeNull();
  fire("session_initialized", null); expect(created.emit).not.toHaveBeenCalled();
  expect(reports.some(x => x.state === "ready")).toBe(true);
  command("start"); expect(created.emit).toHaveBeenCalledExactlyOnceWith("start_game_search", expect.objectContaining({ userId: 7, censorship: ["standard"] }));
});
test("cancel во время fetch не создаёт поздний socket", async () => {
  let resolve!: (value: any) => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  command("prepare"); epoch++; command("cancel"); resolve({ ok: true, text: async () => markup });
  await vi.advanceTimersByTimeAsync(1); expect(makeSocket).not.toHaveBeenCalled();
});
test("старый epoch не начинает новый запрос", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  epoch++; command("cancel"); epoch--; command("start"); expect(created.emit).not.toHaveBeenCalled(); epoch++;
});
test("существующая очередь во время подготовки явно отклоняется без нового start", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", { timeInSearch: 1000 });
  expect(reports.some(x => x.state === "existing-search")).toBe(true); expect(created.emit).not.toHaveBeenCalled(); expect(created.disconnect).toHaveBeenCalled();
});
test("init без timeInSearch не выдаётся за восстановление", async () => {
  const { deliver } = mount(); command("resume"); await vi.advanceTimersByTimeAsync(1); deliver("session_initialized", null);
  expect(reports.some(x => x.state === "resume-restored")).toBe(false);
  deliver("on_start_game_search", { success: true }); expect(reports.some(x => x.state === "resume-new")).toBe(true);
});
test("восстановление имеет проверенное время и снимает listeners после cancel", async () => {
  const { deliver } = mount(); command("resume"); await vi.advanceTimersByTimeAsync(1);
  deliver("session_initialized", { timeInSearch: 1250 }); expect(reports.some(x => x.state === "resume-restored" && x.timeInSearch === 1250)).toBe(true);
  epoch++; command("cancel"); const count = reports.length; deliver("on_start_game_search", { success: true }); expect(reports.length).toBe(count);
});
test("молчащий socket заканчивает восстановление timeout", async () => {
  mount(); command("resume"); await vi.advanceTimersByTimeAsync(10_001); expect(reports.some(x => x.state === "resume-timeout")).toBe(true);
});
test("нет разрешения — startSearch не вызывается", async () => {
  const { p } = mount(); pagePort.postMessage.mockImplementation((data: any) => {
    if (data?.state === "authorize-resume") answer(data.id, data.epoch, false);
  });
  command("resume"); await vi.advanceTimersByTimeAsync(1000); expect(p.startSearch).not.toHaveBeenCalled();
  expect(reports.some(x => x.state === "resume-new")).toBe(false);
});
test("POST найденной игры повторяет поля штатного клиента", () => {
  const form = gameForm({ gameId: 77, dynamicFilling: "true" }, { csrfParam: "_csrf-test", csrfToken: "fake-csrf" });
  expect(form.action).toBe("https://polemicagame.com/game"); expect(form.method).toBe("post");
  expect(Object.fromEntries([...form.querySelectorAll("input")].map(x => [x.name, x.value]))).toEqual({ "_csrf-test": "fake-csrf", gameMode: "player", notify: "true", roleRequired: "undefined", game_id: "77", dynamicFilling: "true" });
});

 test("cold handoff cannot turn a stale in_game response into navigation back to the old room", async () => {
  const { deliver } = mount(); command("resume"); await vi.advanceTimersByTimeAsync(1);
  deliver("on_start_game_search", { illegalState: "in_game" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(reports.some(x => x.state === "resume-refused")).toBe(true);
  expect(reports.some(x => x.state === "game")).toBe(false);
});
test("retry telemetry records the first and actual last send separately", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  const start = Date.now(); command("start", start);
  fire("on_start_game_search", { illegalState: "in_game" }); await vi.advanceTimersByTimeAsync(150);
  fire("on_start_game_search", { illegalState: "in_game" }); await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(40); fire("on_start_game_search", { success: true });
  expect(reports.filter(x => x.state === "sent").map(x => [x.firstSentAt, x.sentAt, x.attempt]))
    .toEqual([[start, start, 1], [start, start + 150, 2], [start, start + 450, 3]]);
  const ack = reports.find(x => x.state === "queued");
  expect(ack.at - ack.firstSentAt).toBe(490); expect(ack.at - ack.sentAt).toBe(40);
});

test("postgame telemetry separates the exit response from the subsequent search", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  let confirm!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  const clicked = Date.now(); command("quit-start", clicked); await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(80); confirm({ ok: true } as Response); await vi.advanceTimersByTimeAsync(1);
  const exited = reports.find(x => x.state === "quit-confirmed");
  const sent = reports.find(x => x.state === "sent");
  expect(exited.quitSentAt).toBe(clicked);
  expect(exited.quitConfirmedAt - exited.quitSentAt).toBe(81);
  expect(sent.sentAt - sent.quitConfirmedAt).toBe(0);
  expect(sent.firstSentAt).toBe(sent.sentAt);
});

test("acknowledged handoff still returns to a newly assigned game", async () => {
  const replace = vi.fn(); vi.stubGlobal("location", { origin: "https://polemicagame.com", replace });
  const { deliver } = mount(); command("resume", Date.now(), true); await vi.advanceTimersByTimeAsync(1);
  deliver("on_start_game_search", { illegalState: "in_game" }); await vi.advanceTimersByTimeAsync(300);
  expect(reports.some(x => x.state === "game")).toBe(true);
  expect(replace).toHaveBeenCalledExactlyOnceWith("https://polemicagame.com/game");
});

test("availability lookup fixes stale prime selection before preparing the socket, without starting a search", async () => {
  localStorage.setItem("searchCensorshipModes", JSON.stringify(["prime"]));
  try {
    command("prepare"); await vi.advanceTimersByTimeAsync(1);
    // Ровно как сайт с 12.11.2026: кука сессии, пустое тело (образец сверен с методом сайта).
    expect(fetch).toHaveBeenNthCalledWith(2, "https://game.polemicagame.com/api/search/me", expect.objectContaining(SITE_STATE_REQUEST));
    expect(makeSocket.mock.calls[0][1]).toEqual({ query: { userId: 7, intention: "game_search" } });
    fire("session_initialized", null); expect(created.emit).not.toHaveBeenCalled();
    command("start"); expect(created.emit).toHaveBeenCalledWith("start_game_search", expect.objectContaining({ censorship: ["standard"] }));
  } finally { localStorage.removeItem("searchCensorshipModes"); }
});
test("cancel during availability lookup cannot create a late socket", async () => {
  let release!: (value: any) => void;
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, text: async () => markup }) as Response)
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  command("prepare"); await vi.advanceTimersByTimeAsync(1); epoch++; command("cancel");
  release({ ok: true, json: async () => ({ queues: { standard: { available: true }, polite: { available: true }, prime: { available: true } } }) });
  await vi.advanceTimersByTimeAsync(1); expect(makeSocket).not.toHaveBeenCalled();
});
test("unavailable status lookup falls back without sending a stale queue selection", async () => {
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, text: async () => markup }) as Response)
    .mockImplementationOnce(async () => ({ ok: false, status: 401 }) as Response);
  command("prepare"); await vi.advanceTimersByTimeAsync(1);
  expect(makeSocket).not.toHaveBeenCalled();
  // Отказ куки сессии различим в логе, а не тонет в общем «недоступно».
  expect(reports.find(x => x.state === "unavailable")?.reason).toBe("state-http-401");
});

async function preparedPostgame() {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  expect(created.emit).not.toHaveBeenCalled();
}
const starts = () => created.emit.mock.calls.filter((args: any[]) => args[0] === "start_game_search");
test("postgame waits for exactly one successful HTTP quit before the search request", async () => {
  await preparedPostgame(); let release!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const click = Date.now(); command("quit-start", click); await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenLastCalledWith("https://game.polemicagame.com/api/games/quit", expect.objectContaining(SITE_STATE_REQUEST));
  command("quit-start", click); command("start", click);
  expect(fetch).toHaveBeenCalledTimes(3); expect(starts()).toHaveLength(0);
  release({ ok: true } as Response); await vi.advanceTimersByTimeAsync(1);
  expect(starts()).toHaveLength(1);
  expect(reports.findIndex(x => x.state === "quit-confirmed")).toBeLessThan(reports.findIndex(x => x.state === "sent"));
});
test.each([500, 403])("HTTP %s after dispatch is unknown, never another quit or start", async status => {
  await preparedPostgame(); vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, status }) as Response);
  command("quit-start"); await vi.advanceTimersByTimeAsync(1); command("quit-start");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).toHaveBeenCalledTimes(3); expect(starts()).toHaveLength(0);
  expect(reports.filter(x => x.state === "quit-unknown")).toHaveLength(1);
});
test("quit timeout is ambiguous and never repeats a potentially completed exit", async () => {
  await preparedPostgame();
  vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  command("quit-start"); await vi.advanceTimersByTimeAsync(8001);
  expect(fetch).toHaveBeenCalledTimes(3); expect(starts()).toHaveLength(0);
  expect(reports.some(x => x.state === "quit-unknown")).toBe(true);
});
test("cancel before exit authorization prevents the HTTP side effect", async () => {
  await preparedPostgame();
  pagePort.postMessage.mockImplementation((data: any) => { reports.push(data); });
  command("quit-start"); await vi.advanceTimersByTimeAsync(0);
  const auth = reports.find(x => x.state === "authorize-quit");
  epoch++; command("cancel");
  answer(auth.id, auth.epoch, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(2); expect(starts()).toHaveLength(0);
});
test.each(["cancel", "pagehide"])("%s while quit is in flight ignores its late successful reply", async event => {
  await preparedPostgame(); let release!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  command("quit-start"); await vi.advanceTimersByTimeAsync(0);
  if (event === "pagehide") window.dispatchEvent(new Event("pagehide")); else { epoch++; command("cancel"); }
  release({ ok: true } as Response); await vi.advanceTimersByTimeAsync(1000);
  expect(starts()).toHaveLength(0); expect(reports.some(x => x.state === "quit-confirmed")).toBe(false);
});
test("new input or a new game may revoke start after the successful quit", async () => {
  await preparedPostgame();
  pagePort.postMessage.mockImplementation((data: any) => {
    reports.push(data);
    if (data?.state?.startsWith("authorize-")) answer(data.id, data.epoch, data.state === "authorize-quit");
  });
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true }) as Response);
  command("quit-start"); await vi.advanceTimersByTimeAsync(1);
  expect(reports.some(x => x.state === "quit-confirmed")).toBe(true);
  expect(reports.some(x => x.state === "deferred")).toBe(true); expect(starts()).toHaveLength(0);
});
test("game found immediately after postgame start enters only once", async () => {
  await preparedPostgame(); vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true }) as Response);
  command("quit-start"); await vi.advanceTimersByTimeAsync(1);
  fire("on_game_found", { gameId: 91, dynamicFilling: true });
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  // Вход сразу: пауза соревновалась бы с навигацией комнаты и отменой попытки.
  command("enter"); command("enter"); expect(submit).toHaveBeenCalledTimes(1);
  expect(document.querySelector('input[name="game_id"]')?.getAttribute("value")).toBe("91");
});
test("команды и «разрешено» через window не действуют — только приватный порт", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  // Скрипт сайта шлёт прежнюю команду через window — запроса нет.
  window.dispatchEvent(new CustomEvent("pn-direct-requeue-command", { detail: JSON.stringify({ op: "start", signalAt: Date.now(), epoch, queued: false }) }));
  expect(created.emit).not.toHaveBeenCalled();
  // Запрос разрешения уходит в порт; подделка ответа через window его не даёт.
  pagePort.postMessage.mockImplementation((data: any) => {
    reports.push(data);
    if (data?.state === "authorize-quit") window.postMessage({ source: "pn-direct-requeue-resume-authority", id: data.id, epoch: data.epoch, ok: true }, "*");
  });
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true }) as Response);
  command("quit-start"); await vi.advanceTimersByTimeAsync(4001);
  expect(reports.some(x => x.state === "deferred")).toBe(true);
  expect(reports.some(x => x.state === "quit-confirmed"), "выход не ушёл").toBe(false);
});

describe("рукопожатие и подделки порта", () => {
  /** init от «контент-скрипта»: MessageEvent на window с портом. */
  function init(data: Record<string, unknown>, port: unknown, source: Window | null = window) {
    const ev = new MessageEvent("message", { source, data });
    Object.defineProperty(ev, "ports", { value: port ? [port] : [] });
    window.dispatchEvent(ev);
  }
  const fakePort = () => ({ postMessage: vi.fn(), onmessage: null as ((e: any) => void) | null });

  test("порт принимается только с nonce своего тега, только с window и только один раз", () => {
    const stop = listenForInit("own-nonce");
    try {
      const foreign = fakePort(), noSource = fakePort(), own = fakePort(), late = fakePort();
      init({ source: "pn-direct-requeue-init", nonce: "other" }, foreign);
      init({ source: "pn-direct-requeue-init", nonce: "own-nonce" }, noSource, null);
      init({ source: "pn-direct-requeue-init", nonce: "own-nonce" }, null);
      expect(foreign.onmessage).toBeNull();
      expect(noSource.onmessage).toBeNull();
      init({ source: "pn-direct-requeue-init", nonce: "own-nonce" }, own);
      expect(own.onmessage).toBeTypeOf("function");
      init({ source: "pn-direct-requeue-init", nonce: "own-nonce" }, late);
      expect(late.onmessage, "второй init — чужой: слушатель снят").toBeNull();
    } finally {
      stop();
      bindPort(pagePort);
    }
  });

  test("синтетическое событие порта (isTrusted=false) — не команда", async () => {
    command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
    pagePort.onmessage!({ data: { op: "start", signalAt: Date.now(), epoch, queued: false }, isTrusted: false } as unknown as MessageEvent);
    expect(created.emit).not.toHaveBeenCalled();
    command("start");
    expect(created.emit).toHaveBeenCalledTimes(1);
  });

  test("ответ о разрешении с чужим epoch не даёт выйти из игры", async () => {
    await preparedPostgame();
    pagePort.postMessage.mockImplementation((data: any) => {
      reports.push(data);
      if (data?.state === "authorize-quit") answer(data.id, data.epoch + 1, true);
    });
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true }) as Response);
    command("quit-start"); await vi.advanceTimersByTimeAsync(4001);
    expect(reports.some(x => x.state === "quit-confirmed")).toBe(false);
    expect(reports.some(x => x.state === "deferred")).toBe(true);
  });
});
test("поиск уже подключён в другой вкладке (connected:true) — второе соединение не открываем", async () => {
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, text: async () => markup }) as Response)
    .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ connected: true,
      queues: { standard: { available: true }, polite: { available: true }, prime: { available: true } } }) }) as Response);
  command("prepare"); await vi.advanceTimersByTimeAsync(1);
  expect(makeSocket).not.toHaveBeenCalled();
  expect(reports.some(x => x.state === "existing-search")).toBe(true);
});
describe("отмена после отправленного запроса", () => {
  async function sent() {
    command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
    command("start"); expect(created.emit).toHaveBeenCalledWith("start_game_search", expect.anything());
  }
  test("отмена контент-скриптом снимает поиск на сервере (stop_game_search), как сайт", async () => {
    await sent(); fire("on_start_game_search", { success: true });
    epoch++; command("cancel");
    expect(created.emit).toHaveBeenLastCalledWith("stop_game_search");
    expect(created.disconnect).toHaveBeenCalled();
  });
  test("уход со страницы (передача на поиск) поиск НЕ снимает", async () => {
    await sent(); fire("on_start_game_search", { success: true });
    window.dispatchEvent(new Event("pagehide"));
    expect(created.emit).not.toHaveBeenCalledWith("stop_game_search");
    expect(created.disconnect).toHaveBeenCalled();
  });
  test("до отправки запроса отмена ничего лишнего не шлёт", async () => {
    command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
    epoch++; command("cancel");
    expect(created.emit).not.toHaveBeenCalled();
  });
});

test("после передачи (handoff) отмена только закрывает — подтверждённую очередь не снимает", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  command("start"); fire("on_start_game_search", { success: true });
  command("handoff"); epoch++; command("cancel");
  expect(created.emit).not.toHaveBeenCalledWith("stop_game_search");
  expect(created.disconnect).toHaveBeenCalled();
});

test("переданная попытка без навигации закрывается через HANDOFF_TTL_MS, без stop", async () => {
  command("prepare"); await vi.advanceTimersByTimeAsync(1); fire("session_initialized", null);
  command("start"); fire("on_start_game_search", { success: true });
  command("handoff");
  await vi.advanceTimersByTimeAsync(HANDOFF_TTL_MS - 1); expect(created.disconnect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(created.disconnect).toHaveBeenCalled();
  expect(created.emit).not.toHaveBeenCalledWith("stop_game_search");
});
