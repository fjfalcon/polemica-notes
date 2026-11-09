import { browser } from "@core/env";
import { setDirectRequeuePort, noteDirectRequeueResult, canResumeDirectSearch, directResumeFinished } from "./features/queue-requeue";
import { setDirectPostgamePort, notePostgameDirectResult, canPostgameDirectAct, postgameDirectResumeFinished } from "./features/postgame-search";
import { log } from "@core/log";

type Owner = "queue" | "postgame";

/** One PAGE connection and monotonically increasing epoch for both features.
 * A feature may cancel only its own work; queue cleanup must not kill postgame.
 *
 * Канал с миром страницы — MessageChannel (ревью 09.11.2026): через window
 * любой скрипт сайта, включая сторонние SDK, мог прислать команду «выйти и
 * встать в поиск» и сам ответить «разрешено» вместо этого контент-скрипта.
 * Порт уходит странице один раз при установке скрипта с одноразовым nonce
 * из его тега; дальше команды и ответы о разрешении идут только через порт,
 * синтетические события порта (dispatchEvent, isTrusted=false) отбрасываются.
 *
 * ЧЕСТНАЯ ГРАНИЦА: это защита от подделок через window и от случайных
 * совпадений, а не от скрипта страницы, который целенаправленно атакует
 * расширение (он видит рукопожатие и может патчить API мира страницы). Такой
 * скрипт и без нас имеет ключ сессии в DOM — новых возможностей канал ему не
 * даёт.
 */
export function setupDirectRequeue(): void {
  let owner: Owner | null = null;
  let ready = false, requested = false, found = false, epoch = 0;
  let installed: Promise<boolean> | null = null;
  let loadFailures = 0, lastLoadFailureAt = 0;
  let pagePort: MessagePort | null = null;
  const command = (op: string, signalAt = 0, queued = false) => pagePort?.postMessage({ op, signalAt, epoch, queued });
  const ensure = (): Promise<boolean> => {
    if (installed) return installed;
    installed = new Promise(resolve => {
      const script = document.createElement("script");
      script.src = browser.runtime.getURL("direct-requeue-page.js");
      const nonce = crypto.randomUUID();
      script.dataset.pnNonce = nonce;
      const channel = new MessageChannel();
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true; clearTimeout(timer); script.remove();
        if (!ok) installed = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 3000);
      script.onload = () => {
        pagePort?.close();
        pagePort = channel.port1;
        pagePort.onmessage = (event: MessageEvent) => {
          if (event.isTrusted === false) return;
          onReport(event.data);
        };
        window.postMessage({ source: "pn-direct-requeue-init", nonce }, location.origin, [channel.port2]);
        finish(true);
      };
      script.onerror = () => finish(false);
      (document.head || document.documentElement).appendChild(script);
    });
    return installed;
  };
  const finishResume = (scope: Owner, state: string, signalAt: number) => {
    if (scope === "queue") directResumeFinished(state, signalAt);
    else postgameDirectResumeFinished(state, signalAt);
  };
  const port = (scope: Owner) => ({
    prepare() {
      if (requested || loadFailures >= 3 || (loadFailures > 0 && Date.now() - lastLoadFailureAt < 1000)) return;
      owner = scope; requested = true; ready = found = false;
      const token = ++epoch;
      void ensure().then(ok => {
        if (token !== epoch || owner !== scope || !requested) return;
        if (ok) command("prepare");
        else { requested = false; loadFailures++; lastLoadFailureAt = Date.now(); }
      });
    },
    cancel() {
      if (owner !== scope) return;
      requested = ready = found = false; owner = null; ++epoch; command("cancel");
    },
    start(signalAt: number) {
      if (owner !== scope || !ready || !requested) return false;
      ready = false; command(scope === "postgame" ? "quit-start" : "start", signalAt); return true;
    },
    enterGame() {
      if (owner !== scope || !found || !requested) return false;
      found = false; command("enter"); return true;
    },
    resume(signalAt: number, queued: boolean) {
      if (owner !== null && owner !== scope && requested) { finishResume(scope, "refused", signalAt); return; }
      owner = scope; requested = true; ready = found = false;
      const token = ++epoch;
      void ensure().then(ok => {
        if (token !== epoch || owner !== scope) return;
        if (!ok) { finishResume(scope, "refused", signalAt); return; }
        command("resume", signalAt, queued);
      });
    },
  });
  setDirectRequeuePort(port("queue"));
  setDirectPostgamePort(port("postgame"));
  // PAGE disposes its socket on pagehide. A BFCache return keeps this content
  // world alive, so it must not advertise that disposed connection as ready.
  window.addEventListener("pagehide", () => {
    requested = ready = found = false; owner = null; ++epoch; command("cancel");
  });
  const authority = (id: unknown, ok: boolean) => pagePort?.postMessage({ authority: true, id, epoch, ok });
  function onReport(data: any): void {
    if (data?.source !== "pn-direct-requeue" || data.epoch !== epoch || owner === null) return;
    const scope = owner;
    const logger = scope === "queue" ? "queue-requeue" : "postgame-search";
    if (["authorize-resume", "authorize-quit", "authorize-start"].includes(data.state)) {
      const token = epoch;
      const action = data.state.slice(10) as "quit" | "start" | "resume";
      const allowed = scope === "queue"
        ? action === "resume" && canResumeDirectSearch(data.signalAt)
        : canPostgameDirectAct(data.signalAt, action);
      void Promise.resolve(allowed).then(ok => {
        if (token !== epoch || owner !== scope) return;
        authority(data.id, ok === true);
      }).catch(() => {
        if (token === epoch && owner === scope) authority(data.id, false);
      });
      return;
    }
    if (typeof data.state === "string" && data.state.startsWith("resume-")) {
      const state = data.state.slice(7);
      if (state === "restored") log.info(logger, "восстановлена прежняя поисковая сессия, timeInSearch:", data.timeInSearch);
      else if (state === "new") log.warn(logger, "после перехода создан новый поиск; прежнее место не подтверждено");
      else if (state === "already-searching") log.info(logger, "поиск уже активен; прежнее место не подтверждено");
      else if (state === "timeout" || state === "refused") log.warn(logger, "не удалось восстановить поисковую сессию:", state);
      finishResume(scope, state, data.signalAt);
      return;
    }
    if (data.state === "game") { finishResume(scope, "game", data.signalAt); return; }
    if (data.state === "ready") {
      if (requested) { ready = true; log.info(logger, "соединение поиска подготовлено; запрос ещё не отправлен"); }
      return;
    }
    if (["unavailable", "existing-search", "refused", "quit-unknown", "deferred"].includes(data.state)) ready = false;
    if (data.state === "found") found = true;
    if (scope === "postgame") {
      if (data.state === "quit-confirmed") log.info(logger, "выход подтверждён, от нажатия до запроса / ответ сервера, мс:",
        data.quitSentAt - data.signalAt, data.quitConfirmedAt - data.quitSentAt);
      if (data.state === "sent") log.info(logger, "от подтверждения выхода до запроса поиска, мс:", data.sentAt - data.quitConfirmedAt);
      if (["sent", "queued", "refused", "unavailable", "found", "quit-confirmed", "quit-unknown", "deferred"].includes(data.state))
        notePostgameDirectResult(data.state, data.signalAt, data.sentAt, data.at, data.firstSentAt, data.attempt);
    } else if (["sent", "queued", "refused", "unavailable", "found"].includes(data.state))
      noteDirectRequeueResult(data.state, data.signalAt, data.sentAt, data.at, data.firstSentAt, data.attempt);
  }
}
