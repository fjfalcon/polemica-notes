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
import { onDomChangeImmediate } from "@core/dom";
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

  /**
   * @param enabled тумблер «Показывать свои ники»: выключен — на страницах
   *   сайта своих ников нет нигде (эфир), резолвер отвечает пустым.
   */
  constructor(
    private readonly notes: () => NotesMap,
    readonly enabled: () => boolean = () => true,
  ) {}

  reset(): void {
    this.cache = null;
  }

  aliasFor(id: string | number | null | undefined, nick: string | null | undefined, strict = false): string {
    if (!this.enabled()) return "";
    const now = Date.now();
    if (!this.cache || now - this.cache.at >= 1000) {
      this.cache = { at: now, index: buildAliasIndex(this.notes()) };
    }
    return aliasFrom(this.cache.index, id, nick, strict);
  }
}

/** Ссылка на профиль, которой match-stats оборачивает ник в ячейке разбора. */
const MATCH_PROFILE_LINK = "a.pn-profile-link";

/**
 * Таблица разбора матча (/match/<id>). Ячейки ников — разметка сайта
 * (`cell player username`), заголовок строки (`.title`) — не игрок.
 *  • Свой ник ставим на НАШУ ссылку профиля, если match-stats её поставил:
 *    его CSS гасит `div.cell.player::after` (ревью 22.10.2026, В1) — на
 *    ячейке суффикс не виден. Без ссылки (разбор выключен) — на ячейку.
 *  • Игрок — по id из этой ссылки (вечный); без id — только точный
 *    легаси-ключ: таблица ник→свой ник по истории ников выдавала бы чужой.
 */
export function applyMatchAliases(resolver: AliasResolver): void {
  document
    .querySelectorAll<HTMLElement>(`${SITE.statsTable} ${SITE.statsUsernameCell}:not(${SITE.statsTitleCell})`)
    .forEach((cell) => {
      const link = cell.querySelector<HTMLAnchorElement>(MATCH_PROFILE_LINK);
      const target = link ?? cell;
      if (link) clearNode(cell); // ссылка появилась после нас — со старого места снимаем
      const nick = target.textContent?.trim() || "";
      if (!nick) return;
      const id = (link?.getAttribute("href") || "").match(/\/profile\/(\d+)/)?.[1] ?? null;
      setNickAlias(target, resolver.aliasFor(id, nick, true), nick, "suffix");
    });
}

/**
 * Немедленная реакция на смену ника НА МЕСТЕ (Vue переписывает Text-узел):
 * обычные подписчики characterData не получают, и до прохода (≤2 с) новый
 * игрок плитки носил бы свой ник прежнего (ревью 22.10.2026, С1). Только
 * снимаем — правильный поставит обычный проход. Возвращает отписку.
 */
export function watchAliasText(): () => void {
  return onDomChangeImmediate((mutations) => {
    for (const m of mutations) {
      if (m.type !== "characterData") continue;
      const el = m.target.parentElement?.closest<HTMLElement>(`[${ALIAS_FOR_ATTR}]`);
      if (!el) continue;
      const nick = el.textContent?.trim() || "";
      if (el.getAttribute(ALIAS_FOR_ATTR) !== nick) clearNode(el);
    }
  });
}
