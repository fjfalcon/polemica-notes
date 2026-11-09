/**
 * Фича: автовозврат в поиск после развала собранного лобби.
 *
 * Боль (владелец, 30.07.2026): «встаём в поиск → лобби собралось, но не все
 * успели нажать готовность → лобби разваливается → заново нужно встать в
 * поиск». Большинство не успевает пройти путь «На главную → Поиск → Играть»
 * — и выпадает из ротации.
 *
 * Развал случается на ДВУХ этапах (флоу сверен с бандлами сайта и живой
 * распущенной комнатой 31.07.2026):
 *
 * ЭТАП 1 — страница поиска (/game-search): «Принять игру» → «Готовы: N/10»;
 *   кто-то не принял → группа падает, игрок остаётся на странице поиска с
 *   кнопкой «Играть». Детект принятия: блок `.p-play__profile-accept` теряет
 *   `cursor-pointer` (бандл game-search, ветка searchState.group).
 *   Машина: блок исчез → секундомер? (сайт сам вернул, выходим) →
 *   «Игра запускается»? (стартуем, ждём редиректа) → кнопка «Играть» в
 *   течение ARM_WINDOW_MS → развал: кликаем.
 *
 * ЭТАП 2 — комната (/game, POST-переход после on_game_found): игроки жмут
 *   кнопку «Готов» (vote {type: game_start}); не все успели → сервер шлёт
 *   on_game_disbandment, и комната показывает ОБРАТНЫЙ ОТСЧЁТ «Игра будет
 *   распущена через MM:SS» (`.disbandment-timer`, бандл комнаты). Когда он
 *   истекает, комната мертва, но экран сам по себе не меняется: игрок сидит
 *   и ждёт (жалоба 01.08.2026), а кнопка сайта «На главную» ведёт на origin
 *   (`finishGameLink: location.origin`) — оттуда до поиска ещё два клика.
 *   Поэтому: отсчёт + наша готовность (`.player.my-player .player__readiness`)
 *   → ставим одноразовый мост в sessionStorage → как отсчёт исчезнет и за
 *   DISBAND_GRACE_MS не появится игровая стадия (значит не «все успели»),
 *   сами уходим на /game-search. Если игрок ушёл раньше нас — мост
 *   отработает на любой другой странице (elsewhereTick) и доведёт до поиска.
 *   На странице поиска мост взводит ту же машину клика «Играть» со всеми
 *   предохранителями.
 *
 * ГЛАВНЫЙ ПРЕДОХРАНИТЕЛЬ (оба этапа): АВТОКЛИК «Играть» — только тому, кто
 * сам подтвердил игру (принял / нажал «Готов»). Кто не подтвердил — сам
 * решил не играть или отошёл; нажав за него, мы зациклим порчу лобби для
 * остальных. При этом СО СТРАНИЦЫ-МОГИЛЫ распущенной комнаты уводим на
 * /game-search ВСЕХ (28.09.2026): путь руками — «На главную» → главная →
 * «Поиск», целая куча страниц; неготовый приземляется на поиск БЕЗ метки
 * и кнопку жмёт сам — навигация не порочит лобби, порочит автоклик.
 *
 * Окна ограничены: клик «Играть» спустя произвольное время по забытому
 * состоянию — ровно тот сюрприз, которого быть не должно.
 *
 * ПРИНЦИП ЖИВУЧЕСТИ (аудит автовозврата 03.08.2026, RQ-3): тики приходят от
 * мутаций DOM, а DOM распущенной комнаты и застывшей страницы поиска НЕ
 * мутирует. Поэтому каждая ветка «подождём и решим позже» обязана владеть
 * собственной точкой пробуждения — общим decision-таймером ниже. Ветка,
 * которая возвращает управление без таймера и без внешнего события
 * (visibilitychange, навигация), — это молчаливая смерть машины.
 *
 * СКОРОСТЬ (9.78.0, жалоба владельца 29.10.2026). Часть игроков ищет лобби
 * компанией: не видят своих — не жмут «Готов», лобби распускается, а они
 * из ЗАРАНЕЕ открытой второй вкладки поиска встают в очередь руками в
 * момент роспуска и попадают в следующее лобби вместе. Честный игрок с
 * автовозвратом проигрывал им секунды: ждали экран сайта (через 2 с после
 * `on_stop_game`) или 12-секундную грейс-паузу, потом грузили страницу
 * поиска с нуля и только тогда жали «Играть». Теперь:
 *  1. смерть комнаты узнаём по сигналу сервера `on_stop_game` от зонда
 *     комнаты (только имя события, room-probe-page) — без экрана и паузы;
 *  2. пока идёт отсчёт роспуска, Chrome ПРЕДЗАГРУЖАЕТ страницу поиска
 *     (speculation rules) — переход после роспуска мгновенный, как у той
 *     самой второй вкладки; Firefox этого не умеет и просто грузит страницу;
 *  3. на странице поиска кнопку «Играть» ждём частым опросом, а не 250-мс
 *     дросселем наблюдателя; «застрявшее» состояние сайта (решающий блок
 *     «Продолжить/Покинуть игру», вечная крутилка после клика) лечим одной
 *     перезагрузкой на эпизод вместо 8-секундного ожидания и отказа.
 * Предохранители не тронуты: автоклик — только подтвердившему готовность,
 * не в фоне, не поперёк живого ввода, бюджеты и окна прежние.
 */
import { onDomChange, safeClick, isVisible } from "@core/dom";
import { SITE, TEXT, SITE_CLASS } from "@core/selectors";
import { isGameRoomPath, isSearchPath } from "@shared/routes";
import { log } from "@core/log";
import { showToast } from "@core/toast";
import { parseMark, refreshMark, validateMark, serializeMark } from "./requeue-pending";
import type { MarkFailure, PendingMark } from "./requeue-pending";
import type { Feature, FeatureContext } from "@core/feature";
import type { Settings } from "@shared/types";

const SCOPE = "queue-requeue";

/** Мост-объяснение: неготового увели с роспуска — сказать на поиске почему. */
const NOT_READY_EXIT_KEY = "pn_requeue_not_ready_exit";

/** Сколько ждём появления «Играть» после исчезновения блока принятия. */
const ARM_WINDOW_MS = 8000;
/** Кнопку могло перерисовать под кликом — повторяем, но не бесконечно. */
const MAX_CLICK_ATTEMPTS = 3;
/** Тики идут каждые ~250мс — без паузы 3 попытки улетели бы за секунду. */
const MIN_CLICK_INTERVAL_MS = 1200;
/** «Игра запускается» — стартующее лобби, а не развал (ветка processing). */
const GAME_STARTING_SELECTOR = SITE.gameStartingLoader;
/**
 * Сайтовые модалки страницы поиска. Если после нашего клика сервер ответил
 * illegalState=game_search (рассинхрон: сервер ещё держит игрока в поиске),
 * сайт показывает модалку «Игра уже ищется» — дальше решает ИГРОК, повторные
 * клики под модалкой запрещены. Классы сверены с бандлом game-search:
 * компонент — `<modal class="modal modal-break-search" name="break-search">`
 * (vue-js-modal); generic `.modal` оставлен как страховка на другие модалки —
 * скрытые узлы отсеивает проверка видимости в siteModalOpen().
 */
const SITE_MODAL_SELECTOR = SITE.siteModals;

// ── этап 2: комната ──

/**
 * Сколько ждать после исчезновения отсчёта, прежде чем считать комнату
 * распущенной. Отсчёт исчезает в ДВУХ случаях: время вышло (роспуск) и
 * `gameDidStart` (все успели). Второй случай отсекается ДВАЖДЫ: по последнему
 * показанному значению (ниже) и по появлению игровой стадии за эту паузу.
 * 12с, а не 5: цена ошибки — выдернуть игрока из начавшегося матча, а первая
 * стадия может прийти отдельным сообщением уже после старта.
 */
const DISBAND_GRACE_MS = 12_000;
/**
 * Отсчёт, исчезнувший на значении больше этого, — признак СТАРТА игры, а не
 * роспуска: при роспуске он доходит до ~00:00. Три секунды запаса на то, что
 * между последним увиденным тиком и исчезновением прошло время.
 */
const DISBAND_ZERO_TOLERANCE_S = 3;
/** Одноразовый мост «комната умерла → страница поиска»: sessionStorage. */
const PENDING_KEY = "pn_requeue_pending";
/**
 * Период планового освежения метки на странице поиска. Нужен отдельный:
 * секундомер принятия сайт (Vue 2) обновляет через textContent текстового
 * узла — это characterData-мутация, которую наш общий наблюдатель НЕ слушает
 * (childList + class/style). Без своего пробуждения принятый блок не давал
 * бы ни одного тика, и метка протухала бы при живом условии (RQ-4).
 */
const PENDING_REFRESH_MS = 10_000;
/** Человекочитаемые причины отказа метки — в лог поддержки. */
const MARK_FAILURE_TEXT: Record<MarkFailure, string> = {
  corrupt: "метка повреждена",
  future: "метка из будущего",
  expired: "метка устарела",
  capped: "эпизод старше потолка",
};

export interface DirectRequeuePort {
  prepare(): void;
  cancel(): void;
  start(signalAt: number): boolean;
  resume?(signalAt: number, queued: boolean): void;
  enterGame?(): boolean;
  handoff?(): void;
}
let directPort: DirectRequeuePort | null = null;
export function setDirectRequeuePort(port: DirectRequeuePort | null): void { directPort = port; }
let directPending = false, directQueued = false, directGameFound = false, directHandoffAt = 0;
/**
 * Сторож молчания страницы: запрос ушёл в мир страницы, а ответа нет (порт
 * не доехал, скрипт страницы умер). Без него комната ждала бы вечно
 * (ревью 09.11.2026) — через DIRECT_SILENCE_MS считаем путь неподтверждённым
 * и передаём штатному восстановлению. У самой страницы ACK ждёт 8 с.
 */
const DIRECT_SILENCE_MS = 10_000;
let directStartedAt = 0;
let directResuming = false, directResumeRequested = false, directResumeAt = 0;
let directResumeQueued = false;
const DIRECT_HANDOFF_KEY = "pn_direct_requeue_handoff";
const DIRECT_HANDOFF_TTL = 45_000;
function writeDirectHandoff(signalAt: number, queued: boolean): void {
  try { sessionStorage.setItem(DIRECT_HANDOFF_KEY, JSON.stringify({ signalAt, queued })); }
  catch { /* ordinary site recovery remains available */ }
}

export function canResumeDirectSearch(signalAt = directResumeAt): boolean {
  return directResuming && signalAt === directResumeAt && !!settings &&
    settings.requeue_after_lobby_fail_enabled !== false && isSearchPage() && !document.hidden &&
    Date.now() - lastTrustedInputAt >= USER_BACKOFF_MS;
}
export function directResumeFinished(state: string, signalAt = directResumeAt): void {
  if (!directResuming || signalAt !== directResumeAt) return;
  directResumeRequested = false;
  if (state === "deferred") { scheduleDecision(FOREGROUND_GRACE_MS); return; }
  directResuming = false;
  try { sessionStorage.removeItem(DIRECT_HANDOFF_KEY); } catch { /* unavailable storage */ }
  if (state === "refused" || state === "timeout") showToast("Поиск не восстановился. Нажмите «Играть», чтобы попробовать снова", { key: "direct-requeue-failed" });
}
function tryDirectResume(): void {
  if (!directResuming) return;
  const now = Date.now();
  if (now - directResumeAt >= DIRECT_HANDOFF_TTL || now < directResumeAt) {
    directPort?.cancel(); directResumeFinished("timeout"); return;
  }
  if (!canResumeDirectSearch()) {
    if (!document.hidden) scheduleDecision(Math.max(FOREGROUND_GRACE_MS, lastTrustedInputAt + USER_BACKOFF_MS - now + 100));
    return;
  }
  if (!directResumeRequested && directPort?.resume) {
    directResumeRequested = true; directPort.resume(directResumeAt, directResumeQueued);
  }
}
export function noteDirectRequeueResult(state: string, signalAt: number, sentAt: number, at: number, firstSentAt = sentAt, attempt = 1): void {
  if (!directPending || signalAt !== stopGameSignalAt || !settings || settings.requeue_after_lobby_fail_enabled === false || gameStarted) return;
  if (matchIsRunning()) { directPending = false; noteMatchStarted("новая стадия видна — поздний результат прямого поиска игнорируется"); return; }
  if (state === "sent") log.info(SCOPE, "прямой запрос поиска отправлен через", sentAt - signalAt, "мс после роспуска, попытка", attempt);
  if (state === "queued") {
    writeDirectHandoff(signalAt, true);
    directQueued = true; directHandoffAt = Date.now() + MIN_DECISION_DELAY_MS;
    log.info(SCOPE, "сервер подтвердил прямой поиск, мс:", { attempt, stopToFirstRequest: firstSentAt - signalAt, stopToRequest: sentAt - signalAt, stopToAck: at - signalAt, firstRequestToAck: at - firstSentAt, requestToAck: at - sentAt });
  }
  if (state === "found") { directGameFound = directQueued = true; directHandoffAt = 0; }
  if (state === "unavailable" || state === "refused") {
    writeDirectHandoff(signalAt, false);
    directQueued = true; directHandoffAt = Date.now() + MIN_DECISION_DELAY_MS;
    log.warn(SCOPE, "прямой поиск не подтверждён — переходим к штатному восстановлению");
  }
  if (directQueued) finishDirectRequeue();
}
function finishDirectRequeue(): void {
  if (!directPending || !directQueued || !isGameRoomPage() || gameStarted || matchIsRunning() || !mayActNow(Date.now())) return;
  if (Date.now() < directHandoffAt) { scheduleDecision(directHandoffAt - Date.now()); return; }
  if (directGameFound && directPort?.enterGame?.()) {
    directPort.handoff?.();
    try { sessionStorage.removeItem(DIRECT_HANDOFF_KEY); } catch { /* navigation still succeeds */ }
    directPending = false; return;
  }
  // Передача ДО навигации: отмена в её окне не снимет подтверждённую очередь.
  directPort?.handoff?.();
  directPending = false;
  location.assign("/game-search");
}

let settings: Settings | null = null;
let unsubscribe: (() => void) | null = null;

// ── единый decision-таймер (RQ-3) ──

/**
 * Пауза перед ПЕРВЫМ решением после возвращения вкладки на экран. Игрок
 * возвращает фокус окну кликом В СТРАНИЦУ, и порядок pointerdown /
 * visibilitychange не определён: решать синхронно значит либо попасть в
 * бэкофф без следующего тика, либо навигировать поперёк живого клика
 * (аудит автовозврата 03.08.2026, RQ-6). Пауза даёт клику фокуса лечь в
 * бэкофф, а бэкофф — запланировать своё пробуждение.
 */
const FOREGROUND_GRACE_MS = 300;
/** Ниже не планируем: нулевые задержки складываются в горячий цикл. */
const MIN_DECISION_DELAY_MS = 50;

let decisionTimer: ReturnType<typeof setTimeout> | null = null;
/** Когда сработает запланированное решение (0 — не запланировано). */
let decisionAt = 0;

/**
 * Запланировать tick() через delayMs. Таймер ОДИН и коалесцированный:
 * побеждает самое раннее время. Ложное пробуждение безвредно — tick()
 * идемпотентен и пересчитывает всё из текущего состояния; ветка, которой
 * ещё рано, обязана перепланировать себя сама.
 */
function scheduleDecision(delayMs: number): void {
  const at = Date.now() + Math.max(delayMs, MIN_DECISION_DELAY_MS);
  if (decisionTimer && decisionAt <= at) return;
  if (decisionTimer) clearTimeout(decisionTimer);
  decisionAt = at;
  decisionTimer = setTimeout(
    () => {
      decisionTimer = null;
      decisionAt = 0;
      tick();
    },
    Math.max(delayMs, MIN_DECISION_DELAY_MS),
  );
}

function cancelDecision(): void {
  if (decisionTimer) clearTimeout(decisionTimer);
  decisionTimer = null;
  decisionAt = 0;
}

// ── ускорение возврата (9.78.0, см. «СКОРОСТЬ» в шапке) ──

/** Источник сигналов зонда комнаты: в сообщении только ИМЯ события. */
export const ROOM_EVENT_SOURCE = "pn-room-event";
/** Команда зонду: присылать (или нет) сигналы жизненного цикла комнаты. */
export const ROOM_EVENTS_CMD = "pn-room-events-cmd";
/** Маркер нашего `<script type="speculationrules">` в комнате. */
export const PRERENDER_ATTR = "data-pn-requeue-prerender";
/**
 * За сколько секунд до конца отсчёта начинать предзагрузку поиска. Не
 * раньше: предзагруженная страница может получить КОПИЮ sessionStorage на
 * момент старта предзагрузки, и метка моста (TTL 45 с) обязана дожить в ней
 * до активации при любом поведении браузера.
 */
const PRERENDER_LEAD_S = 25;
const SEARCH_PATH = "/game-search";
/**
 * Шаг ожидания «Играть» на пути из комнаты: без 250-мс дросселя наблюдателя.
 * Не чаще: каждая проверка видимости форсирует стиль/раскладку, а страница
 * в это время сама грузится (ревью 29.10.2026).
 */
const FAST_POLL_MS = 100;
// Готовая кнопка нажимается сразу. Пауза нужна ТОЛЬКО после доказанного
// in_game: ранний reload тоже мог бы загрузить устаревшее состояние и
// потратить единственный бюджет до синхронизации сервиса поиска.
const IN_GAME_RETRY_SETTLE_MS = 300;
/**
 * Частый опрос может застать «Играть» в момент загрузки, когда сайт ещё не
 * восстановил выбранные очереди (disabled). Сдаёмся по «не выбраны очереди»
 * только если кнопка недоступна дольше этого (ревью 29.10.2026).
 */
const DISABLED_GRACE_MS = 1500;
/** Сколько после активации предзагрузки возврат фокуса не ждёт паузу RQ-6. */
const ACTIVATION_FAST_MS = 2000;
/**
 * Метка «зонд комнаты встал» (= PROBE_MARK_ATTR в room-probe-page). Модуль
 * зонда импортировать нельзя: его IIFE при импорте патчит WebSocket.
 */
const PROBE_READY_ATTR = "data-pn-room-probe-ready";
/** Время последней нашей перезагрузки поиска: одна на эпизод, не цикл. */
const RELOAD_KEY = "pn_requeue_reload";
const RELOAD_GUARD_MS = 60_000;

/** Сервер прислал on_stop_game после отсчёта роспуска (0 — не было). */
let stopGameSignalAt = 0;
/**
 * Сервер объявил отсчёт роспуска (on_game_disbandment). ОТДЕЛЬНО от
 * disbandmentSeen: тот запускает DOM-грейс, а грейс короче серверного
 * отсчёта — по одному сигналу без видимого таймера он увёл бы игрока
 * посреди ещё идущего голосования. Флаг лишь разрешает доверять on_stop_game.
 */
let disbandmentSignaled = false;
let roomEventListener: ((e: MessageEvent) => void) | null = null;
let prerenderListener: (() => void) | null = null;
/** Когда страница поиска показана активацией нашей предзагрузки (0 — нет). */
let prerenderActivatedAt = 0;
/** Когда пришли из распущенной комнаты (для строки задержки в логе). */
let fromRoomAt = 0;
/** Принятая метка моста: перезагрузка обязана продолжить ЭТОТ эпизод. */
let consumedMark: PendingMark | null = null;
/** Первый клик в текущем документе; успехом считается только очередь. */
let firstPlayClickAt = 0;

function isPrerendering(): boolean {
  return (document as Document & { prerendering?: boolean }).prerendering === true;
}

function siteElementVisible(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return !!el && isVisible(el);
}

function prerenderSupported(): boolean {
  const ctor = HTMLScriptElement as unknown as { supports?: (type: string) => boolean };
  try {
    return typeof ctor.supports === "function" && ctor.supports("speculationrules");
  } catch {
    return false;
  }
}

/**
 * Предзагрузить страницу поиска (Chrome, speculation rules). Наш переход
 * на тот же адрес активирует готовую страницу мгновенно; не перешли —
 * браузер её просто выбросит. Идемпотентно (вызывается из DOM-подписчика,
 * §4 п.1): узел вставляется один раз, повтор — один querySelector.
 */
function ensurePrerender(): void {
  // Транспорт прямого поиска ставится всегда (content/index.ts), поэтому
  // speculation rules ниже — только запасной путь на случай, если его нет
  // (тесты, будущий откат); в обычной работе готовится соединение поиска.
  if(directPort){directPort.prepare();return;}
  if (document.querySelector(`script[${PRERENDER_ATTR}]`)) return;
  if (!prerenderSupported()) return;
  // Метка ДО старта предзагрузки: её копию и увидит предзагруженная страница.
  armPending(true);
  const rules = document.createElement("script");
  rules.type = "speculationrules";
  rules.setAttribute(PRERENDER_ATTR, "");
  rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: [SEARCH_PATH] }] });
  (document.head || document.documentElement).appendChild(rules);
  // «Запрошена», а не «идёт»: браузер может молча отказать (CSP страницы,
  // экономия энергии, настройка предзагрузки) — правда будет в строке
  // «клик «Играть» через N мс … (страница была предзагружена)».
  log.info(SCOPE, "запрошена предзагрузка страницы поиска — переход после роспуска будет мгновенным");
}

/** Убрать правила: браузер отменит предзагрузку (матч пошёл, уход, выключение). */
function cancelPrerender(): void {
  directPort?.cancel();
  for (const el of Array.from(document.querySelectorAll(`script[${PRERENDER_ATTR}]`))) el.remove();
}

/**
 * Видели ли МЫ САМИ отсчёт роспуска, дошедший почти до нуля. Клиентский
 * отсчёт отстаёт от серверного на задержку сети — отсюда допуск.
 */
function disbandmentNearZero(): boolean {
  return disbandmentSeen && disbandmentLastSeconds >= 0 && disbandmentLastSeconds <= DISBAND_ZERO_TOLERANCE_S;
}

/** Сказать зонду комнаты, нужны ли нам сигналы (зонда может и не быть). */
function commandRoomEvents(on: boolean): void {
  try {
    window.postMessage({ source: ROOM_EVENTS_CMD, on }, location.origin);
  } catch {
    /* страница уходит */
  }
}

/**
 * Сигнал зонда комнаты. Экспорт — тестовый шов. Подделать его может любой
 * скрипт страницы (сигнал идёт через window), а запускает он уход из комнаты
 * и прямой запрос поиска. Поэтому сигнал только УСКОРЯЕТ решение, которое
 * доказывает DOM: on_stop_game принимаем лишь после того, как сами видели
 * отсчёт роспуска и он дошёл почти до нуля (ревью 09.11.2026) — подделка
 * посреди отсчёта или без него ничего не запускает.
 */
export function onRoomEvent(e: MessageEvent): void {
  if (e.source !== window) return;
  const data = e.data as { source?: unknown; name?: unknown } | null;
  if (data?.source !== ROOM_EVENT_SOURCE || typeof data.name !== "string") return;
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) return;
  if (!isGameRoomPage() || gameStarted) return;
  // Старт стадии во время отсчёта — все успели, матч пошёл: уводить нельзя.
  // ДО отсчёта сигнал не трогаем — стартом матча там занимается DOM.
  if (data.name === "on_game_disbandment") {
    disbandmentSignaled = true;
    return;
  }
  if (data.name === "on_start_stage") {
    if (disbandmentSeen || disbandmentSignaled) {
      noteMatchStarted("сервер начал стадию во время отсчёта роспуска — матч идёт, не вмешиваемся");
    }
    return;
  }
  if (data.name !== "on_stop_game" || stopGameSignalAt) return;
  // Прямой on_stop_game без отсчёта — не «лобби не собралось» (исключение,
  // ошибка сервера): им занимается DOM-путь с узкой классификацией экрана
  // (RQ-5/RQ-7). Ускоряем только доказанный роспуск.
  if (!disbandmentNearZero()) return;
  stopGameSignalAt = Date.now();
  log.info(SCOPE, "сервер распустил комнату (on_stop_game) — решаем сразу, не дожидаясь экрана сайта");
  tick();
}

/**
 * Перезагрузить страницу поиска ОДИН раз на эпизод: сайт застрял в
 * состоянии «игрок ещё в игре» (предзагрузка снята, пока комната была жива,
 * или сервер поиска узнал о роспуске на мгновение позже нашего клика).
 * Свежая загрузка спрашивает сервер заново. false — перезагрузка уже была,
 * пусть машина доживает своё окно и честно сдаётся.
 */
function waitForSearchService(now: number): boolean {
  const anchor = firstPlayClickAt || consumedMark?.roomStoppedAt || 0;
  const remaining = anchor + IN_GAME_RETRY_SETTLE_MS - now;
  if (!anchor || remaining <= 0) return false;
  scheduleDecision(remaining);
  return true;
}

function reloadSearchOnce(reason: string, budgeted = true): boolean {
  const now = Date.now();
  try {
    if (budgeted) {
      const prev = Number(sessionStorage.getItem(RELOAD_KEY));
      // Время из будущего — мусор недоверенного хранилища: перезагрузки не было.
      if (prev > 0 && prev <= now && now - prev < RELOAD_GUARD_MS) return false;
      sessionStorage.setItem(RELOAD_KEY, String(now));
    }
    // Мост обязан пережить перезагрузку — и остаться ТЕМ ЖЕ эпизодом:
    // новый issuedAt обнулял бы потолок эпизода на каждой перезагрузке.
    sessionStorage.setItem(PENDING_KEY, serializeMark(refreshMark(consumedMark, now)));
  } catch {
    return false;
  }
  log.info(
    SCOPE,
    reason,
    budgeted
      ? "— перезагружаем страницу поиска (один раз на эпизод) и повторяем"
      : "— перезагружаем устаревшую предзагрузку (вне бюджета перезагрузок) и повторяем",
  );
  location.reload();
  return true;
}

/**
 * Можно ли действовать СЕЙЧАС: не поперёк живого ввода (§4 п.2, бэкофф с
 * собственным пробуждением, RQ-6) и не в фоновой вкладке (разбудит
 * visibilitychange). Общий гейт клика и перезагрузок страницы поиска.
 */
function mayActNow(now: number): boolean {
  // Игрок только что кликал/печатал сам — он у панели, дорога его (ревью №3).
  if (now - lastTrustedInputAt < USER_BACKOFF_MS) {
    // По фронту, не на каждый тик: строка нужна, чтобы отличить «мы уступили
    // человеку» от «машина умерла», но тиков тут четыре в секунду (QR-1).
    if (!backoffLogged) {
      backoffLogged = true;
      log.info(SCOPE, "автовозврат отложен: игрок только что действовал сам");
    }
    scheduleDecision(lastTrustedInputAt + USER_BACKOFF_MS - now + 100);
    return false;
  }
  // Фоновая вкладка = игрока может не быть у экрана: действие запрещено, но
  // гейт стоит ИМЕННО ЗДЕСЬ, в секции действий — состояние и окно выше живут
  // и в фоне (dom.ts тикает таймером), и окно честно истекает. Ранний return
  // в начале tick замораживал disappearedAt=0 — возврат на вкладку спустя
  // минуты начинал окно заново и кликал по забытому состоянию (ревью, р.3).
  return !document.hidden;
}

/** Игрок принял игру в ТЕКУЩЕМ сборе лобби. */
let accepted = false;
/** Взведение пришло мостом из распущенной комнаты (для честного тоста). */
let armedFromRoom = false;
/** Момент исчезновения accept-блока (0 — ещё виден/не был). */
let disappearedAt = 0;
let attempts = 0;
let lastClickAt = 0;

/** Есть ли на странице ВИДИМАЯ сайтовая модалка (у скрытых нет размеров). */
function siteModalOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(SITE_MODAL_SELECTOR)).some(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0,
  );
}

/** Последнее НАСТОЯЩЕЕ действие игрока (isTrusted) — автоклик обязан уступать
 *  дорогу человеку (инвариант AGENTS.md §4 п.2: бэкофф после ручных действий). */
let lastTrustedInputAt = 0;

/**
 * Отметить настоящее действие игрока. Доверенность (isTrusted) проверяет
 * слушатель; экспорт — тестовый шов: jsdom не умеет создавать доверенные
 * события, а бэкофф-ветки обязаны быть покрыты мутационными тестами.
 */
export function noteTrustedInput(): void {
  lastTrustedInputAt = Date.now();
  if(directResuming){directPort?.cancel();directResumeRequested=false;scheduleDecision(USER_BACKOFF_MS+100);}
  if(directPending){directPort?.cancel();directPending=false;directQueued=false;roomExitDone=false;scheduleDecision(USER_BACKOFF_MS+100);}
}
let trustedListener: ((e: Event) => void) | null = null;
/** Слушатель доверенных кликов для латча намерения (RQ-2). */
let intentListener: ((e: Event) => void) | null = null;
/** Когда вкладку спрятали при живом accepted (окно сверяется на возврате). */
let hiddenAt = 0;
let visibilityListener: (() => void) | null = null;

// ── состояние этапа 2 (комната) ──

/**
 * Состояние комнаты живёт до `disable()`, а роутер (content/index.ts)
 * queue-requeue не перезапускает: вход в комнату — это полная загрузка
 * страницы. Если сайт когда-нибудь сделает комнату SPA-маршрутом, вторая
 * комната в той же вкладке унаследует `gameStarted = true` — то есть ровно тот
 * баг, который чинили 02.08.2026. Тогда состояние надо будет сбрасывать по
 * смене URL.
 */
/** Игрок нажал «Готов» в ЭТОЙ комнате (отметка на своей плитке). */
let roomReady = false;
/** Видели игровую стадию — матч состоялся, возвраты запрещены до ухода. */
let gameStarted = false;
/** Переход на поиск уже инициирован — не кликать ссылку повторно. */
let roomExitDone = false;
/** Видели обратный отсчёт роспуска в этой комнате. */
let disbandmentSeen = false;
/** Про отсчёт уже написали в лог (пишем один раз на комнату, даже без готовности). */
let disbandmentLogged = false;
/** Момент исчезновения отсчёта (0 — виден или ещё не появлялся). */
let disbandmentGoneAt = 0;
/** Последнее прочитанное значение отсчёта в секундах (-1 — не читали). */
let disbandmentLastSeconds = -1;
/**
 * Когда значение отсчёта в ПОСЛЕДНИЙ РАЗ МЕНЯЛОСЬ. Именно менялось, а не
 * читалось: в спрятанной вкладке сайт останавливает анимационный цикл, текст
 * замирает, и повторное чтение того же значения «освежало» бы протухший
 * сэмпл. По возвращении вкладки сайт одним колбэком вычитает всю паузу и
 * убирает отсчёт БЕЗ промежуточного «00:00» — старое значение >3 с тогда
 * значит «мы проспали конец», а не «игра стартует» (аудит 03.08.2026, RQ-1).
 */
let disbandmentSampleChangedAt = 0;
/**
 * Свежесть сэмпла: отсчёт при видимой вкладке меняется раз в секунду, тики
 * дросселируются на 250 мс — 3 секунды покрывают оба зазора с запасом.
 */
const SAMPLE_FRESH_MS = 3000;
/** Уход с посторонней страницы уже инициирован. */
let elsewhereDone = false;
/** Про недоступное хранилище на главной уже сказали (не на каждый тик). */
let elsewhereStorageWarned = false;
/** Про невозможность сохранить мост уже сказали (освежение идёт на каждом тике). */
let armStorageWarned = false;
/** Мост для этапа 1 уже поставлен в этом сборе лобби. */
let acceptArmed = false;
/** Про отложенный из-за действий игрока клик уже сказали (не на каждый тик). */
let backoffLogged = false;
/**
 * Про отложенный выход из распущенной комнаты уже сказали — ОТДЕЛЬНО по
 * каждой причине: один общий латч глушил бы две другие до конца жизни
 * страницы, и в файле оставалась бы не та причина (ревью 02.08.2026).
 */
const roomExitDeferLogged = { hidden: false, userInput: false, retryScreen: false };
/** Про «лобби стартует» уже сказали. */
let gameStartingLogged = false;
/** Про неоднозначный экран ошибки уже сказали (один исход на эпизод). */
let ambiguousErrorLogged = false;

function isGameRoomPage(): boolean {
  return isGameRoomPath(location.pathname);
}

function norm(text: string | null | undefined): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Матч ИДЁТ (день/ночь/голосование), а не «комната только что открылась».
 *
 * Проверять сам `.stage` нельзя — и это была причина, по которой этап 2 не
 * работал НИКОГДА (жалоба 01.08.2026, разбор лога 02.08.2026). Роллер сайта
 * выбирает ветку `.new-stage` ровно при `stage.type === voting_for_game_start`,
 * а во ВСЕХ остальных случаях рисует `.stage` — включая первые секунды после
 * загрузки комнаты, пока состояние игры ещё не пришло по сокету. Узел в этот
 * момент пустой, но он ЕСТЬ: фича видела его на первом же тике, ставила
 * `gameStarted` и молча выключала себя на всю жизнь страницы.
 */
/** Текст стадии говорит об ИДУЩЕМ матче (а не об ожидании его начала). */
export function isRunningStageText(text: string): boolean {
  if (text.length === 0) return false;
  return !(TEXT.waitingForGameStage as readonly string[]).some((m) => text.includes(m));
}

function matchIsRunning(): boolean {
  // Пауза/промах/итог игры рисуются вместо роллера, стадии там нет вообще —
  // но все три бывают только после старта матча (ревью 02.08.2026).
  if (document.querySelector(SITE.roomFixedState)) return true;
  // Экран набора игроков — доказательство, что матч ещё не начался.
  if (document.querySelector(SITE.pregameScreen)) return false;
  // Непустой текст обязателен: в свежезагруженной комнате сайт рисует ТРИ
  // пустых `.substage` (массив substages в data фиксирован: current/next/temp,
  // а текст берётся из ещё не пришедшей стадии).
  //
  // И этого мало: пока состояние комнаты не пришло, `gameView` не определён,
  // тернарник роллера уходит в ветку ОБЫЧНОЙ стадии (не «набор игроков») и
  // пишет «Ожидание начала игры». Такой текст непустой — и лобби, в которое
  // мы только что вошли, читалось как идущий матч (жалоба 09.08.2026).
  return Array.from(document.querySelectorAll<HTMLElement>(SITE.runningStageMarkers)).some(
    (el) => isRunningStageText(norm(el.textContent)),
  );
}

/**
 * Игрок подтвердил готовность в этой комнате. Два независимых признака:
 *  1. отметка «Готов» на своей плитке;
 *  2. кнопка готовности в контролах с классом `active` — сайт вешает его
 *     ровно при `votingForGameStart.voted`.
 * Второй нужен потому, что первый держится на вёрстке плитки и на её
 * ВИДИМОСТИ: старая проверка брала первый узел в документе и требовала
 * offsetWidth > 0 — то есть молча отвечала «не готов» на любую разметку, где
 * отметка отрисована иначе.
 */
function readyConfirmed(): boolean {
  const marks = Array.from(document.querySelectorAll<HTMLElement>(SITE.myReadinessMark));
  if (marks.some((el) => el.offsetWidth > 0 || isVisible(el))) return true;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SITE.readyButton))) {
    // Текст опознаёт КНОПКУ (точное совпадение, §4 п.2 — никаких подстрок:
    // «Не готов» содержит «готов»), класс active — НАЖАТА ли готовность. Обе
    // подписи кнопки одинаковы («Готов»), без класса состояние не отличить.
    // Хрупкость: в шаблоне ControlsButton есть спан хоткея button__command,
    // сейчас ЗАКОММЕНТИРОВАННЫЙ. Если сайт его включит, textContent станет
    // «RГотов» и признак молча умрёт — останется только отметка на плитке.
    if (!(TEXT.readyButton as readonly string[]).includes(norm(el.textContent))) continue;
    if (el.classList.contains(SITE.readyButtonActiveClass)) return true;
  }
  return false;
}

/** Тик комнаты: следим за готовностью и смертью комнаты. */
function roomTick(): void {
  if(directPending){
    if(matchIsRunning()){noteMatchStarted("матч начался — прямой поиск отменён");directPending=false;return;}
    if(!directQueued&&Date.now()-directStartedAt>=DIRECT_SILENCE_MS){
      log.warn(SCOPE,"страница не ответила на прямой запрос поиска — переходим к штатному восстановлению");
      noteDirectRequeueResult("unavailable",stopGameSignalAt,0,Date.now());return;
    }
    finishDirectRequeue();return;
  }
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) return;
  if (gameStarted) return;

  if (matchIsRunning()) {
    noteMatchStarted("матч начался — возвраты в поиск выключены до ухода со страницы");
    return;
  }

  if (!roomReady && readyConfirmed()) {
    roomReady = true;
    log.info(SCOPE, "готовность подтверждена — этап 2 на страже");
  }

  // ── обратный отсчёт роспуска ──
  const timer = document.querySelector<HTMLElement>(SITE.disbandmentTimer);
  const timerVisible = !!timer && isVisible(timer);
  // Отсчёт логируем ДО гейта готовности: иначе по логу пользователя нельзя
  // отличить «сайт не показал отсчёт» от «мы не увидели готовность», и
  // разбор жалобы упирается в догадки (разбор лога 02.08.2026).
  if (timerVisible && !disbandmentLogged) {
    disbandmentLogged = true;
    // Зонд — источник быстрого сигнала on_stop_game. Без него (первая
    // комната после включения настройки) «сигнал не пришёл» иначе не
    // отличить от «зонда нет» (ревью 29.10.2026).
    log.info(
      SCOPE,
      "виден обратный отсчёт роспуска; готовность подтверждена:",
      roomReady,
      "; зонд комнаты:",
      document.documentElement.hasAttribute(PROBE_READY_ATTR) ? "есть" : "нет (будет медленный путь)",
    );
  }
  if (roomExitDone) return;

  // Сервер уже сказал on_stop_game после отсчёта — это доказательство
  // роспуска сильнее любого экрана: ни ждать экран (2 с), ни грейс-паузу
  // (12 с) незачем. Отсчёт при этом может ещё секунду показывать «00:01» —
  // клиентский таймер отстаёт от серверного на задержку сети.
  const serverStopped = stopGameSignalAt > 0 && disbandmentNearZero();

  // Трекинг отсчёта идёт и БЕЗ готовности (RQ-7): терминальный роспуск надо
  // уметь доказать для любого игрока — неготовому мы обязаны честно сказать,
  // почему возврата не будет, а не промолчать. Готовность гейтит только
  // ДЕЙСТВИЯ: мост и уход.
  if (timer && timerVisible && !serverStopped) {
    if (!disbandmentSeen) {
      disbandmentSeen = true;
      if (roomReady) {
        log.info(SCOPE, "идёт обратный отсчёт роспуска — готовимся вернуться в поиск");
      }
    }
    // Мост ставим СРАЗУ, а не в момент ухода: дальше игрока может увести сам
    // сайт или он сам нажмёт «На главную» — тогда наш код в комнате уже не
    // выполнится. И на КАЖДОМ тике, а не однажды: видимый отсчёт — живое
    // условие, TTL скользит от последнего подтверждения (RQ-4), иначе
    // серверный отсчёт длиннее 45 с протушил бы метку ещё до роспуска.
    if (roomReady) armPending();
    // Непонятую строку НЕ записываем: -1 неотличим от «досчитал до нуля», а
    // это ветка «комнату распустили» — то есть игрока выдернуло бы из,
    // возможно, стартующего матча. Держим последнее прочитанное значение.
    // Ограничение: если сайт сменит формат ЦЕЛИКОМ, первое же чтение даст -1
    // и держать будет нечего — тогда поведение прежнее, как до этой правки.
    const seconds = parseCountdownSeconds(timer.textContent);
    if (seconds >= 0 && seconds !== disbandmentLastSeconds) {
      disbandmentLastSeconds = seconds;
      // Метка времени — по СМЕНЕ значения (см. комментарий у поля).
      disbandmentSampleChangedAt = Date.now();
    }
    // Предзагрузка поиска — только тому, кого после роспуска вернём
    // автокликом; на финишной прямой отсчёта (см. PRERENDER_LEAD_S).
    if (roomReady && seconds >= 0 && seconds <= PRERENDER_LEAD_S) ensurePrerender();
    disbandmentGoneAt = 0;
    return;
  }
  // Экран ошибки классифицируется РАНЬШЕ веток отсчёта: сайт убирает отсчёт
  // и рисует экран ОДНИМ рендером, то есть одним нашим тиком. Уйди мы сперва
  // в грейс-паузу — метка исключённого игрока жила бы ещё ~12 секунд, ровно
  // пока он читает кнопку «На главную» (контрольное ревью 04.08.2026).
  // «Попробовать снова» проверяется первым: обрыв СВЯЗИ, а не распуск —
  // комната может быть жива, мост не гасим (отсчёт может продолжиться).
  const retry = document.querySelector<HTMLElement>(SITE.roomRetryButton);
  if (retry && isVisible(retry)) {
    if (!roomExitDeferLogged.retryScreen) {
      roomExitDeferLogged.retryScreen = true;
      log.info(SCOPE, "обнаружен обрыв связи (кнопка «Попробовать снова») — в поиск не уводим");
    }
    return;
  }
  const screen = classifyRoomErrorScreen();
  if (screen?.kind === "ambiguous") {
    // Экран ошибки есть, но развала он НЕ доказывает: исключение игрока
    // рисует home+search, потеря сессии — один action без ссылок. Клик по
    // search здесь вернул бы в очередь игрока, которого сервер только что
    // исключил (аудит 03.08.2026, RQ-5). Неоднозначный экран сильнее
    // отсчёта: исключить могли и ВО ВРЕМЯ него — и тогда мост уже лежит в
    // sessionStorage. Не погасить его В ЭТОМ ЖЕ тике = вернуть исключённого
    // в очередь через «На главную» → elsewhereTick (ревью 04.08, блокер 1).
    // Предзагрузку — тоже: ссылка сайта «/game-search» на экране исключения
    // активировала бы её, а предзагруженная страница может держать КОПИЮ
    // хранилища с ещё живой меткой (ревью 29.10.2026, RQ-5 под быстрым путём).
    clearPending();
    cancelPrerender();
    if (!ambiguousErrorLogged) {
      ambiguousErrorLogged = true;
      log.info(SCOPE, "автовозврат не выполнен: экран ошибки комнаты не подтверждает развал");
    }
    return;
  }

  // Отсчёт был и пропал: либо время вышло (роспуск), либо все успели и игра
  // стартовала. Узкая форма экрана смерти решает сама — дискриминатор по
  // сэмплу и грейс-пауза нужны только когда экрана нет. Сигнал сервера
  // (serverStopped) решает тоже сам: ждать здесь — ровно те секунды, которые
  // мы проигрывали ручной второй вкладке.
  if (!serverStopped && !screen && disbandmentSeen && !disbandmentGoneAt) {
    // Первый дискриминатор — последнее показанное значение: при роспуске
    // отсчёт доходит до ~00:00, при старте игры гаснет на произвольном.
    // Дискриминатору можно верить, только пока сэмпл СВЕЖИЙ: после hidden-
    // паузы сайт убирает отсчёт одним catch-up колбэком, и старое «00:28»
    // доказывает лишь то, что мы проспали конец (RQ-1).
    const sampleFresh =
      disbandmentSampleChangedAt > 0 &&
      Date.now() - disbandmentSampleChangedAt <= SAMPLE_FRESH_MS;
    if (sampleFresh && disbandmentLastSeconds > DISBAND_ZERO_TOLERANCE_S) {
      log.info(
        SCOPE,
        "отсчёт погас на",
        disbandmentLastSeconds,
        "с — игра стартует, не вмешиваемся",
      );
      gameStarted = true;
      clearPending();
      cancelPrerender();
      return;
    }
    if (!sampleFresh && disbandmentLastSeconds > DISBAND_ZERO_TOLERANCE_S) {
      // Один info на эпизод: без него по файлу не отличить «поверили
      // протухшему сэмплу» от «пошли ждать подтверждение стадии».
      log.info(SCOPE, "отсчёт исчез после паузы вкладки — ждём подтверждение стадии");
    }
    disbandmentGoneAt = Date.now();
    // DOM распущенной комнаты замирает: мутаций больше не будет, а tick()
    // ходит только от них — без своего пробуждения пауза не истекла бы
    // НИКОГДА (ровно то «ничего не происходит», ради чего фича переписана).
    // Если за паузу появится игровая стадия, matchIsRunning() выключит нас
    // раньше — старт игры она доказывает надёжнее любого сэмпла.
    scheduleDecision(DISBAND_GRACE_MS + 250);
    return;
  }

  const graceExpired =
    disbandmentSeen && disbandmentGoneAt > 0 && Date.now() - disbandmentGoneAt > DISBAND_GRACE_MS;
  if (!serverStopped && screen?.kind !== "disbandment" && !graceExpired) {
    // Ложное пробуждение до конца паузы (например, foreground grace):
    // перепланировать остаток обязана сама ждущая ветка — таймер один.
    if (disbandmentGoneAt > 0) {
      scheduleDecision(disbandmentGoneAt + DISBAND_GRACE_MS - Date.now() + 250);
    }
    return;
  }

  // Метка неготового гаснет СРАЗУ, до отсрочек (adversarial 28.09.2026,
  // находка 5): в фоновой вкладке отсрочка держала чужую метку этапа 1
  // живой, и сайтовая навигация на поиск успела бы нажать «Играть» за
  // неготового. Гашение метки безопасно в любом состоянии — ждать нечего.
  if (!roomReady) {
    clearPending();
    cancelPrerender();
  }

  // Те же правила, что и на поиске: не в фоне и не поперёк живого человека.
  // Обе отсрочки — по фронту: DOM распущенной комнаты замер, повторной точки
  // решения может не быть, и молчание тут неотличимо от поломки (QR-2).
  if (document.hidden) {
    if (!roomExitDeferLogged.hidden) {
      roomExitDeferLogged.hidden = true;
      log.info(SCOPE, "выход из распущенной комнаты отложен: вкладка в фоне");
    }
    return;
  }
  if (Date.now() - lastTrustedInputAt < USER_BACKOFF_MS) {
    if (!roomExitDeferLogged.userInput) {
      roomExitDeferLogged.userInput = true;
      log.info(SCOPE, "выход из распущенной комнаты отложен: игрок только что действовал сам");
    }
    // DOM мёртвой комнаты больше не мутирует: без собственного пробуждения
    // эта отсрочка была бы НАВСЕГДА (аудит 03.08.2026, RQ-6).
    scheduleDecision(lastTrustedInputAt + USER_BACKOFF_MS - Date.now() + 100);
    return;
  }

  roomExitDone = true;
  // Развал ДОКАЗАН — со страницы-могилы уводим ВСЕХ: путь руками из мёртвой
  // комнаты — «На главную» → главная → «Поиск», целая куча страниц (просьба
  // владельца 28.09.2026). Предохранитель «только подтвердившему» живёт не
  // здесь, а на АВТОКЛИКЕ «Играть»: неготовый приземляется на страницу
  // поиска БЕЗ метки — кнопку жмёт сам. Порчу лобби зацикливал бы автоклик,
  // а не перевод на страницу, где человек решает.
  if (stopGameSignalAt) {
    // Цена решения в миллисекундах — то, за что эта ветка и боролась
    // (СКОРОСТЬ в шапке). Ненулевое значение = отсрочка (фон, живой ввод).
    log.info(SCOPE, "уход из комнаты через", Date.now() - stopGameSignalAt, "мс после on_stop_game");
  }
  if (roomReady) {
    armPending(true, stopGameSignalAt); // время сигнала переживает навигацию и reload
    // Новый эпизод — своя разовая перезагрузка на поиске: запрет прошлого
    // эпизода (даже неуспешного) сюда не переносится.
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* приватный режим */
    }
    // Тост здесь не рисуем: страница сейчас сменится, плашка мелькнёт на
    // миллисекунды. О возврате скажет тост на странице поиска (armedFromRoom).
    log.info(SCOPE, "комната распущена после готовности — уходим на страницу поиска");
  } else {
    // Метка уже погашена выше (до отсрочек); здесь — объяснение. Тост в
    // комнате мелькнул бы миллисекунды, поэтому одноразовый мост-ключ:
    // страница поиска покажет, ПОЧЕМУ игрока сюда привело (adversarial
    // 28.09.2026, находка 4 — молчаливый принудительный увод).
    try {
      sessionStorage.setItem(NOT_READY_EXIT_KEY, "1");
    } catch {
      /* приватный режим: приземлится без объяснения, но приземлится */
    }
    log.info(
      SCOPE,
      "роспуск без подтверждённой готовности — уводим на страницу поиска БЕЗ автоклика «Играть»",
    );
  }
  if(roomReady&&stopGameSignalAt&&directPort?.start(stopGameSignalAt)){
    directPending=true;directQueued=false;directGameFound=false;directHandoffAt=0;
    directStartedAt=Date.now();scheduleDecision(DIRECT_SILENCE_MS+50);return;
  }
  if (roomReady && directPort?.resume) {
    // Even a cold fallback uses the site's startSearch method, never a DOM click.
    writeDirectHandoff(stopGameSignalAt || Date.now(), false);
  }
  cancelPrerender();
  if (screen?.kind === "disbandment") {
    // Сайт показал ссылку узкой формы развала — идём по ней (обычная
    // навигация сайта).
    screen.link.click();
  } else {
    // Обычный случай: комната просто «умерла» без экрана ошибки, и уйти с
    // неё может только тот, кто знает куда. Кнопка сайта «На главную» ведёт
    // на origin, откуда игроку пришлось бы жать «Поиск» руками — ради этого
    // фича и делалась.
    location.assign("/game-search");
  }
}

/**
 * Структурная классификация экрана ошибки комнаты (RQ-5).
 *
 * Развал (`on_stop_game`) сайт рисует ЕДИНСТВЕННОЙ главной кнопкой — ссылкой
 * на /game-search. Любая другая комбинация (home+search у исключения,
 * search+reload у ошибок медиа/авторизации, один action без href у потери
 * сессии) — «ambiguous»: решает игрок. Тексты не читаем — только структуру:
 * подписи локализуются, а строки сервера нам не принадлежат.
 */
function classifyRoomErrorScreen():
  | { kind: "disbandment"; link: HTMLElement }
  | { kind: "ambiguous" }
  | null {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(SITE.roomErrorButtons),
  ).filter((el) => isVisible(el));
  if (buttons.length === 0) return null;
  if (buttons.length === 1 && buttons[0].getAttribute("href") === "/game-search") {
    return { kind: "disbandment", link: buttons[0] };
  }
  return { kind: "ambiguous" };
}

/**
 * Одноразовый мост «комната распускается → страница поиска».
 *
 * Повторный вызов ОСВЕЖАЕТ метку, не начиная эпизод заново: живое условие
 * (видимый отсчёт, принятый блок) обязано звать это на каждом своём тике —
 * TTL скользит от последнего подтверждения, а не от постановки (RQ-4).
 * Потолок эпизода держит issuedAt, который освежение не трогает.
 */
/** Последняя запись метки (0 — не писали). Дроссель освежения ниже. */
let lastArmWriteAt = 0;
/**
 * Освежать чаще незачем: TTL скользит 45 секундами, а синхронная пара
 * get+parse+stringify+set в sessionStorage шла на КАЖДОМ тике живого условия
 * — до 4 записей/с (перф-аудит 06.08.2026, PERF-6). Принудительная запись
 * (force) — для точек, где метка обязана лечь СЕЙЧАС: латч намерения и
 * перевзвод перед уходом.
 */
const ARM_REFRESH_MIN_MS = 5000;

function armPending(force = false, roomStoppedAt = 0): void {
  try {
    const now = Date.now();
    if (!force && now - lastArmWriteAt < ARM_REFRESH_MIN_MS) return;
    lastArmWriteAt = now;
    const verdict = validateMark(sessionStorage.getItem(PENDING_KEY), now);
    // issuedAt наследуем ТОЛЬКО у живой метки. Остаток мёртвого эпизода
    // (страница поиска живёт между сборами лобби без перезагрузки) отравил
    // бы потолок: новый честный мост рождался бы уже «старше 10 минут»
    // (ревью 04.08.2026, блокер 2).
    const prior = verdict?.ok ? verdict.mark : null;
    const mark = refreshMark(prior, now);
    if (roomStoppedAt > 0) mark.roomStoppedAt = roomStoppedAt;
    sessionStorage.setItem(PENDING_KEY, serializeMark(mark));
  } catch {
    // Приватный режим/запрет хранилища: перейдём без автоклика на поиске.
    // Раньше отказ был нем, и «мост не сработал» не отличалось от «мост не
    // ставили» (аудит наблюдаемости 02.08.2026, QR-3). Латч обязателен:
    // освежение зовётся на каждом тике живого условия, без него это был бы
    // warn-флуд на весь отсчёт (ревью 04.08.2026).
    if (!armStorageWarned) {
      armStorageWarned = true;
      log.warn(SCOPE, "не удалось сохранить мост автовозврата — хранилище страницы недоступно");
    }
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* приватный режим */
  }
}

/**
 * «MM:SS» → секунды; -1, если распарсить не удалось.
 *
 * Границы по цифрам обязательны: без них «100:30» матчилось внутренним куском
 * «00:30» и трёхминутный отсчёт читался как тридцать секунд. Секунды строго
 * `[0-5]\d` — «1:60» такого времени не бывает, и принимать его за 120 с
 * значит доверять строке, которую мы не поняли (тест-набор 01.08.2026, №7).
 */
export function parseCountdownSeconds(text: string | null): number {
  const m = /(?<!\d)(\d{1,3}):([0-5]\d)(?!\d)/.exec(text || "");
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Мы НЕ в комнате и НЕ на поиске (например, сайт увёл на главную или игрок
 * сам нажал «На главную»), но мост свежий — значит человек ПОДТВЕРДИЛ игру
 * («Готов» в распускавшейся комнате ИЛИ принятие на поиске: мост этапа 1
 * тоже жив до 45 с после ухода со страницы — известное поведение, ревью
 * 04.08.2026), и лобби развалилось. Доводим до страницы поиска; клик
 * «Играть» сделает этап 1.
 */
function elsewhereTick(): void {
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) return;
  if (elsewhereDone) return;
  // ТОЛЬКО корень сайта — именно туда ведёт кнопка выхода из комнаты
  // (`finishGameLink: location.origin`). На профиле, странице матча и прочих
  // мост игнорируем: игрок ушёл туда сам и не ждёт, что его куда-то унесёт.
  if (location.pathname !== "/") return;
  if (document.hidden) return;
  if (Date.now() - lastTrustedInputAt < USER_BACKOFF_MS) {
    // Главная после мёртвой комнаты статична: без пробуждения бэкофф был бы
    // вечным (RQ-6).
    scheduleDecision(lastTrustedInputAt + USER_BACKOFF_MS - Date.now() + 100);
    return;
  }
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
  } catch {
    // Хранилище недоступно на всей странице — эпизод для нас закрыт. Один
    // warn, не на каждый тик (RQ-8: раньше корень молчал).
    if (!elsewhereStorageWarned) {
      elsewhereStorageWarned = true;
      log.warn(SCOPE, "мост автовозврата недоступен на главной: хранилище страницы недоступно");
    }
    return;
  }
  const verdict = validateMark(raw, Date.now());
  if (!verdict) return; // метки нет — обычное состояние, не эпизод и не лог
  if (!verdict.ok) {
    // Негодную метку снимаем и говорим почему: раньше она лежала молча до
    // конца сессии, и «мост не сработал» было неотличимо от «моста не было».
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* прочитать смогли — удаление здесь не критично */
    }
    log.info(SCOPE, "мост автовозврата снят на главной:", MARK_FAILURE_TEXT[verdict.reason]);
    return;
  }
  elsewhereDone = true;
  log.info(SCOPE, "мост из распущенной комнаты — ведём на страницу поиска");
  location.assign("/game-search");
}

/**
 * Мост с этапа 2: комната умерла → мы перешли на поиск → если флаг свежий,
 * взводим машину клика «Играть» (все её предохранители работают как обычно).
 * Флаг одноразовый: снимается при первом же чтении.
 */
function consumePendingFromRoom(): void {
  if (isSearchPage() && directPort?.resume) {
    try {
      const raw = sessionStorage.getItem(DIRECT_HANDOFF_KEY);
      const mark = raw === null ? null : JSON.parse(raw);
      // Legacy timestamps carry no evidence that the server accepted a search.
      const signal = typeof mark === "number" ? mark : mark?.signalAt;
      if (Number.isSafeInteger(signal) && signal > 0 && signal <= Date.now() && Date.now() - signal < DIRECT_HANDOFF_TTL) {
        clearPending(); directResuming = true; directResumeRequested = false;
        directResumeAt = signal; directResumeQueued = mark?.queued === true;
        tryDirectResume(); return;
      }
      sessionStorage.removeItem(DIRECT_HANDOFF_KEY);
    } catch { /* fall back to ordinary requeue */ }
  }
  if (!isSearchPage()) return;
  // Предзагруженная страница ещё не показана игроку: метку читаем на
  // активации (prerenderingchange), иначе окно ARM_WINDOW_MS начало бы
  // тикать с момента предзагрузки и истекло бы раньше роспуска.
  if (isPrerendering()) return;
  // Мост-объяснение неготовому (одноразовый): его увели с роспуска БЕЗ
  // автоклика, и без этой плашки принудительный перенос был бы молчаливым
  // («меня куда-то перекинуло», adversarial 28.09.2026, находка 4).
  try {
    if (sessionStorage.getItem(NOT_READY_EXIT_KEY) !== null) {
      sessionStorage.removeItem(NOT_READY_EXIT_KEY);
      log.info(SCOPE, "приземление неготового объяснено плашкой");
      showToast("Лобби распущено — вы на странице поиска. «Играть» — за вами", {
        key: "requeue-not-ready-landing",
      });
    }
  } catch {
    /* хранилище недоступно — ниже об этом скажет warn основного моста */
  }
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
    if (raw !== null) sessionStorage.removeItem(PENDING_KEY);
  } catch {
    log.warn(SCOPE, "мост автовозврата пропущен: хранилище страницы недоступно");
    return;
  }
  const verdict = validateMark(raw, Date.now());
  if (!verdict) return;
  if (!verdict.ok) {
    // Почему мост не сработал — четыре разных случая, и раньше они были
    // неразличимы. Сырое время не пишем: sessionStorage принадлежит сайту
    // (AGENTS.md §5; про метку из будущего — аудит безопасности 01.08, №15).
    log.info(SCOPE, "мост автовозврата пропущен:", MARK_FAILURE_TEXT[verdict.reason]);
    return;
  }
  accepted = true;
  armedFromRoom = true;
  disappearedAt = Date.now();
  fromRoomAt = disappearedAt;
  consumedMark = verdict.mark;
  log.info(SCOPE, "пришли из распущенной комнаты — взводим автоклик «Играть»");
}

/** Пауза после ручного действия: игрок у панели — не вмешиваемся. */
const USER_BACKOFF_MS = 2000;

function isSearchPage(): boolean {
  return isSearchPath(location.pathname);
}

// ── латч намерения (RQ-2) ──

/**
 * Что за цель у клика игрока — с точки зрения предохранителя автовозврата.
 *
 * Зачем: подтверждение по DOM живёт в 250-мс дроссель-окне общего
 * наблюдателя, а сайт СБРАСЫВАЕТ и отметку готовности, и класс active на
 * `voting_finished` — готовность, нажатая в последние миллисекунды окна,
 * могла появиться и исчезнуть между двумя нашими тиками. Клик — синхронный,
 * его не съест ни дроссель, ни перезагрузка (аудит 03.08.2026, RQ-2).
 *
 * «room-ready» — НЕактивная кнопка «Готов» (точное совпадение текста, §4.2:
 * «Не готов» содержит «готов», подстроки запрещены). Активную не считаем:
 * готовность уже нажата и залатчена по DOM.
 * «search-accept» — ещё не принятый блок принятия (с cursor-pointer).
 *
 * Чистая функция — вынесена для прямых тестов: jsdom не умеет isTrusted=true,
 * поэтому доверенность проверяет слушатель, а классификацию — тесты.
 */
export function classifyIntentTarget(target: Element): "room-ready" | "search-accept" | null {
  const btn = target.closest(SITE.readyButton);
  if (
    btn &&
    (TEXT.readyButton as readonly string[]).includes(norm(btn.textContent)) &&
    !btn.classList.contains(SITE.readyButtonActiveClass)
  ) {
    return "room-ready";
  }
  const accept = target.closest(SITE.profileAccept);
  if (accept && accept.classList.contains(SITE_CLASS.cursorPointer)) return "search-accept";
  return null;
}

/**
 * Зафиксировать намерение игрока по клику (уже проверенному на isTrusted —
 * или пришедшему из НАШЕГО успешного автоклика, см. noteAutoAcceptDispatched).
 *
 * Смысл предохранителя — «возвращаем только того, кто сам подтвердил игру».
 * Явный клик по «Готов»/«Принять» и ЕСТЬ это подтверждение, даже если сервер
 * не успел его засчитать: развал случился не по вине игрока. Решение
 * согласовано с владельцем (ревью аудита 03.08.2026).
 *
 * Автоклик «Готов» (auto-ready) зовёт этот же хук НАПРЯМУЮ: включивший
 * фичу выбрал полный автоматизм — «развалилось → прыгаем обратно» (решение
 * владельца 03.10.2026). Совместно с тумблером автоповтора это согласие
 * даётся двумя осознанными галочками, обе выключены по умолчанию.
 */
export function noteIntentClick(target: Element): void {
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) return;
  const kind = classifyIntentTarget(target);
  if (kind === "room-ready" && isGameRoomPage()) {
    if (!roomReady && !gameStarted) {
      roomReady = true;
      log.info(SCOPE, "готовность подтверждена по клику игрока — этап 2 на страже");
    }
    return;
  }
  if (kind === "search-accept" && isSearchPage()) {
    // Синхронно, прямо в обработчике клика: reload от game_not_accepted
    // может прийти раньше ближайшего тика, а мост обязан пережить его.
    accepted = true;
    if (!acceptArmed) {
      acceptArmed = true;
      log.info(SCOPE, "принятие игры зафиксировано по клику — возврат после развала взведён");
    }
    armPending(true); // force: reload может прийти раньше любого тика
  }
}

/**
 * Хук для автопринятия (auto-start): наш собственный клик по блоку принятия
 * прошёл синхронный dispatch без исключения. Слушатель кликов его НЕ увидит
 * (isTrusted=false — и это правильно: страница может генерировать любые
 * синтетические клики), поэтому автопринятие говорит нам напрямую.
 */
export function noteAutoAcceptDispatched(): void {
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) return;
  if (!isSearchPage()) return;
  accepted = true;
  if (!acceptArmed) {
    acceptArmed = true;
    log.info(SCOPE, "принятие игры зафиксировано автокликом — возврат после развала взведён");
  }
  armPending(true); // force: как и клик игрока — синхронная гарантия
}

function reset(): void {
  accepted = false;
  acceptArmed = false;
  backoffLogged = false;
  armedFromRoom = false;
  disappearedAt = 0;
  attempts = 0;
  lastClickAt = 0;
  fromRoomAt = 0;
  consumedMark = null;
  firstPlayClickAt = 0;
}


/** pathname последнего тика: "" — ещё не тикали (первый проход не сбрасывает). */
let lastPathname = "";

/**
 * Смена маршрута ВНУТРИ одного документа (RQ-9). Сегодня сайт делает полную
 * загрузку (POST в комнату, reload поиска) и модульное состояние умирает само;
 * но SPA-переход унаследовал бы `gameStarted`/`roomExitDone` от прошлой
 * комнаты и молча подавил бы следующий эпизод — не ждём, пока сайт переедет.
 */
function syncRoute(): void {
  if (location.pathname === lastPathname) return;
  const firstRun = lastPathname === "";
  lastPathname = location.pathname;
  if (firstRun) return;
  const episodeActive = disbandmentSeen || roomReady || accepted || attempts > 0;
  if (episodeActive) log.info(SCOPE, "эпизод автовозврата сброшен: смена страницы");
  resetRoomEpisode();
  reset();
  elsewhereDone = false;
  hiddenAt = 0;
  armStorageWarned = false;
  // Мост потребляется на ВХОДЕ на страницу поиска — SPA-переход не проходит
  // через enable(), а метка одноразовая и ждать её больше некому.
  if (isSearchPage()) consumePendingFromRoom();
}

/** Сброс состояния комнатного эпизода (уход со страницы / выключение). */
function resetRoomEpisode(): void {
  directPending=false;directQueued=false;directGameFound=false;directHandoffAt=0;directResumeRequested=false;directResuming=false;
  roomReady = false;
  gameStarted = false;
  roomExitDone = false;
  disbandmentSeen = false;
  disbandmentLogged = false;
  disbandmentGoneAt = 0;
  disbandmentLastSeconds = -1;
  disbandmentSampleChangedAt = 0;
  roomExitDeferLogged.hidden = false;
  roomExitDeferLogged.userInput = false;
  roomExitDeferLogged.retryScreen = false;
  gameStartingLogged = false;
  ambiguousErrorLogged = false;
  stopGameSignalAt = 0;
  disbandmentSignaled = false;
  cancelPrerender();
}

/**
 * Матч пошёл: возвраты выключены до ухода со страницы. Запланированное
 * решение не отменяем — лишний tick() увидит gameStarted и выйдет. Мост
 * обязан умереть, иначе он утащил бы игрока в поиск прямо из матча (или
 * после его конца); предзагрузка поиска — тоже.
 */
function noteMatchStarted(reason: string): void {
  try{sessionStorage.removeItem("pn_direct_requeue_handoff");}catch{/* unavailable storage */}
  gameStarted = true;
  disbandmentSeen = false;
  disbandmentSignaled = false;
  disbandmentGoneAt = 0;
  disbandmentLastSeconds = -1;
  disbandmentSampleChangedAt = 0;
  clearPending();
  cancelPrerender();
  log.info(SCOPE, reason);
}

function tick(): void {
  if (!settings || settings.requeue_after_lobby_fail_enabled === false) {
    reset();
    return;
  }
  syncRoute();
  if(isSearchPage()&&directResuming){tryDirectResume();return;}
  if (!isSearchPage()) {
    reset();
    // Этап 2: в комнате своя машина (готовность → роспуск → уход).
    if (isGameRoomPage()) roomTick();
    // Прочие страницы (главная и т.п.): довести до поиска, если мост свежий.
    else elsewhereTick();
    return;
  }

  const acceptEl = document.querySelector<HTMLElement>(SITE.profileAccept);
  if (acceptEl) {
    disappearedAt = 0;
    attempts = 0;
    // Новое лобби на поиске — уже не «путь из комнаты»: без сброса оно
    // унаследовало бы частый опрос, перезагрузки и плашку комнаты (ревью
    // 29.10.2026).
    armedFromRoom = false;
    fromRoomAt = 0;
    consumedMark = null;
    firstPlayClickAt = 0;
    // ДВУСТОРОННЕЕ присваивание, не «односторонний if»: если развал лобби A
    // и сборка лобби B уложились в один тик, cursor-pointer на месте — это
    // НОВОЕ, не принятое лобби, и accepted обязан сброситься. Иначе клик
    // «Играть» ушёл бы за игрока, который решил B не принимать (ревью №2).
    accepted = !acceptEl.classList.contains(SITE_CLASS.cursorPointer);
    // Мост переживает ПЕРЕЗАГРУЗКУ: сайт на `on_stop_game_search` с причиной
    // game_not_accepted делает window.location.reload() (сверено с бандлом
    // game-search), и наши accepted/disappearedAt умирали вместе со страницей
    // — этап 1 не срабатывал вообще (аудит устойчивости 01.08.2026, №3).
    if (accepted) {
      if (!acceptArmed) {
        acceptArmed = true;
        log.info(SCOPE, "принятие игры подтверждено — возврат после развала взведён");
      }
      // Освежение на каждом тике + плановое пробуждение: секундомер сайта
      // обновляется через characterData, наш наблюдатель таких мутаций не
      // видит, и без таймера принятый блок не дал бы ни одного тика — метка
      // протухла бы при живом условии (RQ-4).
      armPending();
      scheduleDecision(PENDING_REFRESH_MS);
    }
    return;
  }
  if (!accepted) return;

  // Блок принятия исчез — выясняем, куда всё повернулось.
  if (document.querySelector(SITE.searchInProgress)) {
    // Сайт сам вернул игрока в очередь — не дублируем.
    // Строка успеха: без неё в файле не было ДОКАЗАТЕЛЬСТВА, что всё
    // закончилось хорошо, и «работает» не отличалось от «молча сдались»
    // (аудит наблюдаемости 02.08.2026, QR-1).
    if (attempts > 0 || armedFromRoom) {
      log.info(SCOPE, "поиск возобновлён: секундомер очереди подтверждён");
      if (armedFromRoom) {
        const now = Date.now();
        log.info(SCOPE, "замер автовозврата, мс:", {
          stopToClick: consumedMark?.roomStoppedAt && firstPlayClickAt
            ? firstPlayClickAt - consumedMark.roomStoppedAt : null,
          stopToQueue: consumedMark?.roomStoppedAt ? now - consumedMark.roomStoppedAt : null,
          landingToClick: firstPlayClickAt ? firstPlayClickAt - fromRoomAt : null,
          clickToQueue: firstPlayClickAt ? now - firstPlayClickAt : null,
          prerendered: prerenderActivatedAt > 0,
        });
      }
    }
    clearPending();
    // Эпизод закрыт успехом — следующему роспуску (бывает и через минуту)
    // своя перезагрузка обязана быть доступна.
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* приватный режим */
    }
    reset();
    return;
  }
  if (document.querySelector(GAME_STARTING_SELECTOR)) {
    // Все приняли, игра запускается — сейчас уведут со страницы. Мост обязан
    // умереть: иначе возврат на страницу поиска в пределах TTL (например,
    // игрок вышел из начавшейся игры) принял бы его за развал лобби.
    // Ветка СБРАСЫВАЕТ окно, поэтому терминального warn тут не будет никогда:
    // если лоадер подвиснет, машина молча сидела бы до ухода со страницы
    // (ревью 02.08.2026). Говорим по фронту.
    if (!gameStartingLogged) {
      gameStartingLogged = true;
      log.info(SCOPE, "лобби стартует — не вмешиваемся");
    }
    clearPending();
    disappearedAt = 0;
    return;
  }

  const now = Date.now();
  if (!disappearedAt) disappearedAt = now;
  if (now - disappearedAt > ARM_WINDOW_MS) {
    // Терминальный исход №1: окно кончилось, кнопку так и не увидели.
    // Эпизод закрыт — метка гасится: иначе ручная перезагрузка в пределах
    // TTL реанимировала бы уже сдавшуюся машину (ревью 04.08.2026).
    clearPending();
    log.warn(
      SCOPE,
      "автовозврат остановлен: за",
      `${Math.round(ARM_WINDOW_MS / 1000)} с`,
      "кнопка «Играть» не появилась",
    );
    reset();
    return;
  }

  // Сайт открыл модалку (например «Вы уже в поиске» при рассинхроне с
  // сервером) — дальше решает игрок, автоклики прекращаем.
  if (siteModalOpen()) {
    // Путь из комнаты, модалка сразу после НАШЕГО клика — скорее всего «вы
    // ещё в игре»: сервер поиска узнал о роспуске на мгновение позже (ревью
    // 29.10.2026). Одна перезагрузка спрашивает его заново; вторая модалка —
    // решает игрок. Не поперёк его ввода и не в фоне.
    if (armedFromRoom && attempts > 0 && siteElementVisible(SITE.inProgressModal)) {
      if (!mayActNow(now) || waitForSearchService(now)) return;
      if (reloadSearchOnce("после клика «Играть» сайт подтвердил «вы ещё в игре»")) return;
    }
    clearPending();
    log.warn(SCOPE, "открыта модалка сайта — прекращаем автоповтор");
    reset();
    return;
  }

  const play = document.querySelector<HTMLButtonElement>(SITE.profileSearchButton);
  if (!play || !isVisible(play)) {
    if (armedFromRoom) {
      // Путь из распущенной комнаты — гонка за место в очереди, решают
      // сотни миллисекунд (СКОРОСТЬ в шапке). Решающий блок «Продолжить /
      // Покинуть игру» лечим перезагрузкой вместо ожидания до конца окна.
      // Крутилку после клика НЕ трогаем: в час роспуска очередь нагружена,
      // медленный ответ на start_game_search нормален, а перезагрузка рвёт
      // сокет поиска и может выбросить уже выданное место (ревью 29.10.2026).
      if (siteElementVisible(SITE.searchDecideBlock)) {
        if (!mayActNow(now) || waitForSearchService(now)) return;
        // Сразу после активации предзагрузки решающий блок — устаревшее
        // знание страницы, собранной, пока комната была жива. Такая
        // перезагрузка не тратит разовый бюджет: он — для настоящего
        // рассинхрона с сервером. Повториться она не может: после
        // перезагрузки страница уже не предзагружена.
        if (prerenderActivatedAt && reloadSearchOnce("предзагруженная страница считает игрока ещё в игре", false)) {
          return;
        }
        if (reloadSearchOnce("сайт считает, что игрок ещё в игре (решающий блок)")) return;
      }
      // Ждём кнопку частым опросом: мутация разбудила бы нас только через
      // 250-мс дроссель общего наблюдателя. Опрос ограничен тем же окном.
      scheduleDecision(FAST_POLL_MS);
      return;
    }
    // Скелетон загрузки — ждём в пределах окна. Появление кнопки — это
    // мутация, она разбудит сама; таймер нужен ТЕРМИНАЛЬНОМУ исходу: без
    // него на замёрзшей странице warn «кнопка не появилась» был недостижим
    // (аудит 03.08.2026, RQ-3).
    scheduleDecision(disappearedAt + ARM_WINDOW_MS - now + 250);
    return;
  }
  if (play.disabled || play.hasAttribute("disabled")) {
    if (armedFromRoom && now - disappearedAt < DISABLED_GRACE_MS) {
      scheduleDecision(FAST_POLL_MS);
      return;
    }
    // Не выбраны очереди — решение за игроком, не за нами. Раньше выходили
    // молча, и в файле это не отличалось от «машина перестала тикать» (QR-1).
    clearPending();
    log.info(SCOPE, "автовозврат остановлен: кнопка «Играть» недоступна — не выбраны очереди");
    reset();
    return;
  }
  if (attempts >= MAX_CLICK_ATTEMPTS) {
    clearPending();
    log.warn(SCOPE, "«Играть» не сработала за", MAX_CLICK_ATTEMPTS, "попытки — сдаёмся");
    reset();
    return;
  }
  if (now - lastClickAt < MIN_CLICK_INTERVAL_MS) {
    // Пауза между попытками. Сайт мог НЕ отреагировать на клик ни одной
    // мутацией — повтор обязан разбудить себя сам (RQ-3).
    scheduleDecision(lastClickAt + MIN_CLICK_INTERVAL_MS - now + 50);
    return;
  }
  if (!mayActNow(now)) return;
  attempts++;
  lastClickAt = now;
  if (attempts === 1) firstPlayClickAt = now;
  // Сначала клик, потом лог и плашка: в гонке за очередь не тратим на них
  // ни миллисекунды до действия.
  safeClick(play);
  log.info(SCOPE, "лобби развалилось — возвращаем в поиск, попытка", attempts);
  if (attempts === 1 && fromRoomAt) {
    log.info(
      SCOPE,
      "клик «Играть» через",
      now - fromRoomAt,
      "мс после прихода из комнаты",
      prerenderActivatedAt ? "(страница была предзагружена)" : "(обычная загрузка страницы)",
    );
  }
  // Формулировка без аванса: подтверждение старта — секундомер сайта.
  // Для пути «из комнаты» текст свой: про развал лобби поиска он бы врал.
  if (attempts === 1) {
    showToast(
      armedFromRoom ? "Снова встаю в поиск… 🔁" : "Лобби развалилось — возвращаю в поиск… 🔁",
      // Ключ с номером попытки: дедуп в 30 с иначе съедал бы плашку у
      // ВТОРОГО развала лобби подряд, а он вполне возможен (ревью 02.08.2026).
      { key: `requeue-acting-${Date.now()}` },
    );
  }
  // accepted намеренно не сбрасываем: успех виден по секундомеру поиска
  // (ветка searchInProgress выше сделает reset), а неуспех повторит клик.
  // Проверка результата — своя: сайт мог проглотить клик без единой мутации,
  // и тогда ни повтор, ни терминальный warn не наступили бы (RQ-3).
  scheduleDecision(MIN_CLICK_INTERVAL_MS + 100);
}

export const queueRequeueFeature: Feature = {
  id: "queue-requeue",
  settingKey: "requeue_after_lobby_fail_enabled",

  enable(ctx: FeatureContext) {
    settings = ctx.settings;
    // isTrusted отсекает наши же синтетические клики (как в auto-start).
    trustedListener = (e: Event) => {
      if (e.isTrusted) noteTrustedInput();
    };
    document.addEventListener("pointerdown", trustedListener, true);
    document.addEventListener("keydown", trustedListener, true);
    // Латч намерения (RQ-2): только НАСТОЯЩИЙ клик игрока. Синтетические
    // клики страницы и наши собственные не проходят — их isTrusted=false;
    // автопринятие сообщает о себе явным хуком noteAutoAcceptDispatched.
    intentListener = (e: Event) => {
      if (!e.isTrusted) return;
      if (e.target instanceof Element) noteIntentClick(e.target);
    };
    document.addEventListener("click", intentListener, true);
    // Герметичность окна в фоне: тики идут от мутаций, а в совсем тихой
    // фоновой вкладке их может не быть вовсе — тогда disappearedAt не
    // проверился бы ни разу. На возврат сверяем окно явно.
    visibilityListener = () => {
      if (document.hidden) {
        if(directResuming){directPort?.cancel();directResumeRequested=false;}
        if(directPending){directPort?.cancel();directPending=false;directQueued=false;roomExitDone=false;}
        if (accepted) hiddenAt = Date.now();
        return;
      }
      // Отсутствовали дольше окна — контекст протух независимо от того, что
      // происходило в фоне; пусть игрок решает сам.
      if (accepted && hiddenAt && Date.now() - hiddenAt > ARM_WINDOW_MS) reset();
      hiddenAt = 0;
      // НЕ решать синхронно: игрок возвращает фокус окну кликом В СТРАНИЦУ,
      // и порядок pointerdown/visibilitychange не определён. Синхронный tick
      // либо навигирует поперёк живого клика, либо попадает в бэкофф без
      // следующего пробуждения (RQ-6). Пауза даёт клику осесть в бэкофф,
      // а бэкофф-ветки планируют своё продолжение сами.
      // Исключение — активация нашей же предзагрузки: игрок не возвращался
      // кликом, это мы перевели вкладку, и пауза была бы чистой потерей.
      const justActivated = prerenderActivatedAt > 0 && Date.now() - prerenderActivatedAt < ACTIVATION_FAST_MS;
      scheduleDecision(armedFromRoom && justActivated ? MIN_DECISION_DELAY_MS : FOREGROUND_GRACE_MS);
    };
    document.addEventListener("visibilitychange", visibilityListener);
    // Сигналы жизненного цикла комнаты от зонда (если он есть): on_stop_game
    // доказывает роспуск на 2 с раньше экрана сайта.
    roomEventListener = (e: MessageEvent) => onRoomEvent(e);
    window.addEventListener("message", roomEventListener);
    commandRoomEvents(true);
    if (isPrerendering()) {
      // Страница поиска предзагружена из комнаты и игроку ещё не показана.
      // Мост читаем в момент показа — это и есть «переход после роспуска».
      prerenderListener = () => {
        if (prerenderListener) document.removeEventListener("prerenderingchange", prerenderListener);
        prerenderListener = null;
        prerenderActivatedAt = Date.now();
        consumePendingFromRoom();
        tick();
      };
      document.addEventListener("prerenderingchange", prerenderListener);
    }
    // Пришли на страницу поиска из распущенной комнаты? (одноразовый флаг)
    consumePendingFromRoom();
    unsubscribe = onDomChange(() => tick());
    tick();
  },

  update(ctx: FeatureContext) {
    settings = ctx.settings;
  },

  disable() {
    directResuming=false;directResumeRequested=false;
    unsubscribe?.();
    unsubscribe = null;
    if (trustedListener) {
      document.removeEventListener("pointerdown", trustedListener, true);
      document.removeEventListener("keydown", trustedListener, true);
      trustedListener = null;
    }
    if (intentListener) {
      document.removeEventListener("click", intentListener, true);
      intentListener = null;
    }
    if (visibilityListener) {
      document.removeEventListener("visibilitychange", visibilityListener);
      visibilityListener = null;
    }
    if (roomEventListener) {
      window.removeEventListener("message", roomEventListener);
      roomEventListener = null;
    }
    commandRoomEvents(false);
    if (prerenderListener) {
      document.removeEventListener("prerenderingchange", prerenderListener);
      prerenderListener = null;
    }
    prerenderActivatedAt = 0;
    hiddenAt = 0;
    resetRoomEpisode();
    elsewhereDone = false;
    elsewhereStorageWarned = false;
    armStorageWarned = false;
    // Без этого сброса бэкофф пережил бы выключение фичи, а в тестах —
    // соседний тест (ревью 04.08.2026: вакуумность «ста тиков без строк»).
    lastTrustedInputAt = 0;
    lastPathname = "";
    lastArmWriteAt = 0;
    cancelDecision();
    reset();
    settings = null;
  },
};
