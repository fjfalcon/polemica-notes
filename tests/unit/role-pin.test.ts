// @vitest-environment jsdom
/**
 * Модуль role-pin — единственный владелец inline-пина своей роли (аудит
 * скрытия ролей 29.08.2026, находки 1/2/7). Ключевые обещания:
 *  • правда живёт НА УЗЛЕ: Vue-пересоздание уносит пин, pinHolds честно
 *    отвечает «нет» — глобальный латч без этого лгал (роль в эфире);
 *  • подъём на время «подсмотреть» логически ДЕРЖИТ пин (владелец не воюет
 *    с подсматриванием), возврат перенакладывает на ЖИВЫЕ узлы;
 *  • снятие возвращает ровно те стили и приоритеты, что были до нас.
 */
import { beforeEach, describe, expect, test } from "vitest";

import {
  getRoleVisibilityTargets,
  isNativeRoleHidden,
  isPinnedElement,
  liftPins,
  pinHolds,
  pinOwnRole,
  releasePins,
  resetRolePinForTest,
  restoreLiftedPins,
} from "@content/role-pin";

function mountRole(): HTMLElement {
  const el = document.createElement("div");
  el.className = "player__role role my-role";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  resetRolePinForTest();
  document.body.innerHTML = "";
});

describe("пин своей роли", () => {
  test("пин скрытия: important-стили + маркер на узле; целей нет — false", () => {
    expect(pinOwnRole("hidden"), "пустая страница").toBe(false);
    const el = mountRole();
    expect(pinOwnRole("hidden")).toBe(true);
    expect(el.style.getPropertyValue("visibility")).toBe("hidden");
    expect(el.style.getPropertyPriority("visibility")).toBe("important");
    expect(isPinnedElement(el)).toBe(true);
    expect(pinHolds("hidden")).toBe(true);
    expect(pinHolds("visible")).toBe(false);
  });

  test("№1: Vue-пересоздание узла — пин мёртв, и pinHolds это ЗНАЕТ", () => {
    const el = mountRole();
    pinOwnRole("hidden");
    el.remove();
    mountRole(); // свежий узел без пина — настоящая роль видна
    expect(pinHolds("hidden"), "глобальная память не заменяет живой узел").toBe(false);
  });

  test("№7: подъём для peek держит пин логически и возвращает на ЖИВОЙ узел", () => {
    const el = mountRole();
    pinOwnRole("hidden");
    expect(liftPins()).toBe(true);
    expect(el.style.getPropertyValue("visibility"), "стили сняты — роль видна").toBe("");
    expect(pinHolds("hidden"), "владелец не должен перепинивать под peek").toBe(true);
    // Vue пересоздал узел, пока клавиша удерживалась.
    el.remove();
    const fresh = mountRole();
    restoreLiftedPins();
    expect(fresh.style.getPropertyValue("visibility"), "пин вернулся на живой узел").toBe("hidden");
    expect(isPinnedElement(fresh)).toBe(true);
  });

  test("снятие возвращает исходные inline-стили С ПРИОРИТЕТАМИ", () => {
    const el = mountRole();
    el.style.setProperty("opacity", "0.5", "important");
    el.style.visibility = "visible";
    pinOwnRole("hidden");
    releasePins();
    expect(el.style.getPropertyValue("opacity")).toBe("0.5");
    expect(el.style.getPropertyPriority("opacity")).toBe("important");
    expect(el.style.getPropertyValue("visibility")).toBe("visible");
    expect(isPinnedElement(el)).toBe(false);
    expect(pinHolds("hidden")).toBe(false);
  });

  test("находка B: «показ» не доверяет отравленному снимку — чужой hidden не пинится как показ", () => {
    // Орфанный inline-пин старой версии расширения (без нашего маркера)
    // остался на узле; ночной пин «показать» из снимка запинил бы
    // hidden !important — роль скрыта от игрока всю ночь при довольном
    // pinHolds("visible").
    const el = mountRole();
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("opacity", "0", "important");
    pinOwnRole("visible");
    expect(el.style.getPropertyValue("visibility"), "роль реально показана").toBe("visible");
    expect(el.style.getPropertyValue("opacity")).toBe("1");
    expect(pinHolds("visible")).toBe(true);
  });

  test("находка D: Vue переписал style-атрибут, маркер выжил — pinHolds честно говорит «нет»", () => {
    const el = mountRole();
    pinOwnRole("hidden");
    el.setAttribute("style", "color: red"); // сайт перезаписал стили целиком
    expect(el.hasAttribute("data-pn-role-pin"), "маркер пережил (Vue data-* не трогает)").toBe(true);
    expect(pinHolds("hidden"), "стилей пина больше нет — держаться нечему").toBe(false);
  });

  test("находка F-2: стёртый style при «visible»-пине не маскируется маркером", () => {
    // «!== hidden» удовлетворялось пустой строкой: ночной пин показа со
    // стёртым Vue style-атрибутом считался живым, пока CSS авто-скрытия
    // прятал роль от игрока всю ночь.
    const el = mountRole();
    pinOwnRole("visible");
    expect(pinHolds("visible")).toBe(true);
    el.setAttribute("style", "color: red");
    expect(pinHolds("visible"), "стилей показа больше нет — heal обязан узнать").toBe(false);
  });

  test("находка A3: restoreLiftedPins на 0 целей — пин потерян, но pinHolds это видит", () => {
    const el = mountRole();
    pinOwnRole("hidden");
    liftPins();
    el.remove(); // целей нет в момент отпускания
    restoreLiftedPins();
    expect(pinHolds("hidden"), "heal-путь владельца увидит пропажу").toBe(false);
    // Узел вернулся — повторный пин восстанавливает состояние.
    mountRole();
    expect(pinOwnRole("hidden")).toBe(true);
    expect(pinHolds("hidden")).toBe(true);
  });

  test("жалоба 04.10.2026: подъём для V — ПОКАЗ, чужой hidden из снимка не возвращается", () => {
    // auto-start при входе в игру прячет роль своим inline-слоем ДО пина
    // obs-панели; пин снимает снимок с этим hidden. Прежний подъём
    // восстанавливал снимок — V не показывал ничего.
    const el = mountRole();
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    pinOwnRole("hidden");
    expect(liftPins()).toBe(true);
    expect(el.style.visibility).toBe("");
    expect(el.style.opacity).toBe("");
    expect(el.style.pointerEvents).toBe("");
    // Отпустили V — пин вернулся, роль снова скрыта.
    restoreLiftedPins();
    expect(el.style.visibility).toBe("hidden");
    expect(pinHolds("hidden")).toBe(true);
    // Снимок цел: teardown вернёт ровно исходное.
    releasePins();
    expect(el.style.visibility).toBe("hidden");
  });

  test("V ночью: подъём visible-пина не прячет роль из снимка", () => {
    const el = mountRole();
    el.style.visibility = "hidden"; // чужой hidden под ночным пином
    pinOwnRole("visible");
    liftPins();
    expect(el.style.visibility, "подсматривание не имеет права ПРЯТАТЬ").toBe("");
  });

  test("21.10.2026: display — флаг САЙТА, пин его не трогает ни в одной операции", () => {
    // Сайт прячет роли v-show (display:none на КАЖДОЙ роли по общему флагу).
    // Наш пин, снимавший display:none, показывал свою роль при скрытых сайтом
    // сокомандниках — зеркальный рассинхрон («Бош не показывается»).
    const el = mountRole();
    el.style.display = "none";
    pinOwnRole("visible");
    expect(el.style.display, "visible-пин не снимает скрытие сайта").toBe("none");
    liftPins();
    expect(el.style.display, "подъём для V не снимает скрытие сайта").toBe("none");
    restoreLiftedPins();
    el.style.display = ""; // сайт показал роли своим D
    releasePins();
    expect(el.style.display, "teardown не возвращает устаревший display").toBe("");
  });

  test("isNativeRoleHidden: display:none (v-show сайта) и прежний #stop", () => {
    const el = mountRole();
    expect(isNativeRoleHidden(el)).toBe(false);
    el.style.display = "none";
    expect(isNativeRoleHidden(el), "новая вёрстка сайта").toBe(true);
    el.style.display = "";
    el.innerHTML = '<svg><use href="/room/bundle/x.svg#stop"></use></svg>';
    expect(isNativeRoleHidden(el), "прежняя вёрстка").toBe(true);
    expect(isNativeRoleHidden(null)).toBe(false);
  });

  test("щит дневного пина: Vue-пересозданный узел скрыт сразу (adversarial 21.10.2026, №8)", () => {
    // Inline-пин живёт на узле: до heal-перепина свежий узел показывал
    // настоящую роль. Таблица стилей по атрибуту на <html> — мгновенно.
    const vis = (el: Element) => getComputedStyle(el).visibility;
    const el = mountRole();
    pinOwnRole("hidden");
    el.remove();
    const fresh = mountRole();
    expect(vis(fresh), "свежий узел скрыт до перепина").toBe("hidden");
    liftPins();
    expect(vis(fresh), "«подсмотреть» щит снимает").not.toBe("hidden");
    restoreLiftedPins();
    expect(vis(fresh)).toBe("hidden");
    pinOwnRole("visible");
    expect(vis(fresh), "ночной показ — без щита").toBe("visible");
    pinOwnRole("hidden");
    releasePins();
    expect(vis(fresh), "teardown снимает щит").not.toBe("hidden");
  });

  test("повторный lift без пина — false; restore после перепина владельцем — не мешает", () => {
    expect(liftPins(), "пина нет — поднимать нечего").toBe(false);
    mountRole();
    pinOwnRole("hidden");
    liftPins();
    // Владелец перепинил сам (смена фазы на ночь) — подъём аннулирован.
    pinOwnRole("visible");
    restoreLiftedPins(); // не должен вернуть «hidden» поверх ночного показа
    expect(pinHolds("visible")).toBe(true);
    const el = getRoleVisibilityTargets()[0];
    expect(el.getAttribute("data-pn-role-pin")).toBe("visible");
  });
});
