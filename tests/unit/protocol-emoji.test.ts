// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game" }
/**
 * Эмодзи вместо меток протокола ПУ (обобщение «единорогов» 9.63.0).
 *
 * Сторожим обещания фичи:
 *  - подменяются ТОЛЬКО метки с непустым эмодзи; пустое поле = родная иконка;
 *  - идемпотентность (§4.1): повторный проход тих, контейнер один;
 *  - adversarial-урок 9.63.0: Vue правит только xlink:href, наш href ГЛАВНЕЕ —
 *    перенацеленный узел получает символ НОВОЙ метки (если она включена) или
 *    чистый сайтовый вид (если нет), и никогда не чужую иконку из «снимка»;
 *  - смена эмодзи на лету (update) перерисовывает и символы, и data-URI;
 *  - выключение возвращает сайту ровно то, что он хочет показывать сейчас.
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
  applyProtocolEmoji,
  imgSrcFor,
  protocolEmojiFeature,
  symbolId,
} from "@content/features/protocol-emoji";
import { OWN } from "@core/selectors";
import type { FeatureContext } from "@core/feature";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Реальный вид ссылок сайта: хэш спрайта ПЕРЕД фрагментом. */
const SPRITE = "/room/bundle/f59bacbc2885635c4d91.svg";
const CIV = `${SPRITE}#guess-civ`;
const MAF = `${SPRITE}#guess-maf`;
const VICE = `${SPRITE}#guess-vice`;
/** Реальные contenthash картинок пикера (сверены с бандлом 01.10.2026). */
const IMG_CIV = "/room/bundle/8bd3b0d043b384ffb24e.svg";
const IMG_MAF = "/room/bundle/24b5ad3bd86f4bb33b4e.svg";
const IMG_VICE = "/room/bundle/f8eb2b2335b96664affa.svg";

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    settings: {
      unicorn_hearts_enabled: true,
      protocol_emoji_civ: "🦄",
      protocol_emoji_maf: "",
      protocol_emoji_vice: "",
      ...over,
    },
  }) as unknown as FeatureContext;

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
  protocolEmojiFeature.disable();
  // Дефолтный конфиг сессии теста: сердце → 🦄, остальные пустые.
  protocolEmojiFeature.update?.(ctx());
});

describe("reconcile: метки включаются выборочно", () => {
  test("сердце подменяется, пистолет и корона с пустым полем — нет", () => {
    const heart = makeUse(CIV);
    const pistol = makeUse(MAF);
    const crown = makeUse(VICE);
    expect(applyProtocolEmoji()).toBe(1);
    expect(heart.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    expect(heart.getAttribute(ORIG_HREF_ATTR)).toBe(CIV);
    expect(pistol.getAttributeNS(XLINK_NS, "href")).toBe(MAF);
    expect(pistol.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(crown.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    // Символ в контейнере — эмодзи из настройки.
    const sprite = document.querySelector(`.${OWN.protocolEmojiSprite}`);
    expect(sprite?.querySelector(`#${symbolId("civ")} text`)?.textContent).toBe("🦄");
    expect(sprite?.querySelector(`#${symbolId("maf")}`)).toBeNull();
    expect(registered).toContain(sprite);
  });

  test("все три метки с эмодзи — подменяются все три, каждая своим символом", () => {
    protocolEmojiFeature.update?.(
      ctx({ protocol_emoji_maf: "🤡", protocol_emoji_vice: "💩" }),
    );
    const heart = makeUse(CIV);
    const pistol = makeUse(MAF);
    const crown = makeUse(VICE);
    const img = makeImg(IMG_MAF);
    expect(applyProtocolEmoji()).toBe(4);
    expect(heart.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    expect(pistol.getAttribute("href")).toBe(`#${symbolId("maf")}`);
    expect(crown.getAttribute("href")).toBe(`#${symbolId("vice")}`);
    expect(img.getAttribute("src")).toBe(imgSrcFor("maf"));
    const sprite = document.querySelector(`.${OWN.protocolEmojiSprite}`);
    expect(sprite?.querySelector(`#${symbolId("maf")} text`)?.textContent).toBe("🤡");
    expect(sprite?.querySelector(`#${symbolId("vice")} text`)?.textContent).toBe("💩");
  });

  test("идемпотентна: второй проход тих, контейнер один", () => {
    makeUse(CIV);
    makeUse(CIV);
    makeImg(IMG_CIV);
    expect(applyProtocolEmoji()).toBe(3);
    expect(applyProtocolEmoji()).toBe(0);
    expect(document.querySelectorAll(`.${OWN.protocolEmojiSprite}`).length).toBe(1);
  });
});

describe("adversarial 9.63.0: Vue перенацеливает узлы", () => {
  test("сердце → пистолет при ВЫКЛЮЧЕННОМ пистолете: наш href снят, не перебивает", () => {
    const use = makeUse(CIV);
    applyProtocolEmoji();
    use.setAttributeNS(XLINK_NS, "xlink:href", MAF);
    expect(applyProtocolEmoji()).toBe(1);
    expect(use.getAttribute("href")).toBeNull();
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(MAF);
    expect(applyProtocolEmoji()).toBe(0);
  });

  test("сердце → пистолет при ВКЛЮЧЁННОМ пистолете: узел переезжает на символ мафии", () => {
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_maf: "🤡" }));
    const use = makeUse(CIV);
    applyProtocolEmoji();
    use.setAttributeNS(XLINK_NS, "xlink:href", MAF);
    expect(applyProtocolEmoji()).toBe(1);
    expect(use.getAttribute("href")).toBe(`#${symbolId("maf")}`);
    // Оригинал обновлён на ПРАВДУ сайта (пистолет), не на снимок сердца.
    expect(use.getAttribute(ORIG_HREF_ATTR)).toBe(MAF);
  });

  test("оригинал не отравляется: Vue вернул xlink сердца — «снимок» прежний", () => {
    const use = makeUse(CIV);
    applyProtocolEmoji();
    use.setAttributeNS(XLINK_NS, "xlink:href", CIV);
    applyProtocolEmoji();
    expect(use.getAttribute(ORIG_HREF_ATTR)).toBe(CIV);
    expect(use.getAttribute("href")).toBe(`#${symbolId("civ")}`);
  });

  test("img пикера перенацелен Vue на невключённую метку — метка протухает, src цел", () => {
    const img = makeImg(IMG_CIV);
    applyProtocolEmoji();
    img.setAttribute("src", IMG_VICE); // корона выключена
    expect(applyProtocolEmoji()).toBe(1);
    expect(img.getAttribute("src")).toBe(IMG_VICE);
    expect(img.hasAttribute(ORIG_SRC_ATTR)).toBe(false);
  });
});

describe("adversarial 9.64.0: добивка углов", () => {
  test("XML-спецсимвол в поле не ломает data-URI пикера", () => {
    // Значение приходит из настроек (в т.ч. sync с другого устройства):
    // сырой & делал SVG невалидным — картинка пикера умирала молча.
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_civ: "&" }));
    const img = makeImg(IMG_CIV);
    applyProtocolEmoji();
    const decoded = decodeURIComponent(img.getAttribute("src") ?? "");
    expect(decoded).toContain(">&amp;</text>");
    expect(decoded).not.toContain(">&</text>");
  });

  test("сайт мигрировал на href (без xlink): метка всё равно подменяется и откатывается", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", CIV); // ТОЛЬКО href — xlink нет
    svg.appendChild(use);
    document.body.appendChild(svg);
    expect(applyProtocolEmoji()).toBe(1);
    expect(use.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    expect(use.getAttribute(ORIG_HREF_ATTR)).toBe(CIV);
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_civ: "" }));
    applyProtocolEmoji();
    expect(use.getAttribute("href")).toBe(CIV);
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
  });

  test("Vue увёл узел на НЕ-метку (#voted): следы сняты, чужой xlink цел", () => {
    const use = makeUse(CIV);
    applyProtocolEmoji();
    use.setAttributeNS(XLINK_NS, "xlink:href", `${SPRITE}#voted`);
    expect(applyProtocolEmoji()).toBe(1);
    expect(use.getAttribute("href")).toBeNull();
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(`${SPRITE}#voted`);
  });

  test("img переехал сердце → пистолет при включённом пистолете: оригинал — правда, не снимок", () => {
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_maf: "🤡" }));
    const img = makeImg(IMG_CIV);
    applyProtocolEmoji();
    img.setAttribute("src", IMG_MAF); // Vue перенацелил кнопку
    applyProtocolEmoji();
    expect(img.getAttribute("src")).toBe(imgSrcFor("maf"));
    // Откат вернул бы пистолет, а не сердце из протухшего снимка.
    expect(img.getAttribute(ORIG_SRC_ATTR)).toBe(IMG_MAF);
  });
});

describe("смена эмодзи на лету (update)", () => {
  test("символ и data-URI перерисовываются новым эмодзи", () => {
    const use = makeUse(CIV);
    const img = makeImg(IMG_CIV);
    void protocolEmojiFeature.enable(ctx());
    const oldUri = img.getAttribute("src");
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_civ: "💩" }));
    expect(
      document.querySelector(`#${symbolId("civ")} text`)?.textContent,
    ).toBe("💩");
    expect(use.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    expect(img.getAttribute("src")).toBe(imgSrcFor("civ"));
    expect(img.getAttribute("src")).not.toBe(oldUri);
    expect(img.getAttribute(ORIG_SRC_ATTR)).toBe(IMG_CIV);
  });

  test("метку выключили на лету — узлы возвращаются сайту без перезагрузки", () => {
    const use = makeUse(CIV);
    const img = makeImg(IMG_CIV);
    void protocolEmojiFeature.enable(ctx());
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_civ: "" }));
    expect(use.getAttribute("href")).toBe(CIV);
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(CIV);
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(img.getAttribute("src")).toBe(IMG_CIV);
    expect(img.hasAttribute(ORIG_SRC_ATTR)).toBe(false);
  });
});

describe("protocolEmojiFeature", () => {
  test("enable подменяет сразу и подписывается; поздний узел ловится проходом", () => {
    vi.useFakeTimers();
    try {
      const use = makeUse(CIV);
      void protocolEmojiFeature.enable(ctx());
      expect(use.getAttribute("href")).toBe(`#${symbolId("civ")}`);
      const late = makeUse(CIV);
      expect(domSubscriber).toBeTruthy();
      domSubscriber?.();
      vi.advanceTimersByTime(260);
      expect(late.getAttribute("href")).toBe(`#${symbolId("civ")}`);
    } finally {
      vi.useRealTimers();
    }
  });

  test("disable возвращает сайту метки и убирает контейнер", () => {
    protocolEmojiFeature.update?.(ctx({ protocol_emoji_maf: "🤡" }));
    const heart = makeUse(CIV);
    const pistol = makeUse(MAF);
    const img = makeImg(IMG_CIV);
    void protocolEmojiFeature.enable(ctx({ protocol_emoji_maf: "🤡" }));
    const sprite = document.querySelector(`.${OWN.protocolEmojiSprite}`);
    protocolEmojiFeature.disable();
    expect(heart.getAttribute("href")).toBe(CIV);
    expect(pistol.getAttribute("href")).toBe(MAF);
    expect(img.getAttribute("src")).toBe(IMG_CIV);
    expect(document.querySelector(`.${OWN.protocolEmojiSprite}`)).toBeNull();
    expect(unregistered).toContain(sprite);
    expect(domSubscriber).toBeNull();
  });

  test("disable НЕ надевает сердце на перенацеленный узел (окно между проходами)", () => {
    const use = makeUse(CIV);
    const img = makeImg(IMG_CIV);
    void protocolEmojiFeature.enable(ctx());
    use.setAttributeNS(XLINK_NS, "xlink:href", MAF);
    img.setAttribute("src", IMG_MAF);
    protocolEmojiFeature.disable();
    expect(use.getAttribute("href")).toBeNull();
    expect(use.getAttributeNS(XLINK_NS, "href")).toBe(MAF);
    expect(use.hasAttribute(ORIG_HREF_ATTR)).toBe(false);
    expect(img.getAttribute("src")).toBe(IMG_MAF);
    expect(img.hasAttribute(ORIG_SRC_ATTR)).toBe(false);
  });
});
