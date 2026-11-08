import io from "socket.io-client";
import { DirectSearch, type FoundGame, type SearchOutcome } from "./direct-search";
import { parseSearchBootstrap, applySearchAvailability, type SearchBootstrap } from "./search-bootstrap";
import { ResumeSearch, type ResumeClient, type ResumeResult } from "./resume-search";

interface Proxy extends ResumeClient { $children?: Proxy[]; returnToGame?: () => void }
function client(doc: Document): Proxy | null {
  const root = doc.querySelector("#app") as (Element & { __vue__?: Proxy }) | null;
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
function report(value: Run, state: string, extra: Record<string, unknown> = {}): void {
  if (current(value)) window.postMessage({ source: RESULT, state, epoch: value.epoch,
    signalAt: value.signalAt, quitSentAt: value.quitSentAt, quitConfirmedAt: value.quitConfirmedAt,
    ...value.search?.requestTiming(), at: Date.now(), ...extra }, location.origin);
}
function cancel(): void {
  const old = run;
  run = null;
  if (!old) return;
  old.fetch?.abort(); old.search?.dispose(); old.resume?.cancel();
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
      window.removeEventListener("message", receive); resolve(ok && current(value));
    };
    const abort = () => finish(false);
    const receive = (event: MessageEvent) => {
      if (event.source === window && event.data?.source === "pn-direct-requeue-resume-authority" &&
        event.data.id === id && event.data.epoch === value.epoch) finish(event.data.ok === true);
    };
    const timer = setTimeout(abort, action === "resume" ? 750 : 4000);
    value.timers.add(timer); value.authorizations.add(abort);
    window.addEventListener("message", receive);
    window.postMessage({ source: RESULT, state: "authorize-" + action, id, epoch: value.epoch, signalAt: value.signalAt }, location.origin);
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
    const config = applySearchAvailability(bootstrap, state);
    if (!config) { report(value, "unavailable"); return; }
    value.config = config;
    const search = new DirectSearch(config, settings => io(settings.endpoint, {
      transports: ["websocket"], forceNew: true, reconnection: false,
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
  if (command.op === "cancel") { lastEpoch = command.epoch; cancel(); return; }
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
    const form = gameForm(found, value.config); document.body.appendChild(form); form.submit();
  }
}
const marker = "data-pn-direct-requeue-installed";
if (!document.documentElement.hasAttribute(marker)) {
document.documentElement.setAttribute(marker, "1");
window.addEventListener("pn-direct-requeue-command", event => {
  try { handleCommand(JSON.parse((event as CustomEvent<string>).detail)); } catch { /* unsupported command */ }
});
window.addEventListener("pagehide", cancel);
}
