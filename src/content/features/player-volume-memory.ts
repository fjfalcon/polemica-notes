/**
 * Фича: громкость игрока запоминается (просьба владельца 09.11.2026, галочка,
 * по умолчанию ВКЛ). Сайт держит громкость в компоненте плитки и с каждой
 * новой игрой сбрасывает её на умолчание.
 *
 *  - ЗАПИСЬ: игрок отпустил ползунок «Громкость игрока» (событие change,
 *    только trusted) → id игрока из ссылки «Профиль» того же меню →
 *    storage.local pn_player_volumes, список пар [id, громкость] (слиянием со свежим диском: соседняя
 *    вкладка могла записать своё).
 *  - ПРИМЕНЕНИЕ: в комнате, когда есть что применять, page-скрипт
 *    (page/player-volume-page.ts, ставится лениво) получает карту и зовёт
 *    у плиток метод сайта updateVolumeIcon — тот же, что ползунок. Каждой
 *    плитке — один раз на значение; дальше ползунок в руках игрока.
 *
 * DOM-подписчик в DOM не пишет: читает плитки и шлёт команду (задросселено,
 * при смене состава плиток и не чаще раза в RESEND_MS без смены). Единственный
 * свой узел — тег page-скрипта, один раз, под флагом.
 */
import { browser } from "@core/env";
import { isContextInvalidated } from "@core/context";
import { onDomChange } from "@core/dom";
import { log } from "@core/log";
import { SITE } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import {
  PLAYER_VOLUMES_KEY,
  PLAYER_VOLUME_CMD_SOURCE,
  normalizeVolume,
  sanitizePlayerVolumes,
  serializePlayerVolumes,
  userIdFromProfileHref,
  withPlayerVolume,
  type PlayerVolumes,
} from "@shared/player-volumes";
import type { Feature } from "@core/feature";

const SCOPE = "player-volume";
const PAGE_SCRIPT = "player-volume-page.js";
/** Дроссель прохода после изменений DOM. */
const THROTTLE_MS = 500;
/** Повтор без смены состава: компонент плитки мог пересоздаться молча. */
const RESEND_MS = 5000;

let volumes: PlayerVolumes = new Map();
let version = 0;
let active = false;
/** Поколение enable: продолжение старого enable после disable ничего не трогает. */
let generation = 0;
let offDom: (() => void) | null = null;
let throttle: ReturnType<typeof setTimeout> | null = null;
let probe: "none" | "loading" | "ready" | "failed" = "none";
let lastSig = "";
let lastSentAt = 0;
/** Очередь записей: две подряд не должны затереть друг друга. */
let writeChain: Promise<void> = Promise.resolve();

/** Отпущенный ползунок → id игрока и громкость; null — не наш ползунок. Тестовый шов. */
export function readSliderChange(target: EventTarget | null): { id: string; volume: number } | null {
  if (!(target instanceof HTMLInputElement) || !target.matches(SITE.playerVolumeSlider)) return null;
  const menu = target.closest(SITE.playerMenuContainer);
  const link = menu?.querySelector(SITE.playerMenuProfileLink);
  const id = userIdFromProfileHref(link?.getAttribute("href"));
  const volume = normalizeVolume(target.value);
  return id && volume !== null ? { id, volume } : null;
}

function save(id: string, volume: number): void {
  volumes = withPlayerVolume(volumes, id, volume);
  version++;
  writeChain = writeChain
    .then(async () => {
      const res = (await browser.storage.local.get(PLAYER_VOLUMES_KEY)) as Record<string, unknown>;
      const fresh = withPlayerVolume(sanitizePlayerVolumes(res[PLAYER_VOLUMES_KEY]), id, volume);
      await browser.storage.local.set({ [PLAYER_VOLUMES_KEY]: serializePlayerVolumes(fresh) });
    })
    .catch((e) => {
      // Осиротевшая вкладка (расширение обновили) — молчим: API расширения мертвы.
      if (!isContextInvalidated()) log.warn(SCOPE, `громкость не сохранилась: ${String(e)}`);
    });
  log.debug(SCOPE, `громкость игрока ${id}: ${volume}`);
}

/** Отпущенный ползунок → запись. Тестовый шов: jsdom не создаёт trusted-событий. */
export function noteSliderChange(target: EventTarget | null): void {
  if (!active) return;
  const hit = readSliderChange(target);
  if (hit) save(hit.id, hit.volume);
}

const onChange = (e: Event): void => {
  // Синтетическое событие страницы — не решение игрока.
  if (e.isTrusted) noteSliderChange(e.target);
};

const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
  if (area !== "local" || !(PLAYER_VOLUMES_KEY in changes)) return;
  volumes = sanitizePlayerVolumes(changes[PLAYER_VOLUMES_KEY].newValue);
  version++;
  schedule();
};

function ensureProbe(onReady: () => void): void {
  if (probe === "ready") return onReady();
  if (probe !== "none") return;
  probe = "loading";
  const s = document.createElement("script");
  s.src = browser.runtime.getURL(PAGE_SCRIPT);
  s.onload = () => {
    s.remove();
    probe = "ready";
    onReady();
  };
  s.onerror = () => {
    s.remove();
    probe = "failed";
    log.warn(SCOPE, `${PAGE_SCRIPT} не загрузился`);
  };
  (document.head || document.documentElement).appendChild(s);
}

/** Подпись стола: состав плиток (ники) + версия карты. */
function tableSignature(): string {
  const names = Array.from(document.querySelectorAll(SITE.playerName), (n) => n.textContent ?? "");
  return `${version}|${names.length}|${names.join("\u0001")}`;
}

function push(): void {
  if (!active || !isGameRoomPath(location.pathname)) return;
  if (volumes.size === 0) return;
  if (!document.querySelector(SITE.player)) return;
  const sig = tableSignature();
  const now = Date.now();
  if (sig === lastSig && now - lastSentAt < RESEND_MS) return;
  lastSig = sig;
  lastSentAt = now;
  ensureProbe(() => {
    if (!active || volumes.size === 0) return;
    try {
      // Карта на момент отправки, а не на момент заказа: пока грузился
      // page-скрипт, могла прийти свежая (ревью).
      window.postMessage(
        { source: PLAYER_VOLUME_CMD_SOURCE, volumes: serializePlayerVolumes(volumes) },
        location.origin,
      );
    } catch {
      /* страница уходит */
    }
  });
}

function schedule(): void {
  if (throttle) return;
  throttle = setTimeout(() => {
    throttle = null;
    push();
  }, THROTTLE_MS);
}

export const playerVolumeMemoryFeature: Feature = {
  id: "player-volume-memory",
  settingKey: "player_volume_memory_enabled",

  async enable() {
    const gen = ++generation;
    active = true;
    volumes = new Map();
    lastSig = "";
    lastSentAt = 0;
    document.addEventListener("change", onChange, true);
    browser.storage.onChanged.addListener(onStorage);
    offDom = onDomChange(schedule);
    try {
      const res = (await browser.storage.local.get(PLAYER_VOLUMES_KEY)) as Record<string, unknown>;
      if (gen !== generation || !active) return;
      // Пока читали, могла прийти свежая запись этой вкладки — её не теряем.
      const loaded = sanitizePlayerVolumes(res[PLAYER_VOLUMES_KEY]);
      for (const [id, v] of volumes) {
        loaded.delete(id);
        loaded.set(id, v);
      }
      volumes = loaded;
      version++;
    } catch (e) {
      if (gen !== generation || !active) return;
      log.warn(SCOPE, `громкости не прочитались: ${String(e)}`);
    }
    schedule();
  },

  disable() {
    generation++;
    active = false;
    volumes = new Map();
    document.removeEventListener("change", onChange, true);
    browser.storage.onChanged.removeListener(onStorage);
    offDom?.();
    offDom = null;
    if (throttle) {
      clearTimeout(throttle);
      throttle = null;
    }
    // Уже выставленное плиткам остаётся до конца игры — это громкость сайта,
    // её дальше двигает ползунок.
  },
};
