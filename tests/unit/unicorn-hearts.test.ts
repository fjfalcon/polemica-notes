// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * «Единороги вместо сердец»: подмена метки «сердце» (мирный) в протоколе ПУ.
 *
 * Сторожим обещания фичи:
 *  - подменяется ТОЛЬКО сердце (#guess-civ и contenthash-картинка пикера),
 *    пистолеты/короны соседних <use> не трогаются;
 *  - идемпотентность (§4.1): повторный проход ничего не меняет и не плодит
 *    второй контейнер символа;
 *  - оригинал в data-атрибуте не отравляется нашим же значением (класс
 *    «отравленный снимок»: Vue вернул xlink:href — повторный проход не должен
 *    записать в «оригинал» наш "#pn-unicorn-heart»);
 *  - выключение возвращает сайту ровно то, что было, и убирает контейнер.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

let domSubscriber: (() => void) | null = null;
const registered: Element[] = [];
const unregistered: Element[] = [];
vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    domSubscriber = cb;
    return () => {
      domSubscriber = null;
    };
  }),
  registerOwnContainer: vi.fn((el: Element) => registered.push(el)),
  unregisterOwnContainer: vi.fn((el: Element) => unregistered.push(el)),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  ORIG_HREF_ATTR,
  ORIG_SRC_ATTR,
  UNICORN_EMOJI,
  UNICORN_IMG_SRC,
  UNICORN_SYMBOL_ID,
  applyUnicorns,
  unicornHeartsFeature,
} from "@content/features/unicorn-hearts";
import { OWN } from "@core/selectors";
import type { FeatureContext } from "@core/feature";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Реальный вид ссылки сайта: хэш спрайта ПЕРЕД фрагментом. */
const SPRITE_HREF = "/room/bundle/f59bacbc2885635c4d91.svg#guess-civ";
/** Реальный contenthash guessCiv.svg (сверен с бандлом 01.10.2026). */
const PICKER_SRC = "/room/bundle/8bd3b0d043b384ffb24e.svg";

const ctx = { settings: { unicorn_hearts_enabled: true } } as unknown as FeatureContext;

/** <svg><use xlink:href="…"> — как рисует RoomIcon сайта. */
function makeUse(href: string): SVGUseElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttributeNS(XLINK_NS, "xlink:href", href);
  svg.appendChild(use);
  document.body.appendChild(svg);
  return use;
}

function makeImg(src: string): HTMLImageElement {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  document.body.appendChild(img);
  return img;
}

beforeEach(() => {
  document.body.innerHTML = "";
  domSubscriber = null;
  registered.length = 0;
  unregistered.length = 0;
  unicornHeartsFeature.disable();
});

describe("applyUnicorns", () => {
  test("перенацеливает спрайтовое сердце на наш символ и сохраняет оригинал", () => {
    const use = makeUse(SPRITE_HREF);
    expect(applyUnicorns()).toBe(1);
    expect(use.getAttribute("href")).toBe(`#${UNICORN_SYMBOL_ID}`);
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(`#${UNICORN_SYMBOL_ID}`);
    expect(use.getAttribute(ORIG_HREF_ATTR)).toBe(SPRITE_HREF);
    // Символ появился в документе и зарегистрирован своим контейнером.
    // Внутри — эмодзи платформы, не свой рисунок (решение владельца 01.10.2026).
    const sprite = document.querySelector(`.${OWN.unicornSprite}`);
    expect(sprite?.querySelector(`#${UNICORN_SYMBOL_ID} text`)?.textContent).toBe(UNICORN_EMOJI);
    expect(registered).toContain(sprite);
  });

  test("пистолеты и короны не трогает", () => {
    const maf = makeUse("/room/bundle/f59bacbc2885635c4d91.svg#guess-maf");
    const vice = makeUse("/room/bundle/f59bacbc2885635c4d91.svg#guess-vice");
    expect(applyUnicorns()).toBe(0);
    expect(maf.getAttributeNS(XLINK_NS, "href")).toContain("#guess-maf");
    expect(vice.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    // Без единого сердца нечего подменять — и символ не вставляется.
    expect(document.querySelector(`.${OWN.unicornSprite}`)).toBeNull();
  });

  test("идемпотентна: второй проход ничего не меняет и не плодит контейнер", () => {
    // ДВА сердца в одном проходе: дедуп контейнера сторожится внутри прохода,
    // а не только между проходами (мутационная проверка 01.10.2026).
    makeUse(SPRITE_HREF);
    makeUse(SPRITE_HREF);
    makeImg(PICKER_SRC);
    expect(applyUnicorns()).toBe(3);
    expect(applyUnicorns()).toBe(0);
    expect(document.querySelectorAll(`.${OWN.unicornSprite}`).length).toBe(1);
  });

  test("оригинал не отравляется: Vue вернул xlink:href — «снимок» прежний", () => {
    const use = makeUse(SPRITE_HREF);
    applyUnicorns();
    // Vue патчит только xlink:href (его ветка шаблона); наш href остаётся.
    use.setAttributeNS(XLINK_NS, "xlink:href", SPRITE_HREF);
    applyUnicorns();
    expect(use.getAttribute(ORIG_HREF_ATTR)).toBe(SPRITE_HREF);
    expect(use.getAttribute("href")).toBe(`#${UNICORN_SYMBOL_ID}`);
  });

  test("пересозданный Vue узел (только xlink:href) подменяется заново", () => {
    const use = makeUse(SPRITE_HREF); // href-атрибута нет — как у сайта
    expect(use.getAttribute("href")).toBeNull();
    expect(applyUnicorns()).toBe(1);
    expect(use.getAttribute("href")).toBe(`#${UNICORN_SYMBOL_ID}`);
  });

  test("картинка пикера ПУ меняется на data-URI, чужие — нет", () => {
    const heart = makeImg(PICKER_SRC);
    const other = makeImg("/room/bundle/24b5ad3bd86f4bb33b4e.svg"); // guessMaf
    expect(applyUnicorns()).toBe(1);
    expect(heart.getAttribute("src")).toBe(UNICORN_IMG_SRC);
    expect(heart.getAttribute(ORIG_SRC_ATTR)).toBe(PICKER_SRC);
    expect(other.getAttribute("src")).toBe("/room/bundle/24b5ad3bd86f4bb33b4e.svg");
  });
});

describe("unicornHeartsFeature", () => {
  test("enable подменяет сразу и подписывается; новая метка ловится проходом", () => {
    vi.useFakeTimers();
    try {
      const use = makeUse(SPRITE_HREF);
      void unicornHeartsFeature.enable(ctx);
      expect(use.getAttribute("href")).toBe(`#${UNICORN_SYMBOL_ID}`);
      const late = makeUse(SPRITE_HREF);
      expect(domSubscriber).toBeTruthy();
      domSubscriber?.();
      vi.advanceTimersByTime(260);
      expect(late.getAttribute("href")).toBe(`#${UNICORN_SYMBOL_ID}`);
    } finally {
      vi.useRealTimers();
    }
  });

  test("disable возвращает сайту сердца и убирает контейнер", () => {
    const use = makeUse(SPRITE_HREF);
    const img = makeImg(PICKER_SRC);
    void unicornHeartsFeature.enable(ctx);
    const sprite = document.querySelector(`.${OWN.unicornSprite}`);
    unicornHeartsFeature.disable();
    expect(use.getAttribute("href")).toBe(SPRITE_HREF);
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(SPRITE_HREF);
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(img.getAttribute("src")).toBe(PICKER_SRC);
    expect(img.hasAttribute(ORIG_SRC_ATTR)).toBe(false);
    expect(document.querySelector(`.${OWN.unicornSprite}`)).toBeNull();
    expect(unregistered).toContain(sprite);
    expect(domSubscriber).toBeNull(); // отписка от onDomChange состоялась
  });
});
