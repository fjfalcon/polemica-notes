/**
 * Поиск по настройкам попапа (просьба владельца 16.11.2026): настроек больше
 * сотни на восьми вкладках, и даже автор не всегда помнит, где что лежит.
 *
 * Как устроено. Строка поиска над вкладками; пока в ней есть текст, попап
 * показывает ВСЕ вкладки разом, оставляя в каждой только подходящие строки,
 * под заголовком своей вкладки. Контролы — те же самые узлы, что и на
 * вкладках: тумблер из результатов работает на месте, ничего не клонируется.
 *
 * Правило записи в DOM: поиск управляет ТОЛЬКО своими классами
 * (settings-hit/-owner/-ctx на строках, settings-empty/-first на панелях,
 * searching на body). Инлайновый style.display строк не трогаем — им владеют sync-функции
 * попапа (OBS выключен → блок настроек скрыт и т.п.), и после очистки поиска
 * всё возвращается как было без единого восстановления «вручную».
 *
 * Подопции (.row.child) зависят от строки над ними и без неё непонятны
 * («Клавиша» — чего?). Поэтому подопция ищется и по подписи родителя, а
 * найденная подопция приводит родителя с собой (settings-ctx).
 *
 * Формы слов. Человек набирает «камера», а в меню «камеры», «камерам» —
 * у слова запроса срезается окончание, и основа ищется в НАЧАЛЕ слов строки
 * («роль» не находит «пароль»). Длинная основа (от 5 букв) ищется и внутри
 * слова — чтобы «запись» находила «Автозапись».
 *
 * Скрытые настройки. Строка может подходить под запрос, но лежать в блоке,
 * который сейчас скрыт родительским тумблером (сцены OBS при выключенной
 * интеграции). Тогда показываем «хозяина» блока — строку перед ним, которая
 * его включает: человек видит, что нужное есть и чем его открыть.
 */

/** Единица поиска: строка настройки или поле с подписью. */
const UNIT_SELECTOR = ".row, .field";
/** Панель «Тильт» — упражнения, а не настройки: в поиске не участвует. */
const SKIP_PANEL = "tilt";
/** Подопция: строка с отступом, зависит от ближайшей строки без него выше. */
const CHILD_CLASS = "child";
/** Строка с захватом клавиши находится и по словам, которых в подписи нет. */
const HOTKEY_WORDS = "клавиша хоткей горячая кнопка";

// Префикс settings-: класс search-hit уже занят строками «Поиска игрока».
export const HIT_CLASS = "settings-hit";
export const OWNER_CLASS = "settings-owner";
export const CONTEXT_CLASS = "settings-ctx";
export const EMPTY_PANEL_CLASS = "settings-empty";
/** Первая вкладка с находками — её заголовок без верхнего отступа. */
export const FIRST_PANEL_CLASS = "settings-first";
export const SEARCHING_CLASS = "searching";
export const TITLE_CLASS = "search-title";

/** Нижний регистр, ё→е, без кавычек/тире/пунктуации, один пробел. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9+#]+/g, " ")
    .trim();
}

/** Окончания, которые срезаются у слова запроса (длинные — раньше коротких). */
const ENDINGS = [
  "иями", "ями", "ами", "иях", "ией", "ого", "его", "ому", "ему", "ыми", "ими",
  "ые", "ие", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ую", "юю", "ов", "ев", "ей",
  "ам", "ям", "ах", "ях", "ом", "ем", "ью", "ия", "ию", "ии",
  "а", "я", "ы", "и", "у", "ю", "е", "о", "ь", "й",
];
/** Короче этого основу не делаем: «ник» остаётся «ник». */
const STEM_MIN = 3;
/** С этой длины основа ищется и внутри слова («запис» в «автозапись», «смен» в «автосмена»). */
const INFIX_MIN = 4;

/** Основа русского слова запроса; латиница и цифры — как есть. */
export function stem(word: string): string {
  if (!/[а-я]/.test(word)) return word;
  for (const end of ENDINGS) {
    if (word.endsWith(end) && word.length - end.length >= STEM_MIN) return word.slice(0, -end.length);
  }
  return word;
}

/** Подходит ли строка под слово запроса (haystack и word — после normalize). */
export function matchesWord(haystack: string, word: string): boolean {
  const s = stem(word);
  if (` ${haystack}`.includes(` ${s}`)) return true;
  return s.length >= INFIX_MIN && haystack.includes(s);
}

/** Подпись строки без подсказки: первый span (или label поля) минус .hint. */
export function unitLabel(unit: Element): string {
  const head = unit.matches(".field") ? unit.querySelector("label") : unit.firstElementChild;
  if (!head) return "";
  let out = "";
  for (const node of Array.from(head.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || "";
    else if (node instanceof Element && !node.classList.contains("hint")) out += node.textContent || "";
  }
  return out.trim();
}

interface Unit {
  el: HTMLElement;
  panel: HTMLElement;
  haystack: string;
  /** Родитель подопции — строка, от которой она зависит. */
  parent: HTMLElement | null;
}

/**
 * Весь текст узла, куски через пробел. textContent склеил бы подпись с
 * подсказкой («Тема кнопокцвет иконок…») — и первое слово подсказки при
 * поиске по началу слова не находилось бы (контрольное ревью 16.11.2026).
 */
function textOf(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent || "");
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
    }
  };
  walk(el);
  return parts.join(" ");
}

/** Собрать индекс: текст строки + слова-синонимы + подпись родителя у подопций. */
export function buildIndex(root: ParentNode): Unit[] {
  const units: Unit[] = [];
  for (const panel of Array.from(root.querySelectorAll<HTMLElement>(".panel"))) {
    if (panel.dataset.panel === SKIP_PANEL) continue;
    let parent: HTMLElement | null = null;
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(UNIT_SELECTOR))) {
      if (el.dataset.search === "off") continue;
      // Строки ВНУТРИ поля (найденные игроки в «Поиске игрока») — содержимое
      // этого поля, а не настройки: в индекс не идут и живут вместе с полем.
      if (el.parentElement?.closest(".field")) continue;
      const isChild = el.classList.contains(CHILD_CLASS);
      // Родителем бывает только строка-настройка, не поле ввода между ними.
      if (!isChild && el.matches(".row")) parent = el;
      const parts = [textOf(el), el.dataset.kw || ""];
      if (isChild && parent) parts.push(unitLabel(parent), parent.dataset.kw || "");
      if (el.querySelector(".btn-key")) parts.push(HOTKEY_WORDS);
      units.push({ el, panel, haystack: normalize(parts.join(" ")), parent: isChild ? parent : null });
    }
  }
  return units;
}

/** Самый внешний предок (или сам узел) со скрытием через инлайновый style. */
function hiddenRoot(el: HTMLElement, panel: HTMLElement): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (let node: HTMLElement | null = el; node && node !== panel; node = node.parentElement) {
    if (node.style.display === "none") found = node;
  }
  return found;
}

/**
 * Строка, которая открывает скрытое: ближайшая .row перед ним. Только для
 * блоков настроек и подопций — у них «хозяин» есть по построению меню.
 * Самостоятельная строка, скрытая целиком (тумблер уведомлений у версии из
 * магазина), просто недоступна: строка над ней к ней отношения не имеет.
 */
function ownerOf(hidden: HTMLElement): HTMLElement | null {
  if (hidden.matches(".row") && !hidden.classList.contains(CHILD_CLASS)) return null;
  for (let node = hidden.previousElementSibling; node; node = node.previousElementSibling) {
    if (node instanceof HTMLElement && node.matches(".row")) {
      return node.style.display === "none" ? null : node;
    }
  }
  return null;
}

/**
 * Применить запрос: расставить классы, вернуть число ВИДИМЫХ строк.
 * Пустой запрос снимает всё. Идемпотентно — повторный вызов с тем же
 * запросом классов не меняет.
 */
export function applySearch(root: Document, units: Unit[], query: string): number {
  const words = normalize(query).split(" ").filter(Boolean);
  const searching = words.length > 0;
  root.body.classList.toggle(SEARCHING_CLASS, searching);

  const owners = new Set<HTMLElement>();
  const contexts = new Set<HTMLElement>();
  const shownByPanel = new Map<HTMLElement, number>();
  let shown = 0;
  const count = (panel: HTMLElement): void => {
    shownByPanel.set(panel, (shownByPanel.get(panel) || 0) + 1);
    shown++;
  };

  for (const unit of units) {
    const hit = searching && words.every((w) => matchesWord(unit.haystack, w));
    unit.el.classList.toggle(HIT_CLASS, hit);
    if (!hit) continue;
    const hidden = hiddenRoot(unit.el, unit.panel);
    if (!hidden) {
      count(unit.panel);
      if (unit.parent && !hiddenRoot(unit.parent, unit.panel)) contexts.add(unit.parent);
      continue;
    }
    const owner = ownerOf(hidden);
    if (owner && !owners.has(owner) && !hiddenRoot(owner, unit.panel)) owners.add(owner);
  }

  for (const unit of units) {
    const isOwner = owners.has(unit.el);
    unit.el.classList.toggle(OWNER_CLASS, isOwner);
    const isHit = unit.el.classList.contains(HIT_CLASS);
    // Родитель найденной подопции: виден как обычная строка, для контекста.
    const isContext = contexts.has(unit.el) && !isHit && !isOwner;
    unit.el.classList.toggle(CONTEXT_CLASS, isContext);
    // Хозяин, который и сам подошёл под запрос, уже посчитан выше.
    if ((isOwner && !isHit) || isContext) count(unit.panel);
  }

  let first = true;
  for (const panel of new Set(units.map((u) => u.panel))) {
    const has = shownByPanel.has(panel);
    panel.classList.toggle(EMPTY_PANEL_CLASS, searching && !has);
    panel.classList.toggle(FIRST_PANEL_CLASS, searching && has && first);
    if (has) first = false;
  }
  return shown;
}

export interface SettingsSearchOptions {
  /** Перейти на вкладку (клик по заголовку вкладки в результатах). */
  activateTab: (name: string) => void;
}

export interface SettingsSearchHandle {
  /** Очистить строку поиска и вернуть обычный вид вкладок. */
  clear: () => void;
}

/** Подключить поиск к попапу. Без строки поиска в разметке — ничего не делает. */
export function installSettingsSearch(doc: Document, opts: SettingsSearchOptions): SettingsSearchHandle {
  const input = doc.getElementById("settings_search") as HTMLInputElement | null;
  const empty = doc.getElementById("settings_search_empty");
  const scroller = doc.querySelector<HTMLElement>(".panels");
  if (!input) return { clear: () => {} };

  // Заголовки вкладок в результатах — подписи берём с самих вкладок, чтобы
  // переименование вкладки не разошлось с поиском.
  for (const panel of Array.from(doc.querySelectorAll<HTMLElement>(".panel"))) {
    const name = panel.dataset.panel || "";
    const tab = doc.querySelector<HTMLElement>(`.tab[data-tab="${name}"]`);
    if (!tab || panel.querySelector(`:scope > .${TITLE_CLASS}`)) continue;
    const title = doc.createElement("button");
    title.type = "button";
    title.className = TITLE_CLASS;
    title.textContent = tab.textContent || "";
    title.title = "Открыть вкладку целиком";
    title.addEventListener("click", () => {
      clear();
      opts.activateTab(name);
    });
    panel.prepend(title);
  }

  let units = buildIndex(doc);
  const run = (): void => {
    // Индекс пересобираем на каждый запрос: подписи клавиш меняются
    // (переназначили паузу на F7 — искать надо «f7», а не прежнее «f8»).
    if (normalize(input.value)) units = buildIndex(doc);
    const shown = applySearch(doc, units, input.value);
    if (empty) empty.hidden = !(normalize(input.value) && shown === 0);
  };
  function clear(): void {
    if (!input) return;
    const was = input.value !== "";
    if (was) input.value = "";
    run();
    if (was && scroller) scroller.scrollTop = 0;
  }

  input.addEventListener("input", () => {
    run();
    if (scroller) scroller.scrollTop = 0;
  });
  // Esc с текстом — очистить поиск, а не закрыть попап. На документе, а не
  // на поле: после клика по тумблеру в результатах фокус уже не в строке.
  doc.addEventListener("keydown", (e) => {
    // Открыта модалка длины ников — Esc её, а не поиска.
    if (doc.querySelector("#nicklen_overlay.show")) return;
    if (e.key === "Escape" && input.value) {
      e.preventDefault();
      clear();
      input.focus({ preventScroll: true });
    }
  });
  // Тумблер в результатах мог раскрыть или скрыть блок настроек (OBS,
  // Twitch) — пересчитать «хозяев» и пустые вкладки после sync-функций попапа.
  scroller?.addEventListener("change", () => {
    if (input.value) setTimeout(run, 0);
  });
  // Попап открыли — можно сразу печатать, не целясь мышью в строку.
  try {
    input.focus({ preventScroll: true });
  } catch {
    /* нет фокуса — не страшно */
  }
  return { clear };
}
