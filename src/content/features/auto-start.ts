/**
 * Фича: автостарт/автопринятие игр + игровая страница.
 * Порт auto-start.js.
 *
 * Управляется НЕСКОЛЬКИМИ настройками, поэтому settingKey: null (фича включена
 * всегда), а под-поведения включаются/выключаются индивидуально по ctx.settings:
 *
 *  • auto_accept_enabled          — автоклик кнопок «Принять/Готов/Старт» на странице поиска.
 *  • skip_start_screen_enabled    — автоклик «НАЧАТЬ ИГРУ» на приветственном экране.
 *  • disable_webcam_clicks        — запрет автокликов по кнопке веб-камеры.
 *  • auto_hide_roles_enabled      — авто-скрытие своей роли (CSS-инъекция).
 *  • role_phase_auto_switch_enabled — переключение видимости роли по фазе день/ночь.
 *
 * Хоткей D/В (event.code === "KeyD") — ручной toggle видимости роли.
 *
 * update(ctx) переприменяет настройки без выкл/вкл фичи.
 */
import { onDomChange, safeClick, isVisible, onDomChangeImmediate } from "@core/dom";
import { keyboard } from "@core/keyboard";
import { log } from "@core/log";
import { showToast } from "@core/toast";
import { isPinnedElement, liftPins, restoreLiftedPins, sweepOrphanPins } from "../role-pin";
import { isRoleFaked } from "./role-faker";
import { sweepOrphanFakeIfIdle } from "../role-fake-orphans";
import {
  nightSceneSafeForRoleShow,
  obsAutoScenesActive,
  setRoleSceneGateListener,
  type RoleSceneGateReason,
} from "../panels/obs-panel";
import { SITE, TEXT, OWN, classifyPhaseText, endedScreenVisible, staleDayLabel, SITE_CLASS } from "@core/selectors";
import { isAutoAcceptSuppressed } from "../auto-accept-gate";
import { noteAutoAcceptDispatched } from "./queue-requeue";
import type { Feature, FeatureContext } from "@core/feature";
import { gameRouteKey, isGameRoomPath } from "@shared/routes";

const SCOPE = "auto-start";

/** Текст элемента в нижнем регистре, со схлопнутыми пробелами. */
function norm(el: { textContent?: string | null } | null | undefined): string {
  return (el?.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function containsAny(text: string, markers: readonly string[]): boolean {
  return markers.some((m) => text.includes(m));
}

// ─────────────────────────── состояние под-поведений ───────────────────────────

let cfg = {
  autoAccept: true,
  skipStartScreen: true,
  disableWebcam: false,
  autoHideRoles: false,
  rolePhaseSwitch: false,
  /** Автосцены OBS включены настройками (obs-panel могла ещё не стартовать). */
  obsAutoExpected: false,
};

// Автопринятие (страница поиска)
let acceptInterval: ReturnType<typeof setInterval> | null = null;
let unsubAcceptDom: (() => void) | null = null;
let acceptScanTimer: ReturnType<typeof setTimeout> | null = null;
let webcamClickTimer: ReturnType<typeof setTimeout> | null = null;
let videoButtonClicked = false;
/** Про подавление разведкой уже сказали (состояние, а не тик). */
let acceptSuppressLogged = false;
/** Про исчерпанный бюджет кликов уже сказали. */
let budgetExhaustedLogged = false;
/** Про нераспознанное стартовое окно уже сказали. */
let welcomeUnknownLogged = false;
/** Про нераспознанную кнопку камеры уже сказали (раз на лобби). */
let webcamUnknownLogged = false;

// Игровая страница
let gameInterval: ReturnType<typeof setInterval> | null = null;
let unsubGameDom: (() => void) | null = null;
let unsubKeyboard: (() => void) | null = null;
let roleHideKey = "KeyD";
let onUserClick: ((e: Event) => void) | null = null;
let webcamDisabled = false;
/** 10 кликов не выключили камеру — до следующего лобби не пытаемся. */
let webcamGaveUp = false;
let webcamClickInterval: ReturnType<typeof setInterval> | null = null;

// Скрытие/показ роли
const roleVisibilityState = new WeakMap<
  HTMLElement,
  { visibility: string; opacity: string; pointerEvents: string }
>();
let unsubSceneGate: (() => void) | null = null;
let unsubSiteRoleKey: (() => void) | null = null;
let lastManualRoleActionAt = 0;
let initialAutoHideTimer: ReturnType<typeof setInterval> | null = null;
let initialAutoHideAttempts = 0;

// Фаза день/ночь
let rolePhaseInitialized = false;
let rolePhaseCheckTimer: ReturnType<typeof setTimeout> | null = null;
let lastDetectedRolePhase: "day" | "night" | null = null;
let pendingNightRoleShowTimer: ReturnType<typeof setTimeout> | null = null;
/** «Показ отложен: эфир не на ночной сцене» — одна строка на ночь, не 30. */
let nightShowSceneDeferredLogged = false;
let nightAutoShowStartedAt = 0;

// ─────────────────────────── автопринятие игр ───────────────────────────

/** Кликабельные кандидаты на «Принять игру» — вместо обхода всего документа. */
const ACCEPT_CANDIDATE_SELECTOR = SITE.acceptCandidates;

/**
 * Элементы с текстом «Принять игру».
 *
 * Раньше здесь был querySelectorAll("*"): textContent наследуется, поэтому под
 * фильтр попадали html, body и вся цепочка контейнеров — и все они получали
 * safeClick раз в секунду. Берём только кликабельные узлы и оставляем самые
 * глубокие совпадения.
 */
/** Панель принятия игры — вне её мы не кликаем ничего (см. ниже). */
const ACCEPT_SCOPE_SELECTOR = SITE.acceptScope;

/**
 * Кандидат НЕ лежит внутри уже принятого блока принятия.
 *
 * УЖЕ ПРИНЯТЫЙ блок — не цель, и фильтр обязан быть центральным для ВСЕХ
 * путей сбора (primary-селектор, fallback, wrapper-дети, текстовые цели):
 * cursor-pointer сайт держит ровно до принятия (бандл game-search:
 * :class="{cursor-pointer: !isGameAccepted}"), а сам блок после принятия
 * ОСТАЁТСЯ в DOM — он же показывает «Готовы: N/10». Клики по принятому не
 * делают ничего (acceptGame сам гардится isGameAccepted), но сжигали бюджет
 * за ~2 секунды и ложили терминальный warn «не дали результата» на путь
 * УСПЕХА — мина под разбор любой жалобы на автопринятие (лог 04.08.2026,
 * разбор «через раз» 05.08.2026).
 */
function notInsideAcceptedBlock(el: HTMLElement): boolean {
  const acceptRoot = el.closest<HTMLElement>(SITE.profileAccept);
  return !(acceptRoot && !acceptRoot.classList.contains(SITE_CLASS.cursorPointer));
}

function findAcceptTextElements(): HTMLElement[] {
  const matched = Array.from(
    document.querySelectorAll<HTMLElement>(ACCEPT_CANDIDATE_SELECTOR),
  ).filter(
    (el) =>
      containsAny(norm(el), TEXT.acceptGameText) &&
      // Гейт по контейнеру: текстовый фолбэк кликал любой элемент страницы с
      // подстрокой «принять игру» — сайт (или его будущая разметка) мог
      // подсунуть посторонний элемент с таким текстом (аудит безопасности
      // 01.08.2026, находка 11).
      el.closest(ACCEPT_SCOPE_SELECTOR) !== null,
  );
  return matched.filter((el) => !matched.some((other) => other !== el && el.contains(other)));
}

/**
 * Бюджет автокликов: не больше нескольких попыток на один и тот же элемент.
 * Если элемент не ушёл из DOM после трёх кликов — он не про приём игры,
 * и продолжать жать его значит воевать с интерфейсом (или с игроком).
 */
const acceptClickCounts = new WeakMap<Element, number>();
const MAX_ACCEPT_CLICKS_PER_ELEMENT = 3;

function consumeClickBudget(el: Element, kind: string): boolean {
  if (!isVisible(el)) return false;
  const used = acceptClickCounts.get(el) ?? 0;
  if (used >= MAX_ACCEPT_CLICKS_PER_ELEMENT) {
    // Терминальный исход: по этому элементу больше не жмём. Раньше он был
    // полностью нем, и «кандидата не было» не отличалось от «три клика не
    // сработали» (аудит наблюдаемости 02.08.2026, AS-1).
    if (!budgetExhaustedLogged) {
      budgetExhaustedLogged = true;
      log.warn(
        SCOPE,
        "автопринятие остановлено:",
        MAX_ACCEPT_CLICKS_PER_ELEMENT,
        "клика по цели",
        kind,
        "не дали результата",
      );
    }
    return false;
  }
  acceptClickCounts.set(el, used + 1);
  // info ТОЛЬКО на первый клик по этому узлу: бюджет живёт на экземпляр, а
  // сайт пересоздаёт блок принятия (там счётчик «Готовы: N/10»), поэтому у
  // строки иначе нет потолка — до пяти в секунду на всё окно принятия
  // (ревью 02.08.2026). Повторы остаются в debug.
  // Текст элемента НЕ пишем: это подписи сайта, сигнала они не добавляют.
  if (used === 0) log.info(SCOPE, "автопринятие: жмём цель", kind);
  else log.debug(SCOPE, "автопринятие: повторный клик", used + 1, kind);
  return true;
}

function clickAcceptButtons() {
  // Приём игры существует ТОЛЬКО на странице поиска. Без гейта скан шёл
  // каждую секунду на ЛЮБОЙ странице, включая игровую комнату, где точные
  // тексты «готов»/«подтвердить» — это подписи ИГРОВЫХ кнопок: лишний CPU
  // всегда и риск клика по чужому диалогу.
  if (!location.pathname.startsWith("/game-search")) return;
  // Идёт разведка очереди — принимать игру нельзя ни в коем случае
  // (см. content/auto-accept-gate.ts).
  if (isAutoAcceptSuppressed()) {
    if (!acceptSuppressLogged) {
      acceptSuppressLogged = true;
      log.info(SCOPE, "автопринятие приостановлено: идёт разведка очереди");
    }
    return;
  }
  if (acceptSuppressLogged) {
    acceptSuppressLogged = false;
    log.info(SCOPE, "автопринятие снова активно: разведка очереди завершена");
  }
  // Игрок только что кликал сам — не вмешиваемся, он пользуется интерфейсом.
  if (Date.now() - lastUserClickAt < USER_ACTION_BACKOFF_MS) return;

  // Симметрия центрального фильтра: сегодня текстовый путь спасает смена
  // текста принятой карточки, но держать защиту на подписи сайта нельзя
  // (контрольное ревью 05.08.2026).
  const acceptGameElements = findAcceptTextElements().filter(notInsideAcceptedBlock);

  // ТОЧНОЕ совпадение текста, а не подстрока: «Не готов» содержит «готов»,
  // «Подтвердить пароль» — «подтвердить». Прежний вариант жал любую такую
  // кнопку на любой странице сайта, включая подтверждения во время голосования.
  // Кнопки внутри стартового окна не трогаем — у clickStartGameButton свой
  // лимит попыток и бэкофф, и обходить их отсюда нельзя (окно настроек камеры —
  // то же самое окно).
  // Кнопка должна лежать в контексте приёма игры (.p-play*/profile-accept):
  // точная «Подтвердить» — типовая подпись ЛЮБОГО диалога сайта, и без гейта
  // по контейнеру расширение подтверждало чужие диалоги на любой странице.
  const readyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (btn) =>
      (TEXT.acceptGameButton as readonly string[]).includes(norm(btn)) &&
      !btn.closest(SITE.welcomeModal) &&
      !!btn.closest('[class*="p-play"], [class*="profile-accept"], [class*="accept"]'),
  );

  let gameAcceptDivs: HTMLElement[] = [];

  try {
    Array.from(document.querySelectorAll<HTMLElement>(SITE.acceptGameDivPrimary)).forEach((el) =>
      gameAcceptDivs.push(el),
    );
  } catch (e) {
    log.debug(SCOPE, "primary accept selector failed", e);
  }

  try {
    Array.from(document.querySelectorAll<HTMLElement>(SITE.acceptGameWrapperDiv))
      .filter((el) => containsAny(norm(el), TEXT.acceptGameText))
      .forEach((el) => gameAcceptDivs.push(el));
  } catch (e) {
    log.debug(SCOPE, "wrapper accept selector failed", e);
  }

  try {
    Array.from(document.querySelectorAll<HTMLElement>(SITE.cursorPointerDiv))
      .filter(
        (el) =>
          containsAny(norm(el), TEXT.acceptGameText) &&
          // Тот же scope-гейт, что в findAcceptTextElements: без него любой
          // div.cursor-pointer с текстом «принять игру» где угодно на странице
          // оставался кликабельным (аудит безопасности, находка 11).
          el.closest(ACCEPT_SCOPE_SELECTOR) !== null,
      )
      .forEach((el) => gameAcceptDivs.push(el));
  } catch (e) {
    log.debug(SCOPE, "cursor-pointer accept selector failed", e);
  }

  // Прежний fallback «по названию режима» (культурный/обычный/без цензуры)
  // удалён: textContent наследуется, и под фильтр попадал любой крупный
  // cursor-pointer контейнер с названием режима где-то внутри — расширение
  // кликало по нему на каждый батч мутаций. Это был главный оставшийся цикл.

  try {
    Array.from(document.querySelectorAll<HTMLElement>(SITE.profileAccept)).forEach((el) =>
      gameAcceptDivs.push(el),
    );
  } catch (e) {
    log.debug(SCOPE, "profileAccept selector failed", e);
  }

  // УЖЕ ПРИНЯТЫЙ блок — не цель, и фильтр обязан быть центральным: принятая
  // карточка приходит и из primary-селектора (`.p-play__profile-game
  // .p-play__profile-accept` без cursor-pointer), и из fallback, и детьми
  // через wrapper. cursor-pointer сайт держит ровно до принятия (бандл:
  // :class="{cursor-pointer: !isGameAccepted}"), а сам блок после принятия
  // ОСТАЁТСЯ в DOM — он же показывает «Готовы: N/10». Клики по принятому не
  // делают ничего, но сжигали бюджет за ~2 секунды и ложили терминальный
  // warn «не дали результата» на путь УСПЕХА — мина под разбор любой жалобы
  // на автопринятие (лог 04.08.2026, разбор «через раз» 05.08.2026).
  gameAcceptDivs = gameAcceptDivs.filter(notInsideAcceptedBlock);

  gameAcceptDivs = Array.from(new Set(gameAcceptDivs));
  // Оставляем только самые глубокие совпадения: textContent наследуется, и в
  // список попадали родитель И дитя — оба получали клик (дедуп 8.1.22 закрыл
  // это только для findAcceptTextElements, а div-ветку — нет).
  gameAcceptDivs = gameAcceptDivs.filter(
    (el) => !gameAcceptDivs.some((other) => other !== el && el.contains(other)),
  );

  // Клик по обычным кнопкам
  readyButtons.forEach((button) => {
    if (!consumeClickBudget(button, "кнопка")) return;
    log.debug(SCOPE, "click accept button", button.textContent);
    button.click();
    // Клик прошёл синхронно и не бросил — фиксируем принятие для автовозврата
    // напрямую: наш собственный клик не isTrusted, слушатель queue-requeue его
    // не увидит, а по любому НЕдоверенному DOM-событию латчиться нельзя —
    // страница умеет генерировать что угодно (аудит 03.08.2026, RQ-2).
    noteAutoAcceptDispatched();

    // После старта — один раз пытаемся включить видео.
    // Таймер именованный и гасится в disableAutoAccept: без ссылки на него
    // клик по камере прилетал через секунду ПОСЛЕ выключения автопринятия —
    // то есть расширение включало камеру уже выключенной фичей (§4.7).
    if (!videoButtonClicked && webcamClickTimer === null) {
      webcamClickTimer = setTimeout(() => {
        webcamClickTimer = null;
        const videoButton = findWebcamButton();
        if (videoButton) {
          if (cfg.disableWebcam) {
            log.debug(SCOPE, "skip webcam autoclick (disabled by setting)");
          } else {
            videoButton.click();
            videoButtonClicked = true;
          }
        }
      }, 1000);
    }
  });

  // Клик по карточкам приёма игры
  gameAcceptDivs.forEach((div) => {
    if (consumeClickBudget(div, "карточка") && safeClick(div)) noteAutoAcceptDispatched();
  });

  // Доп. элементы с текстом «Принять игру»
  acceptGameElements.forEach((el) => {
    if (readyButtons.includes(el as HTMLButtonElement) || gameAcceptDivs.includes(el)) return;
    if (consumeClickBudget(el, "текстовый блок") && safeClick(el)) noteAutoAcceptDispatched();
  });
}

/** Последний фактический скан принятия (общий для интервала и наблюдателя). */
let lastAcceptScanAt = 0;
/** Бюджет из перф-аудита 06.08.2026 (PERF-3): не чаще одного скана в 250 мс. */
const ACCEPT_SCAN_MIN_GAP_MS = 250;

/**
 * ЕДИНЫЙ планировщик сканов: интервал и наблюдатель мутаций раньше были
 * независимыми путями и в худшем случае давали двойной скан внутри одного
 * 250-мс окна (6 QSA за скан × до 5 сканов/с = 30 QSA/с). Теперь оба идут
 * через один таймер с общим минимальным зазором.
 */
function scheduleAcceptScan(delayMs: number): void {
  if (acceptScanTimer !== null) return;
  const gap = lastAcceptScanAt + ACCEPT_SCAN_MIN_GAP_MS - Date.now();
  acceptScanTimer = setTimeout(
    () => {
      acceptScanTimer = null;
      lastAcceptScanAt = Date.now();
      clickAcceptButtons();
    },
    Math.max(delayMs, gap, 0),
  );
}

function enableAutoAccept() {
  if (acceptInterval !== null) return;
  log.info(SCOPE, "auto-accept enabled");
  videoButtonClicked = false;
  acceptInterval = setInterval(() => scheduleAcceptScan(0), 1000);
  // Подписка на мутации нужна только чтобы отреагировать на появление карточки
  // быстрее, чем раз в секунду. Без дросселя она вызывала скан+клики на каждый
  // батч мутаций (до 60 раз/с) и обходила интервал-ограничитель: клик порождал
  // перерисовку, перерисовка — новый клик.
  unsubAcceptDom = onDomChange((muts) => {
    if (!muts.some((m) => m.addedNodes.length)) return;
    scheduleAcceptScan(250);
  });
}

function disableAutoAccept() {
  if (acceptInterval !== null) {
    clearInterval(acceptInterval);
    acceptInterval = null;
  }
  unsubAcceptDom?.();
  unsubAcceptDom = null;
  // Хвост дросселя: без этого через ≤250 мс после выключения прилетал
  // ещё один скан с кликами.
  lastAcceptScanAt = 0;
  if (acceptScanTimer !== null) {
    clearTimeout(acceptScanTimer);
    acceptScanTimer = null;
  }
  acceptSuppressLogged = false;
  budgetExhaustedLogged = false;
  // Отложенный клик по камере — тот же хвост: через секунду после выключения
  // он бы включил видео от имени уже неактивной фичи.
  if (webcamClickTimer !== null) {
    clearTimeout(webcamClickTimer);
    webcamClickTimer = null;
  }
}

// ─────────────────────────── скрытие/показ роли ───────────────────────────
//
// ОДНА ВЛАСТЬ (решение владельца 21.10.2026, после двух внешних аудитов):
// видимостью ролей стола управляет ТОЛЬКО наш CSS (<style id=polemica-role-hide>).
// Флаг сайта roleDisplay (его D, пункт меню, Ctrl/Cmd+D, v-show — inline
// display:none на каждой роли) мы больше не переключаем синтетическим D и не
// угадываем, сработал ли он. Его скрытие нейтрализовано правилом таблицы
// стилей (display !important поверх inline — inline-стилей ролей мы
// по-прежнему не пишем, инвариант №13), а решения игрока с флагом сайта
// (меню, его хоткей) ПРИНИМАЮТСЯ в наш слой немедленным подписчиком
// наблюдателя — до отрисовки кадра. Прежняя схема (синтетический D сайту)
// за три раунда ревью дала ~40 находок одного корня: зажатые клавиши у
// hotkeys-js сайта, режим модификатора, push-to-talk, микрозадача Vue,
// ретраи и страховки возврата.

function getRoleVisibilityTargets(): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const seen = new Set<Element>();
  SITE.ownRoleTargets.forEach((selector) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      targets.push(el);
    });
  });
  return targets;
}

function getPrimaryOwnRoleElement(roleElements = getRoleVisibilityTargets()): HTMLElement | null {
  return roleElements[0] || null;
}

function rememberRoleInlineState(roleElements: HTMLElement[]) {
  roleElements.forEach((el) => {
    if (isPinnedElement(el)) return; // чужой пин — не «исходное состояние»
    if (roleVisibilityState.has(el)) return;
    roleVisibilityState.set(el, {
      visibility: el.style.visibility,
      opacity: el.style.opacity,
      pointerEvents: el.style.pointerEvents,
    });
  });
}

function applyInlineRoleVisibility(roleElements: HTMLElement[], isVisible: boolean) {
  rememberRoleInlineState(roleElements);
  roleElements.forEach((el) => {
    // Запинённый узел не трогаем ни в какую сторону: его видимостью владеет
    // модуль role-pin, подъём/возврат пина — отдельный слой peek (наход. 7).
    if (isPinnedElement(el)) return;
    const original =
      roleVisibilityState.get(el) || { visibility: "", opacity: "", pointerEvents: "" };
    if (isVisible) {
      // Снимку НЕ доверяем прятать (тот же урок, что находка B у пина,
      // 03.09.2026): скрытые значения в «оригинале» — чей-то чужой hide
      // (прежняя версия, чужой писатель), и «показ» из такого снимка был
      // no-op — роль ночью оставалась скрытой при зелёной верификации.
      // display НЕ пишем (21.10.2026): им сайт прячет роли по своему флагу
      // (v-show), и Vue поправит его только на следующей смене флага —
      // наша запись рассинхронизировала свою роль с сокомандниками.
      el.style.visibility = original.visibility === "hidden" ? "" : original.visibility;
      el.style.opacity = original.opacity === "0" ? "" : original.opacity;
      el.style.pointerEvents = original.pointerEvents === "none" ? "" : original.pointerEvents;
    } else {
      el.style.visibility = "hidden";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    }
  });
}

/**
 * Легаси inline-скрытие своей роли (его писали прежние версии; новых
 * писателей нет). Снимается любым показом, подсматривание его поднимает.
 */
function isInlineHidden(roleElements = getRoleVisibilityTargets()): boolean {
  return roleElements.some(
    (el) => !isPinnedElement(el) && (el.style.visibility === "hidden" || el.style.opacity === "0"),
  );
}

// ─────────────────────────── CSS-скрытие ВСЕХ ролей ───────────────────────────

const ROLE_HIDE_ID = OWN.roleHideStyle;
// SITE.roleRevealNotice — текст «Игрок является мафией» на плитке (событие
// сайта on_reveal_role, ~3 с): то же знание, что значок роли. Теперь любое
// наше скрытие — этот CSS, и текст прячется всегда вместе со значками
// (внешний аудит №2, B06/B07).
const ROLE_HIDE_CSS = `
    .player__role,
    .player__role.role,
    svg.role,
    .my-role .player__role,
    .my-player .player__role,
    ${SITE.roleRevealNotice} {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
    }
`;

/**
 * Почему стоит CSS: ручное решение игрока (D, меню/хоткей сайта) или
 * автоматика (настройки, фаза, сцена). Выключение настроек снимает только
 * автоматическое скрытие — ручное остаётся решением игрока.
 */
let cssReason: "manual" | "auto" | null = null;

function hideAllRolesCSS(reason: "manual" | "auto" = "auto") {
  // Скрытие, поставленное ПОД «подсмотреть» (наступил день, включили
  // авто-скрытие), отпускание обязано вернуть — даже если прежнее снятое
  // скрытие выключили настройкой (случайные сценарии 21.10.2026).
  if (peeking) {
    // Причину только повышаем: ручное скрытие игрока остаётся ручным.
    if (reason === "manual" || !peekRestoreHidden) peekRestoreReason = reason;
    peekRestoreHidden = true;
  }
  const present = !!document.getElementById(ROLE_HIDE_ID);
  if (reason === "manual" || !present) cssReason = reason;
  if (present) return;
  const el = document.createElement("style");
  el.id = ROLE_HIDE_ID;
  el.textContent = ROLE_HIDE_CSS;
  (document.head || document.documentElement).appendChild(el);
  log.debug(SCOPE, "roles hidden via CSS");
}

function showAllRolesCSS() {
  cssReason = null;
  const el = document.getElementById(ROLE_HIDE_ID);
  if (!el) return;
  el.remove();
  log.debug(SCOPE, "roles shown via CSS");
}

function isRolesHiddenByCSS(): boolean {
  return !!document.getElementById(ROLE_HIDE_ID);
}

/** Показать всё НАШЕ: CSS и легаси inline-слой. Пин obs-панели — её дело. */
function showAllRoles(): void {
  lastOurShowAt = Date.now();
  showAllRolesCSS();
  applyInlineRoleVisibility(getRoleVisibilityTargets(), true);
}

// ─────────────────────────── флаг сайта: нейтрализация и приём ───────────────────────────

const ROLE_DISPLAY_OVERRIDE_ID = OWN.roleDisplayOverride;

function installRoleDisplayOverride(): void {
  if (document.getElementById(ROLE_DISPLAY_OVERRIDE_ID)) return;
  const el = document.createElement("style");
  el.id = ROLE_DISPLAY_OVERRIDE_ID;
  el.textContent = `${SITE.anyRole} { display: ${SITE.roleDisplayValue} !important; }`;
  (document.head || document.documentElement).appendChild(el);
}

function removeRoleDisplayOverride(): void {
  document.getElementById(ROLE_DISPLAY_OVERRIDE_ID)?.remove();
}

/** Флаг сайта, каким мы его видели последним (null — ролей ещё не было). */
let siteFlag: boolean | null = null;
/**
 * Последняя КОМАНДА ролей сайту от игрока: его D/Ctrl+D, дошедшие до сайта
 * (наш роутер их не забрал), и клик по пункту меню «Скрыть/Показать роли».
 * Только она делает смену флага решением игрока — прежде годился любой клик
 * рядом по времени (внешний аудит №3, §4 п.5).
 */
let lastSiteRoleCommandAt = 0;
/** Когда НАШ слой последний раз показал роли (D, ночной показ, nightShow). */
let lastOurShowAt = 0;
/**
 * Окно «смена флага — действие игрока». Флаг сайт сам не меняет, кроме
 * разового переворота у зрителя с canSeeRolesAsViewer (подключение к
 * комнате) — поэтому окно короткое.
 */
const USER_INITIATED_MS = 700;
let onSiteCommandKey: ((e: Event) => void) | null = null;
let onSiteCommandBubble: ((e: Event) => void) | null = null;
let onSiteCommandClick: ((e: Event) => void) | null = null;
/**
 * D, дошедший до document (наш роутер его не забрал), — кандидат в команду
 * ролей сайту. Командой он становится, только если сайт его ПРИНЯЛ: обёртка
 * хоткеев сайта всегда зовёт `event.preventDefault()` (`return
 * event.preventDefault(),n(),!1`, room/bundle/main.js). Отвергнутое сайтом —
 * печать в поле, IME, лишняя зажатая клавиша, чужой профиль модификатора —
 * preventDefault не получает. Прежняя модель зажатых клавиш расходилась с
 * настоящим hotkeys-js в обе стороны (внешний аудит №5, B02/H01).
 */
let pendingRoleKey: { e: KeyboardEvent; at: number; reachedWindow: boolean } | null = null;

/** Код клавиши так, как его видит hotkeys-js сайта. */
function siteKeyCode(e: KeyboardEvent): number {
  return e.keyCode || e.which || e.charCode;
}

/** Последняя ПРИНЯТАЯ сайтом команда ролей (включая ещё не учтённую). */
function siteRoleCommandAt(): number {
  // Принятую команду обёртка сайта ещё и ОСТАНАВЛИВАЕТ (`return !1` →
  // stopPropagation на document): D, всплывший до window, сайт не принял,
  // чей бы preventDefault на нём ни стоял (внешний аудит №6, C03).
  if (pendingRoleKey && pendingRoleKey.e.defaultPrevented && !pendingRoleKey.reachedWindow) {
    lastSiteRoleCommandAt = Math.max(lastSiteRoleCommandAt, pendingRoleKey.at);
    pendingRoleKey = null;
  }
  return lastSiteRoleCommandAt;
}
let unsubRoleDomImmediate: (() => void) | null = null;

function readSiteFlag(): boolean | null {
  const el = document.querySelector<HTMLElement>(SITE.anyRole);
  return el ? el.style.display !== "none" : null;
}

/**
 * Принять смену флага сайта в наш слой. Скрытие сайта принимаем ВСЕГДА
 * (fail-safe: и программное — зритель, флаг, перевёрнутый без нас); показ —
 * только как действие игрока: сам по себе сайт роли не показывает.
 * Узел, смонтированный уже скрытым при известном «скрыто», сменой не считается
 * (проверка шерифа при показанных нами ролях).
 */
function syncSiteFlag(): void {
  const flag = readSiteFlag();
  if (flag !== null) sawRunningGame = true;
  if (flag === null || flag === siteFlag) return;
  const first = siteFlag === null;
  siteFlag = flag;
  if (first && flag) return;
  // Первая увиденная роль смонтирована уже скрытой: флаг сайта мог быть
  // выключен ДО нашего последнего показа (Ctrl+D в лобби, потом наш D;
  // наш ночной показ до раздачи) — тогда это не новое решение, и более
  // новый показ стоит (внешний аудит №3, H02). Команда ролей сайту после
  // нашего показа — решение игрока, принимаем.
  const commandAt = siteRoleCommandAt();
  if (first && lastOurShowAt > 0 && commandAt <= lastOurShowAt) return;
  const byUser = Date.now() - commandAt < USER_INITIATED_MS;
  if (!flag) adoptSiteDecision(false, byUser);
  else if (byUser) adoptSiteDecision(true, true);
}

function adoptSiteDecision(show: boolean, byUser: boolean): void {
  if (byUser) lastManualRoleActionAt = Date.now();
  // Скрытие увидели поздно (ролей ещё не было), но команду игрок отдал —
  // решение датируется ею: ночная автоматика его не переигрывает (аудит №3).
  else if (!show && lastSiteRoleCommandAt > lastManualRoleActionAt) {
    lastManualRoleActionAt = lastSiteRoleCommandAt;
  }
  if (peeking) {
    // Под V решение применится на отпускании.
    if (show) {
      peekRestoreHidden = false;
      peekRestoreInline = false;
      // И CSS, поставленный уже ПОД V (наступил день): иначе отпускание его не
      // снимало, и показ игрока терялся (внешний аудит №3, H01).
      showAllRolesCSS();
    } else {
      peekRestoreHidden = true;
      peekRestoreReason = "manual";
    }
    return;
  }
  if (show) {
    showAllRoles();
    log.info(SCOPE, "роли стола показаны: игрок показал их на сайте (меню или его хоткей)");
  } else {
    // Причина — «ручная» и для программного скрытия сайта: это не скрытие
    // наших настроек, и выключение настроек снимать его не вправе.
    hideAllRolesCSS("manual");
    log.info(
      SCOPE,
      byUser
        ? "роли стола скрыты: игрок скрыл их на сайте (меню или его хоткей)"
        : "сайт скрыл роли сам — скрываем и мы",
    );
  }
}

/**
 * Новая игра в ТОМ ЖЕ документе (SPA-переход поиск → комната): прежде
 * состояние прошлой игры (показанные D роли, «ручное» этой ночи) переезжало
 * в новую, и авто-скрытие не перевзводилось — раздача шла с открытыми
 * ролями (внешний аудит №3, §4 п.7). Проверка — в немедленном подписчике,
 * до монтирования ролей новой игры.
 */
let lastRoutePath: string | null = null;

function checkGameRoute(): void {
  const path = gameRouteKey(location);
  if (path === lastRoutePath) return;
  const fresh = lastRoutePath === null;
  lastRoutePath = path;
  // Любой вход в комнату после другого пути (и другой game_id в query) —
  // новая игра: и первая комната после поиска, и возврат в ту же комнату
  // (внешние аудиты №4 S1, №5 C05).
  if (fresh || !isGameRoomPath(location.pathname)) return;
  resetForNewGame("новая игра в том же документе");
}

/**
 * Матч в этой комнате уже шёл (роли или экран итога): следующее появление
 * экрана набора — новая игра в ТОЙ ЖЕ комнате, URL не меняется (внешний
 * аудит №5, C05).
 */
let sawRunningGame = false;

function checkNewRound(): void {
  // Экран набора — ВИДИМЫЙ: скрытый узел (переходный рендер) новой игрой не
  // считается (аудит №6, §4).
  const pregame = document.querySelector<HTMLElement>(SITE.pregameScreen);
  if (pregame && isVisible(pregame)) {
    if (!sawRunningGame) return;
    sawRunningGame = false;
    resetForNewGame("новая игра в той же комнате");
  } else if (!sawRunningGame && (document.querySelector(SITE.anyRole) || document.querySelector(SITE.roomFixedState))) {
    sawRunningGame = true;
  }
}

function resetForNewGame(why: string): void {
  log.info(SCOPE, `${why} — состояние скрытия ролей сброшено`);
  lastManualRoleActionAt = 0;
  lastSiteRoleCommandAt = 0;
  pendingRoleKey = null;
  // Решение о столе новой игры — наше и новее флага сайта: свой roleDisplay
  // сайт на новой игре НЕ сбрасывает, и первая роль, смонтированная по
  // старому «скрыто», иначе вносила решение прошлой игры (аудит №6, C01).
  lastOurShowAt = Date.now();
  siteFlag = null;
  sceneHide = null;
  endObsNight();
  lastDaySeenAt = 0;
  nightAutoShowStartedAt = 0;
  cancelDayConfirm();
  dayPending = false;
  resumeShowMark = null;
  if (pendingNightRoleShowTimer) {
    clearTimeout(pendingNightRoleShowTimer);
    pendingNightRoleShowTimer = null;
  }
  rolePhaseInitialized = false;
  lastDetectedRolePhase = null;
  // Новая игра — новое решение о приватности: ручное скрытие/показ и снимки
  // V прошлой игры (CSS и легаси-инлайн) в неё не переезжают (S3, C03).
  // Скрывает только настройка — и под V, зажатой в прошлой игре.
  peekRestoreInline = false;
  if (cfg.autoHideRoles) {
    cssReason = "auto";
    peekRestoreHidden = false;
    peekRestoreReason = "auto";
    hideAllRolesCSS("auto");
  } else if (peeking) {
    peekRestoreHidden = false;
  } else {
    showAllRolesCSS();
  }
  // Фаза — сразу: новый стол без маркеров этапа считается днём (S2).
  if (cfg.rolePhaseSwitch) applyRolePhase(detectRolePhase());
  // Автосцены: ночь OBS прошлой игры кончилась — стол новой открывает только
  // её собственный nightShow (иначе напарники видны при скрытой своей).
  if (obsAutoScenesActive()) hideAllRolesCSS("auto");
  // Сцена эфира от смены игры не стала безопаснее: гейт решает заново —
  // прежде сброс снимал сценовое скрытие до сверки obs-panel (аудит №5, C01).
  syncRolesWithSceneGate();
}

function hostsPhase(nodes: NodeList): boolean {
  for (const n of Array.from(nodes)) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.matches(SITE.rolePhaseHost) || el.querySelector(SITE.rolePhaseHost)) return true;
  }
  return false;
}

/** Может ли мутация сменить распознаваемую фазу (см. detectRolePhase). */
function touchesPhase(m: MutationRecord): boolean {
  const t = m.target;
  const el = t.nodeType === 1 ? (t as Element) : t.parentElement;
  if (!el) return false;
  if (m.type === "attributes" && (el === document.body || el === document.documentElement)) return true;
  if (el.closest(SITE.rolePhaseHost)) return true;
  return m.type === "childList" && (hostsPhase(m.addedNodes) || hostsPhase(m.removedNodes));
}

/** Немедленный подписчик (до кадра): смена display ролей или новые узлы. */
function onRoleDomImmediate(muts: MutationRecord[]): void {
  checkGameRoute();
  // Смена этапа — фаза сразу, до кадра: прежде её видел только тик
  // интервала, и в начале дня роли до ~1,15 с оставались открытыми
  // (случайные сценарии 21.10.2026). Не только внутри `.stage`: подпись
  // этапа — Text-узел (characterData), а «Промах» заменяет весь роллер
  // (внешний аудит №4, B01/§2.2).
  // Под V — тоже (как тик интервала): день прячет и под клавишей (fail-safe).
  for (const m of muts) {
    if (touchesPhase(m)) {
      checkNewRound();
      if (cfg.rolePhaseSwitch) applyRolePhase(detectRolePhase());
      break;
    }
  }
  for (const m of muts) {
    const relevant =
      m.type === "attributes"
        ? (m.target as Element).classList?.contains(SITE_CLASS.playerRole)
        : m.addedNodes.length > 0;
    if (relevant) {
      syncSiteFlag();
      return;
    }
  }
}

// ─────────────────────── «подсмотреть роли, пока держу» ───────────────────────

/**
 * Скрытие ролей прячет ВСЁ знание игрока, а не только его собственную роль:
 * сайт рисует роль одним и тем же элементом у любого игрока, поэтому под
 * раздачу попадают напарники чёрного и результаты проверок шерифа (жалоба
 * стримера 12.08.2026 — «дон и шериф играют вслепую»).
 *
 * Прятать чужие роли ПРАВИЛЬНО: на стриме состав мафии утечёт так же, как своя
 * роль. Поэтому не ослабляем скрытие, а даём подсмотреть — и именно
 * УДЕРЖАНИЕМ, а не переключателем: переключатель однажды забудут вернуть, и
 * роль уедет в эфир, то есть случится ровно то, от чего фича защищает.
 */
let roleePeekKey = "";
let unsubPeek: (() => void) | null = null;
/** CSS-скрытие, снятое на время подсматривания, и его причина. */
let peekRestoreHidden = false;
let peekRestoreReason: "manual" | "auto" = "auto";
/** Легаси inline-скрытие своей роли. */
let peekRestoreInline = false;
/** Пин obs-панели был поднят на время подсматривания (модуль role-pin). */
let peekRestorePin = false;
/** Клавиша сейчас зажата. */
let peeking = false;

/** Идёт ли подсматривание (тестовый шов). */
export function isPeeking(): boolean {
  return peeking;
}

/**
 * Прячем ли роли днём. Днём это делают ОБЕ настройки: авто-скрытие (оно же
 * держит скрытие вне игры и при входе) и автосмена, которой днём положено
 * прятать, а ночью показывать.
 */
export function hidesRolesByDay(opts: { autoHideRoles: boolean; rolePhaseSwitch: boolean }): boolean {
  return opts.autoHideRoles || opts.rolePhaseSwitch;
}

/**
 * Вернуть ли скрытие после отпускания клавиши: РОВНО то, что было до
 * нажатия, кроме «ночной показ положен (автосмена, ночь, игрок после
 * наступления ночи роли руками не трогал) И эфир на ночной сцене» — тогда
 * роли и так должны быть видны, а спрятать, чтобы показ открыл снова, —
 * мигание в эфире (случайные сценарии 21.10.2026).
 */
export function shouldRehideAfterPeek(opts: {
  nightShowDue: boolean;
  nightSceneSafe: boolean;
}): boolean {
  return !(opts.nightShowDue && opts.nightSceneSafe);
}

/**
 * Ночной показ ещё «должен» случиться: автосмена, ночь, и игрок после
 * наступления ночи роли руками не трогал (D/меню — его решение главнее).
 */
function nightShowDue(): boolean {
  // При автосценах ночной показ ведёт OBS: его ночь — с первого nightShow
  // (подтверждённая ночная сцена), а не с распознавания фазы auto-start.
  if (obsAutoScenesActive()) return obsNightSince !== null && manualBeforeNight(obsNightSince);
  return cfg.rolePhaseSwitch && lastDetectedRolePhase === "night" && manualBeforeNight(nightAutoShowStartedAt);
}

/**
 * Запас на распознавание фазы: ночь в игре начинается РАНЬШЕ, чем её видит
 * детектор (интервал 1 с + дребезг 150 мс; у obs-panel — подтверждение
 * 150+350 мс). Ручное решение в этом окне — решение ЭТОЙ ночи: прежде D,
 * нажатый между настоящим началом ночи и распознаванием, считался «вчерашним»,
 * и ночной показ открывал спрятанное (внешний аудит №3, B02).
 */
const PHASE_RECOGNITION_SLACK_MS = 2500;

/** Последнее ручное решение было ДО начала этой ночи (с запасом). */
function manualBeforeNight(nightStart: number): boolean {
  return lastManualRoleActionAt < nightStart - PHASE_RECOGNITION_SLACK_MS;
}

/**
 * Подсмотреть роли, пока клавиша зажата: снимаем наши слои (CSS, легаси
 * inline) и поднимаем пин obs-панели через владельца. Скрытие сайта
 * нейтрализовано — снимать его не нужно. true — подсматривание включено
 * (клавиша наша, сайту не отдаётся).
 */
/** Эфир был на безопасной сцене (или автосцен нет), когда V включилась. */
let peekSceneSafe = false;

function startPeek(): boolean {
  if (peeking) return true;
  peekSceneSafe = !obsAutoScenesActive() || nightSceneSafeForRoleShow();
  peekRestoreHidden = isRolesHiddenByCSS();
  peekRestoreReason = cssReason ?? "auto";
  peekRestoreInline = isInlineHidden();
  // Пин obs-панели поднимаем через владельца (liftPins), а не срывом стилей
  // (аудит 29.08.2026, находка 7): пока пин поднят, pinHolds отвечает
  // «держится» — обс не воюет с подсматриванием.
  peekRestorePin = liftPins();
  // Подсматривать нечего: клавиша отдаётся сайту (его `v` — тумблер камеры
  // в лобби). Кроме D: у сайта это тумблер ролей.
  if (!peekRestoreHidden && !peekRestoreInline && !peekRestorePin) {
    return roleePeekKey === "KeyD";
  }
  peeking = true;
  if (peekRestoreHidden) showAllRolesCSS();
  if (peekRestoreInline) applyInlineRoleVisibility(getRoleVisibilityTargets(), true);
  log.info(
    SCOPE,
    "роли показаны, пока удерживается клавиша; снято скрытие:",
    [peekRestoreHidden && "css", peekRestoreInline && "inline", peekRestorePin && "пин"]
      .filter(Boolean)
      .join("+"),
  );
  return true;
}

/**
 * teardown — выключение фичи: роли намеренно показываются, возвращать
 * скрытие нельзя. Пин возвращается владельцу всегда.
 */
function stopPeek(teardown = false): void {
  if (!peeking) return;
  const restoreCss = peekRestoreHidden;
  const reason = peekRestoreReason;
  const restoreInline = peekRestoreInline;
  const restorePin = peekRestorePin;
  peekRestoreHidden = false;
  peekRestoreInline = false;
  peekRestorePin = false;
  peeking = false;
  if (restorePin) restoreLiftedPins();
  if (teardown) return;
  const showDue = nightShowDue();
  const rehide = shouldRehideAfterPeek({
    nightShowDue: showDue,
    nightSceneSafe: nightSceneSafeForRoleShow(),
  });
  if (rehide) {
    if (restoreCss) hideAllRolesCSS(reason);
    if (restoreInline) applyInlineRoleVisibility(getRoleVisibilityTargets(), false);
  } else {
    // Ночной показ положен и эфир на ночной сцене: роли видны — в том числе
    // поверх скрытия, поставленного ПОД клавишей (включили авто-скрытие),
    // и когда V держали через переход в ночь (adversarial 03.09.2026, Н6).
    showAllRoles();
  }
  // Под V канал сцены молчал: эфир мог уйти с ночной сцены или вернуться.
  syncRolesWithSceneGate();
  if (pendingNightShowSince !== null) {
    const since = pendingNightShowSince;
    pendingNightShowSince = null;
    if (nightSceneSafeForRoleShow()) onObsNightShow(since);
  }
}

function bindPeekKey(code: string): void {
  if (unsubPeek) {
    unsubPeek();
    unsubPeek = null;
  }
  roleePeekKey = code;
  if (!code) return;
  unsubPeek = keyboard.registerHold(code, startPeek, stopPeek);
}

function autoHideRole(): boolean {
  if (!cfg.autoHideRoles) return false;
  // Всегда прячем CSS. Ночью ночной показ уберёт его сам.
  hideAllRolesCSS("auto");
  return true;
}

function stopInitialAutoHideRole() {
  if (initialAutoHideTimer) {
    clearInterval(initialAutoHideTimer);
    initialAutoHideTimer = null;
  }
  initialAutoHideAttempts = 0;
}

function startInitialAutoHideRole() {
  stopInitialAutoHideRole();
  if (!cfg.autoHideRoles) return;
  // Сразу, а не первым тиком интервала: стол уже на экране, и 100 мс роли
  // были открыты (внешний аудит 21.10.2026, B09). CSS элементов не ждёт.
  if (autoHideRole()) {
    log.info(SCOPE, "роль скрыта при входе в игру");
    return;
  }

  initialAutoHideTimer = setInterval(() => {
    initialAutoHideAttempts += 1;
    if (!cfg.autoHideRoles) {
      stopInitialAutoHideRole();
      return;
    }
    if (autoHideRole()) {
      log.info(SCOPE, "роль скрыта при входе в игру");
      stopInitialAutoHideRole();
      return;
    }
    if (initialAutoHideAttempts >= 100) {
      // Десять секунд попыток и молчаливая сдача: у стримера, чья роль не
      // скрылась, в файле не было ни одной строки (аудит наблюдаемости
      // 02.08.2026, AS-3 — последняя из 26 находок).
      log.warn(
        SCOPE,
        "роль не удалось скрыть за",
        initialAutoHideAttempts,
        "попыток — элемент роли так и не появился",
      );
      stopInitialAutoHideRole();
    }
  }, 100);
}

// ─────────────────────────── фаза день/ночь ───────────────────────────

function scheduleNightRoleAutoShow(delayMs: number) {
  if (pendingNightRoleShowTimer) clearTimeout(pendingNightRoleShowTimer);

  log.debug(SCOPE, "night-show scheduled in", delayMs);
  pendingNightRoleShowTimer = setTimeout(() => {
    pendingNightRoleShowTimer = null;
    // Возврат стола после неподтверждённого дня — решение игрока (или показ)
    // этой ночи, а не новый автопоказ: проверки «действовал сам» не к нему.
    const resume = resumeShowMark !== null && resumeShowMark === lastManualRoleActionAt;
    resumeShowMark = null;

    if (!resume) {
      // Игрок только что сам скрыл/показал роль (D-D «глянул и спрятал») —
      // не переигрываем его решение принудительным показом.
      if (Date.now() - lastManualRoleActionAt < 2000) {
        log.info(SCOPE, "ночной показ роли пропущен: игрок только что действовал сам");
        return;
      }
      // Игрок управлял ролями сам ПОСЛЕ наступления ночи — его решение на
      // эту ночь главнее (случайные сценарии 21.10.2026).
      if (!nightShowDue()) {
        log.info(SCOPE, "ночной показ роли отменён: этой ночью игрок управлял ролями сам");
        return;
      }
    }
    // Автосцены OBS ведут ночной показ сами: obs-panel снимает пин своей
    // роли после подтверждённой ночной сцены и сообщает нам (nightShow) —
    // напарники открываются в тот же момент, без зеркала (внешний аудит
    // №2, H05). Исключение — возврат после переходного «дня» (B01 аудита №5).
    if (obsAutoScenesActive()) {
      if (resume && nightSceneSafeForRoleShow()) {
        showAllRoles();
        log.info(SCOPE, "ночь продолжилась после застрявшей подписи дня — стол снова как был");
      }
      return;
    }
    // Эфир ещё НЕ на ночной сцене (жалоба 01.10.2026) — ждём её повторами.
    if (!nightSceneSafeForRoleShow()) {
      if (!nightShowSceneDeferredLogged) {
        nightShowSceneDeferredLogged = true;
        log.info(SCOPE, "ночной показ роли отложен: эфир не на ночной сцене OBS");
      }
      if (resume) resumeShowMark = lastManualRoleActionAt;
      scheduleNightRoleAutoShow(2000);
      return;
    }
    nightShowSceneDeferredLogged = false;
    showAllRoles();
    log.info(SCOPE, resume ? "ночь продолжилась после застрявшей подписи дня — стол снова как был" : "ночной показ: роли стола показаны");
  }, delayMs);
}

function getTexts(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector))
    .map((el) => norm(el))
    .filter(Boolean);
}

// Классификация вынесена в selectors.ts (classifyPhaseText) — она общая с
// автосценами OBS. Причина появления: «Голосование мафии» (ночной этап
// в одном из словарей сайта) содержит дневное «голос» — раньше это включало
// «день» посреди ночи, прятало роли и воевало с ночным показом
// («подглючивает с переключением ролей», жалоба 31.07.2026).
function isNightText(text: string): boolean {
  return classifyPhaseText(text) === "night";
}

function isDayText(text: string): boolean {
  return classifyPhaseText(text) === "day";
}

function detectRolePhase(): "day" | "night" {
  const body = document.body;
  if (body?.classList.contains(SITE_CLASS.night)) return "night";
  if (body?.classList.contains(SITE_CLASS.day)) return "day";

  // Игра закончилась: сайт перед этим стартует день, но экран результата
  // фазовых маркеров не несёт — без этой ветки фаза оставалась ночной, и
  // роль могла светиться на итоговом экране (аудит устойчивости, находка 5).
  if (endedScreenVisible()) return "day";

  // 1) Текущий этап (.current) — высший приоритет
  const currentTexts = getTexts(SITE.substageCurrent);
  if (currentTexts.length > 0) {
    const curDay = currentTexts.some(isDayText);
    const curNight = currentTexts.some(isNightText);
    if (curDay && !curNight) return "day";
    if (curNight && !curDay) return "night";
    if (curDay && curNight) return "day"; // речь игрока = день
  }

  // 2) Активный этап (.active)
  const activeTexts = getTexts(SITE.substageActive);
  if (activeTexts.length > 0) {
    const actDay = activeTexts.some(isDayText);
    const actNight = activeTexts.some(isNightText);
    if (actDay && !actNight) return "day";
    if (actNight && !actDay) return "night";
    if (actDay && actNight) return "day";
  }

  // 3) Следующий этап (.next) — только если current/active не определили
  const nextTexts = getTexts(SITE.substageNext);
  if (nextTexts.length > 0) {
    const nxtDay = nextTexts.some(isDayText);
    const nxtNight = nextTexts.some(isNightText);
    if (nxtNight && !nxtDay) return "night";
    if (nxtDay && !nxtNight) return "day";
  }

  // (Ветка window.obsFloatingPanel удалена — этот объект нигде не определялся,
  // наследие legacy page-script; в изолированном мире её не существовало.)

  // 4) Любые .stage/.substage — последний fallback
  const allTexts = getTexts(SITE.stage);
  const allDay = allTexts.some(isDayText);
  const allNight = allTexts.some(isNightText);
  if (allDay && !allNight) return "day";
  if (allNight && !allDay) return "night";
  if (allDay && allNight) return "day";

  return lastDetectedRolePhase || "day";
}

function applyRolePhase(phase: "day" | "night") {
  if (!cfg.rolePhaseSwitch) {
    if (pendingNightRoleShowTimer) {
      clearTimeout(pendingNightRoleShowTimer);
      pendingNightRoleShowTimer = null;
    }
    return;
  }

  if (phase !== "day" && phase !== "night") return;

  // Отменяем таймер ночного показа только при уходе ИЗ ночи
  if (phase !== "night" && pendingNightRoleShowTimer) {
    clearTimeout(pendingNightRoleShowTimer);
    pendingNightRoleShowTimer = null;
  }

  if (rolePhaseInitialized && phase === lastDetectedRolePhase) {
    // Тот же день: подпись могла стать однозначной (или застрявшей).
    if (phase === "day" && dayPending) syncDayConfirm(Date.now());
    return;
  }
  rolePhaseInitialized = true;
  lastDetectedRolePhase = phase;
  nightShowSceneDeferredLogged = false;

  if (phase === "night") {
    // Неподтверждённый «день» — застрявшая подпись роллера (старый день при
    // уже ночной игре), а не конец ночи: её начало и ручные решения этой
    // ночи остаются (внешние аудиты №5 B01, №6 B03).
    const sameNight = dayPending && nightAutoShowStartedAt > 0;
    cancelDayConfirm();
    dayPending = false;
    if (!sameNight) nightAutoShowStartedAt = Date.now();
    // Стол был виден до этого «дня» и игрок с тех пор ничего не решал —
    // возвращаем ровно его, будь то ночной показ или ручной показ этой ночи
    // (аудит №6, H01); при автосценах нового nightShow не будет.
    resumeShowMark = sameNight && preDayVisible ? preDayManualMark : null;
    scheduleNightRoleAutoShow(3000);
    if (obsShowAwaitingNight !== null) {
      const since = obsShowAwaitingNight;
      obsShowAwaitingNight = null;
      syncRolesWithSceneGate("nightShow", { nightSince: since });
    }
    return;
  }
  // Скрыть — сразу (fail-safe), закончить ночь — только подтверждённым днём.
  // Возврат стола после прошлой застрявшей подписи ещё не наступил — стол
  // «был виден», хотя DOM сейчас скрыт: второй такой «день» подряд не
  // стирает намерение (аудит №7, C01).
  const resumePending = resumeShowMark !== null && resumeShowMark === lastManualRoleActionAt;
  preDayVisible = resumePending || (peeking ? !peekRestoreHidden : !isRolesHiddenByCSS());
  preDayManualMark = lastManualRoleActionAt;
  hideAllRolesCSS("auto");
  dayPending = true;
  syncDayConfirm(Date.now());
}

/**
 * Сколько ОДНОЗНАЧНЫЙ день должен продержаться, чтобы закончить ночь.
 * Настоящий день длится минуты; застрявшая подпись роллера однозначной не
 * бывает (следующий этап — ночь, staleDayLabel), и её не ограничивает
 * никакой таймер.
 */
const DAY_CONFIRM_MS = 2000;
let dayConfirmTimer: ReturnType<typeof setTimeout> | null = null;
/** Распознан день, но ночь ещё не закончена (не подтверждён). */
let dayPending = false;
/** Стол был виден перед распознанным днём, и метка ручных решений тогда. */
let preDayVisible = false;
let preDayManualMark = 0;
/** Вернуть стол после неподтверждённого дня, если ручных решений не было. */
let resumeShowMark: number | null = null;
/** nightShow OBS, пришедший, пока автосмена фаз видит день (§4.2 аудита №5). */
let obsShowAwaitingNight: number | null = null;

function cancelDayConfirm(): void {
  if (dayConfirmTimer) clearTimeout(dayConfirmTimer);
  dayConfirmTimer = null;
}

/** Взвести/снять подтверждение дня по однозначности подписи. */
function syncDayConfirm(candidateAt: number): void {
  if (staleDayLabel()) {
    cancelDayConfirm();
    return;
  }
  if (dayConfirmTimer) return;
  dayConfirmTimer = setTimeout(() => {
    dayConfirmTimer = null;
    if (lastDetectedRolePhase !== "day" || !dayPending || staleDayLabel()) return;
    dayPending = false;
    nightAutoShowStartedAt = 0;
    lastDaySeenAt = candidateAt;
    resumeShowMark = null;
    endObsNight();
  }, DAY_CONFIRM_MS);
}

/**
 * Роли стола следуют за автосменой сцен OBS (adversarial 21.10.2026, №7;
 * внешние аудиты 21.10.2026). obs-panel прячет пином только СВОЮ роль,
 * напарников — наш CSS. Правило: эфир НЕ на ночной сцене (заранее — до
 * команды дневной сцены; ушёл руками; разрыв OBS) — прячем ВСЕ роли,
 * независимо от автосмены фаз; скрытие держится самолечением, пока игрок
 * руками не показал роли. Ночная сцена подтверждена — obs-panel снимает
 * свой пин и шлёт nightShow: видны ВСЕ роли (решение владельца, H04), если
 * игрок этой ночью не прятал их сам, иначе снимается только сценовое
 * скрытие. Автосцены выключили — сценовое скрытие снимается сразу.
 */
let sceneHide: { manualMark: number; cssWasPresent: boolean } | null = null;
/** Автосцены были включены на прошлой сверке гейта. */
let obsWasActive = false;
/** nightShow, пришедший под V: применится на отпускании (иначе терялся). */
let pendingNightShowSince: number | null = null;
/** Начало ночи OBS (первый nightShow после дня) — эпоха ручных решений. */
let obsNightSince: number | null = null;

function syncRolesWithSceneGate(
  reason: RoleSceneGateReason = "gate",
  info?: { nightSince?: number },
): void {
  if (peeking) {
    if (reason === "nightShow") {
      pendingNightShowSince = info?.nightSince ?? Date.now();
      noteObsNight(pendingNightShowSince);
    }
    if (reason === "beforeDayScene") {
      if (!cfg.rolePhaseSwitch) endObsNight();
      // Эфир уходит на дневную сцену — прячем и под V, как день автосмены
      // (fail-safe); отпускание вернёт скрытым.
      hideAllRolesCSS("auto");
    }
    // Эфир УШЁЛ с ночной сцены уже под V (хоткей OBS, Stream Deck, разрыв) —
    // то же: прежде пин прятал только свою, напарники уезжали на DAY
    // (внешний аудит №6, B01). V, начатая на уже небезопасной сцене, —
    // осознанный выбор игрока, её не трогаем.
    if (reason === "gate" && obsAutoScenesActive()) {
      if (!nightSceneSafeForRoleShow()) {
        if (peekSceneSafe) {
          peekSceneSafe = false;
          hideAllRolesCSS("auto");
        }
      } else {
        // Эфир вернулся на ночную сцену под той же V — следующий уход снова
        // уход «после начала V» (внешний аудит №7, B03).
        peekSceneSafe = true;
      }
    }
    return;
  }
  // Конец ночи при автосмене фаз решает её ПОДТВЕРЖДЁННЫЙ день: панель
  // подтверждает свой за ~0,5 с и по застрявшей подписи роллера стирала
  // эпоху ручных решений этой ночи (внешний аудит №6, B03).
  if (reason === "beforeDayScene" && !cfg.rolePhaseSwitch) endObsNight();
  if (cfg.rolePhaseSwitch) applyRolePhase(detectRolePhase());
  if (reason === "nightShow") {
    onObsNightShow(info?.nightSince ?? Date.now());
    return;
  }
  const unsafe = reason === "beforeDayScene" || !nightSceneSafeForRoleShow();
  if (unsafe) {
    if (sceneHide) {
      // Новая дневная сцена — решение заново: ручной показ на прошлом уходе
      // со сцены не открывает стол на следующем дне (внешний аудит №5, B03).
      if (reason === "beforeDayScene") sceneHide.manualMark = lastManualRoleActionAt;
      // Самолечение: скрытие сняли не руками игрока — прячем снова.
      if (sceneHide.manualMark === lastManualRoleActionAt && !isRolesHiddenByCSS()) {
        hideAllRolesCSS("auto");
      }
      return;
    }
    sceneHide = { manualMark: lastManualRoleActionAt, cssWasPresent: isRolesHiddenByCSS() };
    if (!sceneHide.cssWasPresent) {
      hideAllRolesCSS("auto");
      log.info(SCOPE, "эфир не на ночной сцене — роли стола спрятаны до её возврата");
    }
    return;
  }
  // Ночная сцена при автосценах — ждём nightShow от obs-panel (своя роль
  // откроется с её задержкой; напарники — вместе с ней, без зеркала).
  const obsActive = obsAutoScenesActive();
  const obsJustOff = obsWasActive && !obsActive;
  obsWasActive = obsActive;
  if (obsActive) return;
  releaseSceneHide();
  // Автосцены выключили ночью: ночной показ, который они вели, — снова наш.
  if (obsJustOff && nightShowDue()) scheduleNightRoleAutoShow(0);
}

/** Снять своё сценовое скрытие (если оно ещё стоит и не было до ухода). */
function releaseSceneHide(): void {
  if (!sceneHide) return;
  const { cssWasPresent } = sceneHide;
  sceneHide = null;
  // Ночной показ положен — он и решит (покажет всё), чей бы CSS ни стоял.
  if (nightShowDue()) {
    scheduleNightRoleAutoShow(0);
    return;
  }
  if (cssWasPresent) return;
  if (cfg.rolePhaseSwitch && lastDetectedRolePhase === "day") return; // днём фаза прячет сама
  // Ручное скрытие игрока после ухода сцены — его решение, не сценовое.
  if (isRolesHiddenByCSS() && cssReason !== "manual") {
    showAllRolesCSS();
    log.info(SCOPE, "сценовое скрытие снято — роли как до ухода с ночной сцены");
  }
}

/**
 * Начало ночи OBS — САМОЕ РАННЕЕ с последнего дня: реконнект OBS и F5
 * распознают ту же игровую ночь заново и присылают более позднее начало, а
 * ручное решение этой ночи от этого не устаревает (внешний аудит №3, B02/B03).
 */
function noteObsNight(nightSince: number): void {
  // Ночь не могла начаться раньше дня, который мы видели сами: obs-panel с
  // выключенными автосценами хранит начало ПРОШЛОЙ ночи, и D той ночи
  // считался решением новой (внешний аудит №4, H01). Такое начало заменяем
  // нашим распознаванием ночи после этого дня (или самим днём).
  const ownNight = nightAutoShowStartedAt > lastDaySeenAt ? nightAutoShowStartedAt : lastDaySeenAt;
  const since = nightSince < lastDaySeenAt ? ownNight : nightSince;
  obsNightSince = obsNightSince === null ? since : Math.min(obsNightSince, since);
}

/** Начало дня, распознанное автосменой фаз (переход в день). */
let lastDaySeenAt = 0;

/**
 * День закончил ночь OBS: и её эпоху ручных решений, и nightShow, ждущий
 * отпускания V, — он был о прошедшей ночи (внешний аудит №4, H01/H02).
 */
function endObsNight(): void {
  obsNightSince = null;
  pendingNightShowSince = null;
  obsShowAwaitingNight = null;
}

function onObsNightShow(nightSince: number): void {
  // Автосмена фаз уже видит день, а показ obs-panel запланировала ещё ночью
  // (её фаза подтверждается позже) — днём стол не открываем; если это была
  // переходная подпись, показ применится с возвратом ночи (аудит №5, §4.2).
  if (cfg.rolePhaseSwitch && lastDetectedRolePhase === "day") {
    obsShowAwaitingNight = nightSince;
    return;
  }
  noteObsNight(nightSince);
  const hadSceneHide = sceneHide;
  sceneHide = null;
  if (manualBeforeNight(obsNightSince!)) {
    showAllRoles();
    log.info(SCOPE, "ночная сцена: роли стола показаны вместе со своей");
    return;
  }
  // Игрок этой ночью решал сам — снимаем только сценовое скрытие (не его).
  if (hadSceneHide && !hadSceneHide.cssWasPresent && isRolesHiddenByCSS() && cssReason !== "manual") {
    showAllRolesCSS();
  }
}

function queueRolePhaseCheck() {
  if (!cfg.rolePhaseSwitch) return;
  if (rolePhaseCheckTimer) return;

  rolePhaseCheckTimer = setTimeout(() => {
    rolePhaseCheckTimer = null;
    applyRolePhase(detectRolePhase());
  }, 150);
}

// ─────────────────────────── стартовый экран / лобби / веб-камера ───────────────────────────

/**
 * Скип стартового окна не должен воевать с игроком.
 *
 * Раньше эта функция вызывалась раз в секунду И на каждый батч мутаций, и жала
 * «Начать игру» безусловно. Если игрок сам открывал настройки камеры/звука
 * (это то же модальное окно), расширение закрывало их снова и снова.
 *
 * Теперь: не больше нескольких попыток на одно появление окна и пауза после
 * любого действия игрока — окно, которое он открыл сам, остаётся открытым.
 */
const MAX_START_CLICK_ATTEMPTS = 3;
/** Кликабельные кандидаты на «НАЧАТЬ ИГРУ» — вместо обхода всего окна. */
const START_CANDIDATE_SELECTOR = SITE.startCandidates;
const USER_ACTION_BACKOFF_MS = 5000;
let startClickAttempts = 0;
let startModalSeen = false;
let lastUserClickAt = 0;

function clickStartGameButton() {
  if (!cfg.skipStartScreen) return;

  const welcomeModal = document.querySelector<HTMLElement>(SITE.welcomeModal);
  if (!welcomeModal) {
    // Окно закрылось — следующее появление получит свежий лимит попыток.
    if (startModalSeen) log.info(SCOPE, "стартовое окно закрыто");
    startModalSeen = false;
    startClickAttempts = 0;
    welcomeUnknownLogged = false;
    return;
  }
  if (!startModalSeen) {
    startModalSeen = true;
    startClickAttempts = 0;
  }

  // Игрок только что кликал — он пользуется интерфейсом, не мешаем.
  if (Date.now() - lastUserClickAt < USER_ACTION_BACKOFF_MS) return;

  // Окно не ушло после нескольких попыток — значит оно нужно игроку.
  if (startClickAttempts >= MAX_START_CLICK_ATTEMPTS) return;

  const modalText = norm(welcomeModal);
  const hasWelcomeText = containsAny(modalText, TEXT.welcome);

  // Видимость и disabled обязательны: ранний return кнопочной ветки теперь
  // глушит текстовый фолбэк, и скрытая/выключенная кнопка молча съедала бы
  // попытку. Сегодня бандл рисует единственную всегда активную кнопку
  // (ButtonComp без disabled-байндинга), но защита держится на нашем фильтре,
  // а не на везении разметки (контрольное ревью 05.08.2026).
  const startButtons = Array.from(welcomeModal.querySelectorAll<HTMLButtonElement>("button")).filter(
    (btn) =>
      containsAny((btn.textContent || "").toLowerCase(), TEXT.startGameButton) &&
      !btn.disabled &&
      isVisible(btn),
  );

  if (!hasWelcomeText && startButtons.length === 0) return;

  startClickAttempts++;
  if (startClickAttempts === MAX_START_CLICK_ATTEMPTS) {
    log.info(SCOPE, "start-screen skip: attempt limit reached, leaving modal alone");
  }

  if (startButtons.length > 0) {
    // Подпись кнопки не пишем: это текст сайта, сигнала он не добавляет.
    log.info(SCOPE, "стартовое окно: попытка", startClickAttempts, "— клик по кнопке");
    startButtons[0].click();
    // Текстовая ветка ниже — ФОЛБЭК для окна без <button>, а не второй клик:
    // раньше обе ветки срабатывали одним тиком («клик по кнопке» и «клик по
    // тексту» в одну миллисекунду в логе 04.08.2026) — окно получало два
    // синтетических клика подряд.
    return;
  }

  // Доп. элементы с точным текстом «НАЧАТЬ ИГРУ». Только кликабельные
  // кандидаты: querySelectorAll("*") обходил всё поддерево окна на каждой
  // мутации, а textContent наследуется — под фильтр попадали и контейнеры
  // (§4.1/§4.2, тест-набор 01.08.2026, №8).
  let startElements = Array.from(
    welcomeModal.querySelectorAll<HTMLElement>(START_CANDIDATE_SELECTOR),
  ).filter(
    (el) =>
      (TEXT.startGameButton as readonly string[]).includes(norm(el)) &&
      !startButtons.includes(el as HTMLButtonElement),
  );
  // Оставляем только самые глубокие совпадения — родитель и дитя с одним и тем
  // же текстом иначе оба считались кандидатами.
  startElements = startElements.filter(
    (el) => !startElements.some((other) => other !== el && el.contains(other)),
  );

  // Только видимый элемент (§4.2): у окна сайта бывают заготовленные, но
  // скрытые узлы. Кнопочная ветка выше фильтрует по isVisible и !disabled.
  const startTarget = startElements.find((el) => isVisible(el));
  if (startTarget) {
    log.info(SCOPE, "стартовое окно: попытка", startClickAttempts, "— клик по тексту");
    safeClick(startTarget);
    return;
  }
  // Окно есть, а нажимать нечего: раньше это состояние было полностью немым,
  // и «не пропустило стартовый экран» не имело в файле ни одного следа (AS-2).
  if (!welcomeUnknownLogged) {
    welcomeUnknownLogged = true;
    log.warn(SCOPE, "стартовое окно найдено, но кнопка запуска не распознана");
  }
}

/**
 * У кнопки камеры и кнопки настроек ОДИН И ТОТ ЖЕ класс
 * (div.button.preset-1.small.desktop-version) — селектором их не различить.
 * Раньше брался первый попавшийся элемент, и если это оказывалась шестерёнка,
 * расширение открывало/закрывало окно настроек до 10 раз подряд.
 * Различаем по иконке/подписи; если уверенности нет — не кликаем вовсе.
 */
/**
 * Иконки кнопок управления (webpack content-hash, снято с живого лобби
 * 27.07.2026). Хеш детерминирован содержимым файла, поэтому меняется только
 * при перерисовке иконки — тогда сработает позиционный фолбэк ниже.
 */
const CAMERA_ICON_HASHES = ["516810fd6c1e38f17335", "edf479f3365a51e1beca"]; // camera, camera-off
const NON_CAMERA_ICON_HASHES = [
  "652f9184e845e10a12e5", // mic
  "3a2b1603137ca0fb3eeb", // mic-off
  "e3a7cf4ee64b975985ad", // settings
];

function iconSrcOf(el: HTMLElement): string {
  return el.querySelector<HTMLImageElement>(SITE.buttonIconImg)?.getAttribute("src") || "";
}

/**
 * Найти кнопку камеры среди кнопок управления комнатой.
 *
 * У камеры, микрофона и настроек ОДИН класс и НИ ОДНОГО текстового признака:
 * ни title, ни aria-label, а подпись хоткея в шаблоне сайта закомментирована
 * (`<!-- <span v-if="hotKey" -->` — проверено в живом лобби 27.07.2026).
 * Поэтому 8.1.41 с детектом по букве «V» не находил ничего, а прежняя версия
 * искала use[href]/title — их тоже нет. Единственный настоящий признак —
 * иконка (img.button__icon с хешированным именем).
 *
 * Порядок распознавания:
 *  1. хеш иконки в известном списке камеры → это она;
 *  2. хеш в списке «точно не камера» → пропускаем кандидата;
 *  3. иконка незнакома (сайт перерисовал) → позиционный фолбэк по шаблону
 *     [камера?, микрофон, настройки]: камера есть только когда кнопок ровно
 *     три, и она первая. Меньше трёх — камеры нет, НЕ кликаем: ошибка тут
 *     означала бы выключенный микрофон или открытые настройки.
 */
function findWebcamButton(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(SITE.webcamButton));
  if (candidates.length === 0) return null;

  const known = candidates.find((el) =>
    CAMERA_ICON_HASHES.some((hash) => iconSrcOf(el).includes(hash)),
  );
  if (known) return known;

  const allIconsKnown = candidates.every((el) => {
    const src = iconSrcOf(el);
    return NON_CAMERA_ICON_HASHES.some((hash) => src.includes(hash));
  });
  if (allIconsKnown) {
    // Все кнопки опознаны и камеры среди них нет (например, судья без видео).
    log.debug(SCOPE, "camera button absent among known icons");
    return null;
  }

  if (candidates.length === 3) {
    log.debug(SCOPE, "camera icon unknown — falling back to position 0 of 3");
    return candidates[0];
  }
  log.debug(SCOPE, `camera button not identified (${candidates.length} candidates) — skip`);
  return null;
}

/**
 * Предыгровой экран (в шаблоне сайта — стадия `voting_for_game_start`).
 *
 * Раньше требовалось СОВПАДЕНИЕ ТЕКСТА `.new-stage__name` со списком
 * «идет набор игроков» И наличие ссылки-приглашения. Оба условия протухли
 * (сверено с живым лобби и room-бандлом 27.07.2026):
 *  • в этом блоке теперь локализованный текст стадии («Голосование за начало
 *    игры»), слова «набор игроков» в комнатном бандле нет вообще — совпадение
 *    не срабатывало НИКОГДА, и камера не выключалась даже при найденной кнопке;
 *  • `.invitation-link` рендерится только когда у комнаты есть ссылка
 *    (в лиге её нет), так что требовать его нельзя.
 * Признак структурный и не зависит от языка: `.new-stage__name` существует
 * ТОЛЬКО на предыгровом экране (в остальных стадиях там `.stage__name`).
 */
function isInLobby(): boolean {
  if (document.querySelector(SITE.lobbyStageName)) return true;
  return document.querySelector(SITE.invitationLink) !== null;
}

function disableWebcams() {
  if (!isInLobby()) {
    // Вышли из лобби — сброс флагов: раньше webcamDisabled жил до disable(),
    // и в следующей игре той же вкладки камера не отключалась.
    webcamDisabled = false;
    webcamGaveUp = false;
    webcamUnknownLogged = false;
    return;
  }
  if (webcamDisabled || webcamGaveUp) return;
  if (cfg.disableWebcam) {
    log.debug(SCOPE, "webcam disabling forbidden by setting");
    return;
  }
  // Интервал уже работает — не перезапускаем: каждый повторный вызов (тик 1с
  // + каждый батч мутаций) обнулял clickCount, превращая лимит 10 кликов
  // в бесконечные 5 кликов/с.
  if (webcamClickInterval) return;

  const webcamButton = findWebcamButton();
  if (!webcamButton) return;

  if (webcamButton.classList.contains(SITE.webcamButtonOffClass)) {
    webcamDisabled = true;
    return;
  }

  log.debug(SCOPE, "webcam on, turning off...");
  try {
    let clickCount = 0;
    const maxClicks = 10;

    webcamClickInterval = setInterval(() => {
      if (clickCount >= maxClicks) {
        if (webcamClickInterval) clearInterval(webcamClickInterval);
        webcamClickInterval = null;
        // Не помогло за 10 кликов — сдаёмся до следующего лобби, а не
        // начинаем заново с нулевым счётчиком. Латч был полностью нем: у
        // жалобы «камера не выключилась» не было ни одного следа в файле
        // (аудит наблюдаемости 02.08.2026, AS-2).
        webcamGaveUp = true;
        log.warn(
          SCOPE,
          "камера не переключилась за",
          maxClicks,
          "кликов — автоклики остановлены до следующего лобби",
        );
        return;
      }
      const currentButton = findWebcamButton();
      if (!currentButton) {
        if (webcamClickInterval) clearInterval(webcamClickInterval);
        webcamClickInterval = null;
        if (!webcamUnknownLogged) {
          webcamUnknownLogged = true;
          log.warn(SCOPE, "кнопка камеры не распознана — автоклик по камере прекращён");
        }
        return;
      }
      if (currentButton.classList.contains(SITE.webcamButtonOffClass)) {
        webcamDisabled = true;
        if (webcamClickInterval) clearInterval(webcamClickInterval);
        webcamClickInterval = null;
        return;
      }
      currentButton.click();
      clickCount++;
    }, 200);
  } catch (e) {
    log.debug(SCOPE, "webcam disable error", e);
  }
}

// ─────────────────────────── хоткей D/В ───────────────────────────

function handleRoleKey(e?: KeyboardEvent) {
  // Пока подсматриваем, клавиша скрытия не действует — и человек должен
  // понимать почему: нажал — ничего не произошло — в логе есть строка.
  if (peeking) {
    e?.stopPropagation();
    log.info(SCOPE, "клавиша скрытия роли не действует, пока удерживается «подсмотреть»");
    return;
  }
  // Активна подмена роли (F): уступаем, скрытие вернётся после E (аудит
  // 29.08.2026, №4). Тост обязателен (F-5, прецедент RF-1).
  if (isRoleFaked()) {
    e?.stopPropagation();
    e?.preventDefault();
    log.info(SCOPE, "клавиша скрытия роли не действует, пока активна подмена (E — сбросить)");
    showToast("Скрытие не действует: активна подмена роли. E — сбросить", {
      key: "role-hide-vs-fake",
      kind: "warn",
    });
    return;
  }
  // Сайту нажатие не отдаём: роли переключает наш CSS (одна власть).
  e?.stopPropagation();
  lastManualRoleActionAt = Date.now();
  if (isRolesHiddenByCSS() || isInlineHidden()) {
    showAllRoles();
    // info (жалоба 04.10.2026): эта ветка открывает роли ВСЕГО стола.
    log.info(SCOPE, "клавиша скрытия роли: роли стола показаны");
  } else {
    hideAllRolesCSS("manual");
    log.info(SCOPE, "клавиша скрытия роли: роли стола скрыты");
  }
}

/**
 * D сайта, не забранный нашим хоткеем (Ctrl/Cmd+D у опции «хоткеи с
 * модификатором», простой D при переназначенной клавише). Его решение примет
 * syncSiteFlag по смене флага; здесь — только то, что сайт делать не должен:
 * автоповторы (hotkeys-js переключал флаг на каждом — мигание) и само
 * нажатие под «подсмотреть»/подменой.
 */
function handleSiteRoleKey(e: KeyboardEvent): void {
  if (e.altKey || e.shiftKey) return; // для hotkeys-js это не D
  if (e.repeat || peeking || isRoleFaked()) {
    e.stopPropagation();
    if (!e.repeat) e.preventDefault();
  }
}

const ROLE_KEY_OPTS = {
  preventDefault: false,
  // Автоповтор зажатого D сайту не отдаём (adversarial 21.10.2026, №1).
  swallowRepeat: true,
};

// ─────────────────────────── игровая страница: вкл/выкл ───────────────────────────

function enableGamePage() {
  if (gameInterval !== null) return;
  log.info(SCOPE, "game-page behaviors enabled");

  gameInterval = setInterval(() => {
    checkGameRoute();
    clickStartGameButton();
    disableWebcams();
    queueRolePhaseCheck();
  }, 1000);

  // Одна власть: скрытие сайта нейтрализовано, его текущее «скрыто»
  // (зритель, прошлое нажатие) принимаем в наш слой сразу.
  installRoleDisplayOverride();
  sweepOrphanFakeIfIdle();
  lastRoutePath = null;
  sawRunningGame = !!document.querySelector(SITE.roomFixedState);
  checkGameRoute();
  siteFlag = null;
  syncSiteFlag();
  unsubRoleDomImmediate = onDomChangeImmediate(onRoleDomImmediate);
  // Команды ролей сайту от игрока (см. lastSiteRoleCommandAt). D, дошедший
  // до document, наш роутер не забрал — его получит сайт.
  onSiteCommandKey = (e: Event) => {
    const k = e as KeyboardEvent;
    if (siteKeyCode(k) !== 68) return; // «d» для hotkeys-js — по keyCode
    // Прежний кандидат уже отдиспатчен — учесть его ДО замены: два нажатия
    // подряд раньше нулевого таймера теряли принятое первое (аудит №6, C04).
    siteRoleCommandAt();
    const entry = { e: k, at: Date.now(), reachedWindow: false };
    pendingRoleKey = entry;
    // Принял ли сайт — известно после диспатча; без ролей на столе смены
    // флага не будет, поэтому досматриваем и отдельно (правило первой роли).
    setTimeout(() => {
      if (pendingRoleKey === entry) siteRoleCommandAt();
    }, 0);
  };
  onSiteCommandClick = (e: Event) => {
    const item = (e.target as Element | null)?.closest?.("li, button, [role=\"button\"]");
    const text = norm(item);
    if (item && (containsAny(text, TEXT.showRoles) || containsAny(text, TEXT.hideRoles))) {
      lastSiteRoleCommandAt = Date.now();
    }
  };
  document.addEventListener("keydown", onSiteCommandKey, true);
  onSiteCommandBubble = (e: Event) => {
    if (pendingRoleKey?.e === e) pendingRoleKey.reachedWindow = true;
  };
  window.addEventListener("keydown", onSiteCommandBubble);
  document.addEventListener("click", onSiteCommandClick, true);

  startInitialAutoHideRole();
  // Фазу — сразу, а не первым тиком интервала: днём при одной автосмене роли
  // были открыты ~1,15 с после включения (внешний аудит №3, B05).
  if (cfg.rolePhaseSwitch) applyRolePhase(detectRolePhase());
  // Автосцены включены настройками, а obs-panel ещё не запущена (менеджер
  // включает фичи по очереди, с чужими await между ними) — сцена эфира
  // неизвестна: стол под сценовым скрытием до первого слова гейта
  // (внешний аудит №5, B04).
  if (cfg.obsAutoExpected && !obsAutoScenesActive() && !sceneHide) {
    sceneHide = { manualMark: lastManualRoleActionAt, cssWasPresent: isRolesHiddenByCSS() };
    if (!sceneHide.cssWasPresent) hideAllRolesCSS("auto");
  }

  // Отмечаем действия игрока, чтобы автоклики не спорили с ним.
  // isTrusted отсекает наши же синтетические клики.
  onUserClick = (e: Event) => {
    if ((e as MouseEvent).isTrusted) lastUserClickAt = Date.now();
  };
  document.addEventListener("click", onUserClick, true);
  document.addEventListener("pointerdown", onUserClick, true);

  unsubKeyboard = keyboard.register(roleHideKey, handleRoleKey, ROLE_KEY_OPTS);
  unsubSceneGate = setRoleSceneGateListener(syncRolesWithSceneGate);
  unsubSiteRoleKey = keyboard.observe("KeyD", handleSiteRoleKey);

  unsubGameDom = onDomChange((muts) => {
    if (muts.some((m) => m.addedNodes.length)) {
      clickStartGameButton();
      disableWebcams();
      queueRolePhaseCheck();
    }
  });

  setTimeout(() => queueRolePhaseCheck(), 2000);
}

function disableGamePage() {
  if (gameInterval !== null) {
    clearInterval(gameInterval);
    gameInterval = null;
  }
  stopInitialAutoHideRole();
  if (webcamClickInterval) {
    clearInterval(webcamClickInterval);
    webcamClickInterval = null;
  }
  unsubGameDom?.();
  unsubGameDom = null;
  unsubKeyboard?.();
  unsubKeyboard = null;
  unsubSceneGate?.();
  unsubSceneGate = null;
  unsubSiteRoleKey?.();
  unsubSiteRoleKey = null;
  unsubRoleDomImmediate?.();
  unsubRoleDomImmediate = null;
  if (onSiteCommandKey) document.removeEventListener("keydown", onSiteCommandKey, true);
  if (onSiteCommandBubble) window.removeEventListener("keydown", onSiteCommandBubble);
  onSiteCommandBubble = null;
  if (onSiteCommandClick) document.removeEventListener("click", onSiteCommandClick, true);
  onSiteCommandKey = null;
  onSiteCommandClick = null;
  pendingRoleKey = null;
  // Флаг сайта снова его: без нашего слоя роли видны так, как решил сайт.
  removeRoleDisplayOverride();
  siteFlag = null;
  // Состояние сценового скрытия — от прежней жизни фичи.
  sceneHide = null;
  pendingNightShowSince = null;
  obsNightSince = null;
  lastDaySeenAt = 0;
  cancelDayConfirm();
  dayPending = false;
  resumeShowMark = null;
  obsShowAwaitingNight = null;
  obsWasActive = false;
  // Подсматривание снимаем ПЕРВЫМ делом: если фичу выключили с зажатой
  // клавишей, роли остались бы на экране — на стриме это утечка.
  stopPeek(true);
  unsubPeek?.();
  unsubPeek = null;
  roleePeekKey = "";
  if (onUserClick) {
    document.removeEventListener("click", onUserClick, true);
    document.removeEventListener("pointerdown", onUserClick, true);
  }
  onUserClick = null;
  startModalSeen = false;
  startClickAttempts = 0;
  if (rolePhaseCheckTimer) {
    clearTimeout(rolePhaseCheckTimer);
    rolePhaseCheckTimer = null;
  }
  if (pendingNightRoleShowTimer) {
    clearTimeout(pendingNightRoleShowTimer);
    pendingNightRoleShowTimer = null;
  }
}

// ─────────────────────────── применение настроек ───────────────────────────

function applyConfig(ctx: FeatureContext) {
  const s = ctx.settings;
  const prevAutoHide = cfg.autoHideRoles;

  // Переназначаемая клавиша скрытия роли — перерегистрируем, если изменилась.
  const newHideKey = s.hotkey_role_hide || "KeyD";
  if (newHideKey !== roleHideKey) {
    roleHideKey = newHideKey;
    if (unsubKeyboard) {
      unsubKeyboard();
      unsubKeyboard = keyboard.register(roleHideKey, handleRoleKey, ROLE_KEY_OPTS);
    }
  }

  // Клавиша «подсмотреть» — отдельная от скрытия роли: их держат нажатыми
  // по-разному, и путать их в одной кнопке нельзя (решение владельца).
  const newPeekKey = s.hotkey_role_peek || "KeyV";
  if (newPeekKey !== roleePeekKey) bindPeekKey(newPeekKey);

  const prevPhaseSwitch = cfg.rolePhaseSwitch;
  cfg = {
    autoAccept: s.auto_accept_enabled === true,
    skipStartScreen: s.skip_start_screen_enabled !== false,
    disableWebcam: s.disable_webcam_clicks === true,
    autoHideRoles: s.auto_hide_roles_enabled === true,
    // Автосмена САМОСТОЯТЕЛЬНА (просьба Ильи 12.08.2026). Раньше она гейтилась
    // авто-скрытием, то есть включённый в одиночку тумблер не делал ничего —
    // молчаливый обман, а не замысел. Смысл у неё свой и понятный: днём роли
    // скрыты, ночью показаны; авто-скрытие добавляет к этому «скрыть сразу при
    // входе и держать скрытым вне ночи».
    rolePhaseSwitch: s.role_phase_auto_switch_enabled === true,
    // То же правило, что effectiveAutoMode в obs-panel: до включения панели
    // её состояние (obsAutoScenesActive) — false, поэтому читаем настройки.
    obsAutoExpected: s.obs_auto_mode_enabled === true && s.obs_enabled === true,
  };

  // Включили автосмену посреди фазы — переинициализируем её на ближайшей
  // проверке: прежде отменённый выключением ночной показ не перевзводился, и
  // роли оставались скрыты до новой ночи (внешний аудит 21.10.2026, H03).
  if (!prevPhaseSwitch && cfg.rolePhaseSwitch) {
    rolePhaseInitialized = false;
    // Включили посреди игры — сразу (внешний аудит №3, B05).
    if (gameInterval !== null) applyRolePhase(detectRolePhase());
  }

  // Выключили фазовое переключение — гасим уже взведённый ночной таймер:
  // раньше он переживал выключение (проверка настройки жила в пути, который
  // сам этой настройкой гейтится) и через ≤3с показывал роль вопреки тумблеру.
  if (prevPhaseSwitch && !cfg.rolePhaseSwitch && pendingNightRoleShowTimer) {
    clearTimeout(pendingNightRoleShowTimer);
    pendingNightRoleShowTimer = null;
  }

  // Автопринятие: тумблер
  if (cfg.autoAccept) enableAutoAccept();
  else disableAutoAccept();

  // Реакция на смену настроек скрытия на лету. Показываем, только когда
  // выключили ПОСЛЕДНЮЮ прячущую настройку: выключение авто-скрытия днём
  // при включённой автосмене снимало и её дневное скрытие — роли открыты до
  // новой фазы (внешний аудит 21.10.2026, B08).
  const hidBefore = prevAutoHide || prevPhaseSwitch;
  const hidesNow = cfg.autoHideRoles || cfg.rolePhaseSwitch;
  if (prevAutoHide && !cfg.autoHideRoles) stopInitialAutoHideRole();
  if (hidBefore && !hidesNow) {
    if (sceneHide) {
      // Эфир не на ночной сцене: стоящий CSS держится теперь ТОЛЬКО сценой —
      // вернётся ночная сцена, снимем. Снятый игроком руками — его решение:
      // отметку ручного действия не сдвигаем, иначе самолечение спрятало бы
      // показанное им.
      sceneHide = {
        cssWasPresent: false,
        manualMark: isRolesHiddenByCSS() ? lastManualRoleActionAt : sceneHide.manualMark,
      };
    } else {
      // Выключенное скрытие удерживаемое «подсмотреть» не вернёт (H05);
      // ручное скрытие игрока — его решение, оно остаётся.
      if (peekRestoreReason === "auto") {
        peekRestoreHidden = false;
        peekRestoreInline = false;
      }
      if (cssReason !== "manual") showAllRoles();
    }
  } else if (!prevAutoHide && cfg.autoHideRoles) {
    // Включили авто-скрытие ПОСРЕДИ игры — это решение игрока «прятать»:
    // ночной показ этой ночью его не переигрывает (иначе касание V ночью
    // открывало только что спрятанное). Запуск страницы — не решение.
    if (gameInterval !== null) lastManualRoleActionAt = Date.now();
    // CSS теперь держит и настройка: вернувшаяся ночная сцена его не снимает
    // как «только сценовый» (внешний аудит №3, B04).
    if (sceneHide) sceneHide = { ...sceneHide, cssWasPresent: true };
    startInitialAutoHideRole();
  }
}

// ─────────────────────────── публичная фича ───────────────────────────

export const autoStartFeature: Feature = {
  id: "auto-start",
  // Управляется несколькими настройками сразу → включена всегда, гейтит под-поведения внутри.
  settingKey: null,

  enable(ctx) {
    // Следы прежней копии скрипта (обновление расширения посреди игры: DOM
    // остаётся, состояние модулей — нет) — внешний аудит 21.10.2026, раздел E.
    sweepOrphanPins();
    applyConfig(ctx);
    // Игровая страница активна всегда: под-поведения сами проверяют свои тумблеры,
    // а наблюдатели/интервалы дёшевы благодаря общему onDomChange.
    enableGamePage();
  },

  update(ctx) {
    applyConfig(ctx);
  },

  disable() {
    disableAutoAccept();
    disableGamePage();

    // Снять наше скрытие: дальше роли ведёт сам сайт.
    showAllRoles();

    // Сброс состояния
    cfg = {
      autoAccept: true,
      skipStartScreen: true,
      disableWebcam: false,
      autoHideRoles: false,
      rolePhaseSwitch: false,
      obsAutoExpected: false,
    };
    peeking = false;
    peekRestoreHidden = false;
    peekRestoreInline = false;
    rolePhaseInitialized = false;
    lastDetectedRolePhase = null;
    nightAutoShowStartedAt = 0;
    lastManualRoleActionAt = 0;
    lastSiteRoleCommandAt = 0;
    pendingRoleKey = null;
    lastOurShowAt = 0;
    cancelDayConfirm();
    dayPending = false;
    resumeShowMark = null;
    obsShowAwaitingNight = null;
    webcamDisabled = false;
    videoButtonClicked = false;
  },
};
