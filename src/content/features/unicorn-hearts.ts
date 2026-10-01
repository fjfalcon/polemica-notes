/**
 * «Единороги вместо сердец» (просьба владельца 01.10.2026).
 *
 * ПУ (первый убиенный) оставляет протокол: пистолеты, короны и сердца. Фича
 * подменяет сердце («мирный») единорогом в обоих местах, где сайт его рисует
 * (точные якоря и их живучесть — у GUESS_CIV_FRAGMENT в selectors.ts):
 *  - спрайтовые `<use …#guess-civ>` перенацеливаются на НАШ символ в скрытом
 *    `<svg>`;
 *  - `<img>` кнопки пикера у самого ПУ получает data-URI.
 * В обоих случаях внутри — платформенный эмодзи 🦄 (см. UNICORN_EMOJI ниже),
 * цветной, в отличие от белых символов спрайта сайта: пасхалка и должна
 * бросаться в глаза включившему её.
 *
 * Идемпотентность (§4.1): подменённый узел больше не матчится якорем (href уже
 * не `#guess-civ`, src уже не хэш), а оригинал лежит в data-атрибуте — и для
 * отключения фичи, и как маркер «уже наш». Vue при re-render сравнивает vnode
 * с ПРЕЖНИМ vnode, не с DOM, поэтому при неизменной иконке нашу подмену не
 * перетирает; если узел пересоздан — data-атрибут умер вместе с ним, и
 * следующий проход обсерватора подменит заново.
 */
import { log } from "@core/log";
import { onDomChange, registerOwnContainer, unregisterOwnContainer } from "@core/dom";
import { GUESS_CIV_FRAGMENT, GUESS_CIV_PICKER_IMG, OWN } from "@core/selectors";
import type { Feature } from "@core/feature";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** id нашего символа; `<use href="#…">` резолвится в пределах документа. */
export const UNICORN_SYMBOL_ID = "pn-unicorn-heart";
/** Оригинальный href спрайтового `<use>` — для отката и как маркер «наш». */
export const ORIG_HREF_ATTR = "data-pn-orig-href";
/** Оригинальный src `<img>` пикера — для отката и как маркер «наш». */
export const ORIG_SRC_ATTR = "data-pn-orig-src";

/**
 * Единорог — ЭМОДЗИ платформы (🦄), а не свой рисунок: владелец показал
 * пальцем именно на него (01.10.2026, «вот примерно так надо» — первый
 * вариант-силуэт читался совой). Глиф рендерит системный эмодзи-шрифт ОС
 * пользователя — и лицензионный вопрос не возникает вовсе. Цена: на системе
 * без цветного эмодзи-шрифта (голый Linux без Noto Color Emoji) будет
 * монохром/тофу — приемлемо для опциональной пасхалки.
 */
export const UNICORN_EMOJI = "🦄";
/** Разметка глифа внутри 24×24 — одна и та же для символа и data-URI. */
const UNICORN_TEXT_ATTRS =
  'x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="20"';

/** data-URI для `<img>` пикера: тот же эмодзи, цвет — родной платформенный. */
export const UNICORN_IMG_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">` +
      `<text ${UNICORN_TEXT_ATTRS}>${UNICORN_EMOJI}</text></svg>`,
  );

let container: SVGSVGElement | null = null;
let offDom: (() => void) | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

/** Вставить (однократно) скрытый спрайт с нашим символом. */
function ensureSymbol(): void {
  if (container && container.isConnected) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", OWN.unicornSprite);
  svg.setAttribute("style", "display:none");
  svg.setAttribute("aria-hidden", "true");
  const symbol = document.createElementNS(SVG_NS, "symbol");
  symbol.id = UNICORN_SYMBOL_ID;
  symbol.setAttribute("viewBox", "0 0 24 24");
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", "12");
  text.setAttribute("y", "12");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("font-size", "20");
  text.textContent = UNICORN_EMOJI;
  symbol.appendChild(text);
  svg.appendChild(symbol);
  registerOwnContainer(svg);
  (document.body ?? document.documentElement).appendChild(svg);
  container = svg;
}

/** Подменить все сердца на странице. Идемпотентна; возвращает число подмен. */
export function applyUnicorns(): number {
  let changed = 0;
  for (const use of document.querySelectorAll("use")) {
    // Сайт пишет xlink:href (legacy-ветка Vue); href — на случай его миграции.
    const href = use.getAttribute("href") ?? use.getAttributeNS(XLINK_NS, "href");
    if (!href || !href.endsWith(GUESS_CIV_FRAGMENT)) continue;
    ensureSymbol();
    use.setAttribute(ORIG_HREF_ATTR, href);
    use.setAttribute("href", `#${UNICORN_SYMBOL_ID}`);
    use.setAttributeNS(XLINK_NS, "xlink:href", `#${UNICORN_SYMBOL_ID}`);
    changed++;
  }
  for (const img of document.querySelectorAll<HTMLImageElement>(GUESS_CIV_PICKER_IMG)) {
    img.setAttribute(ORIG_SRC_ATTR, img.getAttribute("src") ?? "");
    img.setAttribute("src", UNICORN_IMG_SRC);
    changed++;
  }
  if (changed) log.debug("unicorn-hearts", "replaced", changed);
  return changed;
}

/** Вернуть сайту его сердца (выключение фичи). */
function restore(): void {
  for (const use of document.querySelectorAll(`use[${ORIG_HREF_ATTR}]`)) {
    const orig = use.getAttribute(ORIG_HREF_ATTR);
    if (orig) {
      use.setAttribute("href", orig);
      use.setAttributeNS(XLINK_NS, "xlink:href", orig);
    }
    use.removeAttribute(ORIG_HREF_ATTR);
  }
  for (const img of document.querySelectorAll(`img[${ORIG_SRC_ATTR}]`)) {
    const orig = img.getAttribute(ORIG_SRC_ATTR);
    if (orig) img.setAttribute("src", orig);
    img.removeAttribute(ORIG_SRC_ATTR);
  }
}

export const unicornHeartsFeature: Feature = {
  id: "unicorn-hearts",
  settingKey: "unicorn_hearts_enabled",
  enable() {
    applyUnicorns();
    // Троттлинг как у role-marker: метки не требуют реакции на каждый кадр.
    offDom = onDomChange(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        applyUnicorns();
      }, 250);
    });
    log.info("unicorn-hearts", "enabled");
  },
  disable() {
    offDom?.();
    offDom = null;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    restore();
    if (container) {
      unregisterOwnContainer(container);
      container.remove();
      container = null;
    }
  },
};
