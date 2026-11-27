/**
 * Фича: пост-игровая статистика на странице /match/:id.
 * Слушает document-событие `gameDataParsed` и строит таблицу фаз
 * (дневные голосования, ночные действия), индикаторы «лучшего хода»
 * и точки штрафов. Порт match-enhancer.js.
 *
 * Гейтится настройкой match_page_stats_enabled (а также statistics_enabled —
 * это учитывает FeatureManager на уровне регистрации; здесь дополнительно
 * проверяем оба флага из ctx.settings, как в оригинале).
 */
import { SITE, SITE_CLASS } from "@core/selectors";
import { onDomChange } from "@core/dom";
import { escapeHtml } from "@core/escape";
import { actionTip, isLiftBallot, resolveDayOutcome, voteRoundName } from "../match-outcome";
import { log } from "@core/log";
import { setSettings } from "@core/settings";
import { showToast } from "@core/toast";
import { getLastGameData, getMatchId } from "../match-data";
import { analyzeMafiaShots, shotIconTitle } from "../mafia-shots";
import { buildMatchReview, type ReviewBestMove } from "../match-review-data";
import { createMatchReview, createMatchReviewState, type MatchReviewState } from "../match-review-view";
import type { Feature, FeatureContext } from "@core/feature";
import type { Settings } from "@shared/types";

const SCOPE = "match-stats";

// ───────────────────────── состояние для очистки ─────────────────────────

let settings: Settings | null = null;
let gameDataListener: ((event: Event) => void) | null = null;
/** Исходная разметка заголовка сайта — восстанавливается при disable(). */
let originalHeaderHtml: string | null = null;
let originalHeaderElement: HTMLElement | null = null;
let originalHeaderStyle: string | null = null;
let originalHeaderHadScopeAttr = false;
const intervals = new Set<ReturnType<typeof setInterval>>();
const timeouts = new Set<ReturnType<typeof setTimeout>>();
const injectedStyles: HTMLStyleElement[] = [];
const originalInlineStyles = new Map<HTMLElement, string | null>();
let activeMatchId: string | null = null;
let previousRouteTable: WeakRef<HTMLElement> | null = null;
let previousRouteTableHtml = "";
let previousRouteMatchId: string | null = null;
let routeReadyInterval: ReturnType<typeof setInterval> | null = null;
let autoHeightInterval: ReturnType<typeof setInterval> | null = null;
let routeDomUnsub: (() => void) | null = null;
let pendingGameData: any = null;
let latestGameData: any = null;
let renderGeneration = 0;
let fullReview: ReturnType<typeof createMatchReview> | null = null;
let fullReviewTable: HTMLElement | null = null;
let fullReviewAnchor: HTMLElement | null = null;
let fullReviewHeader: HTMLElement | null = null;
let fullReviewState: MatchReviewState | null = null;
let viewPicker: { label: HTMLLabelElement; select: HTMLSelectElement } | null = null;
const REPLACED_BY_REVIEW = "data-pn-review-replaced";
/**
 * Ожидание таблицы от ПРЕДЫДУЩЕГО enhance(). Обязано быть модульным: два
 * enhance() подряд быстрее 500мс (пользователь листает виды в select'е
 * стрелками) оставляли два живых интервала, и оба дорисовывали фазы — таблица
 * удваивалась. removeEnhancements() не спасал: он отрабатывает ДО того, как
 * отложенный рендер выстрелит.
 */
let tableCheckInterval: ReturnType<typeof setInterval> | null = null;

function trackInterval(id: ReturnType<typeof setInterval>): ReturnType<typeof setInterval> {
  intervals.add(id);
  return id;
}
function clearTrackedInterval(id: ReturnType<typeof setInterval>): void {
  clearInterval(id);
  intervals.delete(id);
}
function trackTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    timeouts.delete(id);
    fn();
  }, ms);
  timeouts.add(id);
  return id;
}

function appendStyle(css: string, id?: string): HTMLStyleElement {
  // С id — переиспользуем существующий элемент. Без этого вызовы из
  // периодических задач добавляли новый <style> на каждый тик.
  if (id) {
    const existing = document.getElementById(id) as HTMLStyleElement | null;
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return existing;
    }
  }
  const style = document.createElement("style");
  if (id) style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  injectedStyles.push(style);
  return style;
}

/**
 * Идемпотентная запись style. applyAutoHeight крутится по таймеру раз в 5 сек
 * и раньше переписывал десятки атрибутов на каждом тике — это будило общий
 * MutationObserver и всех его подписчиков вхолостую.
 */
function setStyleAttr(el: Element, css: string): void {
  if (el instanceof HTMLElement && !originalInlineStyles.has(el)) {
    originalInlineStyles.set(el, el.getAttribute("style"));
  }
  if (el.getAttribute("style") !== css) el.setAttribute("style", css);
}

/** То же для отдельного свойства. */
function setStyleProp(el: HTMLElement, prop: "height" | "maxHeight", value: string): void {
  if (!originalInlineStyles.has(el)) originalInlineStyles.set(el, el.getAttribute("style"));
  if (el.style[prop] !== value) el.style[prop] = value;
}

/**
 * Vue-scope сайта, под которым живёт ВСЯ раскладка таблицы статистики.
 *
 * Стили сайта scoped: `.table .row[data-v-XXXX]{display:flex}` и
 * `.table .row .cell[data-v-XXXX]{flex:1;min-width:115px}`. Наши строки без
 * этого атрибута не получают ни flex у строки, ни ширины у ячеек: строка
 * становится display:block, ячейки — блоками во всю ширину друг под другом.
 * Ровно это сломалось 07.08.2026 (жалоба владельца со скриншотом): аудит
 * хрупкости 06.08 убрал проставление scope-ID, посчитав его мёртвым. Он жив
 * — проверено на живой странице: строка со scope повторяет геометрию сайта
 * (67/116/…/115 px), без scope ячейки становятся по 1225 px в столбик.
 *
 * ID НЕ хардкодим (в этом и была хрупкость): читаем его с настоящих узлов
 * сайта при каждой перерисовке. Сменится хеш — подхватим новый.
 */
function detectScopeAttr(table: HTMLElement): string | null {
  // Читаем ТОЛЬКО с узлов того же рода, что создаём сами: со строки сайта и
  // её ячейки. Контейнер спрашивать нельзя — на живой странице
  // `.game-stats-table` несёт scope РОДИТЕЛЬСКОГО компонента
  // (data-v-bb241ecc против data-v-1db9d42a у строк, сверено 07.08.2026), а
  // под ним правил `.table .row .cell{flex:1}` нет: проставив чужой хеш, мы
  // получили бы тот же развал вёрстки, но уже молча. Нет scope у строк —
  // значит scoped-правил нет ни у кого, и раскладку берёт наш фолбэк-CSS.
  const probes = [
    table.querySelector<HTMLElement>(`${SITE.statsRow} ${SITE.statsCellTitle}`),
    table.querySelector<HTMLElement>(SITE.statsRow),
  ];
  for (const el of probes) {
    if (!el) continue;
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-v-")) return attr.name;
    }
  }
  return null;
}

/** Проставить нашей строке/ячейке scope сайта (если он вообще есть). */
function applyScope(el: HTMLElement, scopeAttr: string | null): void {
  if (scopeAttr) el.setAttribute(scopeAttr, "");
}

/** Ключ hints остаётся прежним: он уже записан в настройках пользователей. */
const VIEW_LABELS = {
  hints: "Полный вид",
  phase_hints: "С подсказками",
  legend: "Только сводка",
  classic: "Как в старой версии",
} as const;

function viewMode(): keyof typeof VIEW_LABELS {
  const view = settings?.match_stats_view;
  return view === "phase_hints" || view === "legend" || view === "classic" ? view : "hints";
}

function mountViewPicker(matchId: string): void {
  const header = document.querySelector<HTMLElement>(SITE.statsHeader);
  if (!header) return;
  if (!viewPicker) {
    const label = document.createElement("label");
    label.className = "pn-match-view-picker";
    label.textContent = "Вид разбора";
    const select = document.createElement("select");
    select.title = "Запомнить вид для следующих матчей";
    for (const [value, text] of Object.entries(VIEW_LABELS)) select.add(new Option(text, value));
    select.value = viewMode();
    let lastWrite = 0;
    select.onchange = async (event) => {
      if (!event.isTrusted || getMatchId() !== matchId || viewPicker?.select !== select) return;
      const value = select.value;
      if (!Object.hasOwn(VIEW_LABELS, value)) return;
      const write = ++lastWrite;
      try {
        // Та же подписка на storage, что и у попапа, перерисует этот и другие матчи.
        await setSettings({ match_stats_view: value });
      } catch (e) {
        log.warn(SCOPE, "не удалось сохранить вид разбора", e);
        if (write !== lastWrite || viewPicker?.select !== select || getMatchId() !== matchId) return;
        select.value = viewMode();
        showToast("Не удалось сохранить вид разбора", { kind: "warn" });
      }
    };
    label.append(select);
    viewPicker = { label, select };
  }
  if (viewPicker.label.parentElement !== header.parentElement) header.before(viewPicker.label);
}

function statsEnabled(): boolean {
  return !(
    settings?.statistics_enabled === false || settings?.match_page_stats_enabled === false
  );
}

function clearPreviousRouteSnapshot(): void {
  previousRouteTable = null;
  previousRouteTableHtml = "";
  previousRouteMatchId = null;
}

function isRouteDomReady(): boolean {
  const header = document.querySelector<HTMLElement>(SITE.statsHeader);
  const table = document.querySelector<HTMLElement>(SITE.statsTable);
  if (!header || !table) return false;
  return !(
    table === previousRouteTable?.deref() && table.innerHTML === previousRouteTableHtml
  );
}

// ───────────────────────── построение таблицы ─────────────────────────

function enhance(gameData: any): void {
  // Идемпотентность + защита от SPA-гонки: повторное событие или ожидание
  // таблицы, пережившее переход на другой матч, раньше давало дубликаты строк
  // и вставку данных ЧУЖОГО матча в свежеоткрытую таблицу.
  const matchIdAtStart = getMatchId();
  if (!statsEnabled() || !gameData?.data || !matchIdAtStart || activeMatchId !== matchIdAtStart) return;
  // Данные должны принадлежать ЭТОЙ странице: кэш getLastGameData при
  // перевключении тумблера после SPA-перехода приносил матч A на страницу B.
  if (gameData?.id && String(gameData.id) !== matchIdAtStart) {
    log.debug(SCOPE, "cached data is for another match, skip", gameData.id, matchIdAtStart);
    return;
  }
  latestGameData = gameData;
  if (!isRouteDomReady()) {
    pendingGameData = gameData;
    return;
  }
  pendingGameData = null;
  clearPreviousRouteSnapshot();
  removeEnhancements();
  const generation = ++renderGeneration;
  const current = (): boolean =>
    renderGeneration === generation && activeMatchId === matchIdAtStart &&
    getMatchId() === matchIdAtStart && statsEnabled();

  const header = document.querySelector<HTMLElement>(SITE.statsHeader);
  if (viewMode() === "hints") {
    restoreHeader();
  } else if (header) {
    const gameId = gameData.id || "";
    if (header !== originalHeaderElement) restoreHeader();
    if (originalHeaderHtml === null) {
      originalHeaderHtml = header.innerHTML;
      originalHeaderElement = header;
      originalHeaderStyle = header.getAttribute("style");
      // data-pn-stats — НАШ маркер для нашей же CSS. Исторически здесь были
      // Vue-scope-ID сайта (data-v-33ae8458/1db9d42a), но сайт давно на
      // другом scope: селекторы и так матчили только проштампованные нами
      // узлы, а имена врали о происхождении (аудит хрупкости 06.08.2026).
      originalHeaderHadScopeAttr = header.hasAttribute("data-pn-stats");
    }

    const { color: winnerColor, text: winnerText } = winnerBadge(gameData.winnerCode);

    header.style.cssText = `
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 16px 24px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    `;

    header.innerHTML = `
      <span class="header-info" style="font-size: 24px; color: #0ea5e9;">Статистика игры (ID${escapeHtml(
        String(gameId),
      )})</span>
      <span class="header-info text-right" style="font-size: 24px; color: ${winnerColor}; font-weight: 500;">${escapeHtml(
        winnerText,
      )}</span>
    `;

    header.setAttribute("data-pn-stats", "");
  }

  log.debug(SCOPE, "Starting page enhancement");
  // Ждём появления таблицы.
  // Гасим ожидание от предыдущего enhance(), иначе оба дорисуют фазы.
  if (tableCheckInterval !== null) clearTrackedInterval(tableCheckInterval);
  const stopTableCheck = (): void => {
    clearTrackedInterval(checkTable);
    if (tableCheckInterval === checkTable) tableCheckInterval = null;
  };
  const tryRender = (): void => {
    // SPA-переход на другой матч — данные этого больше не актуальны.
    if (!current()) {
      stopTableCheck();
      return;
    }
    const table = document.querySelector<HTMLElement>(SITE.statsTable);
    if (!table) return;
    stopTableCheck();
    const view = viewMode();
    const moves = collectBestMoves(gameData);
    if (view === "hints") {
      const review = buildMatchReview(gameData.data, moves, gameData.players);
      // Если сайт вернул только обёртку, не заменяем рабочую разметку пустой.
      if (!review.players.length) return;
      const anchor = table.closest<HTMLElement>(SITE.statsTableRoot) ?? table;
      appendStyle(
        `[${REPLACED_BY_REVIEW}] { display: none !important; }
         html[data-pn-hide-rating] .pn-match-review { --pn-mr-rating-display: none; }`,
        "pn-match-review-bridge",
      );
      fullReviewState ??= createMatchReviewState();
      fullReview = createMatchReview(review, fullReviewState, {
        id: matchIdAtStart, winner: winnerBadge(gameData.winnerCode).text, mafiaWon: gameData.winnerCode === 1,
        judge: typeof gameData.judge?.username === "string" ? gameData.judge.username : undefined,
        allDays: settings?.match_review_all_days === true,
        saveAllDays: (next) => {
          if (!settings || settings.match_review_all_days === next) return;
          settings = { ...settings, match_review_all_days: next };
          void setSettings({ match_review_all_days: next }).catch((e) => {
            log.warn(SCOPE, "не удалось сохранить режим всех дней", e);
            if (activeMatchId === matchIdAtStart && settings?.match_review_all_days === next)
              showToast("Не удалось запомнить выбор дней для следующих матчей", { kind: "warn" });
          });
        },
      });
      fullReviewTable = table;
      fullReviewAnchor = anchor;
      anchor.before(fullReview.root);
      anchor.setAttribute(REPLACED_BY_REVIEW, "");
      replaceNativeHeader();
      return;
    }
    enhanceTable(table, gameData, view);
    trackTimeout(() => {
      if (!current() || !table.isConnected) return;
      addBestMoveIndicators(table, moves);
      addPenaltyIndicators(table, gameData);
      addShotIcons(table, gameData);
    }, 100);
  };
  const checkTable = trackInterval(setInterval(tryRender, 500));
  tableCheckInterval = checkTable;

  // На дедлайне пробуем ещё раз: наблюдатель мог уже обработать появление
  // таблицы с пустым pendingGameData, а очередной тик таймера задержаться.
  trackTimeout(() => {
    if (tableCheckInterval !== checkTable) return;
    tryRender();
    if (tableCheckInterval !== checkTable) return;
    pendingGameData = gameData;
    stopTableCheck();
  }, 10000);
}

/** Класс нашей ссылки на профиль — по нему же идёт идемпотентность и уборка. */
const PROFILE_LINK_CLASS = "pn-profile-link";

/**
 * Ники игроков в таблице разбора → ссылки на их профили.
 *
 * Просьба владельца 09.08.2026: со страницы разбора некуда перейти к игроку,
 * а именно там чаще всего и хочется — «кто это вообще был».
 *
 * id берём из данных матча (`data.players[].player`), а не из разметки:
 * позиция и ник в ячейке могут повторяться, id — нет. Привязка сначала по
 * позиции (`data-player` у ячейки), и только потом по тексту: у ника нет
 * гарантии уникальности внутри таблицы, а позиция уникальна всегда.
 *
 * Запись строго идемпотентна (§4 п.1): своя же ссылка второй раз не
 * переписывается, иначе подписчик onDomChange будил бы сам себя.
 */
function linkPlayerNames(table: HTMLElement, players: any[]): void {
  const byPosition = new Map<string, { id: number; name: string }>();
  const byName = new Map<string, { id: number; name: string }>();
  for (const p of players) {
    const id = typeof p?.player === "number" ? p.player : Number(p?.player);
    const name = typeof p?.username === "string" ? p.username.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !name) continue;
    const entry = { id, name };
    if (p.position !== undefined) byPosition.set(String(p.position), entry);
    byName.set(name, entry);
  }
  if (byPosition.size === 0 && byName.size === 0) return;

  table.querySelectorAll<HTMLElement>(SITE.statsUsernameCell).forEach((cell) => {
    const existing = cell.querySelector<HTMLAnchorElement>(`.${PROFILE_LINK_CLASS}`);
    const shown = (existing ?? cell).textContent?.trim() ?? "";
    const entry = byPosition.get(cell.dataset.player ?? "") ?? byName.get(shown);
    if (!entry) return;
    const href = `/profile/${entry.id}`;
    if (existing) {
      if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
      return;
    }
    const link = document.createElement("a");
    link.className = PROFILE_LINK_CLASS;
    link.setAttribute("href", href);
    // Новая вкладка: разбор матча открыт не для того, чтобы его потерять.
    link.target = "_blank";
    link.rel = "noopener";
    link.title = "Открыть профиль игрока";
    // ПЕРЕНОСИМ содержимое, а не переписываем текстом: в ячейке рядом с ником
    // могут стоять значки сайта (подписка, prime, twitch), и `textContent = ""`
    // снёс бы их молча. Заодно кликабельной становится вся ячейка.
    while (cell.firstChild) link.appendChild(cell.firstChild);
    if (!link.textContent?.trim()) link.textContent = entry.name;
    cell.appendChild(link);
  });
}

/** Снять наши ссылки, вернув ячейкам обычный текст. */
function unlinkPlayerNames(root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>(`.${PROFILE_LINK_CLASS}`).forEach((link) => {
    // Возвращаем ИМЕННО то, что забрали (включая значки сайта), а не текст.
    link.replaceWith(...Array.from(link.childNodes));
  });
}

function replaceNativeHeader(): void {
  const header = document.querySelector<HTMLElement>(SITE.statsHeader);
  if (header === fullReviewHeader) return;
  fullReviewHeader?.removeAttribute(REPLACED_BY_REVIEW);
  fullReviewHeader = header;
  header?.setAttribute(REPLACED_BY_REVIEW, "");
}

function removeEnhancements(): void {
  fullReview?.dispose();
  fullReview = null;
  fullReviewTable = null;
  fullReviewAnchor?.removeAttribute(REPLACED_BY_REVIEW);
  fullReviewAnchor = null;
  fullReviewHeader?.removeAttribute(REPLACED_BY_REVIEW);
  fullReviewHeader = null;
  document
    .querySelectorAll(
      `${SITE.statsRowPhase}, ${SITE.bestMoveDot}, ${SITE.penaltyDots}, .pn-timeline, .pn-shot-icon`,
    )
    .forEach((element) => element.remove());
}

/** Вернуть заголовок сайта как был (мы его переписываем через innerHTML). */
function restoreHeader(): void {
  if (originalHeaderHtml === null) return;
  const header = originalHeaderElement;
  if (header) {
    header.innerHTML = originalHeaderHtml;
    if (originalHeaderStyle === null) header.removeAttribute("style");
    else header.setAttribute("style", originalHeaderStyle);
    if (!originalHeaderHadScopeAttr) header.removeAttribute("data-pn-stats");
  }
  originalHeaderHtml = null;
  originalHeaderElement = null;
  originalHeaderStyle = null;
  originalHeaderHadScopeAttr = false;
}

function restoreInlineStyles(): void {
  for (const [element, style] of originalInlineStyles) {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }
  originalInlineStyles.clear();
}

/**
 * ЕДИНАЯ палитра ролей (канон 8.1.30, согласована с владельцем):
 * мирный красный, шериф жёлтый, мафия светло-серая, дон фиолетовый.
 * До этого в проекте жили ЧЕТЫРЕ разные палитры — один и тот же игрок был
 * белым в голосах, синим в тултипе и серым в метках.
 */
export const ROLE_COLORS: Record<number, string> = {
  0: "#c084fc", // дон
  1: "#d1d5db", // мафия
  2: "#f87171", // мирный
  3: "#facc15", // шериф
};

function voterStyleFor(role: number): string {
  return `color: ${ROLE_COLORS[role] ?? ROLE_COLORS[2]};`;
}

function voterClassFor(role: number): string {
  let cls = "voter";
  if (role === 0) cls += " don-vote";
  if (role === 1) cls += " mafia-vote";
  if (role === 3) cls += " sheriff-vote";
  return cls;
}

function renderVotesBlock(
  voteList: any[],
  players: any[],
  extraStyle = "",
  tip = "",
  tourLabel = "",
  tourTitle = "",
): string {
  const spans = voteList
    .map((v) => {
      const voter = players.find((p) => p.position === v.from);
      const role = voter ? voter.role : -1;
      return `<span class="${voterClassFor(role)}" style="${voterStyleFor(
        role,
      )}">${escapeHtml(String(v.from))}</span>`;
    })
    .join("");
  const tipAttr = tip ? ` data-tip="${escapeHtml(tip)}"` : "";
  // Видимая подпись тура: три безымянных ряда чипов было невозможно прочитать
  // («почему у игрока 1 три группы цифр?»).
  const label = tourLabel
    ? `<span class="pn-tour-label" title="${escapeHtml(tourTitle || tourLabel)}">${escapeHtml(tourLabel)}</span>`
    : "";
  return `<div class="action"${extraStyle ? ` style="${extraStyle}"` : ""}${tipAttr}>${label}${spans}</div>`;
}

/**
 * Исход дня по финальному туру голосования.
 *
 * `departed` — массив, а НЕ один игрок: при ничьей в туре подъёма стол
 * покидают ВСЕ ничейные кандидаты сразу («попил»). Проверено на реальном
 * матче polemicagame.com/match/598995, день 4: шесть живых (чётный стол),
 * num 1 → 5:[1,4,10] против 4:[3,5,6] — ничья 3:3; num 2 повторил её один
 * в один — ушли и №4, и №5. Одноместная сигнатура такой день выразить не
 * могла и не давала точку ЛХ никому из ушедших.
 *
 * Ничья в туре голосования (num 1), не перешедшая в подъём, ухода не даёт.
 *
 * Ничья в подъёме решается БЮЛЛЕТЕНЕМ «поднимаем всех?» — это записи БЕЗ
 * поля num, `candidate: 1` = «за» (семантика подтверждена владельцем на
 * docs/fixtures/match_598995.json: день 4, «за» все 6 живых → ушли №4 и №5).
 * Если голосов «за» СТРОГО больше, чем «против», попил состоялся — уходят
 * все ничейные кандидаты. Правило равенства подтверждено владельцем:
 * «если нет или поровну — начинается ночь и все остаются за столом».
 * Остаточное допущение: у матчей БЕЗ записей бюллетеня (старый формат?)
 * ничья в подъёме по-прежнему трактуется как уход — маркер «против» пока
 * не встречался в данных (ожидаемо `candidate: 0`).
 */

function enhanceTable(table: HTMLElement, gameData: any, view: "phase_hints" | "legend" | "classic"): void {
  const classic = view === "classic";
  const gameDetails = gameData.data || {};
  const players = gameDetails.players || [];
  const phases = processGamePhases(gameDetails);
  linkPlayerNames(table, players);

  const rows = Array.from(table.querySelectorAll<HTMLElement>(SITE.statsRow));
  const roleRow = rows.find(
    (row) => row.querySelector(SITE.statsCellTitle)?.textContent?.trim() === "Роль",
  );

  if (!roleRow) {
    log.debug(SCOPE, "Role row not found");
    return;
  }

  // Один раз на перерисовку: сам DOM таблицы посреди неё не меняется.
  const scopeAttr = detectScopeAttr(table);
  if (!scopeAttr) {
    // Не «тихо продолжаем»: без scope раскладку держит только наш фолбэк-CSS,
    // и знать об этом надо ДО того, как придёт скриншот с развалившейся
    // таблицей (жалоба 07.08.2026).
    log.warn(SCOPE, "у таблицы нет Vue-scope сайта — раскладка строк идёт по нашему CSS");
  }

  let lastInsertedRow: HTMLElement = roleRow;
  phases.forEach((phase, index) => {
    const phaseNumber = index + 1;
    // Бюллетень подъёма рисуется в ячейках УШЕДШИХ попилом (departed > 1 —
    // значит резолвер подтвердил исход по бюллетеню). Провалившийся подъём
    // блока не получает: подпись «попил» над днём, где никто не ушёл, врала
    // бы; сводка в этом случае честно пишет «ничья».
    const outcome = resolveDayOutcome(gameDetails.votes || [], phaseNumber);
    const liftTargets = outcome.departed.length > 1 ? outcome.departed : [];

    // Строка дня.
    const dayRow = document.createElement("div");
    dayRow.className = "row";
    dayRow.setAttribute("data-pn-stats", "");
    applyScope(dayRow, scopeAttr);
    dayRow.setAttribute("data-phase", `day-${phaseNumber}`);

    const dayTitleCell = document.createElement("div");
    dayTitleCell.className = "cell title role";
    applyScope(dayTitleCell, scopeAttr);
    dayTitleCell.innerHTML = `<span class="phase-title">${phaseNumber} ☀️</span>`;
    dayRow.appendChild(dayTitleCell);

    players.forEach((player: any) => {
      const cell = document.createElement("div");
      cell.className = "cell player role";
      applyScope(cell, scopeAttr);
      cell.setAttribute("data-player", String(player.position));

      // Бюллетень подъёма (записи без num, candidate 1 = «за») — НЕ голос за
      // игрока: его candidate это «да/нет», а не позиция. Без фильтра шесть
      // голосов «за подъём» рисовались ложными «Выс» в ячейке игрока №1
      // (реальный кейс: docs/fixtures/match_598995.json, день 4).
      const votes = phase.day.filter((a: any) => a.to === player.position && !a.lift);
      // Classic, как прежде, не показывает выставления и подписи, но реальные
      // туры голосования больше не ограничены двумя (match/673463).
      const rounds = new Map<number, any[]>();
      for (const v of votes) {
        if (!Number.isSafeInteger(v.num) || v.num < (classic ? 1 : 0)) continue;
        if (!rounds.has(v.num)) rounds.set(v.num, []);
        rounds.get(v.num)!.push(v);
      }
      // Бюллетень рисуем в ячейках ничейных кандидатов финального тура (по
      // просьбе владельца: «должно быть в игроках 4 и 5, а не у №1»). Не в
      // classic: legacy его не знал и не рисовал.
      const liftBallot =
        !classic && liftTargets.includes(player.position)
          ? phase.day.filter((a: any) => a.lift && a.to === 1)
          : [];

      let html = "";
      for (const [num, round] of [...rounds].sort(([a], [b]) => a - b)) {
        const title = voteRoundName(num);
        html += renderVotesBlock(
          round,
          players,
          html ? "margin-top: 4px;" : "",
          `${title}${num === 0 ? "" : " за"} №${player.position}`,
          classic ? "" : num === 0 ? "Выс" : num === 1 ? "Гол" : `Перег. ${num - 1}`,
          title,
        );
      }
      if (liftBallot.length > 0) {
        html += renderVotesBlock(
          liftBallot,
          players,
          "margin-top: 4px;",
          "Кто голосовал за подъём всех",
          "подъём",
          "Голосование за подъём всех: чипы — кто «за»",
        );
      }

      // min-width НЕ трогаем: у ячеек сайта он 115px, и inline-ноль позволял
      // нашей ячейке сжиматься сильнее соседних — на узком экране колонки
      // разъезжались с шапкой (найдено при разборе жалобы 07.08.2026).
      cell.style.cssText = `
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 4px;
      `;
      cell.innerHTML = html;
      dayRow.appendChild(cell);
    });

    lastInsertedRow.insertAdjacentElement("afterend", dayRow);
    lastInsertedRow = dayRow;

    if (phase.night.length > 0) {
      const nightRow = createNightRow(phaseNumber, phase, players, scopeAttr);
      lastInsertedRow.insertAdjacentElement("afterend", nightRow);
      lastInsertedRow = nightRow;
    }
  });

  // Таймлайн со сворачиванием: детальные строки фаз спрятаны, над таблицей —
  // компактная строка на каждый день (итог голосования + ночь + штрафы);
  // клик по строке раскрывает подробности. Таблица вдвое короче.
  if (!classic) buildPhaseTimeline(table, players, phases, gameDetails, view === "legend");
}

/**
 * Значок «пистолет» у чёрных в разборе: вся ночная стрельба игрока и
 * промахи с виновными (просьба владельца 31.08.2026). Контент — в title:
 * тултип-фича вынесет его в body, как у «лучшего хода». Правило вины — в
 * mafia-shots.ts (уведший от большинства; при ничьей виновны все).
 */
const SHOT_ICON_CLASS = "pn-shot-icon";

export function addShotIcons(table: HTMLElement, gameData: any): void {
  const players = gameData?.data?.players;
  if (!Array.isArray(players)) return;
  const nights = analyzeMafiaShots(gameData.data);
  if (nights.length === 0) return;
  // Чёрные: 0 — дон, 1 — мафия (кодировка разбора, как в findShotNight).
  const mafiaByPos = new Set(
    players
      .filter((p: any) => p?.role === 0 || p?.role === 1)
      .map((p: any) => p.position)
      .filter((n: unknown) => Number.isSafeInteger(n)),
  );
  const posByName = new Map<string, number>();
  const dupNames = new Set<string>();
  for (const p of players) {
    if (typeof p?.username === "string" && Number.isSafeInteger(p?.position)) {
      const name = p.username.trim();
      if (posByName.has(name)) dupNames.add(name); // тёзки: ник не однозначен
      posByName.set(name, p.position);
    }
  }
  // Коллизия ников (adversarial 03.09.2026, Н5): last-wins вешал ЧУЖУЮ
  // стрельбу на обе ячейки — тёзки резолвятся только индексом колонки.
  for (const name of dupNames) posByName.delete(name);

  // Таблица разбора ТРАНСПОНИРОВАНА: колонки — игроки, data-атрибутов с
  // позицией в разметке НЕТ (сверено на живом /match/627785, 31.08.2026:
  // первая версия искала [data-player] и не находила ничего). Привязка —
  // по нику (как у ссылок профиля), фолбэк — индекс колонки: строка «Ник»
  // идёт в том же порядке, что строка «№» 1..10.
  const cells = table.querySelectorAll<HTMLElement>(
    `${SITE.statsUsernameCell}:not(${SITE.statsCellTitle})`,
  );
  cells.forEach((cell, idx) => {
    const shown =
      (cell.querySelector<HTMLElement>(`.${PROFILE_LINK_CLASS}`) ?? cell).textContent?.trim() ??
      "";
    const position = posByName.get(shown) ?? idx + 1;
    if (!mafiaByPos.has(position)) return;
    // Идемпотентно: пересборки таблицы зовут нас повторно.
    if (cell.querySelector(`.${SHOT_ICON_CLASS}`)) return;
    const icon = document.createElement("span");
    icon.className = SHOT_ICON_CLASS;
    icon.title = shotIconTitle(position, nights);
    icon.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3 8h17v4h-3l-1.5 6h-4l1.2-5H9.5L8.5 16H4.5L6 12H3V8z" fill="currentColor"/>' +
      '<rect x="19" y="7" width="2.4" height="2.2" fill="currentColor"/></svg>';
    // Ссылка на профиль могла уже поглотить содержимое ячейки — значок
    // кладём В ссылку, если она есть, чтобы не разъезжалась вёрстка.
    (cell.querySelector(`.${PROFILE_LINK_CLASS}`) ?? cell).appendChild(icon);
  });
  addShotIconStyles();
}

function addShotIconStyles(): void {
  appendStyle(
    `
    .pn-shot-icon {
      display: inline-flex;
      margin-left: 4px;
      vertical-align: middle;
      color: #b45959;
      cursor: help;
    }
    .pn-shot-icon:hover { color: #e07070; }
  `,
    "pn-shot-icon-style",
  );
}

function buildPhaseTimeline(
  table: HTMLElement,
  players: any[],
  phases: Array<{ day: any[]; night: any[] }>,
  gameDetails: any,
  compact: boolean,
): void {
  const detailRowsByPhase = new Map<number, HTMLElement[]>();
  table.querySelectorAll<HTMLElement>(".row[data-phase]").forEach((row) => {
    const m = row.getAttribute("data-phase")?.match(/^(?:day|night)-(\d+)$/);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (!detailRowsByPhase.has(n)) detailRowsByPhase.set(n, []);
    detailRowsByPhase.get(n)!.push(row);
    if (compact) row.style.display = "none";
    row.classList.add("pn-phase-detail");
  });
  if (detailRowsByPhase.size === 0) return;

  const roleOf = (pos: number): number =>
    players.find((p: any) => p.position === pos)?.role ?? 2;
  const chip = (pos: number, extra = ""): string =>
    `<span class="pn-tl-chip" style="${voterStyleFor(roleOf(pos))}">${escapeHtml(String(pos))}${extra}</span>`;

  const timeline = document.createElement("div");
  timeline.className = "pn-timeline";

  const tlHeader = document.createElement("div");
  tlHeader.className = "pn-tl-header";
  tlHeader.innerHTML = `<span class="pn-tl-toggle">${compact ? "▾" : "▸"}</span> Сводка по дням`;
  const tlBody = document.createElement("div");
  tlBody.className = "pn-tl-body";
  if (!compact) tlBody.style.display = "none";
  tlHeader.addEventListener("click", () => {
    const show = tlBody.style.display === "none";
    tlBody.style.display = show ? "" : "none";
    const t = tlHeader.querySelector(".pn-tl-toggle");
    if (t) t.textContent = show ? "▾" : "▸";
  });
  timeline.append(tlHeader, tlBody);

  phases.forEach((phase, index) => {
    const n = index + 1;
    // Итог дня: финальный тур и голоса по кандидатам считаются общим resolver'ом.
    const { finalNum, counts: sorted, tied, departed } = resolveDayOutcome(
      gameDetails.votes || [],
      n,
    );
    const tourName = finalNum === 0 ? "" : finalNum === 1 ? " (голос.)" : ` (перегол. ${finalNum - 1})`;
    // Гард по finalNum, а не по номеру дня: день из одних выставлений — это не
    // ничья (голосования не было), а настоящая ничья в первом дне существует,
    // если у стола включён zeroVoting. Прежний `n > 1` врал в обе стороны.
    const isTie = finalNum > 0 && tied;
    // При ничьей в подъёме игроки реально уходят — «ничья» тут ввела бы в
    // заблуждение («никто не ушёл»), хотя стол покинули двое-четверо.
    const tieNote =
      departed.length > 1
        ? `<span class="pn-tl-none"> · подъём: ${escapeHtml(
            [...departed].sort((a, b) => a - b).join(", "),
          )}</span>`
        : isTie
          ? '<span class="pn-tl-none"> · ничья</span>'
          : "";
    const dayHtml = sorted.length
      ? sorted.map(([pos, cnt]) => chip(pos, `<i>·${cnt}</i>`)).join("") +
        escapeHtml(tourName) +
        tieNote
      : '<span class="pn-tl-none">без голосования</span>';

    const nightHtml = phase.night
      .map(
        (a: any) =>
          `<span class="pn-tl-night">${getActionIcon(a.type)}${chip(a.to)}</span>`,
      )
      .join("");

    // Штрафы этой фазы (день ИЛИ ночь) — видны даже при свёрнутых деталях.
    // Дедуп — страховка по образцу penaltyKey у точек (в референс-JSON
    // penalty лежит один раз, в массиве инициатора; дублей там НЕТ, но
    // точки исторически защищаются от них — держим паритет).
    const seenPens = new Set<string>();
    const penaltyHtml = players
      .flatMap((p: any) => p.penalties || [])
      .filter((pen: any) => {
        if (pen?.stage?.day !== n && pen?.stage?.night !== n) return false;
        const key = `${pen.type}|${pen.initiator}|${pen.player}|${pen.stage?.day ?? ""}|${pen.stage?.night ?? ""}`;
        if (seenPens.has(key)) return false;
        seenPens.add(key);
        return true;
      })
      .map((pen: any) => `<span class="pn-tl-pen">⚠${escapeHtml(String(pen.player))}</span>`)
      .join("");

    const line = document.createElement("div");
    line.className = "pn-tl-line";
    line.innerHTML =
      `<span class="pn-tl-toggle">${compact ? "▸" : "▾"}</span>` +
      `<span class="pn-tl-phase">${n} ☀️</span><span class="pn-tl-group">${dayHtml}</span>` +
      (nightHtml ? `<span class="pn-tl-phase">🌙</span><span class="pn-tl-group">${nightHtml}</span>` : "") +
      penaltyHtml;

    line.addEventListener("click", () => {
      const rows = detailRowsByPhase.get(n) || [];
      const show = rows[0]?.style.display === "none";
      rows.forEach((r) => (r.style.display = show ? "" : "none"));
      const t = line.querySelector(".pn-tl-toggle");
      if (t) t.textContent = show ? "▾" : "▸";
    });

    tlBody.appendChild(line);
  });

  const root = table.closest<HTMLElement>(SITE.statsTableRoot) || table;
  root.parentElement?.insertBefore(timeline, root);

  appendStyle(
    `
    .pn-timeline { display: flex; flex-direction: column; gap: 4px; margin: 0 0 12px;
      padding: 10px 14px; background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
    .pn-tl-header { display: flex; align-items: center; gap: 6px; cursor: pointer;
      color: #8b90a0; font-size: 12px; padding: 2px 4px; border-radius: 6px; }
    .pn-tl-header:hover { background: rgba(255,255,255,.05); }
    .pn-tl-body { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .pn-tl-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      cursor: pointer; padding: 3px 4px; border-radius: 6px; font-size: 13px; }
    .pn-tl-line:hover { background: rgba(255,255,255,.05); }
    .pn-tl-toggle { color: #8b90a0; width: 12px; }
    .pn-tl-phase { color: #8b90a0; font-size: 12px; }
    .pn-tl-group { display: inline-flex; gap: 5px; align-items: center; flex-wrap: wrap; }
    .pn-tl-chip { background: rgba(255,255,255,.07); border-radius: 5px;
      padding: 1px 7px; font-size: 12px; }
    .pn-tl-chip i { font-style: normal; color: #8b90a0; font-size: 11px; }
    .pn-tl-night { display: inline-flex; align-items: center; gap: 2px; }
    .pn-tl-none { color: #5b6070; font-size: 12px; }
    .pn-tl-pen { color: #fbbf24; font-size: 12px; margin-left: 4px; }
    .pn-tour-label { color: rgba(255,255,255,.45); font-size: 10px;
      margin-right: 4px; align-self: center; }
  `,
    "pn-timeline-styles",
  );
}

function createNightRow(
  phaseNumber: number,
  phase: any,
  players: any[],
  scopeAttr: string | null,
): HTMLElement {
  const nightRow = document.createElement("div");
  nightRow.className = "row";
  nightRow.setAttribute("data-pn-stats", "");
  applyScope(nightRow, scopeAttr);
  nightRow.setAttribute("data-phase", `night-${phaseNumber}`);

  const nightTitleCell = document.createElement("div");
  nightTitleCell.className = "cell title";
  applyScope(nightTitleCell, scopeAttr);
  nightTitleCell.innerHTML = `<span class="phase-title">${phaseNumber} 🌙</span>`;
  nightRow.appendChild(nightTitleCell);

  players.forEach((player) => {
    const cell = document.createElement("div");
    cell.className = "cell player";
    applyScope(cell, scopeAttr);
    cell.setAttribute("data-player", String(player.position));

    const actions = phase.night.filter((a: any) => a.from === player.position);
    cell.innerHTML = actions
      .map((action: any) => {
        const icon = getActionIcon(action.type);
        return `<div class="action ${escapeHtml(String(action.type))}" data-tip="${escapeHtml(
          actionTip(action.type, action.to),
        )}">
          ${icon} ${escapeHtml(String(action.to))}
        </div>`;
      })
      .join("");

    nightRow.appendChild(cell);
  });

  return nightRow;
}

// ───────────────────────── индикаторы «лучшего хода» ─────────────────────────

function collectBestMoves(gameData: any): ReviewBestMove[] {
  const players = gameData.data?.players || [];
  const moves: ReviewBestMove[] = [];
  players.forEach((player: any) => {
    const guess = player?.guess;
    if (!guess || !Number.isSafeInteger(player.position) || player.position <= 0) return;
    const lines: string[] = [];
    if (Array.isArray(guess.mafs) && guess.mafs.length) lines.push(`Черные: ${guess.mafs.join(" ")}`);
    if (Array.isArray(guess.civs) && guess.civs.length) lines.push(`Мирные: ${guess.civs.join(" ")}`);
    if (guess.vice !== undefined) lines.push(`Руль: ${guess.vice}`);
    if (!lines.length) return;
    const shotNight = findShotNight(player.position, gameData);
    const day = shotNight ?? findVotedDay(player.position, gameData);
    if (day !== null) moves.push({
      player: player.position, day, night: shotNight !== null, description: lines.join("\n"),
    });
  });
  return moves;
}

function addBestMoveIndicators(table: HTMLElement, moves: ReviewBestMove[]): void {
  for (const move of moves) {
    addDotToCell(table, move.player, move.night ? "night" : "day", move.day, move.description);
  }
  addBestMoveStyles();
}

function addDotToCell(
  table: HTMLElement,
  playerPosition: number,
  phaseType: "night" | "day",
  phaseNumber: number,
  description: string,
): void {
  const rows = table.querySelectorAll<HTMLElement>(SITE.statsRow);
  rows.forEach((row) => {
    // Точное совпадение по data-phase, а НЕ подстрока «N ☀️»: «11 ☀️» содержит
    // «1 ☀️», и точка дня 1 продублировалась бы в день 11. Число дней в матче
    // не фиксировано (AGENTS.md §4 п.8).
    const isTargetRow = row.getAttribute("data-phase") === `${phaseType}-${phaseNumber}`;

    if (isTargetRow) {
      const playerCell = row.querySelector<HTMLElement>(
        `.cell[data-player="${playerPosition}"]`,
      );

      if (playerCell && !playerCell.querySelector(SITE.bestMoveDot)) {
        const dot = document.createElement("div");
        dot.className = "best-move-dot";

        // Контент — в title: тултип-фича вынесет его в body с position:fixed,
        // как у штрафов. Прежний sibling-тултип (absolute внутри ячейки)
        // срезался границей строки и накрывался строками Итог/MMR.
        dot.title = `Лучший ход\n${description}`;

        playerCell.appendChild(dot);
      }
    }
  });
}

function findShotNight(playerPosition: number, gameData: any): number | null {
  const shots = gameData.data?.shots || [];
  const mafiaPlayers =
    gameData.data?.players
      .filter((p: any) => p.role === 1 || p.role === 0)
      .map((p: any) => p.position) || [];

  const shotsByNight: Record<number, Set<number>> = {};
  shots.forEach((shot: any) => {
    if (shot.victim === playerPosition) {
      if (!shotsByNight[shot.night]) {
        shotsByNight[shot.night] = new Set();
      }
      shotsByNight[shot.night].add(shot.shooter);
    }
  });

  const nights = Object.keys(shotsByNight)
    .map(Number)
    .sort((a, b) => b - a);

  for (const night of nights) {
    const shooters = shotsByNight[night];
    if (shooters.size === mafiaPlayers.length) {
      return night;
    }
  }

  if (nights.length > 0) {
    return nights[0];
  }

  return null;
}

/**
 * ВАЖНО: день ухода определяется исходом финального тура, а не выставлениями
 * num=0. День без голосования и ничья в туре голосования ушедших не дают,
 * а ничья в подъёме даёт СРАЗУ НЕСКОЛЬКИХ — поэтому проверяем вхождение в
 * массив, а не равенство (см. resolveDayOutcome).
 */
function findVotedDay(playerPosition: number, gameData: any): number | null {
  const votes = gameData.data?.votes || [];
  const days = [...new Set<number>(votes.map((vote: any) => vote.day))]
    .filter((day) => Number.isFinite(day) && day > 0)
    .sort((a, b) => a - b);
  return days.find((day) => resolveDayOutcome(votes, day).departed.includes(playerPosition)) ?? null;
}

function addBestMoveStyles(): void {
  appendStyle(
    `
    .best-move-dot {
      width: 8px;
      height: 8px;
      background-color: #3b82f6;
      border-radius: 50%;
      position: absolute;
      top: 5px;
      right: 5px;
      z-index: 10;
      transition: transform 0.2s ease;
    }
    .best-move-dot:hover { transform: scale(1.2); }
    .tooltip-content { display: flex; flex-direction: column; gap: 6px; }
    .tooltip-content::before {
      content: 'Лучший ход';
      display: block;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.7);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .tooltip-row { display: flex; justify-content: space-between; align-items: center; }
    .role-label { color: rgba(255, 255, 255, 0.7); font-size: 12px; }
    .numbers { display: flex; gap: 4px; }
    .number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 4px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 12px;
    }
    /* Единая палитра ролей (8.1.30): «Чёрные» больше не синие. */
    .mafs .number { background: rgba(209, 213, 219, 0.14); color: #d1d5db; }
    .civs .number { background: rgba(248, 113, 113, 0.14); color: #f87171; }
    .sheriff .number { background: rgba(250, 204, 21, 0.14); color: #facc15; }
    .vice .number { background: rgba(147, 51, 234, 0.2); color: #9333ea; }
    .cell { position: relative !important; }
  `,
    "pn-best-move-styles",
  );
}

// ───────────────────────── фазы / иконки ─────────────────────────


/**
 * Эмодзи вместо картинок с трёх сторонних CDN: раньше каждая страница матча
 * сливала IP пользователя vexels/icons8/flaticon, а лупа «голоса» была
 * неотличима от лупы шерифа. Заодно закрыт пункт техдолга про хотлинк.
 */
function getActionIcon(type: string): string {
  const icon =
    type === "kill"
      ? "🎯"
      : type === "check"
        ? "🔍"
        : type === "don_check"
          ? "👑"
          : type === "vote"
            ? "🗳️"
            : "•";
  return `<span style="font-size: 13px; vertical-align: middle;">${icon}</span>`;
}

function processGamePhases(gameDetails: any): Array<{ day: any[]; night: any[] }> {
  const votes = gameDetails.votes || [];
  const shots = gameDetails.shots || [];
  const checks = gameDetails.checks || [];

  const donPlayer = gameDetails.players.find((p: any) => p.role === 0)?.position;
  const sheriffPlayer = gameDetails.players.find((p: any) => p.role === 3)?.position;

  const maxDay = Math.max(
    ...votes.map((v: any) => v.day || 0),
    ...shots.map((s: any) => s.night || 0),
    ...checks.map((c: any) => c.night || 0),
  );

  const phases: Array<{ day: any[]; night: any[] }> = Array.from(
    { length: maxDay },
    () => ({ day: [], night: [] }),
  );

  // num=0 — выставление, num=1 — голосование, num>=2 — переголосования.
  votes.forEach((vote: any) => {
    if (!vote.day || vote.day <= 0 || vote.day > maxDay) return;
    phases[vote.day - 1].day.push({
      type: "vote",
      from: vote.voter,
      to: vote.candidate,
      num: vote.num,
      // Бюллетень «поднимаем всех?» (candidate 1 = «за») — не голос за №1.
      lift: isLiftBallot(vote),
    });
  });

  // Выстрелы (убийства мафии).
  shots.forEach((shot: any) => {
    if (shot.night && shot.night > 0) {
      phases[shot.night - 1].night.push({
        type: "kill",
        from: shot.shooter,
        to: shot.victim,
      });
    }
  });

  // Проверки (шериф/дон).
  checks.forEach((check: any) => {
    if (check.night && check.night > 0) {
      phases[check.night - 1].night.push({
        type: check.role === 0 ? "don_check" : "check",
        from: check.role === 0 ? donPlayer : sheriffPlayer,
        to: check.player,
      });
    }
  });

  return phases;
}

// ───────────────────────── штрафы ─────────────────────────

function addPenaltyIndicators(table: HTMLElement, gameData: any): void {
  const players = gameData.data?.players || [];

  players.forEach((player: any) => {
    if (player.penalties?.length > 0) {
      player.penalties.forEach((penalty: any) => {
        const playerPosition = penalty.player;
        const stage = penalty.stage || {};
        // Ночной штраф раньше терялся молча: искалась строка «undefined ☀️».
        const phaseLabel = stage.day
          ? `${stage.day} ☀️`
          : stage.night
            ? `${stage.night} 🌙`
            : null;
        // Ключ строки для поиска — атрибут, а не человекочитаемая подпись.
        const phaseKey = stage.day
          ? `day-${stage.day}`
          : stage.night
            ? `night-${stage.night}`
            : null;
        if (!phaseLabel || !phaseKey) return;
        const type = penalty.type;

        const initiatorName = gameData.data.players.find(
          (p: any) => p.position === parseInt(penalty.initiator, 10),
        )?.username;

        let tooltipText = "";
        const initiator = `Инициатор: ${penalty.initiator} ${initiatorName}\n`;
        const votes = Object.entries(penalty.votes)
          .map(([voter, vote]) => {
            const voterName = gameData.data.players.find(
              (p: any) => p.position === parseInt(voter, 10),
            )?.username;
            return `${voter} ${voterName}: ${vote ? "✓" : "✗"}`;
          })
          .join("\n");

        switch (type) {
          case "disqual":
            tooltipText = `Дисквалификация · ${phaseLabel}\n${initiator}${votes}`;
            break;
          case "stop":
            tooltipText = `ППК · ${phaseLabel}\n${initiator}${votes}`;
            break;
          case "tech":
            tooltipText = `Тех. фол · ${phaseLabel}\n${initiator}${votes}`;
            break;
        }

        const color =
          type === "tech"
            ? "#FFD700"
            : type === "stop"
              ? "#ef4444"
              : "rgba(239, 68, 68, 0.45)";
        const votePairs = Object.entries(penalty.votes || {})
          .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
          .map(([voter, vote]) => `${voter}:${vote ? 1 : 0}`)
          .join(",");
        const penaltyKey = `${phaseLabel}|${type}|${penalty.initiator}|${playerPosition}|${votePairs}`;
        addPenaltyDot(table, playerPosition, phaseKey, color, tooltipText, penaltyKey);
      });
    }
  });
}

function addPenaltyDot(
  table: HTMLElement,
  playerPosition: number,
  /** Ключ строки фазы вида `day-3` / `night-2` — см. addDotToCell про подстроки. */
  phaseKey: string,
  color: string,
  tooltipText: string,
  penaltyKey: string,
): void {
  const rows = table.querySelectorAll<HTMLElement>(SITE.statsRow);

  rows.forEach((row) => {
    if (row.getAttribute("data-phase") === phaseKey) {
      const playerCell = row.querySelector<HTMLElement>(
        `.cell[data-player="${playerPosition}"]`,
      );

      if (playerCell) {
        let dotContainer = playerCell.querySelector<HTMLElement>(SITE.penaltyDots);
        if (!dotContainer) {
          dotContainer = document.createElement("div");
          dotContainer.className = "penalty-dots";
          dotContainer.style.position = "absolute";
          dotContainer.style.top = "5px";
          dotContainer.style.left = "5px";
          dotContainer.style.zIndex = "10";
          dotContainer.style.display = "inline-flex";
          dotContainer.style.gap = "3px";
          if (!originalInlineStyles.has(playerCell)) {
            originalInlineStyles.set(playerCell, playerCell.getAttribute("style"));
          }
          playerCell.style.position = "relative";
          playerCell.appendChild(dotContainer);
        }

        if (
          penaltyKey &&
          dotContainer.querySelector(
            `${SITE.penaltyDot}[data-penalty-key="${CSS.escape(penaltyKey)}"]`,
          )
        ) {
          return;
        }

        const dot = document.createElement("div");
        dot.className = "penalty-dot";
        if (penaltyKey) dot.setAttribute("data-penalty-key", penaltyKey);
        dot.title = tooltipText;
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.backgroundColor = color;
        dot.style.borderRadius = "50%";
        dot.style.cursor = "pointer";
        dot.style.display = "block";

        dotContainer.appendChild(dot);
      }
    }
  });
}

// ───────────────────────── авто-высота таблицы ─────────────────────────

/**
 * Заголовок исхода матча по сырому winnerCode SSR-пейлоада.
 *
 * Живые фикстуры: 0 — победа мирных (match_610180), 1 — победа мафии
 * (match_314446). Любой ДРУГОЙ код — нейтраль, а не «мафия по умолчанию»:
 * прежняя проверка `!== 0` молча красила бы будущий код сайта в победу мафии
 * (аудит хрупкости 06.08.2026, раздел 6). ВНИМАНИЕ: room-API статистики
 * использует ДРУГУЮ шкалу с тем же именем поля (1=red, 2=black) — эти
 * форматы не смешивать.
 */
export function winnerBadge(winnerCode: unknown): { color: string; text: string } {
  if (winnerCode === 0) return { color: "#22c55e", text: "Победа мирных" };
  if (winnerCode === 1) return { color: "#ef4444", text: "Победа мафии" };
  return { color: "#94a3b8", text: "" };
}

/**
 * Семантический выбор строк «Итог» и «MMR» вместо порядкового.
 *
 * «Последние две строки таблицы» было правдой прошлого поколения разметки.
 * Сейчас .game-stats-table — ТРИ отдельных корня (header/main/footer),
 * строки MMR не существует вовсе, и порядковый выбор красил последнюю строку
 * ИГРОКА как «итог», а строку суммы — как MMR (аудит хрупкости 06.08.2026,
 * живой дрифт). Строку суммы сайт подписывает захардкоженным «Итог»
 * (бандл: code:"sum",title:"Итог" — сторожится живой пробой sumRowTitle);
 * MMR стилизуется, только если сайт снова начнёт её рисовать. Наши строки
 * фаз (data-phase) из кандидатов исключены.
 */
export function findSummaryRows(rows: HTMLElement[]): {
  totalRow: HTMLElement | null;
  mmrRow: HTMLElement | null;
} {
  const siteRows = rows.filter((row) => !row.hasAttribute("data-phase"));
  const titleOf = (row: HTMLElement) =>
    row.querySelector(SITE.statsCellTitle)?.textContent?.trim() ?? "";
  return {
    totalRow: siteRows.find((row) => titleOf(row) === "Итог") ?? null,
    mmrRow: siteRows.find((row) => titleOf(row) === "MMR") ?? null,
  };
}

// export — тестовый шов: ревью 06.08.2026 показало, что чистая
// findSummaryRows сторожится, а её ВЫЗОВ отсюда — нет: мутант-возврат к
// порядковому «последние две строки» проходил все тесты, а это ровно
// возвращение исправленного бага.
export function applyAutoHeight(): void {
  const gameStatsTable = document.querySelector<HTMLElement>(SITE.statsTableRoot);
  if (!gameStatsTable) return;

  // Ищем data-v-* атрибут и применяем height:auto к нему.
  const attributes = gameStatsTable.attributes;
  let dataVAttribute: string | null = null;
  for (let i = 0; i < attributes.length; i++) {
    if (attributes[i].name.startsWith("data-v-")) {
      dataVAttribute = attributes[i].name;
      break;
    }
  }
  if (dataVAttribute) {
    // Селектор заякорен на контейнер таблицы: голый [data-v-X] снимал height
    // у ВСЕХ элементов компонента по странице — она растягивалась целиком.
    appendStyle(
      `${SITE.statsTableRoot} [${dataVAttribute}], ${SITE.statsTableRoot}[${dataVAttribute}] { height: auto !important; }`,
      "pn-stats-auto-height",
    );
  }

  setStyleProp(gameStatsTable, "height", "auto");

  // Чиним прокручиваемых родителей — но не дальше трёх уровней вверх:
  // обход до корня документа разворачивал скролл-контейнеры всего лейаута.
  let parent = gameStatsTable.parentElement;
  let hops = 0;
  while (parent && parent !== document.body && hops < 3) {
    const computedStyle = window.getComputedStyle(parent);
    if (
      computedStyle.overflow.includes("scroll") ||
      computedStyle.overflowY === "scroll" ||
      parent.classList.contains(SITE_CLASS.vueScroll) ||
      parent.classList.contains(SITE_CLASS.vueScrollPanel) ||
      parent.classList.contains(SITE_CLASS.vueScrollView)
    ) {
      setStyleProp(parent, "height", "auto");
      setStyleProp(parent, "maxHeight", "none");
    }
    parent = parent.parentElement;
    hops++;
  }

  // Строки итога и MMR — семантически, по заголовку (см. findSummaryRows).
  const allRows = Array.from(gameStatsTable.querySelectorAll<HTMLElement>(SITE.statsRow));
  const { totalRow, mmrRow } = findSummaryRows(allRows);

  if (totalRow) {
    setStyleAttr(totalRow, "background: #1a1c29 !important; border-top: 2px solid #2c3347 !important;");
    const totalTitle = totalRow.querySelector(SITE.statsCellTitle);
    if (totalTitle) {
      setStyleAttr(totalTitle, "background: #151824 !important; font-weight: 700 !important; color: #d1d5db !important;");
    }
    totalRow.querySelectorAll<HTMLElement>(".cell:not(.title)").forEach((cell) => {
      const value = parseFloat(cell.textContent?.trim() || "") || 0;
      if (value > 0) {
        setStyleAttr(cell, "color: #10b981 !important; font-weight: 600 !important; font-size: 16px !important;");
      } else if (value < 0) {
        setStyleAttr(cell, "color: #ef4444 !important; font-weight: 600 !important; font-size: 16px !important;");
      } else {
        setStyleAttr(cell, "color: #94a3b8 !important; font-weight: 600 !important; font-size: 16px !important;");
      }
    });
  }

  if (mmrRow) {
    setStyleAttr(mmrRow, "background: #1a1c29 !important; border-bottom: 2px solid #2c3347 !important;");
    const mmrTitle = mmrRow.querySelector(SITE.statsCellTitle);
    if (mmrTitle) {
      setStyleAttr(mmrTitle, "background: #151824 !important; font-weight: 700 !important; color: #d1d5db !important;");
    }
    mmrRow.querySelectorAll<HTMLElement>(".cell:not(.title)").forEach((cell) => {
      const value = parseInt(cell.textContent?.trim() || "", 10) || 0;
      if (value > 0) {
        setStyleAttr(cell, "color: #10b981 !important; font-weight: 700 !important; font-size: 17px !important;");
      } else if (value < 0) {
        setStyleAttr(cell, "color: #ef4444 !important; font-weight: 700 !important; font-size: 17px !important;");
      } else {
        setStyleAttr(cell, "color: #94a3b8 !important; font-weight: 700 !important; font-size: 17px !important;");
      }
    });
  }
}

// ───────────────────────── базовые стили таблицы ─────────────────────────

function injectBaseStyles(): void {
  appendStyle(`
    .pn-match-view-picker { display: flex; flex-wrap: wrap; align-items: center;
      justify-content: flex-end; gap: 8px; margin: 0 0 10px; color: #cbd5e1; font-size: 14px; }
    .pn-match-view-picker select { font: inherit; color-scheme: dark; color: #f1f5f9;
      background: #1e293b; border: 1px solid #475569; border-radius: 8px; padding: 5px 8px; }
    /*
     * Страховка раскладки НАШИХ строк фаз. Первый пояс — scope сайта
     * (detectScopeAttr), под которым лежит настоящий .table .row/.cell CSS;
     * этот блок держит таблицу, если scoped-стилей у сайта не окажется
     * вовсе. Без него потеря scope превращала строку в display:block, а
     * ячейки — в блоки во всю ширину друг под другом (жалоба 07.08.2026).
     * Цифры сверены с живым CSS сайта: flex:1, min-width 115px у ячейки
     * игрока и 67px у заголовка фазы.
     */
    .table .row[data-pn-stats] { display: flex; width: 100%; }
    .table .row[data-pn-stats] > .cell {
      flex: 1; min-width: 115px; padding: 16px 10px;
      position: relative; text-align: center;
      border-right: 1px solid #252526; border-top: 1px solid #252526;
    }
    .table .row[data-pn-stats] > .cell.title {
      max-width: 67px; min-width: 67px; padding-left: 5px; padding-right: 5px;
    }
    .table .row[data-pn-stats] > .cell:last-of-type { border-right: none; }
    .game-stats-header[data-pn-stats] {
      background: rgba(45, 48, 57, .03) !important;
    }
    .table .row .cell.username[data-pn-stats],
    .table .row .cell.title[data-pn-stats],
    .table .row .cell.position[data-pn-stats] {
      background: rgba(45, 48, 57, .03) !important;
    }
    .table .row .cell.sum[data-pn-stats],
    .table .row .cell.mmr_diff[data-pn-stats] {
      background: rgba(45, 48, 57, .09) !important;
    }
    .cell.mmr_diff[data-pn-stats] { font-weight: 500; }
    .cell.mmr_diff[data-pn-stats] span { padding: 4px 8px; border-radius: 4px; }
    .cell.mmr_diff[data-pn-stats] span[style*="color: rgb(239, 68, 68)"] { background: rgba(239, 68, 68, 0.1); }
    .cell.mmr_diff[data-pn-stats] span[style*="color: rgb(34, 197, 94)"] { background: rgba(34, 197, 94, 0.1); }
    .cell.mmr_diff[data-pn-stats] span[style*="color: rgb(255, 255, 255)"] { background: rgba(255, 255, 255, 0.1); }
    .cell.sum[data-pn-stats] { font-weight: 500; }
    .cell.sum[data-pn-stats] span { padding: 4px 8px; border-radius: 4px; }
    .cell.sum[data-pn-stats] span:not([style]) { background: rgba(255, 255, 255, 0.1); color: #ffffff; }
    .cell.sum[data-pn-stats] span[style*="color: rgb(239, 68, 68)"] { background: rgba(239, 68, 68, 0.1); }
    .cell.sum[data-pn-stats] span[style*="color: rgb(34, 197, 94)"] { background: rgba(34, 197, 94, 0.1); }
    .table .row .cell.mmr_diff[data-pn-stats] > span,
    .table .row .cell.sum[data-pn-stats] > span {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      border: 1px solid;
    }
    .table .row .cell.mmr_diff[data-pn-stats] > span[style*="color: rgb(239, 68, 68)"],
    .table .row .cell.sum[data-pn-stats] > span[style*="color: rgb(239, 68, 68)"] {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .table .row .cell.mmr_diff[data-pn-stats] > span[style*="color: rgb(34, 197, 94)"],
    .table .row .cell.sum[data-pn-stats] > span[style*="color: rgb(34, 197, 94)"] {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
    }
    .table .row .cell.mmr_diff[data-pn-stats] > span[style*="color: rgb(255, 255, 255)"],
    .table .row .cell.sum[data-pn-stats] > span[style*="color: rgb(255, 255, 255)"],
    .table .row .cell.mmr_diff[data-pn-stats] > span:not([style]),
    .table .row .cell.sum[data-pn-stats] > span:not([style]) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .table .row .cell.mmr_diff[data-pn-stats] span,
    .table .row .cell.sum[data-pn-stats] span {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 45px !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      font-weight: 500 !important;
    }
    .table .row .cell.mmr_diff[data-pn-stats] span[style*="color: #ef4444"],
    .table .row .cell.sum[data-pn-stats] span[style*="color: #ef4444"] {
      background: rgba(239, 68, 68, 0.15) !important;
      border: 1px solid rgba(239, 68, 68, 0.3) !important;
    }
    .table .row .cell.mmr_diff[data-pn-stats] span[style*="color: #22c55e"],
    .table .row .cell.sum[data-pn-stats] span[style*="color: #22c55e"] {
      background: rgba(34, 197, 94, 0.15) !important;
      border: 1px solid rgba(34, 197, 94, 0.3) !important;
    }
    .table .row .cell.mmr_diff[data-pn-stats] span[style*="color: #ffffff"],
    .table .row .cell.sum[data-pn-stats] span[style*="color: #ffffff"] {
      background: rgba(255, 255, 255, 0.1) !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
    }
    [style*="overflow: scroll hidden"] { overflow: hidden !important; }
    .game-stats-table[data-pn-stats], .game-stats-table [data-pn-stats], .game-stats-header[data-pn-stats] { height: auto !important; }
    .__vuescroll { height: auto !important; }
    .__panel, .__view { height: auto !important; }
    .game-stats-table {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-collapse: collapse;
      color: var(--primary-white);
      font-family: var(--font-family);
    }
    .table .row:nth-last-child(1),
    .table .row:nth-last-child(2) {
      background: rgba(22, 23, 35, 0.98) !important;
      border-top: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15) !important;
    }
    .table .row:nth-last-child(2) .cell:not(.title) {
      font-weight: 600 !important;
      font-size: 15px !important;
      color: #ffffff !important;
      text-shadow: 0 0 5px rgba(255, 255, 255, 0.2);
    }
    .table .row:nth-last-child(1) .cell:not(.title) {
      font-weight: 700 !important;
      font-size: 16px !important;
    }
    .table .row:nth-last-child(1) .cell:not(.title):has(span[style*="color: rgb(34, 197, 94)"]),
    .table .row:nth-last-child(1) .cell:not(.title) span[style*="+"] {
      color: #22c55e !important;
      text-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
    }
    .table .row:nth-last-child(1) .cell:not(.title):has(span[style*="color: rgb(239, 68, 68)"]),
    .table .row:nth-last-child(1) .cell:not(.title) span[style*="-"] {
      color: #ef4444 !important;
      text-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
    }
    .table .row:nth-last-child(2) .cell:not(.title):has(span[style*="color: rgb(34, 197, 94)"]) {
      border-bottom: 3px solid rgba(34, 197, 94, 0.7) !important;
    }
    .table .row:nth-last-child(2) .cell:not(.title):has(span[style*="color: rgb(239, 68, 68)"]) {
      border-bottom: 3px solid rgba(239, 68, 68, 0.7) !important;
    }
    .table .row:nth-last-child(2) .cell:not(.title) { position: relative; }
    .table .row:nth-last-child(2) .cell:not(.title)::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 10%;
      width: 80%;
      height: 3px;
      background: linear-gradient(90deg,
        rgba(255, 255, 255, 0.05) 0%,
        rgba(255, 255, 255, 0.2) 50%,
        rgba(255, 255, 255, 0.05) 100%);
      border-radius: 2px;
    }
    .table .row:nth-last-child(2) .cell:not(.title):has(span[style*="color: rgb(34, 197, 94)"])::after {
      background: linear-gradient(90deg,
        rgba(34, 197, 94, 0.3) 0%,
        rgba(34, 197, 94, 0.8) 50%,
        rgba(34, 197, 94, 0.3) 100%);
    }
    .table .row:nth-last-child(2) .cell:not(.title):has(span[style*="color: rgb(239, 68, 68)"])::after {
      background: linear-gradient(90deg,
        rgba(239, 68, 68, 0.3) 0%,
        rgba(239, 68, 68, 0.8) 50%,
        rgba(239, 68, 68, 0.3) 100%);
    }
    div.cell.player::after,
    div.cell.player.sum.winner.has-calcs::after {
      display: none !important;
      content: none !important;
    }
    .table .row:nth-last-child(1) .cell.title,
    .table .row:nth-last-child(2) .cell.title {
      background: rgba(10, 10, 20, 0.8) !important;
      font-weight: 700 !important;
      color: #cbd5e1 !important;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .table .row[data-pn-stats] {
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(20, 20, 35, 0.95);
    }
    .cell {
      padding: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      min-height: 60px;
      background: transparent;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    .cell:last-child { border-right: none; }
    .cell.title {
      background: rgba(0, 0, 0, 0.3);
      font-weight: 500;
      color: #94a3b8;
      width: 67px !important;
      min-width: 67px !important;
      flex: 0 0 67px !important;
    }
    .cell.player {
      text-align: center;
      width: 115px !important;
      min-width: 115px !important;
      flex: 0 0 115px !important;
    }
    .vote {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      transition: all 0.2s;
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .vote.leading { color: #ff3b30; border-color: rgba(255, 59, 48, 0.3); }
    .action {
      font-size: 12px;
      margin: 2px 0;
      background: rgba(30, 30, 40, 0.5) !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      border-radius: 8px !important;
      padding: 2px 6px !important;
      display: inline-flex !important;
      /* wrap + max-width: «подъём» с 7-8 голосами шире колонки — без переноса
         блок вылезал за границы ячейки (влево, под колонку №). */
      flex-wrap: wrap !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 2px !important;
      min-height: auto !important;
      height: auto !important;
      margin: 2px !important;
    }
    .action:hover { background: rgba(40, 40, 50, 0.7) !important; }
    .action.kill { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
    .action.check { background: rgba(250, 204, 21, 0.14); color: #facc15; }
    .action.don_check { background: rgba(192, 132, 252, 0.16); color: #c084fc; }
    .action.vote { background: rgba(30, 30, 40, 0.5) !important; color: #ffffff; }
    .action.vote.leading .voter { background: rgba(59, 130, 246, 0.2); }
    .action.kill img {
      width: 16px;
      height: 16px;
      vertical-align: middle;
      margin-right: 2px;
      filter: brightness(1.2);
    }
    /* Единая палитра (8.1.30): эти !important-правила перебивают инлайн из
       voterStyleFor — значения обязаны совпадать с ROLE_COLORS, иначе чипы
       таймлайна и детальных строк красятся по-разному. */
    .voter { color: #f87171 !important; }
    .voter.don-vote { color: #c084fc !important; }
    .voter.mafia-vote { color: #d1d5db !important; }
    .voter.sheriff-vote { color: #facc15 !important; }
    .action span.voter {
      display: inline-block;
      margin: 0;
      padding: 0;
      background: transparent;
      font-size: 14px;
      font-weight: 500;
    }
    .cell.player.role {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .cell.player img { width: 26px; height: 26px; }
  `,
    "pn-stats-base-styles",
  );

  // Пояснения к иконкам действий на hover (выстрел/проверки/голосования).
  appendStyle(
    `
    .cell .action[data-tip] { cursor: help; position: relative; }
    .cell .action[data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%);
      max-width: 200px;
      width: max-content;
      white-space: normal;
      text-align: center;
      background: #1e1f26;
      color: #fff;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      z-index: 1000;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
    .cell .action[data-tip]:hover::before {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #1e1f26;
      z-index: 1000;
      pointer-events: none;
    }
  `,
    "pn-stats-action-tips",
  );
}

// ───────────────────────── жизненный цикл фичи ─────────────────────────

function stopMatchRoute(preserveSnapshot = true): void {
  const leavingMatchId = activeMatchId;
  const leavingTable = activeMatchId
    ? document.querySelector<HTMLElement>(SITE.statsTable)
    : null;
  if (gameDataListener) {
    document.removeEventListener("gameDataParsed", gameDataListener);
    gameDataListener = null;
  }
  if (routeDomUnsub) {
    routeDomUnsub();
    routeDomUnsub = null;
  }
  for (const id of intervals) clearInterval(id);
  intervals.clear();
  for (const id of timeouts) clearTimeout(id);
  timeouts.clear();
  for (const style of injectedStyles) style.remove();
  injectedStyles.length = 0;
  if (viewPicker) {
    viewPicker.select.onchange = null;
    viewPicker.label.remove();
    viewPicker = null;
  }
  removeEnhancements();
  // Ссылки на профили снимаем ТОЛЬКО здесь, при уходе со страницы или
  // выключении фичи. В removeEnhancements нельзя: он зовётся на каждой
  // перерисовке, и ссылки пересоздавались бы заново — та самая петля
  // «подписчик будит сам себя» (§4 п.1), которую поймал тест.
  unlinkPlayerNames();
  restoreHeader();
  restoreInlineStyles();
  pendingGameData = null;
  latestGameData = null;
  fullReviewState = null;
  if (leavingMatchId && preserveSnapshot) {
    clearPreviousRouteSnapshot();
    previousRouteMatchId = leavingMatchId;
    previousRouteTable = leavingTable ? new WeakRef(leavingTable) : null;
    previousRouteTableHtml = leavingTable?.innerHTML || "";
  } else if (!preserveSnapshot) {
    clearPreviousRouteSnapshot();
  }
  routeReadyInterval = null;
  autoHeightInterval = null;
  tableCheckInterval = null;
  activeMatchId = null;
}

function ensureAutoHeight(): void {
  applyAutoHeight();
  if (autoHeightInterval === null) {
    autoHeightInterval = trackInterval(setInterval(applyAutoHeight, 5000));
  }
}

function startMatchRoute(matchId: string): void {
  if (activeMatchId === matchId) return;
  if (activeMatchId) stopMatchRoute();
  if (previousRouteMatchId === matchId) {
    clearPreviousRouteSnapshot();
  }
  activeMatchId = matchId;
  log.debug(SCOPE, "Match page detected, initializing enhancer", matchId);

  injectBaseStyles();

  routeDomUnsub = onDomChange(() => {
    if (routeReadyInterval !== null || activeMatchId !== matchId) return;
    // URL уже мог смениться, а роутер (поллинг 500мс) ещё не среконсилил роут:
    // без этого гейта enhance() выходил по несовпадению id, НЕ очищая pending,
    // и каждый DOM-флеш окна навешивал новый setInterval(applyAutoHeight).
    if (getMatchId() !== matchId || !statsEnabled()) return;
    if (previousRouteTable === null) mountViewPicker(matchId);
    // Vue мог пересоздать секцию того же матча. Панель привязана к живой
    // таблице; если якорь исчез, восстанавливаем её один раз по тем же данным.
    if (fullReview && (!fullReview.root.isConnected || !fullReviewTable?.isConnected || !fullReviewAnchor?.isConnected)) {
      pendingGameData = latestGameData;
      removeEnhancements();
    } else if (fullReview) {
      replaceNativeHeader();
    }
    if (!pendingGameData) return;
    // SharedDomObserver уже дросселирует проходы. Дополнительный time-gate
    // терял единственную мутацию при быстрой вставке таблицы после удаления.
    if (!isRouteDomReady()) return;
    clearPreviousRouteSnapshot();
    ensureAutoHeight();
    enhance(pendingGameData);
  });

  const readyStarted = Date.now();
  routeReadyInterval = trackInterval(
    setInterval(() => {
      if (activeMatchId !== matchId) return;
      if (!isRouteDomReady()) {
        if (Date.now() - readyStarted < 10_000) return;
        clearTrackedInterval(routeReadyInterval!);
        routeReadyInterval = null;
        return;
      }
      clearTrackedInterval(routeReadyInterval!);
      routeReadyInterval = null;
      clearPreviousRouteSnapshot();
      if (getMatchId() === matchId) mountViewPicker(matchId);
      ensureAutoHeight();
      if (pendingGameData) enhance(pendingGameData);
    }, 100),
  );

  gameDataListener = (event: Event) => {
    if (!statsEnabled() || activeMatchId !== matchId) return;
    log.debug(SCOPE, "Received game data, enhancing page");
    enhance((event as CustomEvent).detail);
  };
  document.addEventListener("gameDataParsed", gameDataListener);

  const cached = getLastGameData();
  if (cached && statsEnabled()) enhance(cached);
}

/** Вызывается единым URL-роутером content/index.ts. */
export function syncMatchStatsRoute(matchId: string | null): void {
  if (!settings || !statsEnabled() || !matchId) {
    if (activeMatchId) stopMatchRoute(false);
    return;
  }
  startMatchRoute(matchId);
}

export const matchStatsFeature: Feature = {
  id: "match-stats",
  settingKey: "match_page_stats_enabled",

  enable(ctx: FeatureContext): void {
    settings = ctx.settings;
    syncMatchStatsRoute(getMatchId());
  },

  update(ctx: FeatureContext): void {
    const prevView = viewMode();
    const prevAll = settings?.match_review_all_days === true;
    settings = ctx.settings;
    if (!statsEnabled()) {
      if (activeMatchId) stopMatchRoute(false);
      return;
    }
    if (viewPicker && viewPicker.select.value !== viewMode()) viewPicker.select.value = viewMode();
    const matchId = getMatchId();
    if (!matchId || activeMatchId !== matchId) {
      syncMatchStatsRoute(matchId);
    } else if (prevView !== viewMode()) {
      const cached = latestGameData ?? getLastGameData();
      if (cached) enhance(cached);
    } else if (prevAll !== (settings.match_review_all_days === true)) {
      fullReview?.setAllDays(settings.match_review_all_days === true);
    }
  },

  disable(): void {
    stopMatchRoute(false);
    settings = null;
  },
};
