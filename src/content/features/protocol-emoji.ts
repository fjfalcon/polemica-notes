/**
 * Эмодзи вместо меток протокола ПУ (выросло из «единорогов вместо сердец»
 * 9.63.0; обобщение на все три метки — просьба владельца 01.10.2026).
 *
 * ПУ (первый убиенный) оставляет протокол: пистолеты (мафия), короны и
 * сердца (мирные). Каждой метке в попапе назначается свой эмодзи; пустое
 * поле = родная иконка сайта. Подменяются оба механизма отрисовки (точные
 * якоря и их живучесть — у GUESS_FRAGMENT в selectors.ts):
 *  - спрайтовые `<use …#guess-*>` перенацеливаются на НАШИ символы в скрытом
 *    `<svg>` (символ = `<text>` с эмодзи — глиф рисует системный шрифт ОС,
 *    лицензий нет; на системе без цветного эмодзи-шрифта будет монохром);
 *  - `<img>` кнопок пикера у самого ПУ получают data-URI с тем же эмодзи.
 *
 * Идемпотентность (§4.1) и adversarial-урок 9.63.0: Vue правит ТОЛЬКО
 * xlink:href (его канал в шаблоне RoomIcon), а наш href по SVG2 ГЛАВНЕЕ —
 * поэтому единый reconcile-проход для КАЖДОГО узла выводит нужный вид из
 * «что сайт хочет показывать» (живой xlink, иначе href, иначе сохранённый
 * оригинал) и текущего конфига: подменить, перенацелить на другой символ или
 * вернуть сайту. Оригинал лежит в data-атрибуте — и для отката, и как маркер
 * «уже наш». Выключение метки/фичи возвращает ровно то, что сайт хочет
 * СЕЙЧАС, а не снимок прошлого (класс «отравленный снимок»).
 */
import { log } from "@core/log";
import { onDomChange, registerOwnContainer, unregisterOwnContainer } from "@core/dom";
import { GUESS_FRAGMENT, GUESS_PICKER_IMG, OWN } from "@core/selectors";
import type { Feature, FeatureContext } from "@core/feature";
import {
  DEFAULT_PROTOCOL_EMOJI,
  PROTOCOL_EMOJI_SETTING,
  PROTOCOL_MARKS,
  normalizeProtocolEmoji,
  type ProtocolMark,
} from "@shared/protocol-emoji";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** id наших символов; `<use href="#…">` резолвится в пределах документа. */
export const SYMBOL_PREFIX = "pn-protocol-emoji-";
export const symbolId = (mark: ProtocolMark): string => `${SYMBOL_PREFIX}${mark}`;
/** Оригинальный href спрайтового `<use>` — для отката и как маркер «наш». */
export const ORIG_HREF_ATTR = "data-pn-orig-href";
/** Оригинальный src `<img>` пикера — для отката и как маркер «наш». */
export const ORIG_SRC_ATTR = "data-pn-orig-src";

/** Разметка глифа внутри 24×24 — одна и та же для символа и data-URI. */
const TEXT_ATTRS = 'x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="20"';

/** Текущий конфиг: эмодзи на метку, "" = не подменять. */
let config: Record<ProtocolMark, string> = { ...DEFAULT_PROTOCOL_EMOJI };

export function imgSrcFor(mark: ProtocolMark): string {
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"><text ${TEXT_ATTRS}>${config[mark]}</text></svg>`,
    )
  );
}

let container: SVGSVGElement | null = null;
let offDom: (() => void) | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

/** Метка по НАШЕМУ символу ("#pn-protocol-emoji-civ") или null. */
function markOfOurRef(v: string | null): ProtocolMark | null {
  if (!v || !v.startsWith(`#${SYMBOL_PREFIX}`)) return null;
  const m = v.slice(SYMBOL_PREFIX.length + 1) as ProtocolMark;
  return PROTOCOL_MARKS.includes(m) ? m : null;
}

/** Метка по САЙТОВОЙ ссылке ("…спрайт.svg#guess-civ") или null. */
function markOfSiteRef(v: string | null): ProtocolMark | null {
  if (!v) return null;
  for (const m of PROTOCOL_MARKS) if (v.endsWith(GUESS_FRAGMENT[m])) return m;
  return null;
}

/** Вставить/обновить скрытый спрайт с символами включённых меток. */
function ensureSymbols(): void {
  if (!container || !container.isConnected) {
    // Без включённых меток контейнер не нужен — не мусорим в чужом DOM.
    if (!PROTOCOL_MARKS.some((m) => config[m])) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", OWN.protocolEmojiSprite);
    svg.setAttribute("style", "display:none");
    svg.setAttribute("aria-hidden", "true");
    registerOwnContainer(svg);
    (document.body ?? document.documentElement).appendChild(svg);
    container = svg;
  }
  for (const mark of PROTOCOL_MARKS) {
    let symbol = container.querySelector<SVGSymbolElement>(`#${symbolId(mark)}`);
    if (!config[mark]) {
      symbol?.remove();
      continue;
    }
    if (!symbol) {
      symbol = document.createElementNS(SVG_NS, "symbol");
      symbol.id = symbolId(mark);
      symbol.setAttribute("viewBox", "0 0 24 24");
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", "12");
      text.setAttribute("y", "12");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", "20");
      symbol.appendChild(text);
      container.appendChild(symbol);
    }
    const text = symbol.querySelector("text");
    if (text && text.textContent !== config[mark]) text.textContent = config[mark];
  }
}

/**
 * Привести один `<use>` к нужному виду. «Что сайт хочет показывать» — живой
 * xlink (канал Vue), иначе href (не наш), иначе сохранённый оригинал.
 */
function reconcileUse(use: Element, cfg: Record<ProtocolMark, string>): boolean {
  const hrefV = use.getAttribute("href");
  const xlinkV = use.getAttributeNS(XLINK_NS, "href");
  const hrefOur = markOfOurRef(hrefV);
  const xlinkOur = markOfOurRef(xlinkV);
  const orig = use.getAttribute(ORIG_HREF_ATTR);
  const touched = hrefOur !== null || xlinkOur !== null || orig !== null;
  if (!touched && !markOfSiteRef(xlinkV) && !markOfSiteRef(hrefV)) return false; // чужой узел

  const siteHref =
    (xlinkV && xlinkOur === null ? xlinkV : null) ??
    (hrefV && hrefOur === null ? hrefV : null) ??
    orig;
  const mark = markOfSiteRef(siteHref);

  if (!mark) {
    // Сайт увёл узел на не-метку (или правды не осталось): снимаем свои следы,
    // живые атрибуты сайта не трогаем.
    if (!touched) return false;
    if (hrefOur !== null) use.removeAttribute("href");
    use.removeAttribute(ORIG_HREF_ATTR);
    return true;
  }

  const emoji = cfg[mark];
  const sym = `#${symbolId(mark)}`;
  if (emoji) {
    if (hrefV === sym && xlinkV === sym) return false; // устойчиво наш
    ensureSymbols();
    use.setAttribute(ORIG_HREF_ATTR, siteHref as string);
    use.setAttribute("href", sym);
    use.setAttributeNS(XLINK_NS, "xlink:href", sym);
    return true;
  }
  // Метка не подменяется — вернуть сайту его вид, если наши следы есть.
  if (!touched) return false;
  if (xlinkOur !== null) {
    use.setAttribute("href", siteHref as string);
    use.setAttributeNS(XLINK_NS, "xlink:href", siteHref as string);
  } else if (hrefOur !== null) {
    use.removeAttribute("href");
  }
  use.removeAttribute(ORIG_HREF_ATTR);
  return true;
}

/** Привести все узлы к конфигу cfg. Идемпотентна; возвращает число правок. */
function reconcileAll(cfg: Record<ProtocolMark, string>): number {
  let changed = 0;
  for (const use of document.querySelectorAll("use")) if (reconcileUse(use, cfg)) changed++;

  const uris = new Map<string, ProtocolMark>();
  for (const m of PROTOCOL_MARKS) if (cfg[m]) uris.set(imgSrcFor(m), m);
  for (const img of document.querySelectorAll<HTMLImageElement>(`img[${ORIG_SRC_ATTR}]`)) {
    const src = img.getAttribute("src") ?? "";
    if (uris.has(src)) continue; // устойчиво наш
    if (src.startsWith("data:image/svg+xml")) {
      // Наш, но протух (сменили эмодзи / выключили метку): вернуть оригинал —
      // если метка ещё включена, блок ниже подменит заново уже новым эмодзи.
      const orig = img.getAttribute(ORIG_SRC_ATTR);
      if (orig) img.setAttribute("src", orig);
      img.removeAttribute(ORIG_SRC_ATTR);
      changed++;
    } else {
      // Vue перенацелил картинку. Метку «наш» держим ТОЛЬКО если src — хэш
      // ВКЛЮЧЁННОЙ метки: её перепишет блок ниже (и обновит оригинал).
      // Для выключенной/чужой — снимаем, src сайта не трогаем.
      const m = markOfSiteImg(img);
      if (!m || !cfg[m]) {
        img.removeAttribute(ORIG_SRC_ATTR);
        changed++;
      }
    }
  }
  for (const m of PROTOCOL_MARKS) {
    if (!cfg[m]) continue;
    const uri = imgSrcFor(m);
    for (const img of document.querySelectorAll<HTMLImageElement>(GUESS_PICKER_IMG[m])) {
      img.setAttribute(ORIG_SRC_ATTR, img.getAttribute("src") ?? "");
      img.setAttribute("src", uri);
      changed++;
    }
  }
  if (changed) log.debug("protocol-emoji", "reconciled", changed);
  return changed;
}

function markOfSiteImg(img: HTMLImageElement): ProtocolMark | null {
  for (const m of PROTOCOL_MARKS) if (img.matches(GUESS_PICKER_IMG[m])) return m;
  return null;
}

const EMPTY: Record<ProtocolMark, string> = { civ: "", maf: "", vice: "" };

/** Проход по текущему конфигу (экспорт для тестов). */
export function applyProtocolEmoji(): number {
  return reconcileAll(config);
}

function readConfig(ctx: FeatureContext): Record<ProtocolMark, string> {
  const out = { ...EMPTY };
  for (const m of PROTOCOL_MARKS) {
    out[m] = normalizeProtocolEmoji(ctx.settings[PROTOCOL_EMOJI_SETTING[m]]);
  }
  return out;
}

export const protocolEmojiFeature: Feature = {
  id: "protocol-emoji",
  // Ключ исторический: фича родилась как «единороги вместо сердец» (9.63.0),
  // хранилище уже в проде — не мигрируем.
  settingKey: "unicorn_hearts_enabled",
  update(ctx) {
    config = readConfig(ctx);
    ensureSymbols();
    applyProtocolEmoji();
  },
  enable(ctx) {
    config = readConfig(ctx);
    applyProtocolEmoji();
    // Троттлинг как у role-marker: метки не требуют реакции на каждый кадр.
    offDom = onDomChange(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        applyProtocolEmoji();
      }, 250);
    });
    log.info("protocol-emoji", "enabled", PROTOCOL_MARKS.filter((m) => config[m]).join(","));
  },
  disable() {
    offDom?.();
    offDom = null;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    // Возврат = reconcile с пустым конфигом: каждый узел получает то, что
    // сайт хочет показывать СЕЙЧАС (а не снимок прошлого).
    reconcileAll(EMPTY);
    if (container) {
      unregisterOwnContainer(container);
      container.remove();
      container = null;
    }
  },
};
