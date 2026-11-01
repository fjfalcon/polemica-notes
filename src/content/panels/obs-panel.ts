/**
 * Фича: плавающая панель управления сценами OBS на странице игры
 * + авто-переключение сцен день/ночь по анализу DOM-стадий.
 *
 * Порт obs-floating-panel.js в новую TS-архитектуру.
 *
 * Состоит из двух частей:
 *  • ObsPanel  — UI-панель на базе FloatingPanel (список сцен, статус, клик-переключение).
 *  • obsPanelFeature — Feature: жизненный цикл, авто-режим день/ночь, OBS-messaging.
 *
 * Команды OBS идут в background через sendRuntime({type:"obs_command", ...}),
 * события OBS приходят через onMessage (obs_event).
 *
 * Авто-настройки сцен (obs_auto_mode_enabled / obs_day_scene / obs_night_scene)
 * берутся из ctx.settings. Позицию/размер панели persist'ит сам FloatingPanel
 * (storageKey "obs-panel"); состояние авто-сцены — в browser.storage.local
 * (ключ obs_auto_scene_state).
 *
 * settingKey: "obs_floating_panel_enabled".
 */
import { FloatingPanel } from "@core/FloatingPanel";
// isVisible переименован: в этом модуле имя занято флагом видимости панели.
import { onDomChange, onDomChangeImmediate, isVisible as isElementVisible } from "@core/dom";
import { browser } from "@core/env";
import { log } from "@core/log";
import { onMessage, sendRuntime } from "@core/messaging";
import {
  SITE,
  classifyPhaseText,
  endedScreenVisible,
  staleDayLabel,
  matchFinishedVisible,
  ownEliminatedVisible,
  SITE_CLASS,
} from "@core/selectors";
import { gameRouteKey, isGameRoomPath } from "@shared/routes";
import {
  getRoleVisibilityTargets,
  pinHolds,
  pinOwnRole,
  releasePins,
  sweepOrphanPins,
} from "../role-pin";
import { showToast } from "@core/toast";
import type { Feature, FeatureContext } from "@core/feature";
import type { ObsConnectionState, ObsScene } from "@shared/types";

const SCOPE = "obs-panel";
const OBS_STATE_MAX_AGE_MS = 2 * 60_000;
/**
 * Потолок возраста восстановимого состояния автосцены. Больше пары минут
 * (смерть service worker + переподключение), но конечный: фаза — величина,
 * живущая минуты, и «восстанавливать» её из другого часа бессмысленно.
 */
const RESTORE_MAX_AGE_MS = 10 * 60_000;

type TimeOfDay = "day" | "night";
type ConnStatus = "default" | "connected" | "error";

interface AutoSceneState {
  sessionId: string | null;
  currentTimeOfDay: TimeOfDay | null;
  /** Легаси-поле старых записей: читать и писать запрещено (находка E). */
  lastAppliedRoleVisibility?: string | null;
  timestamp: number;
}

// ─────────────────────────── вспомогательные функции DOM ───────────────────────────

function norm(el: { textContent?: string | null } | null | undefined): string {
  return (el?.textContent || "").toLowerCase();
}

/**
 * Ведёт ли ЭТА вкладка автосцену прямо сейчас — ответ на пинг владения.
 *
 * Чистая функция с явными входами: предикат из четырёх условий, и в нём уже
 * была ошибка (отвечали по одной настройке, а она остаётся включённой до
 * закрытия вкладки — вкладка с доигранным матчем держала сцену до 20 минут).
 *
 * `phaseKnown` — «я в этой вкладке уже определял фазу», а не «на странице
 * сейчас видно 10 плиток»: сайт пересобирает плитки на КАЖДОЙ смене фазы, и
 * пинг, прилетевший ровно в этот кадр, отнял бы владение у настоящего эфира
 * (ревью 02.08.2026).
 */
export function drivesAutoScene(input: {
  autoModeOn: boolean;
  pathname: string;
  phaseKnown: boolean;
  /**
   * Фаза подтверждена ЖИВЬЁМ в этой вкладке (детектор увидел маркеры стадии),
   * а не восстановлена из общего storage. Без этого признака вкладка, ни разу
   * не распознавшая фазу, отвечала «автосцену веду я» чужой фазой из
   * `obs_auto_scene_state` — и живой матч в соседней вкладке получал отказ на
   * каждой смене дня/ночи (жалоба 04.08.2026, лог: owner без единой строки
   * «фаза подтверждена» держал владение весь вечер).
   */
  phaseSeenLive: boolean;
  /**
   * Виден экран набора игроков (`.new-stage`) — сайт рисует его РОВНО при
   * `voting_for_game_start`, то есть это прямое доказательство, что матч в
   * этой вкладке НЕ идёт. Главный сигнал для сценария «та же комната, новая
   * игра»: владение отдаётся сразу, а протухание по непониманию остаётся
   * страховкой для комнат, где не видно ни маркеров, ни пре-гейма.
   */
  pregameVisible: boolean;
  matchFinished: boolean;
}): boolean {
  return (
    input.autoModeOn &&
    isGameRoomPath(input.pathname) &&
    input.phaseKnown &&
    input.phaseSeenLive &&
    !input.pregameVisible &&
    !input.matchFinished
  );
}

/**
 * Виден ли экран fixedState (пауза/промах/итог) — он рисуется ВМЕСТО роллера
 * и сам по себе доказывает идущий (или только что шедший) матч. Итоговые
 * экраны для владения отсекает отдельный гейт matchFinished.
 */
function fixedStateScreenVisible(): boolean {
  const el = document.querySelector<HTMLElement>(SITE.roomFixedState);
  return !!el && isElementVisible(el);
}

/** Виден ли экран набора игроков — см. pregameVisible в drivesAutoScene. */
function pregameScreenVisible(): boolean {
  const el = document.querySelector<HTMLElement>(SITE.pregameScreen);
  return !!el && isElementVisible(el);
}

/** Есть ли на странице активный игровой интерфейс (≥10 игроков/камер + контролы). */
function hasActiveGameInterface(): boolean {
  const playerCount = document.querySelectorAll(SITE.playerDesktop).length;
  const webcamCount = document.querySelectorAll(SITE.playerVideo).length;
  const gameControlCount = document.querySelectorAll(SITE.obsGameControls).length;

  return (
    (playerCount >= 10 || webcamCount >= 10 || (playerCount >= 8 && webcamCount >= 8)) &&
    gameControlCount > 0
  );
}

// ─────────────────────────── UI-панель ───────────────────────────

class ObsPanel extends FloatingPanel {
  private statusEl: HTMLElement | null = null;
  private scenesEl: HTMLElement | null = null;
  private scenes: ObsScene[] = [];
  private currentScene: string | null = null;
  /** Вызывается панелью при клике по сцене. */
  onSceneClick: ((sceneName: string) => void) | null = null;
  /** Вызывается при клике по кнопке закрытия. */
  onClose: (() => void) | null = null;

  constructor() {
    super({
      storageKey: "obs-panel",
      title: "OBS Scenes",
      width: 280,
      height: 220,
      minWidth: 240,
      minHeight: 160,
      resizable: true,
      className: "obs-floating-panel",
    });
  }

  protected renderBody(body: HTMLElement): void {
    // Кнопка закрытия в заголовке (отключает настройку плавающей панели).
    this.addHeaderButton(
      "×",
      () => {
        this.onClose?.();
      },
      "Закрыть",
    );

    const status = document.createElement("div");
    status.className = "obs-connection-status";
    status.textContent = "Подключение...";
    Object.assign(status.style, {
      textAlign: "center",
      padding: "6px 8px",
      borderRadius: "8px",
      fontSize: "12px",
      marginBottom: "8px",
      background: "rgba(0,0,0,.12)",
      color: "rgba(255,255,255,.65)",
    } as CSSStyleDeclaration);

    const scenes = document.createElement("div");
    scenes.className = "obs-scenes-container";
    Object.assign(scenes.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    } as CSSStyleDeclaration);

    body.append(status, scenes);

    this.statusEl = status;
    this.scenesEl = scenes;

    this.renderScenes();
  }

  setConnectionStatus(text: string, status: ConnStatus = "default"): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    const muted = status === "default" ? "rgba(255,255,255,.65)" : "rgba(255,255,255,.85)";
    this.statusEl.style.color = muted;
  }

  setScenes(scenes: ObsScene[], currentScene: string | null): void {
    this.scenes = scenes || [];
    this.currentScene = currentScene;
    this.renderScenes();
  }

  setCurrentScene(currentScene: string | null): void {
    this.currentScene = currentScene;
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (!this.scenesEl) return;
    this.scenesEl.querySelectorAll<HTMLElement>(".obs-scene-item").forEach((item) => {
      const active = item.dataset.scene === this.currentScene;
      item.style.background = active ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.12)";
      item.style.fontWeight = active ? "600" : "400";
    });
  }

  private renderScenes(): void {
    if (!this.scenesEl) return;
    this.scenesEl.innerHTML = "";

    if (!this.scenes || this.scenes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "obs-no-scenes";
      empty.textContent = "Нет доступных сцен";
      Object.assign(empty.style, {
        textAlign: "center",
        color: "rgba(255,255,255,.55)",
        fontSize: "12px",
        padding: "20px",
        fontStyle: "italic",
      } as CSSStyleDeclaration);
      this.scenesEl.appendChild(empty);
      return;
    }

    this.scenes.forEach((scene) => {
      const item = document.createElement("div");
      item.className = "obs-scene-item";
      item.dataset.scene = scene.sceneName;
      const active = scene.sceneName === this.currentScene;
      Object.assign(item.style, {
        padding: "7px 10px",
        background: active ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.12)",
        borderRadius: "8px",
        cursor: "pointer",
        fontWeight: active ? "600" : "400",
      } as CSSStyleDeclaration);

      const name = document.createElement("span");
      name.className = "obs-scene-name";
      name.textContent = scene.sceneName;
      item.appendChild(name);

      item.addEventListener("click", () => {
        this.onSceneClick?.(scene.sceneName);
      });

      this.scenesEl!.appendChild(item);
    });
  }
}

// ─────────────────────────── состояние авто-режима ───────────────────────────

let panel: ObsPanel | null = null;

let autoModeEnabled = false;
/** Конец матча открывает стол (roles_reveal_on_game_end) — пин своей роли снимается. */
let revealOnEnd = true;
/** Показ плавающей панели (obs_floating_panel_enabled). Автомод от неё не зависит. */
let panelEnabled = false;
let dayScene = "";
let nightScene = "";
/** Выбыл из матча — ночью эфир на дневной сцене (obs_day_scene_when_out). */
let dayWhenOut = true;

let scenes: ObsScene[] = [];
let currentScene: string | null = null;
let obsSessionId: string | null = null;

let currentTimeOfDay: TimeOfDay | null = null;
/**
 * Фаза распознана детектором ЭТОЙ вкладки по живым маркерам стадий — без
 * фолбэка — хотя бы раз в ТЕКУЩЕЙ комнате (pathname). Два «не годится»:
 *  • `currentTimeOfDay` — его заполняет и restorePersistedAutoState из ОБЩЕГО
 *    storage.local, то есть фазой другой вкладки из прошлой игры;
 *  • «подтверждённая СМЕНА фазы» — после F5 restore уже дал актуальную фазу,
 *    смены не будет всю дневную фазу, и живой владелец не смог бы защитить
 *    владение (контрольное ревью 04.08.2026, блокер 2); а фолбэк-«day» при
 *    нераспознанных маркерах, наоборот, «подтверждал» смену из null и делал
 *    флаг вакуумным (блокер 1).
 * Единственная точка взведения — обёртка detectTimeOfDay при распознании.
 */
let phaseConfirmedLive = false;
/**
 * ПОСЛЕДНИЙ вызов детектора распознал маркеры (не фолбэк). Отдельно от
 * phaseConfirmedLive: тот липкий на комнату (защита владения), а этот — про
 * конкретный вызов. Жалоба 31.08.2026: на входе в комнату детектор падал в
 * фолбэк «не понял → день», и «день» ПОДТВЕРЖДАЛСЯ как смена null → day —
 * прегейм-сцена стримера («Скоро начнется») сменялась «Днём» ещё на экране
 * ожидания, а нулевая ночь (раздача, знакомство мафии) шла в эфире на
 * дневной сцене до первого живого распознавания (63 с по логу).
 */
let lastDetectWasLive = false;
/** Комната, в которой флаг взведён: смена pathname делает фазу «не живой». */
let phaseFlagPathname = "";
let lastAppliedRoleVisibility: "visible" | "hidden" | null = null;
const roleVisibilityDelayMs = 3000;
/**
 * Реестр изменённых нами элементов ролей.
 *
 * Set, а не только WeakMap: WeakMap нельзя обойти, поэтому при выключении
 * авто-режима мы не могли вернуть исходные стили — роль оставалась скрытой
 * (или наоборот, принудительно показанной) до перерисовки страницы сайтом
 * (аудит lifecycle 01.08.2026, находка 7). Храним и приоритет: мы пишем
 * !important, и «просто снять значение» недостаточно.
 */
/**
 * Снимки/пины своей роли уехали в ../role-pin (аудит скрытия ролей
 * 29.08.2026): пин обязан сниматься «подсмотреть»-механизмом auto-start без
 * войны снимков, а латч — проверяться по живому узлу, не по глобальной
 * переменной.
 */
function restoreRoleVisibility(): void {
  releasePins();
  lastAppliedRoleVisibility = null;
}

// Таймеры/подписки (всё должно быть снято в disable()).
let unsubMessage: (() => void) | null = null;
let unsubDom: (() => void) | null = null;
let unsubRouteImmediate: (() => void) | null = null;
let gameUiDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let timeOfDayCheckDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Страховочный редкий опрос фазы (см. startDOMMonitoring). */
let timeOfDayFallbackTimer: ReturnType<typeof setInterval> | null = null;
let timeOfDayCheckQueued = false;
let pendingTimeOfDay: TimeOfDay | null = null;
let pendingTimeOfDayConfirmTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRoleVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRoleVisibilityTarget: "visible" | "hidden" | null = null;

let isVisible = false;

// ─────────────────────────── OBS-команды (через background) ───────────────────────────

async function obsCommand(
  command: "get_status" | "set_scene" | "room_entered",
  data?: { sceneName?: string; manual?: boolean },
): Promise<any> {
  return sendRuntime<any>({ type: "obs_command", command, data });
}

/** Последнее известное роутеру состояние «мы в игровой комнате». */
let obsRoomRouteLast = false;

/**
 * Сигнал роутера «вошли в игровую комнату» → background даёт мёртвому
 * соединению OBS немедленную плотную попытку вместо ожидания редкого тика
 * (жалоба 01.10.2026: OBS запустили позже браузера, бюджет сгорел до игры).
 * Все гейты (настройки, ручной дисконнект, блокировка, «уже подключены») —
 * на стороне background: правда о соединении живёт там.
 */
export function syncObsRoomRoute(inRoom: boolean): void {
  if (inRoom === obsRoomRouteLast) return;
  obsRoomRouteLast = inRoom;
  if (!inRoom) return;
  void obsCommand("room_entered").catch(() => {
    /* background спит/недоступен — редкий режим остаётся страховкой */
  });
}

/**
 * Переключить сцену. manual=true — это КЛИК ПОЛЬЗОВАТЕЛЯ в панели: такая
 * команда проходит мимо проверки владельца автосцены и забирает владение
 * этой вкладке.
 */
async function switchScene(sceneName: string, manual = false): Promise<boolean> {
  const epoch = sceneInfoEpoch;
  const response = await obsCommand("set_scene", { sceneName, manual });
  // Отказ по владению приходит как success с data.ignored: сцену НЕ трогали,
  // поэтому ни currentScene, ни подсветку обновлять нельзя — иначе панель
  // показывала бы сцену, которой в OBS нет, а автопуть переставал бы
  // повторять попытки (ревью пакета D, блокер).
  if (response?.success && response.data?.ignored === "not_owner") {
    log.info(SCOPE, "смена сцены отклонена: автосценой владеет другая вкладка игры");
    return false;
  }
  if (response && response.success) {
    // Именно sceneName: раньше сюда передавалась модульная currentScene,
    // т.е. подсвечивалась ПРОШЛАЯ сцена, а не только что установленная.
    // Но только если за время запроса не пришло событие сцены: оно новее
    // нашего ответа (стример вручную вернул день) — поздний успех ночи
    // открывал роли на фактически дневной сцене (внешний аудит №3, B01).
    if (epoch === sceneInfoEpoch) {
      currentScene = sceneName;
      panel?.setCurrentScene(sceneName);
    }
    return true;
  } else {
    log.error(SCOPE, "Failed to switch scene", response?.error);
    throw new Error(response?.error || "Unknown error");
  }
}

/**
 * Эпоха сведений о сцене: растёт на каждом событии сцены от OBS. Ответ
 * get_status, запрошенный ДО события, — устаревший снимок: прежде он
 * перетирал уже обработанный уход с ночной сцены, восстанавливал ночь и
 * снимал скрытие своей роли на дневной сцене (внешний аудит №2, B01).
 */
let sceneInfoEpoch = 0;

async function requestOBSStatus(): Promise<void> {
  try {
    const epoch = sceneInfoEpoch;
    const response = await obsCommand("get_status");
    if (response && response.success) {
      const status = response.data;
      if (status && status.connected) {
        panel?.setConnectionStatus("Подключено", "connected");
        scenes = status.scenes || [];
        if (epoch === sceneInfoEpoch) currentScene = status.currentScene ?? null;
        panel?.setScenes(scenes, currentScene);
      } else if (epoch === sceneInfoEpoch) {
        // Отрицательный снимок старше принятого события сцены (реконнект и
        // свежая NIGHT пришли, пока ответ был в пути) — устарел так же, как
        // положительный: прежде он стирал новую NIGHT, и heal прятал стол
        // навсегда (внешний аудит №4, H03).
        panel?.setConnectionStatus("Не подключено", "error");
        scenes = [];
        currentScene = null;
        panel?.setScenes(scenes, currentScene);
      }
    } else {
      panel?.setConnectionStatus("Ошибка подключения", "error");
    }
  } catch (e) {
    log.error(SCOPE, "Failed to request OBS status", e);
    panel?.setConnectionStatus("Ошибка", "error");
  }
}

// ─────────────────────────── persist состояния авто-сцены ───────────────────────────

async function getStoredConnectionState(): Promise<ObsConnectionState | null> {
  try {
    const res = await browser.storage.local.get(["obs_connection_state"]);
    const state = (res as { obs_connection_state?: ObsConnectionState }).obs_connection_state;
    if (!state || !Number.isFinite(state.timestamp)) return null;
    if (Date.now() - state.timestamp > OBS_STATE_MAX_AGE_MS) return null;
    return state;
  } catch (e) {
    log.error(SCOPE, "Failed to load OBS connection state", e);
    return null;
  }
}

async function savePersistedAutoState(): Promise<void> {
  if (!autoModeEnabled || !currentTimeOfDay) return;

  try {
    if (!obsSessionId) {
      const connectionState = await getStoredConnectionState();
      obsSessionId = connectionState?.sessionId || null;
    }
    if (!obsSessionId) return;

    // lastAppliedRoleVisibility сюда НЕ пишется (adversarial 29.08.2026,
    // находка E): restore его принципиально игнорирует — латч описывает
    // живой DOM, а не прошлую загрузку. Мёртвое поле в storage — приманка
    // для будущего «а давайте восстановим».
    const state: AutoSceneState = {
      sessionId: obsSessionId,
      currentTimeOfDay,
      timestamp: Date.now(),
    };
    await browser.storage.local.set({ obs_auto_scene_state: state });
  } catch (e) {
    log.error(SCOPE, "Failed to save OBS auto scene state", e);
  }
}

async function clearPersistedAutoState(resetRuntimeState = false): Promise<void> {
  // Сброс состояния — СРАЗУ, до ожидания storage: его позднее продолжение
  // стирало уже новую подтверждённую ночь после реконнекта (внешний аудит
  // №5, H03).
  if (resetRuntimeState) {
    if (pendingRoleVisibilityTimer) {
      clearTimeout(pendingRoleVisibilityTimer);
      pendingRoleVisibilityTimer = null;
    }
    obsSessionId = null;
    currentTimeOfDay = null;
    phaseConfirmedLive = false;
    lastAppliedRoleVisibility = null;
    // Сброс выше гасил и СВЕЖЕЕ защитное скрытие, взведённое после разрыва
    // OBS, — старый visible-пин держал роль (внешний аудит 21.10.2026, B06).
    // Фаза теперь неизвестна → желаемое «скрыто» — применяем сразу.
    phaseEpoch++;
    healRolePin();
  }
  try {
    await browser.storage.local.remove("obs_auto_scene_state");
  } catch (e) {
    log.error(SCOPE, "Failed to clear OBS auto scene state", e);
  }
}

async function restorePersistedAutoState(
  status: any = null,
  epoch = sceneInfoEpoch,
  // Эпохи снимаются ДО первого ожидания вызывателя (get_status): живая фаза,
  // распознанная, пока он шёл, тоже делает снимок устаревшим (аудит №6, M01).
  phaseAt = phaseEpoch,
  routeAt = routeEpoch,
): Promise<boolean> {
  if (!autoModeEnabled) return false;
  // Снимок фазы из storage — только пока живого знания о фазе нет и комната
  // та же: прежде поздний ответ ставил прошлую фазу поверх живой и сам слал
  // дневную сцену без защиты напарников (внешний аудит №5, B03/C06).
  const stale = () => !autoModeEnabled || phaseEpoch !== phaseAt || routeEpoch !== routeAt;

  try {
    const resolvedStatus = status || (await getStoredConnectionState());
    if (!resolvedStatus?.connected || !resolvedStatus.sessionId) return false;
    if (stale()) return false;

    obsSessionId = resolvedStatus.sessionId;
    // Снимок старше уже обработанного события сцены — сцену не трогаем (B01).
    if (epoch === sceneInfoEpoch) currentScene = resolvedStatus.currentScene || currentScene;
    scenes = resolvedStatus.scenes || scenes;

    const res = await browser.storage.local.get(["obs_auto_scene_state"]);
    const stored = (res as any).obs_auto_scene_state as AutoSceneState | undefined;
    if (!stored || stored.sessionId !== obsSessionId || !stored.currentTimeOfDay) return false;
    if (stale()) return false;
    // Возраст обязателен: восстановление существует для F5 и смерти service
    // worker — это секунды-минуты. Старая запись означает давно ушедшую игру,
    // и восстановив её, вкладка утверждала бы в эфире фазу той игры (и шла бы
    // с ней в autoSwitchScene ниже) — контрольное ревью 04.08.2026, находка 5.
    if (
      !Number.isFinite(stored.timestamp) ||
      Date.now() - stored.timestamp > RESTORE_MAX_AGE_MS
    ) {
      return false;
    }

    currentTimeOfDay = stored.currentTimeOfDay;
    // У восстановленной ночи есть начало: без него каждый nightShow нёс
    // «сейчас», и возврат ночной сцены переигрывал ручное скрытие этой ночи
    // (внешний аудит №3, B03).
    if (currentTimeOfDay === "night" && nightSince === null) nightSince = Date.now();
    // Латч из persisted НЕ восстанавливается (аудит скрытия ролей
    // 29.08.2026, №2): он описывает мёртвый DOM прошлой загрузки. Считанное
    // «hidden» до применения глушило ретрай — applyRoleVisibility после F5
    // не находил целей, а schedule упирался в собственный латч, и роль
    // монтировалась видимой на дневной сцене.
    lastAppliedRoleVisibility = null;

    // Через roleTargetFor (жалоба 01.10.2026): restore не имеет права
    // показать роль, пока эфир не на ночной сцене — autoSwitchScene ниже
    // сам перезапустит показ после подтверждённой смены.
    const restored = currentTimeOfDay;
    const applied = applyRoleVisibility(roleTargetFor(restored) === "visible");
    if (!applied) scheduleRoleVisibility(restored, 1);

    // Дневная сцена — через ту же защиту, что смена фазы: напарники
    // скрыты ДО команды и кадр отрисован (аудит №5, B03). Включение фичи
    // этот кадр не ждёт.
    if (restored === "day") {
      void hideRoleBeforeDaySceneSwitch().then(() => {
        if (!stale()) void autoSwitchScene(restored);
      });
      log.debug(SCOPE, "Restored persisted OBS auto scene state", stored);
      return true;
    }
    await autoSwitchScene(restored);
    log.debug(SCOPE, "Restored persisted OBS auto scene state", stored);
    return true;
  } catch (e) {
    log.error(SCOPE, "Failed to restore OBS auto scene state", e);
    return false;
  }
}

// ─────────────────────────── видимость своей роли ───────────────────────────

function applyRoleVisibility(isRoleVisible: boolean): boolean {
  // Пин и снимки — в ../role-pin; здесь остаётся решение «когда» и латч.
  // Одна власть (решение владельца 21.10.2026): пин только ПРЯЧЕТ свою роль
  // (защита эфира). Показ — снять пин и сообщить auto-start (nightShow): он
  // открывает роли стола своим CSS-слоем в тот же момент — своя и напарники
  // вместе, без зеркала (внешний аудит №2, H04/H05). Прежний visible-пин
  // (!important) был второй властью и спорил с ручным скрытием игрока.
  const target = isRoleVisible ? ("visible" as const) : ("hidden" as const);
  if (isRoleVisible) releasePins();
  else if (!pinOwnRole("hidden")) {
    log.debug(SCOPE, "Role visibility targets not found, skipping role update");
    return false;
  }
  const previous = lastAppliedRoleVisibility;
  lastAppliedRoleVisibility = target;
  // info на СМЕНЕ состояния (несколько раз за игру): без неё в файле не видно,
  // была ли роль реально скрыта перед дневной сценой, и успешное переключение
  // сцены создавало ложное ощущение полного успеха (OP-1).
  if (previous !== lastAppliedRoleVisibility) {
    // Формулировка без привязки к фазе (adversarial 01.10.2026): «скрыта»
    // теперь бывает и НОЧЬЮ (гейт сцены), и старый текст «для дневной фазы»
    // врал бы в логе ровно в том инциденте, ради которого гейт появился.
    log.info(
      SCOPE,
      isRoleVisible
        ? "роль показана (ночь, эфир на ночной сцене)"
        : "роль скрыта (день или эфир не на ночной сцене)",
    );
    if (isRoleVisible && !matchRevealActive()) notifyRoleSceneGate("nightShow", { nightSince: nightSince ?? Date.now() });
  }
  return true;
}

/** Держится ли желаемое: «скрыто» — живой hidden-пин; «видно» — пина нет. */
function roleStateHolds(want: "visible" | "hidden"): boolean {
  return want === "hidden" ? pinHolds("hidden") : !pinHolds("hidden");
}

function setImportant(el: HTMLElement, prop: string, value: string): void {
  if (value) el.style.setProperty(prop, value, "important");
  else el.style.removeProperty(prop);
}

/**
 * Разрешён ли НОЧНОЙ показ роли. Чистая функция — сторожится мутационно.
 *
 * Показ роли ночью безопасен только когда эфир УЖЕ на ночной (приватной)
 * сцене: 01.10.2026 OBS был не подключён, автосмена упала, стрим остался на
 * дневной сцене с игровым экраном — а автопоказ роли об этом не знал, и роль
 * уехала зрителям («ночь не включилась, роль видно было»). Показ и смена
 * сцены — одна рука, не две.
 *
 * Ночная сцена НЕ настроена при включённых автосценах — приватная сцена не
 * подтверждена вовсе, показ запрещён (fail-closed; внешний аудит №4, B04:
 * прежнее «защищать нечего» открывало стол на DAY при разрыве OBS). Без
 * автосцен этот гейт не зовётся (nightSceneSafeForRoleShow). currentScene
 * обновляется только подтверждённым switchScene или событием/статусом
 * самого OBS — это и есть подтверждение «эфир на ночной».
 */
export function nightRoleShowAllowed(input: {
  nightScene: string;
  currentScene: string | null;
}): boolean {
  return !!input.nightScene && input.currentScene === input.nightScene;
}

/**
 * Матч окончен и стол открывается (23.10.2026): прятать нечего — пин своей
 * роли снимается, барьер перед дневной сценой не прячет, nightShow не шлём
 * (стол открывает auto-start своим краем конца матча). Пауза/промах — нет.
 */
function matchRevealActive(): boolean {
  return revealOnEnd && matchFinishedVisible();
}

/**
 * Я выбыл из матча (просьба владельца 25.10.2026): ночью эфир остаётся на
 * дневной сцене — зрители смотрят игру дальше. Стол при этом ПРЯЧЕТСЯ, как
 * днём: игра не сыграна, а напарники выбывшей мафии живы (подсказать им
 * могут из чата). Поэтому и ночной показ запрещён, даже если сцена ночи та
 * же, что дня, или эфир ещё на ночной (выбыл посреди ночи).
 */
function dayAtNightWhenOut(): boolean {
  return autoModeEnabled && dayWhenOut && ownOutThisGame() && !matchRevealActive();
}

/**
 * Метка выбывания у сайта — латч на весь документ (ревью 25.10.2026, №2):
 * компоненты плиток живут по месту, isKilled сбрасывается только начальными
 * data. Новая игра в том же документе унаследовала бы метку прошлой — живой
 * стример считался бы выбывшим, и раздача шла бы на дневной сцене. Метка,
 * видимая в момент сброса фазы на новую игру, — прошлой игры: не слушаем её,
 * пока не пропадёт.
 */
let staleOutMark = false;

function ownOutThisGame(): boolean {
  const seen = ownEliminatedVisible();
  if (!seen) staleOutMark = false;
  return seen && !staleOutMark;
}

/** Ночная сцена держится и показ ночью разрешён (сцена + не выбыл). */
function nightShowSceneHeld(): boolean {
  return !dayAtNightWhenOut() && nightRoleShowAllowed({ nightScene, currentScene });
}

/** Целевая видимость роли для фазы С УЧЁТОМ сцены (живое состояние модуля). */
function roleTargetFor(timeOfDay: TimeOfDay): "visible" | "hidden" {
  if (matchRevealActive()) return "visible";
  return timeOfDay === "night" && nightShowSceneHeld() ? "visible" : "hidden";
}

/**
 * ШОВ для auto-start (жалоба 01.10.2026): его ночной автопоказ жмёт НАТИВНЫЙ
 * D — сайт раскрывает роль мимо нашего пина, и гейт внутри этой панели его
 * не останавливает. Обе руки ночного показа обязаны вестись от одной правды.
 * Без автосцен (режим выключен) ждать нечего — прежнее поведение.
 */
export function nightSceneSafeForRoleShow(): boolean {
  if (!autoModeEnabled) return true;
  return nightShowSceneHeld();
}

export type RoleSceneGateReason = "gate" | "beforeDayScene" | "nightShow";
type RoleSceneGateListener = (reason: RoleSceneGateReason, info?: { nightSince?: number }) => void;
let roleSceneGateListener: RoleSceneGateListener | null = null;

/** Ведут ли автосцены OBS видимость ролей (тогда ночной показ — за ними). */
export function obsAutoScenesActive(): boolean {
  return autoModeEnabled;
}

/**
 * auto-start подписывается, чтобы роли СОКОМАНДНИКОВ (его CSS) шли вместе
 * со своей ролью (наш пин): перед дневной сценой и на смене гейта ночной
 * сцены (adversarial 21.10.2026, №7). Зовётся из healRolePin — он
 * срабатывает на каждую смену сцены, (ре)коннект и разрыв OBS.
 */
export function setRoleSceneGateListener(fn: RoleSceneGateListener): () => void {
  roleSceneGateListener = fn;
  return () => {
    if (roleSceneGateListener === fn) roleSceneGateListener = null;
  };
}

function notifyRoleSceneGate(reason: RoleSceneGateReason, info?: { nightSince?: number }): void {
  try {
    roleSceneGateListener?.(reason, info);
  } catch (err) {
    log.error(SCOPE, "role scene gate listener threw", err);
  }
}

/**
 * Желаемая видимость роли — ВЫВОДИТСЯ из фазы, а не хранится. Adversarial
 * 29.08.2026 (находка A): самолечение гейтилось на латч, а любой путь
 * неудачи гасил латч в null — при бюджете ретраев ~1,25 с (день) F5 или
 * SPA-возврат оставляли систему дремать до смены фазы, роль в эфире.
 * Латч остаётся оптимизацией «уже применено», но право лечить от него
 * не зависит.
 */
function desiredRoleVisibility(): "visible" | "hidden" | null {
  if (!autoModeEnabled) return null;
  // Фаза ещё не распознана (гейт живого распознания, 9.59.0) — роль
  // прятать ВСЁ РАВНО: до фикса её прятал фолбэчный «день», и снять этот
  // побочный щит значило открыть окно «роль в эфире на раздаче» для тех,
  // у кого включена только автосмена (adversarial 31.08.2026, Н2).
  // Fail-safe направление: спрятать до первой распознанной фазы.
  if (!currentTimeOfDay) return "hidden";
  // Ночь дополнительно гейтится сценой (жалоба 01.10.2026): пока эфир не на
  // ночной сцене, desired = hidden — и heal-опрос сам покажет роль, как
  // только сцена реально переключится (или спрячет, если стример ушёл с неё).
  return roleTargetFor(currentTimeOfDay);
}

/**
 * Перенакласть пин, если желаемое состояние не держится на живом узле.
 * Зовётся подписчиком (добавлен узел роли) и страховочным 2с-опросом.
 * Без целей на странице молчит: ретраи в пустоту сжигали бюджет (наход. A).
 */
function healRolePin(): void {
  notifyRoleSceneGate("gate");
  const want = desiredRoleVisibility();
  if (!want) return;
  if (roleStateHolds(want) && lastAppliedRoleVisibility === want) return;
  if (getRoleVisibilityTargets().length === 0) {
    // Узлов ещё/уже нет: желаемое НЕ применено — латч прежнего состояния
    // больше не правда. Иначе возврат к нему (DAY без своей плитки → NIGHT)
    // считался «уже сделано», и nightShow терялся до конца ночи (внешний
    // аудит №5, H02).
    if (lastAppliedRoleVisibility !== want) lastAppliedRoleVisibility = null;
    // Прятать нечего; показ же — это и nightShow для стола: своей плитки
    // может не быть вовсе (зритель), напарники ждут его (аудит №6, H02).
    if (want === "hidden") return;
  }
  lastAppliedRoleVisibility = null; // латч мёртв вместе с прежним узлом
  // Скрыть — СРАЗУ, не таймером: «в эфир» не ждёт даже одного кадра
  // (внешний аудит 21.10.2026, B06).
  if (want === "hidden" && applyRoleVisibility(false)) {
    cancelPendingRoleVisibility();
    return;
  }
  // Показ уже в пути к той же цели — не перевзводим: 2с-опрос сбрасывал
  // 3с-задержку ночного показа, и своя роль ночью не показывалась НИКОГДА
  // (внешний аудит 21.10.2026, H02).
  if (pendingRoleVisibilityTimer && pendingRoleVisibilityTarget === want) return;
  scheduleRoleVisibility(currentTimeOfDay as TimeOfDay);
}

function cancelPendingRoleVisibility(): void {
  if (pendingRoleVisibilityTimer) clearTimeout(pendingRoleVisibilityTimer);
  pendingRoleVisibilityTimer = null;
  pendingRoleVisibilityTarget = null;
}

function scheduleRoleVisibility(timeOfDay: TimeOfDay, attempt = 0): void {
  // Цель с учётом сцены (жалоба 01.10.2026): ночь без подтверждённой ночной
  // сцены планирует hidden, а показ придёт повторным вызовом из
  // autoSwitchScene после успешной смены (или от heal-опроса по событию OBS).
  const shouldShowRoles = roleTargetFor(timeOfDay) === "visible";
  const targetVisibility = shouldShowRoles ? "visible" : "hidden";

  if (pendingRoleVisibilityTimer) {
    clearTimeout(pendingRoleVisibilityTimer);
    pendingRoleVisibilityTimer = null;
  }

  // Латч сверяется с ЖИВЫМ узлом (аудит скрытия ролей 29.08.2026, №1): Vue
  // пересоздаёт плитку, пин умирает вместе с ней, а глобальная переменная
  // продолжала утверждать «скрыто» — настоящая роль была видна в эфире.
  if (lastAppliedRoleVisibility === targetVisibility && roleStateHolds(targetVisibility)) {
    log.debug(SCOPE, "Role visibility already set to", targetVisibility);
    return;
  }

  const delayMs = shouldShowRoles
    ? matchRevealActive()
      ? 0 // конец матча — без ночной задержки
      : attempt === 0
        ? roleVisibilityDelayMs
        : 500
    : attempt === 0
      ? 0
      : 250;
  log.debug(SCOPE, "Scheduling role visibility change to", targetVisibility, "in", delayMs);
  pendingRoleVisibilityTarget = targetVisibility;
  const scheduledRoute = routeEpoch;
  pendingRoleVisibilityTimer = setTimeout(() => {
    pendingRoleVisibilityTimer = null;
    pendingRoleVisibilityTarget = null;
    // Страховка второй линии: сам таймер гасится в stopDOMMonitoring/disable,
    // но проверка здесь дешёвая и закрывает будущие пути взведения.
    if (!autoModeEnabled) return;
    // Таймер прошлой комнаты (SPA) — не решение новой игры (аудит №4, S4).
    checkPhaseRoute();
    if (routeEpoch !== scheduledRoute) return;
    // Цель ПЕРЕсчитывается на срабатывании: за время задержки сцена могла
    // подтвердиться (или уйти) — применяем правду момента, не снимок.
    // И фазу — тоже: ночной таймер, взведённый поздним успехом смены сцены,
    // не вправе открыть роль, если игра уже ушла в день (внешний аудит №4, H04).
    const phaseNow = timeOfDay === "night" && currentTimeOfDay !== "night" ? "day" : timeOfDay;
    const applied = applyRoleVisibility(roleTargetFor(phaseNow) === "visible");
    if (applied) return;
    if (attempt < 5) {
      scheduleRoleVisibility(timeOfDay, attempt + 1);
      return;
    }
    // Терминальный исход: дальше попыток не будет. Без этой строки в файле
    // оставалась тишина, неотличимая от «всё получилось» (OP-1).
    log.warn(
      SCOPE,
      "видимость роли не подтверждена после",
      attempt + 1,
      "попыток; требуемое состояние:",
      targetVisibility,
    );
  }, delayMs);
}

/** Когда стол последний раз прятали перед дневной сценой. */
let lastPreDayAt = 0;
const PRE_DAY_FRESH_MS = 100;
/**
 * Поколение настроек автосцен: растёт на каждой их смене. Продолжение после
 * 30-мс ожидания pre-day из прошлого поколения (выкл/вкл, другая комната)
 * старую команду не шлёт (аудит №6, §4).
 */
let autoGeneration = 0;

async function hideRoleBeforeDaySceneSwitch(): Promise<void> {
  lastPreDayAt = Date.now();
  if (matchRevealActive()) return; // матч окончен: дневная сцена роли не прячет
  if (pendingRoleVisibilityTimer) {
    clearTimeout(pendingRoleVisibilityTimer);
    pendingRoleVisibilityTimer = null;
  }
  // Сокомандников прячет auto-start (CSS) — ДО смены сцены, без оглядки на
  // его собственное распознавание фазы: оно могло ещё видеть ночь (current
  // ночной, next уже дневной), и напарники уезжали на дневную сцену
  // (adversarial №7; внешний аудит 21.10.2026, B05).
  notifyRoleSceneGate("beforeDayScene");
  const hidden = applyRoleVisibility(false);
  if (!hidden) {
    // Латч «скрыто» здесь НЕ ставим. Раньше он ставился безусловно, и
    // retry-машина считала работу сделанной: роль оставалась на экране, а
    // сцена переключалась — в логе это выглядело полным успехом, хотя роль
    // могла уехать в эфир (аудит наблюдаемости 02.08.2026, OP-1).
    log.warn(
      SCOPE,
      "роль НЕ скрыта перед дневной сценой: элементы роли не найдены;",
      "сцена переключается в ухудшенном режиме, повторяем скрытие",
    );
    scheduleRoleVisibility("day");
  }
  // Дать DOM перерисовать скрытое состояние перед переключением сцены OBS.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

// ─────────────────────────── определение времени суток ───────────────────────────

/**
 * Текст самого глубокого элемента, содержащего фразу (или "" если её нет).
 *
 * Раньше тут был querySelectorAll("*") с чтением textContent каждого узла —
 * квадратичный проход по всему документу на каждой проверке времени суток.
 * Спуск по дереву даёт тот же результат за O(глубина × братья).
 */
function findDeepestTextWith(root: Element, phrase: string): string {
  let node = root;
  if (!norm(node).includes(phrase)) return "";
  for (;;) {
    const child = Array.from(node.children).find((c) => norm(c).includes(phrase));
    if (!child) return norm(node);
    node = child;
  }
}

function getStageContainer(): Element | null {
  const stages = Array.from(document.querySelectorAll(SITE.stage));
  if (stages.length === 0) return null;
  let container: Element = stages[0].parentElement || stages[0];
  while (
    container.parentElement &&
    container.parentElement !== document.body &&
    !stages.every((stage) => container.contains(stage))
  ) {
    container = container.parentElement;
  }
  // Таймер обычно сосед списка стадий, поэтому берём один общий уровень выше,
  // но никогда не поднимаемся до body.
  return container.parentElement && container.parentElement !== document.body
    ? container.parentElement
    : container;
}

/**
 * Определяет время суток на основе DOM элементов страницы игры.
 * RU-логика сохранена из obs-floating-panel.js; EN-маркеры — best-effort.
 */
/**
 * Фазу не распознали в ЭТОМ вызове (взводится внутренним детектором).
 * Вынесено из детектора наружу: у него полтора десятка точек возврата, и
 * различать «распознали» и «оставили прежнее» надо в одном месте.
 */
let autoSettingsInitialized = false;
let phaseUnknownHit = false;
/** С какого момента длится «фазу не понимаем» (0 — понимаем). */
let phaseUnknownSince = 0;
/** Про это непонимание уже пожаловались (чтобы не повторяться). */
let phaseUnknownReported = false;
/**
 * Сколько терпим непонимание, прежде чем жаловаться.
 *
 * Комната первые 1.5-2.5 с рисует ТРИ ПУСТЫХ `.substage` (массив substages в
 * data фиксирован, текст берётся из ещё не пришедшей стадии), а детектор ходит
 * раз в 2 с. Без порога совершенно здоровый старт давал бы `warn` в каждой
 * вкладке при каждой загрузке — а `warn` поддержка грепает первым (ревью
 * 02.08.2026). Порог заодно прикрывает промахи в момент перерисовки роллера.
 */
const PHASE_UNKNOWN_GRACE_MS = 8000;
/**
 * Сколько терпим непонимание фазы, прежде чем перестать считать её живой ДЛЯ
 * ВЛАДЕНИЯ автосценой. Закрывает дыру «та же комната, новая игра»: матч
 * кончился, комната вернулась в пре-гейм БЕЗ смены pathname — сброс
 * «живости» по комнате не срабатывал, и старая вкладка держала владение всю
 * первую ночь нового матча в соседней (лог 05.08.2026).
 *
 * ВАЖНО: судейская пауза — НЕ непонимание, хотя маркеров на ней тоже нет
 * (роллер демонтирован целиком, а `.ended-pause` исключена из
 * endedScreenVisible ревью 01.08). Паузу свежести добавляет видимый
 * roomFixedState в ответе на пинг — см. там же (контрольное ревью
 * 05.08.2026, блокер). 90 с, а не 60: интенсивный троттлинг фоновых вкладок
 * батчит таймеры раз в минуту, и порог, равный периоду батча, ловил бы
 * ложное протухание от единственного тика, попавшего в перерисовку роллера.
 */
const OWNER_PHASE_STALE_MS = 90_000;

function detectTimeOfDay(): TimeOfDay {
  // Смена комнаты внутри документа: фаза, распознанная в прошлой, для новой
  // не «живая» — иначе вкладка, ушедшая SPA-переходом в другую комнату,
  // держала бы владение чужой фазой (контрольное ревью 04.08.2026).
  if (location.pathname !== phaseFlagPathname) {
    phaseFlagPathname = location.pathname;
    phaseConfirmedLive = false;
  }
  phaseUnknownHit = false;
  const result = detectTimeOfDayInner();
  lastDetectWasLive = !phaseUnknownHit;
  if (phaseUnknownHit) {
    if (!phaseUnknownSince) {
      phaseUnknownSince = Date.now();
    } else if (!phaseUnknownReported && Date.now() - phaseUnknownSince > PHASE_UNKNOWN_GRACE_MS) {
      phaseUnknownReported = true;
      log.warn(
        SCOPE,
        "фаза игры не распознана дольше",
        `${Math.round(PHASE_UNKNOWN_GRACE_MS / 1000)} с:`,
        "ни один маркер стадии не подошёл; сохраняем прежнюю сцену —",
        result,
      );
    }
  } else {
    // ЕДИНСТВЕННАЯ точка, где фаза становится «живой»: маркеры распознаны
    // без фолбэка. Взводится и при совпадении с текущей фазой — после F5
    // смены не будет, а владение вкладка обязана уметь защитить (блокер 2).
    phaseConfirmedLive = true;
    if (phaseUnknownSince) {
      // О восстановлении говорим только если жаловались: иначе здоровый
      // старт порождал бы пару строк на ровном месте.
      if (phaseUnknownReported) {
        log.info(
          SCOPE,
          "фаза снова распознаётся:",
          result,
          `(не понимали ${Math.round((Date.now() - phaseUnknownSince) / 1000)} с)`,
        );
      }
      phaseUnknownSince = 0;
      phaseUnknownReported = false;
    }
  }
  return result;
}

function detectTimeOfDayInner(): TimeOfDay {
  try {
    // 1. Терминальный экран (.ended): промах, победа любой из сторон, пауза.
    // Сайт перед gameOver стартует день, но фазовых маркеров на этом экране
    // нет — раньше побеждала «память» и OBS оставался на ночной сцене после
    // ночной победы (аудит устойчивости 01.08.2026, находка 5).
    if (endedScreenVisible()) {
      log.debug(SCOPE, "Detected ENDED screen - forcing DAY scene");
      return "day";
    }

    // 2. Ищем надпись "До смены этапа"
    const stageContainer = getStageContainer();
    // EN — best-effort, не проверено на живом EN-интерфейсе.
    let stageChangeText = stageContainer
      ? findDeepestTextWith(stageContainer, "до смены этапа") ||
        findDeepestTextWith(stageContainer, "until stage change")
      : "";
    // Страховка: эвристика контейнера («таймер — сосед списка стадий») —
    // предположение о вёрстке. При промахе возвращаемся к проверенному в бою
    // поиску от body: это старая цена ОДНОЙ проверки, зато ночь не будет
    // молча пропущена, если сайт разложил таймер иначе.
    if (!stageChangeText) {
      stageChangeText =
        findDeepestTextWith(document.body, "до смены этапа") ||
        findDeepestTextWith(document.body, "until stage change");
    }

    if (stageChangeText) {
      const nextStage = document.querySelector(SITE.substageNext);
      if (nextStage) {
        const nextStageText = norm(nextStage);
        log.debug(SCOPE, 'Found "До смены этапа", next stage:', nextStageText);

        // Общий классификатор вместо локальных списков: прежний список
        // проверял «голосование» ПЕРВЫМ, и next «Ночь | Голосование мафии»
        // возвращал день прямо на входе в ночь. RU «промах»/«лучший ход»
        // classify не знает (в TEXT.day только EN-варианты) — оставлены
        // явными дневными спецслучаями.
        const nextPhase = classifyPhaseText(nextStageText);
        if (
          nextPhase === "day" ||
          nextStageText.includes("промах") ||
          nextStageText.includes("лучший ход")
        ) {
          log.debug(SCOPE, "Detected DAY via next stage:", nextStageText);
          return "day";
        }
        if (nextPhase === "night") {
          log.debug(SCOPE, "Detected NIGHT via next stage:", nextStageText);
          return "night";
        }
      }

      if (
        /до смены этапа \d+ сек/.test(stageChangeText) ||
        /until stage change.*\d+\s*(?:s|sec|seconds?)/.test(stageChangeText)
      ) {
        const currentSubstage = document.querySelector(SITE.substageCurrent);
        if (currentSubstage) {
          const currentText = norm(currentSubstage);
          if (currentText.includes("ночь") || currentText.includes("night")) {
            log.debug(SCOPE, 'Detected NIGHT via "До смены этапа" with timer and night substage');
            return "night";
          }
        }
      }
    }

    // Изолированная "Ночь" без "ДО СМЕНЫ ЭТАПА" — игнорируем, остаёмся в
    // текущем времени. Это ФОЛБЭК и метится как фолбэк (adversarial
    // 31.08.2026, Н1): ветка возвращала currentTimeOfDay || "day" БЕЗ
    // phaseUnknownHit — «остаёмся в текущем» считалось живым распознанием,
    // и свежая загрузка посреди ночи подтверждала null → day через гейт.
    const currentSubstage = document.querySelector(SITE.substageCurrent);
    if (currentSubstage) {
      const currentText = norm(currentSubstage);
      if (currentText.trim() === "ночь" || currentText.trim() === "night") {
        phaseUnknownHit = true;
        const fallbackTime = currentTimeOfDay || "day";
        log.debug(
          SCOPE,
          'Found isolated "Ночь" in subtext without "ДО СМЕНЫ ЭТАПА" - keeping',
          fallbackTime.toUpperCase(),
        );
        return fallbackTime;
      }
    }

    // 3. Голосование с "Итоги подъема" — всегда ДЕНЬ
    const votingStage = document.querySelector(SITE.stage);
    const votingResultsSubstage = document.querySelector(SITE.substageCurrent) ||
      document.querySelector(SITE.stage);
    if (votingStage && votingResultsSubstage) {
      const votingText = norm(votingStage);
      const substageText = norm(votingResultsSubstage);
      if (
        (votingText.includes("голосование") ||
          votingText.includes("итоги подъема") ||
          votingText.includes("voting")) &&
        (substageText.includes("итоги подъема") || substageText.includes("results"))
      ) {
        log.debug(SCOPE, "Detected DAY: Голосование с итогами подъема");
        return "day";
      }
    }

    // 5. Текущая стадия игры (без "До смены этапа")
    const currentStage = document.querySelector(SITE.substageCurrent);
    if (currentStage) {
      const stageText = norm(currentStage);

      if (
        stageText.includes("раздача карт") ||
        stageText.includes("card deal") ||
        stageText.includes("dealing")
      ) {
        log.debug(SCOPE, "Detected NIGHT: Раздача карт");
        return "night";
      }

      const nightStages = ["ночь | знакомство мафии", "ночь | ход мафии", "ночь | проверки"];
      for (const nightStage of nightStages) {
        if (stageText.includes(nightStage)) {
          log.debug(SCOPE, "Detected NIGHT stage:", nightStage);
          return "night";
        }
      }

      // Общий классификатор (selectors.ts): «Ночь | Голосование мафии»
      // раньше проваливалась в дневную ветку по слову «голос» — дневная
      // сцена OBS включалась посреди хода мафии.
      const currentPhase = classifyPhaseText(stageText);
      if (currentPhase === "night") {
        log.debug(SCOPE, "Detected NIGHT stage via marker");
        return "night";
      }

      if (stageText.includes("день | речь игрока") || currentPhase === "day") {
        log.debug(SCOPE, "Detected DAY stage via marker");
        return "day";
      }
    }

    // 6. Fallback: все стадии
    const allStages = document.querySelectorAll(SITE.stage);
    let hasAnyNightStage = false;
    let hasAnyDayStage = false;
    allStages.forEach((stage) => {
      const stageText = norm(stage);
      const isSubstage = stage.classList.contains(SITE_CLASS.substage);
      const isIsolatedNight =
        isSubstage && (stageText.trim() === "ночь" || stageText.trim() === "night");

      const phase = classifyPhaseText(stageText);
      if (phase === "night" && !isIsolatedNight) {
        hasAnyNightStage = true;
      }
      if (phase === "day" || stageText.includes("итоги подъема")) {
        hasAnyDayStage = true;
      }
    });

    // При обоих флагах (статичный список всех стадий) — день: это проверенный
    // в бою тай-брейк из auto-start; приоритет ночи здесь давал ложную ночь.
    if (hasAnyNightStage && !hasAnyDayStage) {
      log.debug(SCOPE, "Detected NIGHT via any night stage found");
      return "night";
    }
    if (hasAnyDayStage) {
      log.debug(SCOPE, "Detected DAY via any day stage found");
      return "day";
    }

    const fallbackTime = currentTimeOfDay || "day";
    // Ни один маркер не подошёл: сообщит обёртка, по фронту состояния. Иначе
    // после «слежение запущено» в файле идёт тишина, одинаковая и для здоровой
    // стабильной фазы, и для мёртвого наблюдателя, и для съехавшей разметки
    // сайта (аудит наблюдаемости 02.08.2026, OP-2).
    phaseUnknownHit = true;
    log.debug(SCOPE, "No specific stage detected - keeping", fallbackTime.toUpperCase());
    return fallbackTime;
  } catch (e) {
    log.error(SCOPE, "Error detecting time of day", e);
    phaseUnknownHit = true;
    return currentTimeOfDay || "day";
  }
}

function requestTimeOfDayCheck(): void {
  if (!autoModeEnabled) return;
  // Route-гейт (перф-аудит 06.08.2026, PERF-4): вне игровой комнаты фаз не
  // существует, а детектор на /game-search дважды за проверку сериализовал
  // document.body.textContent и был способен «подтвердить день» и дёрнуть
  // сцену эфира с посторонней страницы. Единственное, что делаем вне комнаты
  // — возвращаем день, если ушли ночью (это не детекция, а сброс).
  if (!isGameRoomPath(location.pathname)) {
    resetNightOnLeave();
    return;
  }
  // Долгая ночь: не переключаем (честная ночь бывает длинной), подсказываем.
  if (currentTimeOfDay === "night" && !longNightWarned && !dayAtNightWhenOut() && isLongNight(nightSince, Date.now())) {
    longNightWarned = true;
    const minutes = Math.round((Date.now() - (nightSince ?? Date.now())) / 60_000);
    log.warn(SCOPE, `ночная сцена держится уже ${minutes} мин — проверь, не зависла ли фаза`);
    showToast(`Ночная сцена на стриме уже ${minutes} мин — проверь, всё ли так`);
  }

  if (timeOfDayCheckDebounceTimer) {
    timeOfDayCheckQueued = true;
    return;
  }

  timeOfDayCheckDebounceTimer = setTimeout(() => {
    timeOfDayCheckDebounceTimer = null;
    void evaluateTimeOfDay();
    if (timeOfDayCheckQueued) {
      timeOfDayCheckQueued = false;
      requestTimeOfDayCheck();
    }
  }, 150);
}

/**
 * Распознать фазу с поправкой на застрявшую подпись роллера: после ночи
 * «день» с ночным следующим этапом — ещё ночь (сайт не обновил current). Эфир
 * на приватной сцене остаётся, а новой ночи (и стёртых решений этой) не
 * начинается (внешний аудит №6, B03). Все чтения фазы — через неё: сырое
 * распознавание в подтверждении и при повторном включении обходило поправку
 * (аудит №7, H01).
 */
function detectPhaseAfter(known: TimeOfDay | null): TimeOfDay {
  const phase = detectTimeOfDay();
  return phase === "day" && known === "night" && staleDayLabel() ? "night" : phase;
}

function evaluateTimeOfDay(): void {
  const newTimeOfDay = detectPhaseAfter(currentTimeOfDay);
  const previousTimeOfDay = currentTimeOfDay;

  log.debug(SCOPE, "Time-of-day result:", newTimeOfDay, "(previous:", previousTimeOfDay, ")");

  // Фолбэк не трогает машину смены ЦЕЛИКОМ (adversarial 31.08.2026, Н5):
  // гейт стоял ниже ветки «значение не изменилось», и фолбэчный тик,
  // вернувший previous, ГАСИЛ живо взведённый pending — ночная сцена
  // опаздывала до следующего распознавания.
  if (!lastDetectWasLive) return;

  if (newTimeOfDay === previousTimeOfDay) {
    pendingTimeOfDay = null;
    if (pendingTimeOfDayConfirmTimer) {
      clearTimeout(pendingTimeOfDayConfirmTimer);
      pendingTimeOfDayConfirmTimer = null;
    }
    return;
  }

  if (pendingTimeOfDay !== newTimeOfDay) {
    pendingTimeOfDay = newTimeOfDay;

    if (pendingTimeOfDayConfirmTimer) clearTimeout(pendingTimeOfDayConfirmTimer);

    pendingTimeOfDayConfirmTimer = setTimeout(async () => {
      pendingTimeOfDayConfirmTimer = null;
      // Гейт и ЗДЕСЬ, а не только в requestTimeOfDayCheck: таймер
      // подтверждения, взведённый в комнате, переживает SPA-переход и
      // подтверждал фазу по чужой странице (поймано тестом PERF-4).
      if (!isGameRoomPath(location.pathname)) return;
      if (!autoModeEnabled) return;
      if (pendingTimeOfDay !== newTimeOfDay) return;

      const confirmedTimeOfDay = detectPhaseAfter(currentTimeOfDay);
      // Подтверждение — тоже только живым распознанием: фолбэк в окне
      // подтверждения не имеет права финализировать смену (жалоба 31.08.2026).
      if (!lastDetectWasLive) return;
      if (confirmedTimeOfDay === newTimeOfDay && confirmedTimeOfDay !== currentTimeOfDay) {
        // info: точка, с которой начинается вся автосмена. Без неё в логе
        // не видно даже того, распознали мы фазу или нет.
        log.info(SCOPE, "фаза подтверждена:", currentTimeOfDay, "→", confirmedTimeOfDay);
        currentTimeOfDay = confirmedTimeOfDay;
        phaseEpoch++;
        pendingTimeOfDay = null;
        nightSince = confirmedTimeOfDay === "night" ? Date.now() : null;
        longNightWarned = false;
        const gen = autoGeneration;
        const route = routeEpoch;
        if (confirmedTimeOfDay === "day") await hideRoleBeforeDaySceneSwitch();
        // Перепроверка ПОСЛЕ await: в его 30-мс окно автомод могли выключить,
        // teardown уже вернул стили роли — хвост этого колбэка не имеет права
        // прятать её заново (арх-аудит швов 29.08.2026, SEAM-04). И поколение:
        // выкл/вкл или другая комната за эти 30 мс — уже не наша команда.
        if (!autoModeEnabled || gen !== autoGeneration || route !== routeEpoch) return;
        scheduleRoleVisibility(confirmedTimeOfDay);
        void savePersistedAutoState();
        await autoSwitchScene(confirmedTimeOfDay);
      } else {
        log.debug(
          SCOPE,
          "Time change not confirmed (expected:",
          newTimeOfDay,
          ", got:",
          confirmedTimeOfDay,
          ")",
        );
        pendingTimeOfDay = null;
      }
    }, 350);
  }
}

/**
 * Сколько ночная сцена может держаться молча. Честная ночь с паузой и
 * договоркой бывает длинной, поэтому порог щедрый: не переключаем, только
 * подсказываем стримеру (жалоба 16.08.2026: «какая-то долгая ночь»).
 */
export const LONG_NIGHT_MS = 4 * 60_000;

/**
 * Нужно ли вернуть дневную сцену при уходе из комнаты. Чистая функция —
 * сторожится мутационно. Вне комнаты фаз нет, и ночной оверлей на стриме
 * становится враньём: игрок уже в поиске, а зрители видят «ночь» (жалоба
 * 16.08.2026 — пришлось переключать вручную, в чате «какая-то долгая ночь»).
 */
export function shouldResetNightOnLeave(input: {
  autoMode: boolean;
  inRoom: boolean;
  currentTimeOfDay: TimeOfDay | null;
}): boolean {
  return input.autoMode && !input.inRoom && input.currentTimeOfDay === "night";
}

/** Держится ли ночная сцена дольше разумного (для подсказки, не для смены). */
export function isLongNight(nightSince: number | null, now: number): boolean {
  return nightSince !== null && now - nightSince >= LONG_NIGHT_MS;
}

/** Когда началась текущая ночная сцена; null — сейчас не ночь. */
let nightSince: number | null = null;
/** Подсказка о долгой ночи показана для ЭТОЙ ночи — не повторяем. */
let longNightWarned = false;

/**
 * Уход из комнаты ночью: вернуть день. Гейт route у остальных путей остаётся
 * (PERF-4: вне комнаты фазы не ДЕТЕКТИРУЮТСЯ), но возврат на день — не
 * детекция, а сброс известного состояния, и ему вне комнаты самое место.
 */
function resetNightOnLeave(): void {
  if (
    !shouldResetNightOnLeave({
      autoMode: autoModeEnabled,
      inRoom: isGameRoomPath(location.pathname),
      currentTimeOfDay,
    })
  ) {
    return;
  }
  log.info(SCOPE, "ушли из комнаты ночью — возвращаем дневную сцену");
  currentTimeOfDay = "day";
  nightSince = null;
  longNightWarned = false;
  // Persisted-ночь обязана умереть вместе с уходом (adversarial 31.08.2026,
  // Н4): запись переживала уход с TTL 10 мин, и вход в НОВУЮ комнату
  // восстанавливал ночную сцену поверх прегейм-сцены стримера. Restore
  // существует для F5 живой игры — ушли из комнаты, значит restore нечего.
  void clearPersistedAutoState(false);
  if (!dayScene) {
    log.info(SCOPE, "дневная сцена не выбрана — вернуть нечего");
    return;
  }
  if (currentScene === dayScene) return;
  void switchScene(dayScene).catch((e: Error) => {
    log.warn(SCOPE, "возврат дневной сцены при уходе не удался", e);
  });
}

/** Автоматически переключает сцену в зависимости от времени суток. */
async function autoSwitchScene(timeOfDay: TimeOfDay): Promise<void> {
  // Ниже — info, а не debug. Это решения, принимаемые НЕСКОЛЬКО РАЗ ЗА ИГРУ
  // (на смене фазы), а не потиковый шум, зато без них жалоба «автосмена сцен
  // перестала работать» неразбираема: в файл лога пишется только info, и весь
  // путь автосцены был в нём невидим (разбор жалобы 02.08.2026).
  if (!autoModeEnabled) {
    log.info(SCOPE, "смена сцены пропущена: авто-режим выключен");
    return;
  }
  // Второй пояс той же защиты (PERF-4): restore и любые будущие вызыватели
  // не имеют права трогать сцену эфира с неигровой страницы.
  if (!isGameRoomPath(location.pathname)) {
    log.info(SCOPE, "смена сцены пропущена: не игровая страница");
    return;
  }

  // Выбыл — ночью дневная сцена, тем же путём защиты, что днём.
  const out = timeOfDay === "night" && dayAtNightWhenOut();
  if (out) log.info(SCOPE, "выбыл из матча — ночью эфир остаётся на дневной сцене");
  const scenePhase: TimeOfDay = out ? "day" : timeOfDay;
  const targetScene = scenePhase === "day" ? dayScene : nightScene;
  if (!targetScene) {
    log.info(SCOPE, "смена сцены пропущена: не выбрана сцена для фазы", scenePhase);
    return;
  }
  if (currentScene === targetScene) {
    log.info(SCOPE, "смена не требуется: нужная сцена уже активна —", targetScene);
    return;
  }
  // Дневная сцена — ТОЛЬКО через защиту «перед дневной сценой», каким бы
  // путём ни пришла команда: повтор после списка сцен (SceneCreated и т. п.)
  // шёл мимо неё, и показанный на приватной ночи стол уезжал в DAY (внешний
  // аудит №6, B02). Вызыватель, только что сделавший её сам, второй кадр не ждёт.
  if (scenePhase === "day") {
    if (Date.now() - lastPreDayAt > PRE_DAY_FRESH_MS) {
      const gen = autoGeneration;
      const route = routeEpoch;
      await hideRoleBeforeDaySceneSwitch();
      if (gen !== autoGeneration || route !== routeEpoch || !autoModeEnabled) return;
      if (currentScene === targetScene) return;
    }
    // Последнее слово перед командой — синхронно: D или V, нажатые за время
    // кадра pre-day, отменяли его результат, а отметка «свежо» заставляла
    // поверить старому скрытию (внешний аудит №7, B01).
    if (!matchRevealActive()) {
      notifyRoleSceneGate("beforeDayScene");
      applyRoleVisibility(false);
    }
  }

  log.info(SCOPE, "автосмена сцены:", scenePhase, "→", targetScene, "(было:", currentScene, ")");
  // currentScene обновляет switchScene ПОСЛЕ подтверждения. Оптимистичная
  // запись до запроса блокировала все повторы гвардом currentScene===target:
  // упавшее переключение (сцена удалена, дисконнект) молча замораживало
  // автомод до следующей смены фазы.
  try {
    // Подтверждение отдельной строкой: «попытались» и «сцена реально
    // переключилась» — разные события, и в жалобе важно именно второе.
    if (await switchScene(targetScene)) {
      log.info(SCOPE, "сцена переключена:", targetScene);
      // Ночь: показ роли ждал подтверждённой сцены (roleTargetFor) — теперь
      // сцена наша, перезапускаем показ (жалоба 01.10.2026).
      // Но только если ночь ещё идёт: успех мог прийти после нового дня
      // (внешний аудит №4, H04).
      if (timeOfDay === "night" && currentTimeOfDay === "night") scheduleRoleVisibility(timeOfDay);
    }
  } catch (e) {
    log.error(SCOPE, "Failed to auto-switch scene", e, "(target:", targetScene, ")");
    // Молчание здесь стоило стримеру роли в эфире (жалоба 01.10.2026): о
    // проблеме узнали от зрителей. Ночью объясняем и последствие для роли.
    showToast(
      scenePhase === "night"
        ? "OBS не подключён: ночная сцена не переключена, роль оставлена скрытой. Запустите OBS или выключите автосцены"
        : "OBS: сцена не переключена — проверьте подключение",
      { key: "obs-scene-switch-fail" },
    );
  }
}

// ─────────────────────────── мониторинг DOM (день/ночь) ───────────────────────────

/** Игра (путь + game_id), которую слежение за фазой видело последней. */
let lastPhaseRoutePath: string | null = null;
/** Растёт на каждой смене пути: отложенное решение прошлой комнаты — не новой. */
let routeEpoch = 0;
/**
 * Растёт на каждом ЖИВОМ знании фазы (подтверждение детектором, сброс при
 * новой игре или разрыве). Снимок фазы из storage, прочитанный до этого,
 * устарел (внешний аудит №5, B03).
 */
let phaseEpoch = 0;

/**
 * Новая игра в том же документе (SPA): фаза, начало ночи и отложенный показ
 * роли — от прошлой комнаты. Прежде старый ночной таймер открывал роль в
 * новой игре с неизвестной фазой, а «та же ночь» не давала нового nightShow
 * (внешний аудит №4, S4). Сбрасываем до живого распознавания: без фазы
 * желаемое — скрыто. Проверка — немедленным подписчиком: обычный склеивал
 * выход и возврат в ту же комнату (аудит №5, C02).
 */
function checkPhaseRoute(): void {
  const path = gameRouteKey(location);
  if (path === lastPhaseRoutePath) return;
  const previous = lastPhaseRoutePath;
  lastPhaseRoutePath = path;
  routeEpoch++;
  if (previous === null || !isGameRoomPath(location.pathname)) return;
  resetPhaseForNewGame("новая игра в том же документе");
}

/** Фаза этой комнаты уже была известна — матч шёл. */
let roundSeenRunning = false;

/**
 * Новая игра в ТОЙ ЖЕ комнате: экран набора после идущего матча (URL не
 * меняется). Иначе «ночь» прошлой игры продолжалась в новой, и nightShow
 * новой ночи не приходил (внешний аудит №5, C05).
 */
function checkNewRound(): void {
  if (pregameScreenVisible()) {
    if (!roundSeenRunning) return;
    roundSeenRunning = false;
    resetPhaseForNewGame("новая игра в той же комнате");
  } else if (currentTimeOfDay !== null) {
    roundSeenRunning = true;
  }
}

/**
 * Выбыл посреди ночи (дисквалификация и т. п.): эфир уходит на дневную сцену
 * сразу, а не со следующей ночи. Один раз на край — повторы при упавшей
 * смене делают переподключение OBS и смена фазы. Стол к этому моменту уже
 * спрятан самолечением (roleTargetFor), а autoSwitchScene прячет ещё раз
 * перед командой дневной сцены.
 */
let outAtNight = false;

function checkOutAtNight(): void {
  const due = currentTimeOfDay === "night" && dayAtNightWhenOut();
  if (due === outAtNight) return;
  outAtNight = due;
  if (due && currentScene !== dayScene) void autoSwitchScene("night");
}

function resetPhaseForNewGame(why: string): void {
  log.info(SCOPE, `${why} — фаза автосцен сброшена`);
  staleOutMark = ownEliminatedVisible();
  outAtNight = false;
  cancelPendingRoleVisibility();
  if (pendingTimeOfDayConfirmTimer) {
    clearTimeout(pendingTimeOfDayConfirmTimer);
    pendingTimeOfDayConfirmTimer = null;
  }
  pendingTimeOfDay = null;
  currentTimeOfDay = null;
  nightSince = null;
  phaseEpoch++;
  lastAppliedRoleVisibility = null;
  healRolePin();
  requestTimeOfDayCheck();
}

function startDOMMonitoring(): void {
  if (!autoModeEnabled) {
    log.info(SCOPE, "слежение за фазой не запущено: авто-режим выключен");
    return;
  }
  if (unsubDom) return;

  log.info(SCOPE, "слежение за фазой запущено (день:", dayScene || "—", "ночь:", nightScene || "—", ")");

  // Реагируем только на мутации, связанные с элементами стадий: раньше
  // релевантной считалась ЛЮБАЯ childList/class/style-мутация документа
  // (звуковые индикаторы!) — до 4 полных detectTimeOfDay в секунду, до
  // 14 400 за часовую игру (аудит 01.08.2026, находка 5). Таймер «До смены
  // этапа» живёт соседом списка стадий и может не попасть под селектор —
  // его добирает редкий страховочный опрос ниже.
  const PHASE_SCOPE = SITE.phaseScope;
  const ROLE_SEL = SITE.ownRoleTargets.join(", ");
  lastPhaseRoutePath = gameRouteKey(location);
  unsubRouteImmediate = onDomChangeImmediate(checkPhaseRoute);
  roundSeenRunning = false;
  unsubDom = onDomChange((mutations) => {
    checkPhaseRoute();
    checkNewRound();
    let shouldCheckTime = false;
    let roleNodeAdded = false;
    // Break только когда найдено ОБА: ранний выход по phaseScope съедал
    // roleNodeAdded ровно в главном сценарии — Vue пересобирает плитки на
    // смене фазы, и фазовая мутация почти всегда идёт в том же батче раньше
    // (adversarial 29.08.2026, находка C).

    for (const mutation of mutations) {
      if (shouldCheckTime && roleNodeAdded) break;
      const t = mutation.target;
      const el = t instanceof Element ? t : t.parentElement;
      if (!shouldCheckTime && el?.closest(PHASE_SCOPE)) {
        shouldCheckTime = true;
      }
      if (mutation.type === "childList") {
        for (const n of mutation.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (!shouldCheckTime && (n.matches(PHASE_SCOPE) || n.querySelector(PHASE_SCOPE))) {
            shouldCheckTime = true;
          }
          // Дешёвый гейт: пин перепроверяем ТОЛЬКО когда в DOM добавлялись
          // узлы роли (Vue-пересоздание) — а не на каждый flush, иначе два
          // QSA на пачку вернули бы перф-класс PERF-1.
          if (!roleNodeAdded && (n.matches(ROLE_SEL) || n.querySelector(ROLE_SEL))) {
            roleNodeAdded = true;
          }
        }
        if (shouldCheckTime && roleNodeAdded) break;
      }
    }

    // Пересозданный узел роли — перенакласть пин, не дожидаясь 2с-опроса
    // (аудит №1): страховочный интервал остаётся второй линией. Желаемое
    // состояние выводится из фазы — латч здесь ничего не решает (наход. A).
    if (roleNodeAdded) healRolePin();

    if (shouldCheckTime) requestTimeOfDayCheck();
  });

  // Страховочный редкий опрос (2с): ловит смену текста таймера вне
  // .stage-скоупа и любые нестандартные раскладки вёрстки. Здесь же —
  // самолечение пина (аудит №1): пересозданный Vue узел теряет пин, латч
  // сверяется с живым DOM и перенакладывает в пределах пары секунд.
  timeOfDayFallbackTimer = setInterval(() => {
    checkPhaseRoute();
    checkNewRound();
    healRolePin();
    checkOutAtNight();
    requestTimeOfDayCheck();
  }, 2000);

  // Начальная проверка времени суток.
  setTimeout(() => requestTimeOfDayCheck(), 1000);
  // Фаза ещё неизвестна → своя роль скрыта, а гейт сцены прячет стол — сразу
  // при включении, а не первым опросом (внешний аудит №5, B04).
  healRolePin();
}

function stopDOMMonitoring(): void {
  unsubDom?.();
  unsubDom = null;
  unsubRouteImmediate?.();
  unsubRouteImmediate = null;
  // Возвращаем роли сайта в исходный вид: авто-режим мог оставить их
  // скрытыми (день) или принудительно показанными (ночь), и без этого они
  // застывали в таком виде до перерисовки страницы сайтом (находка 7).
  restoreRoleVisibility();

  if (timeOfDayFallbackTimer) {
    clearInterval(timeOfDayFallbackTimer);
    timeOfDayFallbackTimer = null;
  }
  if (timeOfDayCheckDebounceTimer) {
    clearTimeout(timeOfDayCheckDebounceTimer);
    timeOfDayCheckDebounceTimer = null;
  }
  if (pendingTimeOfDayConfirmTimer) {
    clearTimeout(pendingTimeOfDayConfirmTimer);
    pendingTimeOfDayConfirmTimer = null;
  }
  // Таймер видимости роли — ТОЖЕ здесь: он взводится на 3 с (ночь) и 250 мс
  // (дневные ретраи), переживал выключение автомода и заново пинил
  // visibility/opacity инлайновым !important ПОСЛЕ того, как
  // restoreRoleVisibility вернул стили — роль могла уехать в эфир при
  // выключенном автомоде (adversarial 29.08.2026, находка 1; тот же класс,
  // что SEAM-04, но таймерный хвост, а не await).
  if (pendingRoleVisibilityTimer) {
    clearTimeout(pendingRoleVisibilityTimer);
    pendingRoleVisibilityTimer = null;
  }
  timeOfDayCheckQueued = false;
  pendingTimeOfDay = null;
}

// ─────────────────────────── видимость панели по игровому интерфейсу ───────────────────────────

function syncPanelVisibilityWithGameState(): void {
  const hasGameUi = hasActiveGameInterface();

  if (!hasGameUi) {
    if (isVisible) doHide();
    return;
  }
  if (!isVisible) doShow();
}

function doShow(): void {
  if (!panelEnabled) return;
  if (!hasActiveGameInterface()) return;

  if (!panel) {
    panel = new ObsPanel();
    panel.onSceneClick = (sceneName) => {
      // Ручной клик: приоритетнее автоматики (см. switchScene). Ошибку ловим
      // здесь: без catch это необработанный rejection, а человек, кликнувший
      // по сцене, не узнавал, что переключение не удалось.
      void switchScene(sceneName, true).catch((e: Error) => {
        log.error(SCOPE, "ручное переключение сцены не удалось", e);
        panel?.setConnectionStatus(`Не удалось переключить: ${e.message}`, "error");
      });
    };
    panel.onClose = () => {
      doHide();
      // Также отключаем настройку плавающей панели.
      void browser.storage.sync.set({ obs_floating_panel_enabled: false });
    };
  }
  panel.show();
  isVisible = true;

  void requestOBSStatus();
  if (autoModeEnabled) startDOMMonitoring();
}

function doHide(): void {
  panel?.hide();
  isVisible = false;
}

let unsubGameUi: (() => void) | null = null;

function startGameUiMonitoring(): void {
  if (unsubGameUi) return;
  unsubGameUi = onDomChange((muts) => {
    // Батч-фильтр (перф-аудит 06.08.2026, PERF-2): видимость игрового UI
    // считается по ЧИСЛУ плиток/камер/контролов — attr-only батчи (звуковые
    // индикаторы, style) его не меняют, а гоняли полную сверку до 6.7 раз/с.
    if (!muts.some((m) => m.type === "childList" && (m.addedNodes.length || m.removedNodes.length))) {
      return;
    }
    if (gameUiDebounceTimer) return;
    gameUiDebounceTimer = setTimeout(() => {
      gameUiDebounceTimer = null;
      syncPanelVisibilityWithGameState();
    }, 500); // ≤2 полных сверок/с — бюджет из отчёта
  });
}

function stopGameUiMonitoring(): void {
  unsubGameUi?.();
  unsubGameUi = null;
  if (gameUiDebounceTimer) {
    clearTimeout(gameUiDebounceTimer);
    gameUiDebounceTimer = null;
  }
}

// ─────────────────────────── приём событий OBS ───────────────────────────

function handleOBSEvent(eventType: string, data: any): void {
  log.debug(SCOPE, "OBS event:", eventType, data);

  switch (eventType) {
    case "obs_scenes_updated":
      sceneInfoEpoch++;
      if (data && data.scenes) {
        scenes = data.scenes;
        currentScene = data.currentScene ?? null;

        // Создаём панель если её нет и включён авторежим.
        if (!panel && autoModeEnabled && hasActiveGameInterface()) doShow();

        panel?.setScenes(scenes, currentScene);
        panel?.setConnectionStatus("Подключено", "connected");
        // (Ре)коннект посреди игры: 01.10.2026 OBS поднялся ЧЕРЕЗ 30 с после
        // начала ночи, но сцену никто не переключил — следующая попытка была
        // бы только на смене фазы. Догоняем известную фазу сейчас; гейты
        // (автомод, комната, «уже на месте») — внутри autoSwitchScene.
        if (autoModeEnabled && currentTimeOfDay) {
          void autoSwitchScene(currentTimeOfDay);
          healRolePin();
        }
      }
      break;

    case "obs_scene_changed":
      sceneInfoEpoch++;
      currentScene = data ?? null;
      if (!panel && autoModeEnabled && hasActiveGameInterface()) doShow();
      panel?.setCurrentScene(currentScene);
      // Сцена эфира сменилась (нами или СТРИМЕРОМ РУКАМИ) — желаемая
      // видимость роли могла измениться вместе с ней: ушли с ночной сцены →
      // роль прячется, вернулись → показывается (жалоба 01.10.2026).
      healRolePin();
      break;

    case "obs_connected":
      // Раньше case отсутствовал: если GetSceneList после коннекта падал,
      // панель навсегда показывала «Не подключено» при живом соединении.
      panel?.setConnectionStatus("Подключено", "connected");
      break;

    case "obs_disconnected":
      sceneInfoEpoch++;
      void clearPersistedAutoState(true);
      scenes = [];
      currentScene = null;
      if (!panel && autoModeEnabled && hasActiveGameInterface()) doShow();
      panel?.setScenes(scenes, currentScene);
      panel?.setConnectionStatus("Не подключено", "error");
      // Сцена больше не известна → ночной гейт закрылся: прячем роль сразу,
      // а не через 2с-опрос (fail-safe: эфир может оставаться на дневной).
      healRolePin();
      break;
  }
}

// ─────────────────────────── применение настроек авто-режима ───────────────────────────

/**
 * Действуют ли автосцены. Чистая функция — сторожится мутационно.
 *
 * Тумблер автосцен в попапе живёт ВНУТРИ блока OBS, который прячется при
 * выключении интеграции, — и значение оставалось true невидимкой (жалоба
 * 07.10.2026: OBS выключен, а автосцены продолжали вести роль по фазам; с
 * гейтом ночной сцены 9.64.1 своя роль была скрыта ВСЮ ночь, а D не помогал —
 * роль держал пин автосцен). Выключенный OBS = автосцен нет вовсе: ни смены
 * сцен, ни пина роли; роль ведёт auto-start по своим настройкам.
 */
export function effectiveAutoMode(s: { obs_auto_mode_enabled?: unknown; obs_enabled?: unknown }): boolean {
  return s.obs_auto_mode_enabled === true && s.obs_enabled === true;
}

function applyAutoSettings(ctx: FeatureContext): void {
  const s = ctx.settings;
  revealOnEnd = s.roles_reveal_on_game_end !== false;
  const newDayWhenOut = s.obs_day_scene_when_out !== false;
  const newAutoMode = effectiveAutoMode(s);
  const newDayScene = s.obs_day_scene || "";
  const newNightScene = s.obs_night_scene || "";

  const changed =
    newAutoMode !== autoModeEnabled ||
    newDayScene !== dayScene ||
    newNightScene !== nightScene ||
    newDayWhenOut !== dayWhenOut;

  const wasAuto = autoModeEnabled;
  dayWhenOut = newDayWhenOut;
  autoModeEnabled = newAutoMode;
  dayScene = newDayScene;
  nightScene = newNightScene;

  if (!changed) return;
  autoGeneration++;
  // Гейт ночной сцены зависит от этих настроек: выключили автосцены —
  // сценовое скрытие сокомандников должно сняться (внешний аудит, H04).
  notifyRoleSceneGate("gate");

  // info: пользователь переключил тумблер или выбрал другие сцены — и ждёт,
  // что это сразу подействует. Раньше в файле не было ни самого изменения, ни
  // его последствия (аудит наблюдаемости 02.08.2026, OP-3).
  // Первый вызов — это ЗАПУСК, а не правка: при загрузке страницы значения
  // приезжают с дефолтов, и «изменены» было бы ложным следом «пользователь
  // только что трогал тумблер» (ревью 02.08.2026).
  log.info(
    SCOPE,
    autoSettingsInitialized ? "настройки автосцен изменены: авто-режим" : "автосцены при запуске: авто-режим",
    autoModeEnabled ? "вкл" : "выкл",
    "| день:",
    dayScene || "не выбрана",
    "| ночь:",
    nightScene || "не выбрана",
  );

  const wasInitialized = autoSettingsInitialized;
  autoSettingsInitialized = true;

  if (autoModeEnabled) {
    startDOMMonitoring();
    // Новую пару применяем к УЖЕ известной фазе. Обнулять currentTimeOfDay
    // нельзя: финальный фолбэк детектора — `currentTimeOfDay || "day"`, то
    // есть без памяти «не понял — оставь как было» превращается в «считай,
    // что день», и смена пары сцен ночью могла выдать дневную сцену в эфир
    // (ревью 02.08.2026).
    // Автосцены были ВЫКЛЮЧЕНЫ: фаза, запомненная до выключения, могла
    // смениться без нас — берём живую, если она распознаётся (аудит №6, §4:
    // выкл → ночь → вкл слал старую дневную сцену).
    if (wasInitialized && !wasAuto && currentTimeOfDay) {
      const live = detectPhaseAfter(currentTimeOfDay);
      if (lastDetectWasLive && live !== currentTimeOfDay) {
        currentTimeOfDay = live;
        nightSince = live === "night" ? Date.now() : null;
        phaseEpoch++;
      }
    }
    if (wasInitialized && currentTimeOfDay) {
      // Повторное включение днём — через ту же защиту, что смена фазы:
      // роли стола прячутся ДО команды дневной сцены (внешний аудит №3, B06).
      const known = currentTimeOfDay;
      const gen = autoGeneration;
      const route = routeEpoch;
      void (async () => {
        if (known === "day") await hideRoleBeforeDaySceneSwitch();
        if (!autoModeEnabled || gen !== autoGeneration || route !== routeEpoch) return;
        await autoSwitchScene(known);
      })();
      // Симметрия teardown/enable (§4 п.7): выключение возвращает стили роли
      // (restoreRoleVisibility в stopDOMMonitoring), значит включение обязано
      // применить видимость к уже известной фазе заново. Без этого цикл
      // выкл/вкл на дне оставлял роль видимой на дневной сцене до следующей
      // смены фазы — раньше дыру случайно маскировал негейченный таймер,
      // который чинили находкой 1 (adversarial 29.08.2026, находка 2).
      scheduleRoleVisibility(currentTimeOfDay);
    }
    requestTimeOfDayCheck();
  } else {
    stopDOMMonitoring();
  }
}

// ─────────────────────────── публичная фича ───────────────────────────

export const obsPanelFeature: Feature = {
  id: "obs-panel",
  // null: раньше здесь стоял "obs_floating_panel_enabled" (дефолт false) —
  // и ВЕСЬ автомод день/ночь, живущий внутри этой фичи, не запускался без
  // включённой плавающей панели. Попап при этом давал настроить сцены,
  // которые никогда не переключались. Теперь фича активна всегда, а панель
  // и мониторинг гейтятся каждый своей настройкой.
  settingKey: null,

  async enable(ctx) {
    sweepOrphanPins(); // следы прежней копии скрипта (внешний аудит, раздел E)
    panelEnabled = ctx.settings.obs_floating_panel_enabled === true;
    applyAutoSettings(ctx);

    // Приём событий OBS из background.
    unsubMessage = onMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as any;
      if (m.type === "obs_event") {
        handleOBSEvent(m.eventType, m.data);
      }
      if (m.type === "obs_scene_owner_ping") {
        // «Автосцену ведёшь ты ПРЯМО СЕЙЧАС?» Отвечать по одной настройке
        // нельзя: `autoModeEnabled` — это «мне разрешено», и он остаётся true
        // до конца жизни вкладки. Вкладка с доигранным матчем держала бы
        // владение ещё 20 минут, а следующая игра в новой вкладке всё это
        // время молчала бы (ревью 02.08.2026 — самый частый бытовой случай).
        return Promise.resolve({
          owning: drivesAutoScene({
            autoModeOn: autoModeEnabled,
            pathname: location.pathname,
            phaseKnown: currentTimeOfDay !== null,
            // Сверка комнаты прямо здесь, а не только в детекторе: быстрый
            // SPA-прыжок в другую комнату оставлял флаг истинным до первого
            // тика детектора (~2 с) — окно ложного «веду» (ревью 05.08.2026).
            // Свежесть: «живость» протухает после полутора минут непонимания
            // фазы — иначе комната, ушедшая в пре-гейм следующей игры без
            // смены pathname, держит владение вечно (лог 05.08.2026).
            // Видимый roomFixedState (пауза/промах) — доказательство ИДУЩЕГО
            // матча (см. selectors), а маркеров на нём нет: пауза длиннее
            // порога не должна отдавать сцену эфира вору (ревью 05.08,
            // блокер). Живость пауза лишь СОХРАНЯЕТ, создать её она не может:
            // phaseConfirmedLive обязан быть заработан распознанием ДО неё.
            phaseSeenLive:
              phaseConfirmedLive &&
              location.pathname === phaseFlagPathname &&
              (phaseUnknownSince === 0 ||
                Date.now() - phaseUnknownSince <= OWNER_PHASE_STALE_MS ||
                fixedStateScreenVisible()),
            pregameVisible: pregameScreenVisible(),
            matchFinished: matchFinishedVisible(),
          }),
        });
      }
      // floating_panel_show/hide/toggle удалены: этих сообщений никто никогда
      // не отправлял (и их не было в ExtMessage) — слушатели-призраки.
      return undefined;
    });

    // Мониторинг появления/исчезновения игрового UI (нужен только панели).
    if (panelEnabled) startGameUiMonitoring();

    // Показываем панель если уже на странице игры.
    if (hasActiveGameInterface()) doShow();

    // Запрос статуса OBS + восстановление состояния авто-сцены.
    if (autoModeEnabled) {
      const epoch = sceneInfoEpoch;
      const phaseAt = phaseEpoch;
      const routeAt = routeEpoch;
      const response = await obsCommand("get_status");
      const status = response?.success ? response.data : null;
      await restorePersistedAutoState(status, epoch, phaseAt, routeAt);
    }

    syncPanelVisibilityWithGameState();

    // Запуск авто-определения времени суток.
    if (autoModeEnabled) startDOMMonitoring();
  },

  update(ctx) {
    const nextPanelEnabled = ctx.settings.obs_floating_panel_enabled === true;
    if (nextPanelEnabled !== panelEnabled) {
      panelEnabled = nextPanelEnabled;
      if (panelEnabled) {
        startGameUiMonitoring();
        syncPanelVisibilityWithGameState();
      } else {
        stopGameUiMonitoring();
        doHide();
      }
    }
    applyAutoSettings(ctx);
  },

  disable() {
    autoGeneration++; // продолжения прошлой жизни фичи — не наши
    // Снять подписки.
    unsubMessage?.();
    unsubMessage = null;
    stopGameUiMonitoring();
    stopDOMMonitoring();

    // Снять оставшиеся таймеры.
    if (pendingRoleVisibilityTimer) {
      clearTimeout(pendingRoleVisibilityTimer);
      pendingRoleVisibilityTimer = null;
    }

    // Демонтировать панель.
    panel?.unmount();
    panel = null;
    isVisible = false;

    // Сброс состояния.
    scenes = [];
    currentScene = null;
    obsSessionId = null;
    outAtNight = false;
    staleOutMark = false;
    currentTimeOfDay = null;
    nightSince = null;
    longNightWarned = false;
    phaseConfirmedLive = false;
    phaseFlagPathname = "";
    lastAppliedRoleVisibility = null;
    autoModeEnabled = false;
    dayScene = "";
    nightScene = "";
    // Иначе после выключения и повторного включения первая же удачная
    // детекция напечатала бы «не понимали 3600 с», посчитав и время, когда
    // фича вообще не работала — строка, чей единственный смысл в длительности,
    // врала бы (ревью 02.08.2026).
    phaseUnknownSince = 0;
    phaseUnknownReported = false;
    autoSettingsInitialized = false;
    // Автосцен больше нет — гейт сцены открыт: сценовое скрытие напарников у
    // auto-start должно сняться и при изолированном выключении этой фичи
    // (внешний аудит №2, L01).
    notifyRoleSceneGate("gate");
  },
};
