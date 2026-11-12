/**
 * Кнопка «↻ Обновить» рядом с «Очередью» на странице поиска (просьба
 * владельца 12.11.2026): перечитать счётчики столов («Обычный 8/10»,
 * «Рейтинг 6/10», «Prime 1/10»). Сайт сам обновляет их только во время
 * поиска, а игрок часто открывает страницу просто посмотреть на столы.
 *
 * Числа пишет page-скрипт (page/search-counts-page.ts, ставится лениво при
 * первом нажатии) в данные компонента сайта — Vue перерисует сам, своих
 * надписей поверх сайта нет.
 *
 * Кнопка видна, только когда игрок может начать поиск (на месте «Играть»):
 * в поиске и при собранной игре числа ведёт сокет сайта. Вставка из
 * onDomChange идемпотентна (AGENTS.md §4 п.1): есть — не трогаем, видимость
 * правим только при расхождении.
 */
import { browser } from "@core/env";
import { onDomChange } from "@core/dom";
import { log } from "@core/log";
import { SITE } from "@core/selectors";
import { SEARCH_COUNTS_CMD, SEARCH_COUNTS_RESULT, safeReason } from "@shared/search-counts";
import type { Feature } from "@core/feature";

export const COUNTS_BUTTON_CLASS = "pn-counts-refresh-button";
const QUEUE_BUTTON_CLASS = "pn-queue-peek-button";
const PAGE_SCRIPT = "search-counts-page.js";
const SCOPE = "queue-counts-refresh";
const LABEL = "↻ Обновить";
/** Сколько ждём ответа page-скрипта, прежде чем вернуть кнопку. */
export const RESULT_TIMEOUT_MS = 8000;

let active = false;
let unsubDom: (() => void) | null = null;
let probe: "none" | "loading" | "ready" = "none";
/** Кто ждёт загрузки page-скрипта (повторный клик во время загрузки). */
let waiters: Array<() => void> = [];
/** Ждущий ответа запрос: id и его кнопка. */
let pending: { id: string; btn: HTMLButtonElement } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function isSearchPage(): boolean {
  return location.pathname === "/game-search" || location.pathname.startsWith("/game-search/");
}

/** На месте «Играть», не поиск и не собранная игра. */
function idleOnSearch(): boolean {
  return (
    !!document.querySelector(SITE.profileSearchButton) &&
    !document.querySelector(SITE.searchInProgress) &&
    !document.querySelector(SITE.profileAccept)
  );
}

function ensureProbe(onReady: () => void): void {
  if (probe === "ready") return onReady();
  waiters.push(onReady);
  if (probe === "loading") return;
  probe = "loading";
  const s = document.createElement("script");
  s.src = browser.runtime.getURL(PAGE_SCRIPT);
  s.onload = () => {
    s.remove();
    probe = "ready";
    const ready = waiters;
    waiters = [];
    for (const cb of ready) cb();
  };
  s.onerror = () => {
    s.remove();
    // Следующий клик попробует снова: разовый сбой не выключает кнопку до F5.
    probe = "none";
    waiters = [];
    finish("page-script");
  };
  (document.head || document.documentElement).appendChild(s);
}

/** Запрос завершён (ответ, отказ или тайм-аут): вернуть кнопку. */
function finish(reason: string | null): void {
  clearTimeout(pendingTimer);
  pendingTimer = undefined;
  const p = pending;
  pending = null;
  if (p) {
    p.btn.disabled = false;
    p.btn.textContent = LABEL;
  }
  // «Идёт поиск» — не ошибка: игрок нажал «Играть», числа ведёт сайт.
  if (reason && reason !== "searching") log.warn(SCOPE, "счётчики не обновлены, причина:", reason);
}

function onClick(btn: HTMLButtonElement): void {
  if (pending) return;
  const id = `c${Date.now().toString(36)}-${++seq}`;
  pending = { id, btn };
  btn.disabled = true;
  btn.textContent = "↻ …";
  pendingTimer = setTimeout(() => finish("timeout"), RESULT_TIMEOUT_MS);
  ensureProbe(() => {
    if (pending?.id !== id) return;
    try {
      window.postMessage({ source: SEARCH_COUNTS_CMD, id }, location.origin);
    } catch {
      finish("post");
    }
  });
}

const onResult = (e: MessageEvent): void => {
  if (e.source !== window) return;
  const d = e.data as { source?: unknown; id?: unknown; ok?: unknown; reason?: unknown } | null;
  if (!d || d.source !== SEARCH_COUNTS_RESULT || !pending || d.id !== pending.id) return;
  finish(d.ok === true ? null : (safeReason(d.reason) ?? "unknown"));
};

function buildButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = COUNTS_BUTTON_CLASS;
  btn.textContent = LABEL;
  btn.title = "Обновить счётчики столов: сколько человек сейчас ищут игру";
  // Как у «Очереди»: ширина по содержимому, соседи в ряду делят остальное.
  btn.style.cssText = `
    flex: 0 0 auto; align-self: stretch; margin-left: 8px; white-space: nowrap;
    background: rgba(255,255,255,.06); color: #cfd6e6;
    border: 1px solid rgba(255,255,255,.14); border-radius: 12px;
    padding: 0 14px; cursor: pointer; font: 600 13px system-ui, sans-serif;
  `;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}

function removeButton(): void {
  document.querySelectorAll(`.${COUNTS_BUTTON_CLASS}`).forEach((n) => n.remove());
}

/** Поставить/спрятать кнопку. Идемпотентно. Экспорт — тестовый шов. */
export function apply(): void {
  const panel = active && isSearchPage() ? document.querySelector<HTMLElement>(SITE.searchPanel) : null;
  if (!panel) {
    if (document.querySelector(`.${COUNTS_BUTTON_CLASS}`)) removeButton();
    return;
  }
  // Якорь — «Очередь», если она есть; иначе блок с «Играть».
  const queue = panel.querySelector<HTMLElement>(`:scope > .${QUEUE_BUTTON_CLASS}`);
  let anchor: HTMLElement | null = queue ?? panel.querySelector<HTMLElement>(SITE.profileSearchButton);
  while (!queue && anchor && anchor.parentElement && anchor.parentElement !== panel) {
    anchor = anchor.parentElement;
  }
  if (anchor?.parentElement !== panel) anchor = null;
  let btn = panel.querySelector<HTMLButtonElement>(`.${COUNTS_BUTTON_CLASS}`);
  if (!btn) {
    removeButton();
    btn = buildButton();
    if (anchor) anchor.after(btn);
    else panel.appendChild(btn);
  } else if (anchor && (anchor.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
    // Панель перестроилась и кнопка оказалась ПЕРЕД якорем — возвращаем.
    // Правило queue-peek: двигаем только из положения «до якоря», поэтому
    // чужой узел между нами и якорем цикла не рождает (§4 п.1).
    anchor.after(btn);
  }
  const want = idleOnSearch() ? "" : "none";
  if (btn.style.display !== want) btn.style.display = want;
}

export const queueCountsRefreshFeature: Feature = {
  id: "queue-counts-refresh",
  settingKey: "queue_counts_refresh_enabled",

  enable() {
    active = true;
    window.addEventListener("message", onResult);
    unsubDom = onDomChange(() => apply());
    apply();
  },

  disable() {
    active = false;
    unsubDom?.();
    unsubDom = null;
    window.removeEventListener("message", onResult);
    finish(null);
    removeButton();
  },
};
