import { SITE } from "@core/selectors";
import { connectSearchSocket } from "./search-socket";
import { DirectSearch, type FoundGame, type SearchOutcome } from "./direct-search";
import { parseSearchBootstrap, applySearchAvailability, type SearchBootstrap } from "./search-bootstrap";
import { ResumeSearch, type ResumeClient, type ResumeResult } from "./resume-search";

interface Proxy extends ResumeClient { $children?: Proxy[]; returnToGame?: () => void }
function client(doc: Document): Proxy | null {
  const root = doc.querySelector(SITE.vueRoot) as (Element & { __vue__?: Proxy }) | null;
  const queue = root?.__vue__ ? [root.__vue__] : [];
  const seen = new Set<Proxy>();
  for (let i = 0; i < queue.length && i < 3000; i++) {
    const item = queue[i];
    if (seen.has(item)) continue;
    seen.add(item);
    if (typeof item.startSearch === "function" && typeof item.disconnectSocket === "function") return item;
    if (Array.isArray(item.$children)) queue.push(...item.$children);
  }
  return null;
}
interface Command { op: string; signalAt: number; epoch: number; queued?: boolean }
interface Run {
  epoch: number;
  signalAt: number;
  exitStarted?: boolean;
  quitSentAt?: number;
  quitConfirmedAt?: number;
  entered?: boolean;
  search?: DirectSearch;
  config?: SearchBootstrap;
  fetch?: AbortController;
  resume?: ResumeSearch;
  timers: Set<ReturnType<typeof setTimeout>>;
  authorizations: Set<() => void>;
}
const RESULT = "pn-direct-requeue";
let run: Run | null = null;
let lastEpoch = 0;
const current = (value: Run) => run === value;
function later(value: Run, callback: () => void, delay: number): void {
  const timer = setTimeout(() => { value.timers.delete(timer); if (current(value)) callback(); }, delay);
  value.timers.add(timer);
}
/**
 * Порт к контент-скрипту (см. direct-requeue-transport, там же честная
 * граница защиты): только через него приходят команды и ответы о
 * разрешении. window для них больше не слушаем — там их подделал бы любой
 * скрипт сайта.
 */
interface PortLike { postMessage(data: unknown): void; onmessage: ((event: MessageEvent) => void) | null }
let port: PortLike | null = null;
/** Ждущие ответа о разрешении: id → ответ. */
const pendingAuthority = new Map<string, (data: { epoch?: unknown; ok?: unknown }) => void>();
function post(data: Record<string, unknown>): void {
  try { port?.postMessage(data); } catch { /* контент-скрипт ушёл */ }
}
function report(value: Run, state: string, extra: Record<string, unknown> = {}): void {
  if (current(value)) post({ source: RESULT, state, epoch: value.epoch,
    signalAt: value.signalAt, quitSentAt: value.quitSentAt, quitConfirmedAt: value.quitConfirmedAt,
    ...value.search?.requestTiming(), at: Date.now(), ...extra });
}
/** stopSearch — отмена решением контент-скрипта (см. DirectSearch.stop); уход со страницы — без. */
function cancel(stopSearch = false): void {
  const old = run;
  run = null;
  if (!old) return;
  old.fetch?.abort();
  if (stopSearch) old.search?.stop(); else old.search?.dispose();
  old.resume?.cancel();
  for (const timer of old.timers) clearTimeout(timer);
  for (const abort of [...old.authorizations]) abort();
  old.timers.clear(); old.authorizations.clear();
}
function authorize(value: Run, action: "quit" | "start" | "resume" = "resume"): Promise<boolean> {
  if (!current(value)) return Promise.resolve(false);
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const finish = (ok: boolean) => {
      clearTimeout(timer); value.timers.delete(timer); value.authorizations.delete(abort);
      pendingAuthority.delete(id); resolve(ok && current(value));
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, action === "resume" ? 750 : 4000);
    value.timers.add(timer); value.authorizations.add(abort);
    pendingAuthority.set(id, data => { if (data.epoch === value.epoch) finish(data.ok === true); });
    post({ source: RESULT, state: "authorize-" + action, id, epoch: value.epoch, signalAt: value.signalAt });
  });
}
async function prepare(value: Run): Promise<void> {
  const controller = new AbortController(); value.fetch = controller;
  later(value, () => controller.abort(), 8000);
  try {
    const response = await fetch("/game-search", { credentials: "same-origin", signal: controller.signal });
    if (!response.ok || !current(value)) throw new Error("unavailable");
    const html = await response.text();
    if (!current(value) || html.length > 5_000_000) return;
    let modes: string | null = null;
    try { modes = localStorage.getItem("searchCensorshipModes"); } catch { /* site's default */ }
    const bootstrap = parseSearchBootstrap(html, modes);
    if (!bootstrap) { report(value, "unavailable"); return; }
    // Read availability exactly as the normal page does, without executing its
    // lifecycle (which may start a search). Complete this before declaring ready.
    const status = await fetch(bootstrap.stateEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ userId: bootstrap.request.userId, authKey: bootstrap.request.authKey }),
      signal: controller.signal,
    });
    if (!status.ok || !current(value)) throw new Error("unavailable");
    const state: unknown = await status.json();
    if (!current(value)) return;
    // Как страница поиска сайта (checkIfUserInSearch): сокет поиска уже
    // подключён — значит, ищет другая вкладка; второе соединение на тот же
    // аккаунт не открываем (поведение сервера на нём не доказано).
    if (state && typeof state === "object" && (state as { connected?: unknown }).connected === true) {
      report(value, "existing-search");
      return;
    }
    const config = applySearchAvailability(bootstrap, state);
    if (!config) { report(value, "unavailable"); return; }
    value.config = config;
    const search = new DirectSearch(config, settings => connectSearchSocket(settings.endpoint, {
      query: { userId: settings.request.userId, authKey: settings.request.authKey, intention: "game_search" },
    }), (state: SearchOutcome) => report(value, state));
    value.search = search;
    search.prepare();
  } catch { if (current(value)) report(value, "unavailable"); }
}
/** A failed exit response is ambiguous: the server may have completed the quit.
 * The content owner records that boundary before granting permission. Only an
 * HTTP success permits a subsequent search; this operation never retries quit.
 */
async function quitAndStart(value: Run): Promise<void> {
  if (value.exitStarted) return;
  value.exitStarted = true;
  if (!value.search?.ready() || !value.config) { report(value, "unavailable"); return; }
  if (!await authorize(value, "quit")) { report(value, "deferred"); return; }
  if (!current(value)) return;
  const controller = new AbortController(); value.fetch = controller;
  const timer = setTimeout(() => controller.abort(), 8000); value.timers.add(timer);
  try {
    value.quitSentAt = Date.now();
    const response = await fetch(value.config.stateEndpoint.replace(/\/api\/search\/me$/, "/api/games/quit"), {
      method: "POST", headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ userId: value.config.request.userId, authKey: value.config.request.authKey }),
      signal: controller.signal,
    });
    if (!current(value)) return;
    if (!response.ok) { report(value, "quit-unknown"); return; }
    value.quitConfirmedAt = Date.now();
    report(value, "quit-confirmed");
  } catch { report(value, "quit-unknown"); return; }
  finally { clearTimeout(timer); value.timers.delete(timer); }
  if (!await authorize(value, "start")) { report(value, "deferred"); return; }
  if (!current(value)) return;
  if (!value.search.start()) report(value, "refused");
}

/** Exact fields from the site's game-found handler; no auth key in the DOM. */
export function gameForm(game: FoundGame, config: Pick<SearchBootstrap, "csrfParam" | "csrfToken">): HTMLFormElement {
  const form = document.createElement("form");
  form.method = "post"; form.action = `${location.origin}/game`;
  const fields = { [config.csrfParam]: config.csrfToken, gameMode: "player", notify: "true",
    roleRequired: "undefined", game_id: String(game.gameId), dynamicFilling: String(game.dynamicFilling) };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
  }
  return form;
}
function resumeResult(value: Run, proxy: Proxy, outcome: ResumeResult): void {
  if (!current(value)) return;
  if (outcome.state === "game") {
    later(value, () => {
      void authorize(value).then(ok => {
        if (!current(value)) return;
        if (!ok) { report(value, "resume-deferred"); return; }
        report(value, "game");
        // The server just confirmed assignment. The site's returnToGame()
        // depends on a client flag that disconnect may already have cleared.
        location.replace(`${location.origin}/game`);
      });
    }, 250);
    return;
  }
  report(value, `resume-${outcome.state}`, outcome.state === "restored" ? { timeInSearch: outcome.timeInSearch } : {});
}
function resume(value: Run, queued: boolean): void {
  const deadline = Date.now() + 10_000;
  const probe = async () => {
    if (!current(value)) return;
    if (!await authorize(value)) { report(value, "resume-deferred"); return; }
    if (!current(value)) return;
    const proxy = client(document);
    if (proxy) {
      value.resume = new ResumeSearch(proxy, { confirmedQueue: queued, authorize: () => authorize(value),
        result: outcome => resumeResult(value, proxy, outcome), timeoutMs: Math.max(1, deadline - Date.now()) });
      value.resume.start();
    } else if (Date.now() < deadline) later(value, () => { void probe(); }, 100);
    else report(value, "resume-timeout");
  };
  void probe();
}
function handleCommand(command: Command): void {
  if (!command || !Number.isSafeInteger(command.epoch) || command.epoch < lastEpoch) return;
  if (command.op === "cancel") { lastEpoch = command.epoch; cancel(true); return; }
  if (command.op === "prepare" || command.op === "resume") {
    if (run?.epoch === command.epoch) return;
    cancel(); lastEpoch = command.epoch;
    const value: Run = { epoch: command.epoch, signalAt: command.signalAt || 0, timers: new Set(), authorizations: new Set() };
    run = value;
    if (command.op === "prepare") void prepare(value); else resume(value, command.queued === true);
    return;
  }
  const value = run;
  if (!value || command.epoch !== value.epoch) return;
  if (command.op === "quit-start") {
    if (!Number.isFinite(command.signalAt) || command.signalAt <= 0 || command.signalAt > Date.now() || value.exitStarted) return;
    value.signalAt = command.signalAt;
    void quitAndStart(value);
  } else if (command.op === "start") {
    if (value.exitStarted) return;
    value.signalAt = command.signalAt;
    if (!Number.isFinite(command.signalAt) || command.signalAt <= 0 || command.signalAt > Date.now() || !value.search?.start()) report(value, "unavailable");
  } else if (command.op === "enter") {
    const found = value.search?.foundGame();
    if (!found || !value.config || value.entered) return;
    value.entered = true;
    // Сразу, БЕЗ случайной паузы сайта (on_game_found ждёт 0–10 с): здесь
    // вход соревнуется с собственной навигацией комнаты (уход через 2 с по
    // gameOver) и с отменой попытки по фону/вводу — пауза теряла бы найденную
    // игру молча, а стол ждал бы игрока (ревью 09.11.2026). Разнос входов
    // нужен сайту на его странице поиска; один ранний вход ему не мешает.
    const form = gameForm(found, value.config); document.body.appendChild(form); form.submit();
  }
}
/** Привязать приватный порт: команды и ответы о разрешении. Экспорт — тестовый шов. */
export function bindPort(next: PortLike): void {
  port = next;
  next.onmessage = (event: MessageEvent) => {
    // port.dispatchEvent(new MessageEvent(…)) со страницы — не наш отправитель.
    if (event.isTrusted === false) return;
    const data = event.data;
    if (data?.authority === true) { pendingAuthority.get(data.id)?.(data); return; }
    try { handleCommand(data); } catch { /* unsupported command */ }
  };
}
/**
 * Ждать init с портом от контент-скрипта: только с nonce своего тега и
 * только один раз. Экспорт — тестовый шов (в тестах нет currentScript).
 */
export function listenForInit(expected: string): () => void {
  const onInit = (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== "pn-direct-requeue-init" || event.data.nonce !== expected) return;
    const received = event.ports?.[0];
    if (!received) return;
    event.stopImmediatePropagation();
    window.removeEventListener("message", onInit);
    bindPort(received);
  };
  window.addEventListener("message", onInit);
  return () => window.removeEventListener("message", onInit);
}
const marker = "data-pn-direct-requeue-installed";
// Одноразовый nonce из СВОЕГО тега: init с портом принимаем только с ним —
// иначе скрипт сайта мог бы первым подсунуть свой порт. Атрибут снимаем
// сразу: дольше в DOM ему лежать незачем.
const ownScript = document.currentScript as HTMLScriptElement | null;
const nonce = ownScript?.dataset.pnNonce ?? "";
if (ownScript) delete ownScript.dataset.pnNonce;
// Каждый экземпляр (после перезагрузки расширения скрипт ставится заново)
// гасит СВОЮ попытку на уходе со страницы; метка — для smoke-проверки бандла.
document.documentElement.setAttribute(marker, "1");
window.addEventListener("pagehide", () => cancel());
if (nonce) listenForInit(nonce);
