/**
 * Фича: кнопка «У меня тильт» на странице поиска (просьба владельца
 * 11.11.2026) — рядом с «Профилем» в карточке, где search-card-avatar ставит
 * фото. Клик открывает окно с упражнениями для успокоения (@core/calm-ui —
 * тот же модуль, что вкладка «Тильт» попапа): дыхание, заземление, STOP,
 * сканирование тела. Без КПТ и дневников, ничего не сохраняет.
 *
 * Вставка кнопки из onDomChange идемпотентна (§4 п.1): есть на месте — не
 * трогаем. Окно создаёт клик, а не подписчик; закрывается крестиком, кликом
 * мимо и Esc, и вместе с ним останавливаются анимация и таймеры.
 */
import { onDomChange } from "@core/dom";
import { mountCalm, type CalmHandle } from "@core/calm-ui";
import { SITE } from "@core/selectors";
import type { Feature, FeatureContext } from "@core/feature";

export const TILT_BUTTON_CLASS = "pn-tilt-btn";
const MODAL_ID = "pn-tilt-modal";

let enabled = false;
/** Подопция режима: сама кнопка на сайте (режим включён, кнопка — по галочке). */
let buttonOn = true;
let unsubDom: (() => void) | null = null;
let calm: CalmHandle | null = null;

function isSearchPage(): boolean {
  return location.pathname === "/game-search" || location.pathname.startsWith("/game-search/");
}

const onKey = (e: KeyboardEvent): void => {
  if (e.key === "Escape") closeModal();
};

/** Где был фокус до окна — вернуть при закрытии. */
let returnFocus: HTMLElement | null = null;

export function closeModal(): void {
  const modal = document.getElementById(MODAL_ID);
  calm?.stop();
  calm = null;
  if (!modal) return;
  modal.remove();
  document.removeEventListener("keydown", onKey, true);
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

/** Окно с упражнениями. Экспорт — тестовый шов. */
export function openModal(): void {
  if (document.getElementById(MODAL_ID)) return;
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "pn-tilt-overlay";
  const box = document.createElement("div");
  box.className = "pn-tilt-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Упражнения для успокоения");
  const head = document.createElement("div");
  head.className = "pn-tilt-head";
  const title = document.createElement("div");
  title.className = "pn-tilt-title";
  title.textContent = "Выдохни";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pn-tilt-close";
  close.title = "Закрыть (Esc)";
  close.setAttribute("aria-label", "Закрыть");
  close.textContent = "×";
  close.addEventListener("click", closeModal);
  head.append(title, close);
  const body = document.createElement("div");
  box.append(head, body);
  overlay.appendChild(box);
  // Клик мимо окна закрывает; внутри — нет. Нажатие, начатое в окне и
  // отпущенное на фоне (выделял текст), — тоже не «мимо».
  let downOnOverlay = false;
  overlay.addEventListener("mousedown", (e) => {
    downOnOverlay = e.target === overlay;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && downOnOverlay) closeModal();
    downOnOverlay = false;
  });
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  calm = mountCalm(body, () => overlay.isConnected);
  close.focus();
}

function buildButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = TILT_BUTTON_CLASS;
  button.textContent = "У меня тильт";
  button.title = "Упражнения для успокоения: дыхание, заземление, пауза";
  button.addEventListener("click", openModal);
  return button;
}

function removeButton(): void {
  document.querySelectorAll(`.${TILT_BUTTON_CLASS}`).forEach((n) => n.remove());
}

/** Поставить кнопку в карточку. Идемпотентно. Экспорт — тестовый шов. */
export function apply(): void {
  // Игра собралась («Принять игру», затем «Готовы: N/10» до входа в комнату):
  // окно не должно закрыть кнопку принятия (ревью, major), а кнопка, чьё окно
  // тут же закрылось бы, выглядела бы сломанной (контрольный раунд) — на это
  // время прячем и её. Ушли со страницы поиска (SPA) — так же.
  if (!enabled || !buttonOn || !isSearchPage() || document.querySelector(SITE.profileAccept)) {
    if (document.querySelector(`.${TILT_BUTTON_CLASS}`)) removeButton();
    closeModal();
    return;
  }
  const host = document.querySelector<HTMLElement>(SITE.searchProfileMain);
  if (!host) return;
  if (host.querySelector(`:scope > .${TILT_BUTTON_CLASS}`)) return;
  removeButton();
  // Сразу за «Профилем»; нет его — в конец карточки.
  const profile = host.querySelector<HTMLElement>(`:scope > ${SITE.searchProfileButtonLink}`);
  const button = buildButton();
  if (profile) profile.after(button);
  else host.appendChild(button);
}

export const tiltButtonFeature: Feature = {
  id: "tilt-button",
  // Весь режим «Тильт» (tilt_mode_enabled); сама кнопка — подопция.
  settingKey: "tilt_mode_enabled",

  enable(ctx: FeatureContext) {
    enabled = true;
    buttonOn = ctx.settings.tilt_button_enabled !== false;
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

  update(ctx: FeatureContext) {
    buttonOn = ctx.settings.tilt_button_enabled !== false;
    if (!buttonOn) closeModal();
    apply();
  },

  disable() {
    enabled = false;
    unsubDom?.();
    unsubDom = null;
    removeButton();
    closeModal();
  },
};
