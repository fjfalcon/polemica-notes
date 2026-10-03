/**
 * Автонажатие «Готов» после захода в лобби (запрос пользователей 03.10.2026).
 *
 * Фича совершает действие за игрока, поэтому выключена по умолчанию и
 * обвешана предохранителями:
 *  - ОДИН автоклик на лобби (латч до смены страницы): больше одного клика по
 *    toggle-кнопке — это уже снятие чужого решения;
 *  - если готовность в этом лобби УЖЕ ставили (класс active видели — неважно,
 *    кто), не вмешиваемся: игрок мог поставить и снять её сам, повторный
 *    клик переиграл бы его волю;
 *  - выдержка CLICK_DELAY_MS от первого появления кнопки: даём интерфейсу
 *    устаканиться и игроку — успеть первым.
 *
 * Для автоповтора после развала автоклик ПРИРАВНЕН к клику игрока
 * (noteIntentClick): включивший фичу выбрал полный автоматизм —
 * «развалилось → прыгаем обратно» (решение владельца 03.10.2026, поверх
 * моего предложения развязки). Цепочка работает только вместе со вторым
 * осознанным тумблером (автовозврат после развала), оба выключены
 * по умолчанию.
 *
 * Кнопку опознаём как readyConfirmed() в queue-requeue: точное совпадение
 * текста (§4 п.2 — «Не готов» содержит «готов», подстроки запрещены), класс
 * active говорит «уже нажата».
 */
import { log } from "@core/log";
import { onDomChange, safeClick, isVisible } from "@core/dom";
import { SITE, TEXT, SITE_CLASS } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import { noteIntentClick } from "./queue-requeue";
import type { Feature } from "@core/feature";

const SCOPE = "auto-ready";
/** Выдержка от первого появления кнопки до автоклика. */
export const CLICK_DELAY_MS = 1200;
/** Через сколько проверяем, что готовность реально встала. */
const VERIFY_DELAY_MS = 1500;

let offDom: (() => void) | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let verifyTimer: ReturnType<typeof setTimeout> | null = null;

let lastPathname = "";
/** Автоклик в этом лобби уже сделан (или отдан на верификацию). */
let clickedThisRoom = false;
/** Повторная попытка после неподтверждённого клика — одна на лобби. */
let retriedThisRoom = false;
/** Готовность в этом лобби уже стояла (кем угодно) — не вмешиваемся. */
let seenActiveThisRoom = false;
/** Когда кнопка впервые увидена в этом лобби (для выдержки). */
let firstSeenAt = 0;

function norm(text: string | null | undefined): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Кнопка готовности прегейма: точный текст из словаря, НЕ подстрока. */
export function findReadyButton(): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SITE.readyButton))) {
    if ((TEXT.readyButton as readonly string[]).includes(norm(el.textContent))) return el;
  }
  return null;
}

function resetRoomLatches(): void {
  clickedThisRoom = false;
  retriedThisRoom = false;
  seenActiveThisRoom = false;
  firstSeenAt = 0;
  if (verifyTimer) {
    clearTimeout(verifyTimer);
    verifyTimer = null;
  }
}

function scheduleVerify(): void {
  if (verifyTimer) clearTimeout(verifyTimer);
  verifyTimer = setTimeout(() => {
    verifyTimer = null;
    const btn = findReadyButton();
    if (!btn) return; // прегейм ушёл — проверять нечего
    if (btn.classList.contains(SITE.readyButtonActiveClass)) {
      seenActiveThisRoom = true;
      return; // встала
    }
    if (retriedThisRoom) {
      // Терминальный исход, без него тишина неотличима от успеха (OP-1).
      log.warn(SCOPE, "готовность не подтвердилась после повторной попытки — оставляем игроку");
      return;
    }
    // Повтор безопасен: кнопка НЕ active, снимать нечего.
    retriedThisRoom = true;
    clickedThisRoom = false;
    firstSeenAt = Date.now() - CLICK_DELAY_MS; // без новой выдержки
    tick();
  }, VERIFY_DELAY_MS);
}

function tick(): void {
  // Смена страницы = новое лобби: латчи эпизода умирают (как RQ-9).
  if (location.pathname !== lastPathname) {
    lastPathname = location.pathname;
    resetRoomLatches();
  }
  if (!isGameRoomPath(location.pathname)) return;
  if (clickedThisRoom) return;

  const btn = findReadyButton();
  if (!btn) {
    firstSeenAt = 0; // кнопка ушла — выдержка начнётся заново
    return;
  }
  if (btn.classList.contains(SITE.readyButtonActiveClass)) {
    // Готовность уже стоит (игрок успел сам или сервер восстановил) — наша
    // работа не нужна; запоминаем, чтобы не кликнуть после её снятия.
    seenActiveThisRoom = true;
    return;
  }
  if (seenActiveThisRoom) return; // ставили и сняли — воля игрока
  if (btn.classList.contains(SITE_CLASS.disabled)) return;
  if (!isVisible(btn)) return;

  if (!firstSeenAt) {
    firstSeenAt = Date.now();
    return;
  }
  if (Date.now() - firstSeenAt < CLICK_DELAY_MS) return;

  clickedThisRoom = true;
  // ДО клика и синхронно: автоклик приравнен к клику игрока (см. шапку), и
  // развал в ту же секунду не должен потерять намерение — та же гарантия,
  // что у noteAutoAcceptDispatched на странице поиска.
  noteIntentClick(btn);
  const ok = safeClick(btn);
  log.info(SCOPE, ok ? "автоклик «Готов» отправлен" : "автоклик «Готов» не прошёл (click бросил)");
  if (ok) scheduleVerify();
}

export const autoReadyFeature: Feature = {
  id: "auto-ready",
  settingKey: "auto_ready_enabled",
  enable() {
    lastPathname = location.pathname;
    resetRoomLatches();
    tick();
    // Троттлинг как у соседей: прегейм не требует реакции на каждый кадр.
    offDom = onDomChange(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        tick();
      }, 250);
    });
    log.info(SCOPE, "enabled");
  },
  disable() {
    offDom?.();
    offDom = null;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    resetRoomLatches();
  },
};
