/**
 * Фича: режим «Скрыть рейтинг» (просьба владельца 28.10.2026) — ничей MMR,
 * его ± и места в рейтингах не видны нигде на сайте.
 *
 * Основная работа — CSS (rating-hide.css) под атрибутом `<html data-pn-hide-rating>`,
 * который ставит ранний скрипт rating-flag-early.ts: значок MMR сайта
 * (`.mmrLabel` — один компонент в лобби комнаты, на профиле и в карточке
 * поиска), иконки уровней MMR, ячейки ± в истории игр, строки места в
 * рейтинге в карточке игрока комнаты, наши метки `[data-pn-rating]`.
 *
 * Здесь — только то, что CSS не умеет найти сам: колонка «MMR» в истории
 * игр профиля (заголовок без своего класса — ищем по подписи) и строка «MMR»
 * в таблице разбора матча (там же «Итог» — баллы Полемики, они остаются;
 * сами ячейки ± rating-hide.css прячет и без метки, по классу mmr_diff).
 * Метки сами по себе ничего не прячут: CSS действует только под флагом.
 */
import { onDomChange } from "@core/dom";
import { SITE } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import type { Feature } from "@core/feature";

/** Метка ячейки/строки рейтинга сайта, которую CSS прячет под флагом. */
export const RATING_MARK = "data-pn-rating-site";
const MMR_TITLE = "MMR";

let unsubDom: (() => void) | null = null;

function mark(el: Element): void {
  if (!el.hasAttribute(RATING_MARK)) el.setAttribute(RATING_MARK, "");
}

function directItems(row: Element, selector: string): Element[] {
  return Array.from(row.children).filter((c) => c.matches(selector));
}

/** Колонка «MMR» в истории игр профиля: заголовок и та же по счёту ячейка строк. */
function markProfileGamesColumn(): void {
  const heads = Array.from(document.querySelectorAll(SITE.profileGamesHeadItem));
  const head = heads.find((h) => h.textContent?.trim() === MMR_TITLE);
  if (!head?.parentElement) return;
  const index = directItems(head.parentElement, SITE.profileGamesHeadItem).indexOf(head);
  if (index < 0) return;
  mark(head);
  document.querySelectorAll(SITE.profileGamesBodyRow).forEach((row) => {
    const item = directItems(row, SITE.profileGamesBodyItem)[index];
    if (item) mark(item);
  });
}

/** Строка «MMR» таблицы разбора матча (сайт рисует её не во всех играх). */
function markMatchMmrRow(): void {
  const root = document.querySelector(SITE.statsTableRoot);
  if (!root) return;
  root.querySelectorAll(SITE.statsRow).forEach((row) => {
    if (row.hasAttribute("data-phase")) return;
    if (row.querySelector(SITE.statsCellTitle)?.textContent?.trim() === MMR_TITLE) mark(row);
  });
}

/** Экспорт — тестовый шов (фикспоинт DOM-наблюдателя). */
export function markRatingNodes(): void {
  // Комната мутирует DOM на частоте кадров, а размечать в ней нечего: её
  // рейтинг (значок лобби, карточка игрока) прячет CSS без меток.
  if (isGameRoomPath(location.pathname)) return;
  markProfileGamesColumn();
  markMatchMmrRow();
}

function clearMarks(): void {
  document.querySelectorAll(`[${RATING_MARK}]`).forEach((el) => el.removeAttribute(RATING_MARK));
}

export const hideRatingFeature: Feature = {
  id: "hide-rating",
  settingKey: "hide_rating",
  enable() {
    markRatingNodes();
    unsubDom?.();
    unsubDom = onDomChange(markRatingNodes);
  },
  disable() {
    unsubDom?.();
    unsubDom = null;
    clearMarks();
  },
};
