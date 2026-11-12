/**
 * Content entry. Поднимает FeatureManager со всеми фичами и парсит данные матча.
 * FeatureManager сам включает/выключает фичи по настройкам (storage.onChanged),
 * поэтому отдельный роутинг сообщений в каждом модуле больше не нужен.
 */
import { log } from "@core/log";
import { setupDirectRequeue } from "./direct-requeue-transport";
import { installErrorCapture } from "@core/errors";
import { getSetting, onSettingsChanged } from "@core/settings";
import { FeatureManager } from "@core/feature";
import { getMatchId, parseMatchOnPage } from "./match-data";
import { onMessage } from "@core/messaging";
import { browser } from "@core/env";
import { clearToasts } from "@core/toast";
import { setupNicknameLengthsResponder } from "./nickname-lengths";
import { setupDiagnostics } from "./diag";
import { startOrphanWatch, stopOrphanWatch } from "./orphan-watch";
import { LEGACY_PROBE_FLAG_KEY, REQUEUE_FLAG_KEY, WS_LOG_FLAG_KEY } from "./page/room-probe-inject";
import { getOwnUserId } from "@core/own-user";

import { searchFeature } from "./features/search";
import { autoStartFeature } from "./features/auto-start";
import { autoReadyFeature } from "./features/auto-ready";
import { cameraHealthFeature } from "./features/camera-health";
import { freezeWatchFeature } from "./features/freeze-watch";
import { hotkeyHintsFeature } from "./features/hotkey-hints";
import { outcryHotkeyFeature } from "./features/outcry-hotkey";
import { playerActionKeysFeature } from "./features/player-action-keys";
import { finishSpeechHotkeyFeature } from "./features/finish-speech-hotkey";
import { tiltButtonFeature } from "./features/tilt-button";
import { playerVolumeMemoryFeature } from "./features/player-volume-memory";
import { playerNotesFeature, syncPlayerNotesRoute } from "./features/player-notes";
import { matchStatsFeature, syncMatchStatsRoute } from "./features/match-stats";
import { tooltipFeature } from "./features/tooltip";
import { roleFakerFeature } from "./features/role-faker";
import { pauseHotkeyFeature } from "./features/pause-hotkey";
import { f5RefreshFeature } from "./features/f5-refresh";
import { roleMarkerFeature } from "./features/role-marker";
import { rolesPredictorFeature } from "./features/roles-predictor";
import { protocolEmojiFeature } from "./features/protocol-emoji";
import { updateNotifyFeature } from "./features/update-notify";
import { connectionDiagFeature, syncConnectionDiagRoute } from "./features/connection-diag";
import { queueGuardFeature, syncQueueGuardRoute } from "./features/queue-guard";
import { queuePeekFeature } from "./features/queue-peek";
import { queueCountsRefreshFeature } from "./features/queue-counts-refresh";
import { roomQueueCountsFeature } from "./features/room-queue-counts";
import { queueRequeueFeature } from "./features/queue-requeue";
import { postgameSearchFeature } from "./features/postgame-search";
import { nickPlateFeature } from "./features/nick-plate";
import { wsLogFeature } from "./features/ws-log";
import { controlsSafetyFeature } from "./features/controls-safety";
import { obsPanelFeature, syncObsRoomRoute } from "./panels/obs-panel";
import { sessionStatsFeature } from "./panels/session-stats-panel";
import { tableSummaryFeature } from "./panels/table-summary-panel";
import { micSyncFeature } from "./features/mic-sync";
import { profileCrossoverFeature, profileIdFromPath, syncProfileCrossoverRoute } from "./features/profile-crossover";
import { profileMmrChartFeature, syncProfileMmrRoute } from "./features/profile-mmr-chart";
import { profilePhotoFeature, syncProfilePhotoRoute } from "./features/profile-photo";
import { searchAvatarsFeature } from "./features/search-avatars";
import { searchCardAvatarFeature } from "./features/search-card-avatar";
import { obsRecordFeature, syncObsRecordRoute } from "./features/obs-record";
import { obsClipFeature } from "./features/obs-clip";
import { contractWatchFeature, syncContractWatchRoute } from "./features/contract-watch";
import { isGameRoomPath } from "@shared/routes";
import { twitchPanelFeature } from "./panels/twitch-panel";
import { hideRatingFeature } from "./features/hide-rating";
import { ppkGuardFeature } from "./features/ppk-guard";

setupDirectRequeue();

const manager = new FeatureManager().register(
  searchFeature,
  autoStartFeature,
  // Скрыть рейтинг — до фич, которые ждут storage: метки колонки и строки
  // MMR не должны ждать загрузки заметок.
  hideRatingFeature,
  ppkGuardFeature,
  // Приватность ролей — до фич, которые ждут storage (заметки): менеджер
  // включает фичи по очереди с await, и автосцены OBS иначе стартовали
  // только после загрузки заметок — роли были открыты (внешний аудит №5, B04).
  obsPanelFeature,
  roleFakerFeature,
  autoReadyFeature,
  // Возврат в очередь не ждёт асинхронной загрузки заметок и панелей.
  queueRequeueFeature,
  playerNotesFeature,
  matchStatsFeature,
  tooltipFeature,
  pauseHotkeyFeature,
  outcryHotkeyFeature,
  finishSpeechHotkeyFeature,
  cameraHealthFeature,
  playerVolumeMemoryFeature,
  freezeWatchFeature,
  f5RefreshFeature,
  roleMarkerFeature,
  rolesPredictorFeature,
  protocolEmojiFeature,
  updateNotifyFeature,
  connectionDiagFeature,
  queueGuardFeature,
  queuePeekFeature,
  queueCountsRefreshFeature,
  roomQueueCountsFeature,
  postgameSearchFeature,
  nickPlateFeature,
  wsLogFeature,
  controlsSafetyFeature,
  twitchPanelFeature,
  sessionStatsFeature,
  tableSummaryFeature,
  micSyncFeature,
  profileCrossoverFeature,
  profileMmrChartFeature,
  profilePhotoFeature,
  searchAvatarsFeature,
  searchCardAvatarFeature,
  tiltButtonFeature,
  obsRecordFeature,
  obsClipFeature,
  contractWatchFeature,
  // Последней из клавишных: при загрузке занятую другими фичами клавишу
  // место не отнимает (пауза, роли, выкрик, микрофон, клип — все раньше).
  playerActionKeysFeature,
  // После действий по цифрам: в одном проходе update подсказка читает уже
  // новую привязку мест, а не прежнюю (контрольный раунд ревью).
  hotkeyHintsFeature,
);

function setupUrlRouter(extensionEnabledAtBoot: boolean): void {
  let extensionOn = extensionEnabledAtBoot;
  let lastHref = "";
  let lastMatchId: string | null | undefined;
  let scheduled = false;

  const reconcile = () => {
    scheduled = false;
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;

    const matchId = getMatchId();
    syncPlayerNotesRoute(matchId !== null);
    syncMatchStatsRoute(matchId);
    // Фичи страницы поиска: раньше они решали свою судьбу один раз в
    // enable() и при переходе ВНУТРИ сайта не поднимались до F5 (аудит
    // lifecycle 01.08.2026, находка 16). Функции идемпотентны и симметричны.
    const onSearch =
      location.pathname === "/game-search" || location.pathname.startsWith("/game-search/");
    syncQueueGuardRoute(onSearch);
    syncConnectionDiagRoute(onSearch);
    syncProfileCrossoverRoute(profileIdFromPath(location.pathname));
    syncProfileMmrRoute(profileIdFromPath(location.pathname));
    syncProfilePhotoRoute();
    syncObsRecordRoute(isGameRoomPath(location.pathname));
    syncContractWatchRoute(isGameRoomPath(location.pathname));
    syncObsRoomRoute(isGameRoomPath(location.pathname));
    if (matchId !== lastMatchId) {
      lastMatchId = matchId;
      // Мастер-выключатель: не качаем страницу матча впустую — все
      // потребители gameDataParsed всё равно выключены FeatureManager'ом.
      if (extensionOn) void parseMatchOnPage(matchId);
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(reconcile);
  };

  window.addEventListener("popstate", schedule);

  // pushState/replaceState сайта выполняются в другом JS-world, поэтому SPA-переходы
  // отслеживает дешёвое сравнение URL; back/forward дополнительно будит popstate.
  const fallbackTimer = window.setInterval(schedule, 500);
  const onPageShow = () => schedule();
  const onPageHide = (event: PageTransitionEvent) => {
    // Тосты — ОБЩИЙ ресурс: снимает их владелец страницы, а не каждая фича.
    // Иначе выключение одной фичи стирало плашку соседней и обнуляло её
    // подавление повторов (ревью 02.08.2026).
    if (!event.persisted) clearToasts();
    if (event.persisted) return;
    clearInterval(fallbackTimer);
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide);
  };
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);

  onSettingsChanged((patch) => {
    if (!("extension_enabled" in patch)) return;
    extensionOn = patch.extension_enabled !== false;
    if (extensionOn) {
      // Пока расширение было выключено, парсинг пропускался — форсируем
      // полный проход, чтобы открытая страница матча ожила без F5.
      lastHref = "";
      lastMatchId = undefined;
      schedule();
    }
  });

  reconcile();
}

// Диагностика: перехват ошибок + гейт персиста логов по настройке.
installErrorCapture("content");
void getSetting("debug_logging_enabled").then((on) => log.setPersist(on));
onSettingsChanged((patch) => {
  if ("debug_logging_enabled" in patch) log.setPersist(patch.debug_logging_enabled === true);
});
// (pagehide-флеш логов теперь внутри core/log — общий для content и popup.)

void manager.start().catch((e) => log.error("content", "manager start failed", e));
// Роутер стартует после чтения мастер-выключателя: иначе первый reconcile()
// успел бы дёрнуть parseMatchOnPage до того, как мы узнали, что расширение
// выключено. Фичи всё равно инертны до manager.start() — задержка безвредна.
// catch ДО then: иначе синхронный throw из setupUrlRouter (например, из
// enhance при готовом кэше) поставил бы второй роутер поверх живого первого.
void getSetting("extension_enabled")
  .catch((e) => {
    log.error("content", "router boot failed", e);
    return true;
  })
  .then((on) => setupUrlRouter(on));
setupNicknameLengthsResponder();
setupDiagnostics();

/**
 * Зеркала настроек, от которых зависит зонд комнаты («Полный лог общения с
 * сервером» и автовозврат в поиск), в localStorage страницы.
 *
 * Ранний инжектор зонда (document_start) обязан решить «ставить или нет»
 * СИНХРОННО — иначе он опоздает к созданию сокета комнаты, ради чего и
 * существует. storage расширения асинхронный, поэтому единственную нужную
 * ему крупицу состояния держим здесь: пишем при загрузке и на каждое
 * изменение настройки. Значение применится со следующей загрузки страницы —
 * зонд ставится один раз и снимается только перезагрузкой.
 */
function mirrorProbeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* приватный режим: зонд останется на дефолте */
  }
}
/**
 * Свой userId читаем на КАЖДОЙ обычной странице сайта и запоминаем: в игровой
 * комнате шапки с ссылкой на профиль нет, а статистика пересечений нужна
 * именно там. Без этого id узнавался бы только в самой комнате и окольным
 * путём (жалоба владельца 09.08.2026).
 */
void getOwnUserId();

void getSetting("ws_full_log_enabled")
  .catch(() => false)
  .then((on) => mirrorProbeFlag(WS_LOG_FLAG_KEY, on === true));
// Тот же зонд нужен автовозврату: сигнал on_stop_game на 2 с раньше экрана
// роспуска (см. REQUEUE_FLAG_KEY). Флаг — тоже со следующей загрузки комнаты.
void getSetting("requeue_after_lobby_fail_enabled")
  .catch(() => false)
  .then((on) => mirrorProbeFlag(REQUEUE_FLAG_KEY, on === true));
onSettingsChanged((patch) => {
  if ("ws_full_log_enabled" in patch) mirrorProbeFlag(WS_LOG_FLAG_KEY, patch.ws_full_log_enabled === true);
  if ("requeue_after_lobby_fail_enabled" in patch) {
    mirrorProbeFlag(REQUEUE_FLAG_KEY, patch.requeue_after_lobby_fail_enabled === true);
  }
});
// Зеркало убранной фичи «кто поставил паузу»: без уборки строка осталась бы
// в localStorage САЙТА у всех, кто ставил прежние версии.
try {
  localStorage.removeItem(LEGACY_PROBE_FLAG_KEY);
  // Ключи ПРЕЖНЕЙ версии расширения (twitch-панель до рефакторинга): они
  // лежат в localStorage САЙТА у всех, кто ставил старую сборку, и ничем не
  // читаются с 9.x. Разовая уборка — та же вежливость, что и строкой выше.
  localStorage.removeItem("twitch-chat-position");
  localStorage.removeItem("twitch-chat-size");
} catch {
  /* приватный режим — чистить нечего */
}

// Сторож осиротевшей вкладки (F5-баннер). Гейт по мастер-выключателю:
// выключенное расширение не имеет права напоминать о себе баннером.
// Флаг от слушателя побеждает boot-чтение: выключение тумблера в момент
// загрузки страницы иначе проигрывало бы устаревшему getSetting (ревью
// 06.08.2026; тот же паттерн, что в setupUrlRouter).
let orphanMasterOff = false;
void getSetting("extension_enabled")
  .catch(() => true)
  .then((on) => {
    if (on !== false && !orphanMasterOff) startOrphanWatch();
  });
onSettingsChanged((patch) => {
  if (!("extension_enabled" in patch)) return;
  orphanMasterOff = patch.extension_enabled === false;
  if (orphanMasterOff) stopOrphanWatch();
  else startOrphanWatch();
});

/**
 * Ответ на вопрос «на какой версии ты работаешь».
 *
 * Браузер НЕ переинжектит content-скрипт в уже открытый документ после
 * обновления расширения: игра продолжает работать на старом коде, и понять
 * это со стороны попапа было нельзя (аудит lifecycle 01.08.2026, находка 3).
 * Ответ отсюда возможен, пока контекст жив; ПОСЛЕ обновления этот скрипт
 * сиротеет и на сообщения не отвечает вовсе — тот случай закрывает
 * orphan-watch: единственный баннер поверх игры, разрешённый владельцем
 * (решение 06.08.2026; прежнее «только попап» касалось живого контекста).
 */
onMessage((msg) => {
  if ("type" in msg && msg.type === "getContentVersion") {
    return Promise.resolve({ version: browser.runtime.getManifest().version });
  }
  // Комнатность для автозаписи OBS: отвечает ЛЮБАЯ вкладка сайта, независимо
  // от включённых фич — правду о вкладке знает только она (§4.10).
  if ("type" in msg && msg.type === "obs_room_probe") {
    return Promise.resolve({ inRoom: isGameRoomPath(location.pathname) });
  }
  // Снимок состояния вкладки для диагностики (попап, экспорт лога).
  if ("type" in msg && msg.type === "diag_state") {
    return Promise.resolve({ path: location.pathname, active: manager.activeIds() });
  }
  return undefined;
});

// Только origin+pathname: query/fragment могут нести приглашения и ключи, а
// лог выгружается в файл для поддержки (аудит безопасности 01.08.2026, №13).
log.info("content", "booted", navigator.userAgent, location.origin + location.pathname);
