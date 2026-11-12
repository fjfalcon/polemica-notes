/**
 * «А что там в очереди» — кнопка в игровой комнате (просьба владельца
 * 12.11.2026): посреди своей игры глянуть, сколько человек ищут игру за
 * каждым столом («Обычный 3/10 · Рейтинг 1/10 · Prime 9/10»).
 *
 * Только числа: публичный GET /api/search (@core/polemica-api) в очередь не
 * заходит. Поимённый состав видно лишь изнутри очереди (так работает «Кто в
 * очереди»), а вставать в поиск посреди своей игры нельзя — сервер мог бы
 * подобрать вторую.
 *
 * Кнопка — в правом ряду контролов сайта (камера/микрофон/настройки), рядом
 * с «Обновить камеры», вид копируется с соседней кнопки (стили сайта scoped).
 * Вставка из onDomChange идемпотентна (§4 п.1): кнопка на месте — не трогаем.
 * Окошко создаёт клик, а не подписчик; закрывается повторным кликом, кликом
 * мимо, Esc и уходом из комнаты.
 */
import { onDomChange } from "@core/dom";
import { log } from "@core/log";
import { fetchQueueCounts } from "@core/polemica-api";
import { QUEUE_ORDER, QUEUE_TITLES } from "@core/queue-state";
import { SITE, SITE_CLASS } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import type { Feature } from "@core/feature";

export const ROOM_QUEUE_BUTTON_CLASS = "pn-room-queue-btn";
const POPOVER_ID = "pn-room-queue-pop";
const SCOPE = "room-queue-counts";

const TABLE_SIZE = 10;

let active = false;
let unsubDom: (() => void) | null = null;
/** Поколение запроса: поздний ответ закрытого/переоткрытого окна не пишем. */
let requestSeq = 0;

function buildButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ROOM_QUEUE_BUTTON_CLASS;
  button.title = "А что там в очереди?";
  button.setAttribute("aria-label", "А что там в очереди?");
  // Иконка «люди» без текста — ряд у сайта из иконок.
  button.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
    '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  button.addEventListener("click", togglePopover);
  // Фокус не оставляем на кнопке: пробел/Enter в игре не должны снова
  // переключать окошко (ревью 12.11.2026).
  button.addEventListener("mousedown", (e) => e.preventDefault());
  return button;
}

/** Вид — с соседней живой кнопки ряда (как у camera-health). */
function styleLike(button: HTMLButtonElement, host: HTMLElement): void {
  const sibling = Array.from(host.children).find(
    (el): el is HTMLElement =>
      el !== button && el instanceof HTMLElement && el.classList.contains(SITE_CLASS.button),
  );
  const cs = sibling ? getComputedStyle(sibling) : null;
  const bg = cs?.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "#464952";
  const radius = cs?.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : "1rem";
  const height = sibling && sibling.offsetHeight > 0 ? `height:${sibling.offsetHeight}px;` : "";
  button.style.cssText =
    "display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;" +
    `color:#fff;min-width:3.833rem;padding:0 .9375rem;${height}` +
    `background:${bg};border-radius:${radius}`;
}

function removeButton(): void {
  document.querySelectorAll(`.${ROOM_QUEUE_BUTTON_CLASS}`).forEach((n) => n.remove());
}

// ───────────────────────── окошко ─────────────────────────

const onKey = (e: KeyboardEvent): void => {
  if (e.key === "Escape") closePopover();
};
const onOutside = (e: MouseEvent): void => {
  const t = e.target as Node | null;
  if (!t) return;
  if (document.getElementById(POPOVER_ID)?.contains(t)) return;
  if ((t as Element).closest?.(`.${ROOM_QUEUE_BUTTON_CLASS}`)) return; // кнопка сама переключит
  closePopover();
};

export function closePopover(): void {
  requestSeq++;
  // Снимаем всегда: окошко могли убрать и без нас (ревью 12.11.2026).
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("mousedown", onOutside, true);
  document.getElementById(POPOVER_ID)?.remove();
}

function render(pop: HTMLElement, state: "loading" | "error" | Record<string, number>): void {
  const body = pop.querySelector<HTMLElement>(".pn-rqc-body")!;
  body.textContent = "";
  if (state === "loading") {
    body.textContent = "Смотрю…";
    return;
  }
  if (state === "error") {
    body.textContent = "Сайт не ответил — попробуй ↻";
    return;
  }
  for (const mode of QUEUE_ORDER) {
    const row = document.createElement("div");
    row.className = "pn-rqc-row";
    const name = document.createElement("span");
    name.textContent = QUEUE_TITLES[mode] ?? mode;
    const n = state[mode];
    const val = document.createElement("b");
    val.textContent = typeof n === "number" ? `${n}/${TABLE_SIZE}` : "—";
    if (typeof n === "number" && n >= TABLE_SIZE - 2) val.className = "pn-rqc-hot";
    row.append(name, val);
    body.appendChild(row);
  }
  const at = new Date();
  const foot = pop.querySelector<HTMLElement>(".pn-rqc-time")!;
  foot.textContent = `на ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`;
}

async function load(pop: HTMLElement, force: boolean): Promise<void> {
  const seq = ++requestSeq;
  render(pop, "loading");
  try {
    const counts = await fetchQueueCounts(force);
    if (seq === requestSeq && pop.isConnected) render(pop, counts);
  } catch (e) {
    if (seq !== requestSeq || !pop.isConnected) return;
    render(pop, "error");
    log.debug(SCOPE, "счётчики очереди не получены", e);
  }
}

/** Открыть окошко над кнопкой. Экспорт — тестовый шов. */
export function openPopover(button: HTMLElement): void {
  if (document.getElementById(POPOVER_ID)) return;
  const pop = document.createElement("div");
  pop.id = POPOVER_ID;
  pop.className = "pn-rqc-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Очередь сейчас");
  const head = document.createElement("div");
  head.className = "pn-rqc-head";
  head.textContent = "В очереди сейчас";
  const body = document.createElement("div");
  body.className = "pn-rqc-body";
  const foot = document.createElement("div");
  foot.className = "pn-rqc-foot";
  const time = document.createElement("span");
  time.className = "pn-rqc-time";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "pn-rqc-refresh";
  refresh.textContent = "↻";
  refresh.title = "Обновить";
  refresh.addEventListener("click", () => void load(pop, true));
  foot.append(time, refresh);
  pop.append(head, body, foot);
  // Над кнопкой, прижато к её правому краю (ряд — внизу справа).
  const r = button.getBoundingClientRect();
  pop.style.right = `${Math.min(window.innerWidth - 200, Math.max(8, window.innerWidth - r.right))}px`;
  pop.style.bottom = `${Math.min(window.innerHeight - 120, Math.max(8, window.innerHeight - r.top + 8))}px`;
  document.body.appendChild(pop);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onOutside, true);
  void load(pop, false);
}

function togglePopover(e: MouseEvent): void {
  if (document.getElementById(POPOVER_ID)) closePopover();
  else openPopover(e.currentTarget as HTMLElement);
}

// ───────────────────────── вставка ─────────────────────────

/** Поставить кнопку в ряд контролов. Идемпотентно. Экспорт — тестовый шов. */
export function apply(): void {
  if (!active || !isGameRoomPath(location.pathname)) {
    if (document.querySelector(`.${ROOM_QUEUE_BUTTON_CLASS}`)) removeButton();
    closePopover();
    return;
  }
  const host = document.querySelector<HTMLElement>(SITE.controlsRight);
  if (!host) {
    // Ряд контролов ушёл (смерть, конец игры) — окошко не висит над пустотой.
    if (document.getElementById(POPOVER_ID) && !document.querySelector(`.${ROOM_QUEUE_BUTTON_CLASS}`)?.isConnected) {
      closePopover();
    }
    return;
  }
  const existing = host.querySelector<HTMLButtonElement>(`:scope > .${ROOM_QUEUE_BUTTON_CLASS}`);
  if (existing) return;
  removeButton();
  const button = buildButton();
  styleLike(button, host);
  host.prepend(button);
}

export const roomQueueCountsFeature: Feature = {
  id: "room-queue-counts",
  settingKey: "room_queue_counts_enabled",

  enable() {
    active = true;
    unsubDom = onDomChange((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          apply();
          return;
        }
      }
    });
    apply();
  },

  disable() {
    active = false;
    unsubDom?.();
    unsubDom = null;
    closePopover();
    removeButton();
  },
};
