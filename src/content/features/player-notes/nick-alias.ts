/**
 * Свой ник игрока на страницах сайта (просьба владельца 22.10.2026).
 *
 * ТЕКСТ САЙТА НЕ ТРОГАЕМ НИКОГДА. Ник в плитке, в «Участниках», в профиле и
 * в таблице разбора читают по textContent больше десятка мест: ключ заметки,
 * сторож пересадки, метки ролей, «Сводка стола», длины ников, аватарки
 * «Участников», ссылки разбора. Любой лишний символ внутри узла — чужая
 * заметка в тултипе или вечный цикл перекраски. Поэтому свой ник — это
 * data-атрибут на узле ника, а показывает его CSS-псевдоэлемент (notes.css):
 *  • data-pn-alias — «замена» (плитка в игре): текст сайта схлопнут
 *    font-size:0, свой ник — ::before; настоящий ник — в title;
 *  • data-pn-alias-suffix — «Ник (свой)» (списки, профиль, разбор) — ::after.
 * Текст псевдоэлемента не входит в textContent, а наблюдатель документа
 * data-атрибутов не видит — ни читатели, ни конвейер мутаций не задеты.
 * Запись идемпотентна (сравнение перед записью, инвариант §4).
 */
import { SITE } from "@core/selectors";
import { aliasFrom, buildAliasIndex, type AliasIndex, type NotesMap } from "@core/notes-store";

export const ALIAS_ATTR = "data-pn-alias";
export const ALIAS_SUFFIX_ATTR = "data-pn-alias-suffix";
/** Чей это свой ник: сторож пересадки сверяет с видимым ником, как у цвета. */
export const ALIAS_FOR_ATTR = "data-pn-alias-for";
/** Метка «title поставили мы» — снимаем только свой. */
const ALIAS_TITLE_ATTR = "data-pn-alias-title";

export type AliasMode = "replace" | "suffix";

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * Поставить или снять свой ник на узле ника сайта. alias пустой или совпал
 * с ником (без учёта регистра) — снять.
 */
export function setNickAlias(el: HTMLElement, alias: string, owner: string, mode: AliasMode): void {
  const show = !!alias && !!owner && alias.toLowerCase() !== owner.toLowerCase();
  setAttr(el, ALIAS_ATTR, show && mode === "replace" ? alias : null);
  setAttr(el, ALIAS_SUFFIX_ATTR, show && mode === "suffix" ? alias : null);
  setAttr(el, ALIAS_FOR_ATTR, show ? owner : null);
  // В режиме замены настоящий ник — по наведению.
  if (show && mode === "replace") {
    if (!el.hasAttribute("title") || el.hasAttribute(ALIAS_TITLE_ATTR)) {
      setAttr(el, "title", owner);
      setAttr(el, ALIAS_TITLE_ATTR, "1");
    }
  } else if (el.hasAttribute(ALIAS_TITLE_ATTR)) {
    el.removeAttribute("title");
    el.removeAttribute(ALIAS_TITLE_ATTR);
  }
}

function clearNode(el: HTMLElement): void {
  setNickAlias(el, "", "", "suffix");
}

/**
 * Сторож пересадки: сайт двигает игроков между плитками, и свой ник прежнего
 * жильца не должен достаться новому. Видимый ник не совпал с владельцем —
 * снимаем (правильный вернётся обычным проходом).
 */
export function sweepStaleAliases(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(`[${ALIAS_FOR_ATTR}]`).forEach((el) => {
    const nick = el.textContent?.trim() || "";
    if (nick && el.getAttribute(ALIAS_FOR_ATTR) !== nick) clearNode(el);
  });
}

/** Снять все свои ники (выключение фичи/статистики). */
export function clearAllAliases(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(`[${ALIAS_FOR_ATTR}]`).forEach(clearNode);
}

/**
 * Свой ник по id (приоритет — вечный) и/или нику для строк сайтовых списков.
 * Индекс кэшируется на секунду — тот же подход, что у индекса цветов: строка
 * «Участников» без кэша сканировала бы всю карту заметок на каждом проходе.
 */
export class AliasResolver {
  private cache: { at: number; index: AliasIndex } | null = null;

  constructor(private readonly notes: () => NotesMap) {}

  reset(): void {
    this.cache = null;
  }

  aliasFor(id: string | number | null | undefined, nick: string | null | undefined): string {
    const now = Date.now();
    if (!this.cache || now - this.cache.at >= 1000) {
      this.cache = { at: now, index: buildAliasIndex(this.notes()) };
    }
    return aliasFrom(this.cache.index, id, nick);
  }
}

/**
 * Таблица разбора матча (/match/<id>): ячейки ников — разметка сайта, которую
 * match-stats оборачивает ссылкой на профиль. Свой ник — суффиксом на самой
 * ячейке; ник для поиска — её текст (ссылка его сохраняет).
 */
export function applyMatchAliases(aliasFor: (nick: string) => string): void {
  document.querySelectorAll<HTMLElement>(`${SITE.statsTable} ${SITE.statsUsernameCell}`).forEach((cell) => {
    const nick = cell.textContent?.trim() || "";
    if (nick) setNickAlias(cell, aliasFor(nick), nick, "suffix");
  });
}
