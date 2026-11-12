/**
 * Обновление из магазина «сейчас» (просьба владельца 12.11.2026).
 *
 * Без слушателя onUpdateAvailable браузер ставит скачанную версию сам, когда
 * фон простаивает, — но пока открыта Полемика, фон почти не засыпает, и
 * обновление ждёт перезапуска браузера. Слушатель даёт знать, что версия
 * скачана, и по документации откладывает её до runtime.reload() — решаем сами
 * (если браузер всё же применит её по простою, флаг снимет сверка при старте):
 *  - вкладок Полемики нет — перезапускаемся сразу (как раньше «по простою»,
 *    только быстрее);
 *  - вкладка открыта — не трогаем (перезапуск посреди игры отключил бы наши
 *    функции в ней до F5), запоминаем готовую версию: попап покажет кнопку
 *    «Обновить», а закрытие последней вкладки Полемики применит обновление.
 *
 * Флаг готовности — в storage.local (фон в MV3 засыпает, память не живёт).
 * attempted — перезапуск уже пробовали: если новый фон проснулся всё ещё на
 * старой версии, скачанное обновление потерялось, и флаг снимаем — иначе
 * кнопка нажималась бы вхолостую; браузер предложит версию заново.
 */
import { browser } from "@core/env";
import { log } from "@core/log";
import { isGameRoomPath } from "@shared/routes";
import {
  STORE_UPDATE_READY_KEY,
  readyFrom,
  versionNewer,
  type StoreUpdateReady,
} from "@shared/store-update";

export { STORE_UPDATE_READY_KEY };

const POLEMICA_TABS = "*://*.polemicagame.com/*";
const SCOPE = "store-update";

async function readReady(): Promise<StoreUpdateReady | null> {
  const st = (await browser.storage.local.get({ [STORE_UPDATE_READY_KEY]: null })) as Record<
    string,
    unknown
  >;
  return readyFrom(st[STORE_UPDATE_READY_KEY]);
}

async function polemicaTabsOpen(): Promise<boolean> {
  const tabs = await browser.tabs.query({ url: POLEMICA_TABS });
  return tabs.length > 0;
}

/** Открыта ли где-нибудь игровая комната — перезапуск выключил бы в ней наши функции. */
async function gameRoomOpen(): Promise<boolean> {
  const tabs = await browser.tabs.query({ url: POLEMICA_TABS });
  return tabs.some((t) => {
    try {
      return isGameRoomPath(new URL(String(t.url || "")).pathname);
    } catch {
      return false;
    }
  });
}

/** Пауза перед перезапуском: ответ кнопке должен успеть уйти, пока фон жив. */
export const RELOAD_DELAY_MS = 150;

/** Применить скачанное обновление: пометить попытку и перезапуститься. */
export async function applyStoreUpdate(ready: StoreUpdateReady): Promise<void> {
  const next: StoreUpdateReady = { version: ready.version, attempted: true };
  await browser.storage.local.set({ [STORE_UPDATE_READY_KEY]: next });
  log.info(SCOPE, "применяю обновление из магазина", ready.version);
  // Не сразу: reload() убивает фон, и ответ на сообщение кнопки не ушёл бы —
  // успех выглядел бы как отказ (ревью 12.11.2026).
  setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
}

/** Браузер скачал новую версию. Экспорт — тестовый шов. */
export async function handleUpdateAvailable(version: string): Promise<void> {
  const current = browser.runtime.getManifest().version;
  if (!versionNewer(version, current)) return;
  const ready: StoreUpdateReady = { version };
  try {
    await browser.storage.local.set({ [STORE_UPDATE_READY_KEY]: ready });
    if (await polemicaTabsOpen()) {
      log.info(SCOPE, "обновление скачано, ждёт: открыта вкладка Полемики", version);
      return;
    }
    await applyStoreUpdate(ready);
  } catch (e) {
    log.warn(SCOPE, "не удалось обработать скачанное обновление", e);
  }
}

export type StoreUpdateReply = { ok: true } | { ok: false; reason: "no_update" | "in_game" | "error" };

/**
 * Кнопка «Обновить» в попапе. Скачанного обновления нет —
 * отказ: перезапуск на той же версии только оборвал бы вкладки. Открыта
 * игровая комната — тоже отказ: перезапуск посреди матча снял бы сцены OBS
 * и хоткеи до F5 (ревью 12.11.2026, major).
 */
export async function requestStoreUpdate(): Promise<StoreUpdateReply> {
  try {
    const ready = await readReady();
    if (!ready || !versionNewer(ready.version, browser.runtime.getManifest().version)) {
      return { ok: false, reason: "no_update" };
    }
    if (await gameRoomOpen()) return { ok: false, reason: "in_game" };
    await applyStoreUpdate(ready);
    return { ok: true };
  } catch (e) {
    log.warn(SCOPE, "не удалось применить обновление по кнопке", e);
    return { ok: false, reason: "error" };
  }
}

/** Закрыли вкладку: если это была последняя вкладка Полемики — применить. */
export async function handleTabClosed(): Promise<void> {
  try {
    const ready = await readReady();
    if (!ready || ready.attempted) return;
    if (!versionNewer(ready.version, browser.runtime.getManifest().version)) return;
    if (await polemicaTabsOpen()) return;
    await applyStoreUpdate(ready);
  } catch (e) {
    log.debug(SCOPE, "проверка после закрытия вкладки не удалась", e);
  }
}

/**
 * При загрузке фона: обновление встало (или потерялось после попытки) —
 * флаг больше не нужен.
 */
export async function reconcileStoreUpdate(): Promise<void> {
  try {
    const ready = await readReady();
    if (!ready) return;
    const current = browser.runtime.getManifest().version;
    const applied = !versionNewer(ready.version, current);
    if (!applied && !ready.attempted) return;
    // Перечитать перед удалением: пока шла сверка, onUpdateAvailable мог
    // записать свежий флаг — его не трогаем (ревью 12.11.2026).
    const again = await readReady();
    if (!again || again.version !== ready.version || again.attempted !== ready.attempted) return;
    await browser.storage.local.remove(STORE_UPDATE_READY_KEY);
    if (!applied) {
      log.warn(SCOPE, "перезапуск не применил обновление, ждём новое предложение браузера", ready.version);
    }
  } catch (e) {
    log.debug(SCOPE, "сверка флага обновления не удалась", e);
  }
}

/** Регистрация слушателей — синхронно на верхнем уровне фона (MV3). */
export function installStoreUpdate(): void {
  const ev = (browser.runtime as { onUpdateAvailable?: { addListener(cb: (d: { version: string }) => void): void } })
    .onUpdateAvailable;
  if (!ev) return;
  ev.addListener((details) => {
    void handleUpdateAvailable(String(details?.version || ""));
  });
  browser.tabs.onRemoved.addListener(() => {
    void handleTabClosed();
  });
  void reconcileStoreUpdate();
}
