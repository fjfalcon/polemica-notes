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
 * (search-hit/search-owner/search-empty на строках и панелях, searching на
 * body). Инлайновый style.display строк не трогаем — им владеют sync-функции
 * попапа (OBS выключен → блок настроек скрыт и т.п.), и после очистки поиска
 * всё возвращается как было без единого восстановления «вручную».
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
/** Подопция: «— Клавиша паузы», «└ Кнопка на сайте». */
const CHILD_RE = /^[\s—–\-└]+/;
/** Строка с захватом клавиши находится и по словам, которых в подписи нет. */
const HOTKEY_WORDS = "клавиша хоткей горячая кнопка";

export const HIT_CLASS = "search-hit";
export const OWNER_CLASS = "search-owner";
export const EMPTY_PANEL_CLASS = "search-empty";
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
}

/** Собрать индекс: текст строки + слова-синонимы + подпись родителя у подопций. */
export function buildIndex(root: ParentNode): Unit[] {
  const units: Unit[] = [];
  for (const panel of Array.from(root.querySelectorAll<HTMLElement>(".panel"))) {
    if (panel.dataset.panel === SKIP_PANEL) continue;
    let parentLabel = "";
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(UNIT_SELECTOR))) {
      if (el.dataset.search === "off") continue;
      const label = unitLabel(el);
      const isChild = CHILD_RE.test(label);
      if (!isChild && label) parentLabel = label;
      const parts = [el.textContent || "", el.dataset.kw || ""];
      if (isChild) parts.push(parentLabel);
      if (el.querySelector(".btn-key")) parts.push(HOTKEY_WORDS);
      units.push({ el, panel, haystack: normalize(parts.join(" ")) });
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

/** Строка, которая включает скрытый блок: ближайшая .row перед ним. */
function ownerOf(hidden: HTMLElement): HTMLElement | null {
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
  const shownByPanel = new Map<HTMLElement, number>();
  let shown = 0;
  const count = (panel: HTMLElement): void => {
    shownByPanel.set(panel, (shownByPanel.get(panel) || 0) + 1);
    shown++;
  };

  for (const unit of units) {
    const hit = searching && words.every((w) => unit.haystack.includes(w));
    unit.el.classList.toggle(HIT_CLASS, hit);
    if (!hit) continue;
    const hidden = hiddenRoot(unit.el, unit.panel);
    if (!hidden) {
      count(unit.panel);
      continue;
    }
    const owner = ownerOf(hidden);
    if (owner && !owners.has(owner) && !hiddenRoot(owner, unit.panel)) owners.add(owner);
  }

  for (const unit of units) {
    const isOwner = owners.has(unit.el);
    unit.el.classList.toggle(OWNER_CLASS, isOwner);
    // Хозяин, который и сам подошёл под запрос, уже посчитан выше.
    if (isOwner && !unit.el.classList.contains(HIT_CLASS)) count(unit.panel);
  }

  for (const panel of new Set(units.map((u) => u.panel))) {
    panel.classList.toggle(EMPTY_PANEL_CLASS, searching && !shownByPanel.has(panel));
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

  const units = buildIndex(doc);
  const run = (): void => {
    const shown = applySearch(doc, units, input.value);
    if (empty) empty.hidden = !(normalize(input.value) && shown === 0);
  };
  function clear(): void {
    if (!input) return;
    if (input.value) input.value = "";
    run();
  }

  input.addEventListener("input", () => {
    run();
    if (scroller) scroller.scrollTop = 0;
  });
  input.addEventListener("keydown", (e) => {
    // Esc с текстом — очистить поиск, а не закрыть попап.
    if (e.key === "Escape" && input.value) {
      e.preventDefault();
      clear();
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
