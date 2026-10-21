// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

const seam = vi.hoisted(() => ({ domSubs: [] as Array<() => void> }));
vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    seam.domSubs.push(cb);
    return () => {
      seam.domSubs = seam.domSubs.filter((s) => s !== cb);
    };
  }),
  safeClick: vi.fn(),
  isVisible: () => true,
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));
const keys = vi.hoisted(() => ({ map: new Map<string, () => void>() }));
vi.mock("@core/keyboard", async (orig) => ({
  ...((await orig()) as object),
  keyboard: {
    register: vi.fn((code: string, fn: () => void) => {
      keys.map.set(code, fn);
      return () => keys.map.delete(code);
    }),
  },
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { isRoleFaked, roleFakerFeature, shouldSwallowRoleKey } from "@content/features/role-faker";
import type { FeatureContext } from "@core/feature";
import { dispatchNativeRoleToggle } from "@content/native-role-toggle";

function keydown(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shouldSwallowRoleKey (§4.5 gates of the D blocker)", () => {
  test("swallows the configured hide key", () => {
    expect(shouldSwallowRoleKey(keydown({ code: "KeyD" }), "KeyD")).toBe(true);
  });

  test("matches by physical key, not by layout (KeyD is «в» in Russian)", () => {
    expect(shouldSwallowRoleKey(keydown({ code: "KeyD", key: "в" }), "KeyD")).toBe(true);
    expect(shouldSwallowRoleKey(keydown({ code: "KeyV", key: "d" }), "KeyD")).toBe(false);
  });

  test("keeps swallowing an auto-repeating key", () => {
    // Инвертированный гейт §4.5: пропустив повтор, мы отдали бы D сайту, и он
    // показал бы настоящую роль посреди подмены. Тест держит это решение.
    expect(shouldSwallowRoleKey(keydown({ code: "KeyD", repeat: true }), "KeyD")).toBe(true);
  });

  test("наш синтетический D не глотает (adversarial 21.10.2026, №9)", () => {
    // Глотая его, блокировщик срывал возврат скрытия после «подсмотреть».
    const seen: boolean[] = [];
    const spy = (e: Event) => seen.push(shouldSwallowRoleKey(e as KeyboardEvent, "KeyD"));
    document.addEventListener("keydown", spy);
    dispatchNativeRoleToggle();
    document.removeEventListener("keydown", spy);
    expect(seen.length, "пара D и пара Ctrl+D").toBe(2);
    expect(seen.every((v) => v === false)).toBe(true);
  });

  test.each(["KeyF", "KeyE", "Space"])("ignores unrelated key %s", (code) => {
    expect(shouldSwallowRoleKey(keydown({ code }), "KeyD")).toBe(false);
  });

  test("follows the rebound hide key, not the literal D", () => {
    expect(shouldSwallowRoleKey(keydown({ code: "KeyD" }), "KeyG")).toBe(false);
    expect(shouldSwallowRoleKey(keydown({ code: "KeyG" }), "KeyG")).toBe(true);
  });

  test.each([
    ["ctrlKey", { ctrlKey: true }],
    ["metaKey", { metaKey: true }],
    ["altKey", { altKey: true }],
  ])("does not swallow a %s combination", (_name, modifier) => {
    expect(shouldSwallowRoleKey(keydown({ code: "KeyD", ...modifier }), "KeyD")).toBe(false);
  });

  test("does not swallow while the user is typing (KeyD is «в» in Russian)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const event = keydown({ code: "KeyD" });
    input.dispatchEvent(event);
    expect(shouldSwallowRoleKey(event, "KeyD")).toBe(false);
  });
});

describe("подмена переживает Vue-перерисовки (аудит скрытия ролей 29.08.2026, №3/№8)", () => {
  function mountTable(): { own: HTMLElement; foe: HTMLElement } {
    document.body.innerHTML = `
      <div class="players">
        <div class="player my-player">
          <div class="my-role">
            <div class="player__role role my-role-el"></div>
          </div>
        </div>
        <div class="player" id="p2"></div>
      </div>`;
    // Своя роль: настоящий селектор .player__role.role.role.my-role.
    const ownWrap = document.querySelector(".my-role") as HTMLElement;
    ownWrap.innerHTML = "";
    const own = document.createElement("div");
    own.className = "player__role role my-role";
    own.innerHTML = `<svg><use href="/sprite.svg#sheriff"></use></svg>
      <div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div>`;
    ownWrap.appendChild(own);
    const foe = document.createElement("div");
    foe.className = "player__role role";
    (document.querySelector("#p2") as HTMLElement).appendChild(foe);
    return { own, foe };
  }

  function enable(): void {
    roleFakerFeature.enable({
      settings: { enable_role_faker: true, hotkey_role_hide: "KeyD" },
    } as unknown as FeatureContext);
  }
  const pressF = () => keys.map.get("KeyF")!();
  const pressE = () => keys.map.get("KeyE")!();
  const fireDom = () => seam.domSubs.forEach((cb) => cb());

  afterEach(() => {
    roleFakerFeature.disable();
    seam.domSubs = [];
    keys.map.clear();
  });

  test("№3: пересозданный узел СВОЕЙ роли получает ту же подмену заново", () => {
    const { own } = mountTable();
    enable();
    pressF();
    expect(isRoleFaked()).toBe(true);
    const fakedHref = own.querySelector("use")!.getAttribute("href")!;
    expect(fakedHref, "подмена наложена").not.toContain("#sheriff");
    // Vue пересоздал узел: настоящая роль вернулась на экран.
    const fresh = document.createElement("div");
    fresh.className = own.className; // Vue создаёт узел заново: наших data-* нет
    fresh.innerHTML = `<svg><use href="/sprite.svg#sheriff"></use></svg>
      <div class="tooltip"><div class="content"><span>Ваша роль - Шериф</span></div></div>`;
    own.replaceWith(fresh);
    fireDom();
    expect(
      fresh.querySelector("use")!.getAttribute("href"),
      "та же фальшивая роль перенанесена, без сдвига по кругу",
    ).toBe(fakedHref);
    expect(isRoleFaked()).toBe(true);
  });

  test("F-1: ПЕРЕИСПОЛЬЗОВАННЫЙ узел с переписанным href перекрашивается обратно", () => {
    // Vue патчит vnode: переписывает use[href], data-* не трогает — маркер
    // выживал, и настоящая роль проступала при живой подмене (adversarial
    // 29.08.2026, F-1). #stop при этом перебивать нельзя.
    const { own } = mountTable();
    enable();
    pressF();
    const fakedHref = own.querySelector("use")!.getAttribute("href")!;
    // Сайт переписал href на настоящую роль (узел ТОТ ЖЕ, data-* на месте).
    own.querySelector("use")!.setAttribute("href", "/sprite.svg#sheriff");
    fireDom();
    expect(own.querySelector("use")!.getAttribute("href"), "фальшивка возвращена").toBe(fakedHref);
    // Нативное скрытие игрока фальшивка не перебивает.
    own.querySelector("use")!.setAttribute("href", "/sprite.svg#stop");
    fireDom();
    expect(own.querySelector("use")!.getAttribute("href"), "#stop уважается").toBe(
      "/sprite.svg#stop",
    );
  });

  test("F-6: узел без <use> — честный отказ подмены, а не вечный тик наблюдателя", () => {
    mountTable();
    const wrap = document.querySelector(".my-role") as HTMLElement;
    wrap.innerHTML = "";
    const bare = document.createElement("div");
    bare.className = "player__role role my-role";
    wrap.appendChild(bare); // полусобранная разметка: без <use>
    enable();
    pressF();
    expect(isRoleFaked(), "подмены нет — блокировать D нечем").toBe(false);
  });

  test("№8: чужой узел, созданный ВО ВРЕМЯ подмены, скрыт и возвращается по E", () => {
    mountTable();
    enable();
    pressF();
    // Vue создал новый узел роли напарника уже после F.
    const late = document.createElement("div");
    late.className = "player__role role";
    late.style.display = "inline-flex";
    (document.querySelector("#p2") as HTMLElement).appendChild(late);
    fireDom();
    expect(late.style.visibility, "скрыт наблюдателем").toBe("hidden");
    expect(late.style.display, "display — флаг сайта, подмена его не трогает").toBe("inline-flex");
    pressE();
    expect(late.style.visibility, "E вернул исходное, а не бросил скрытым").toBe("");
    expect(late.style.display).toBe("inline-flex");
    expect(isRoleFaked()).toBe(false);
  });

  test("щит подмены: свежий узел роли скрыт ДО флаша наблюдателя (adversarial 21.10.2026, №8)", () => {
    // До флаша (rAF, ≤ ~270 мс) пересозданный узел показывал НАСТОЯЩУЮ роль.
    const { own } = mountTable();
    enable();
    pressF();
    const late = document.createElement("div");
    late.className = "player__role role";
    (document.querySelector("#p2") as HTMLElement).appendChild(late);
    const vis = (el: Element) => getComputedStyle(el).visibility;
    expect(vis(late), "новый узел сокомандника скрыт таблицей стилей").toBe("hidden");
    expect(vis(own), "своя роль с фальшивкой видна").not.toBe("hidden");
    // Пересозданная СВОЯ роль без фальшивки — тоже скрыта, а не настоящая.
    const fresh = document.createElement("div");
    fresh.className = "player__role role my-role";
    own.replaceWith(fresh);
    expect(vis(fresh)).toBe("hidden");
    pressE();
    expect(vis(late), "E снимает щит").not.toBe("hidden");
  });

  test("щит: Vue заменил только <use> в подменённой роли — настоящий значок скрыт сразу", () => {
    const { own } = mountTable();
    enable();
    pressF();
    own.querySelector("svg")!.innerHTML = '<use href="/sprite.svg#sheriff"></use>';
    const use = own.querySelector("use")!;
    expect(getComputedStyle(use).visibility, "до флаша наблюдателя").toBe("hidden");
    // Сайт переписал href самого <use> (атрибут наблюдатель не видит).
    fireDom();
    expect(use.getAttribute("href"), "наблюдатель перекрасил").toContain("#godfather");
    expect(getComputedStyle(use).visibility).not.toBe("hidden");
    use.setAttribute("href", "/sprite.svg#sheriff");
    // Переписанный href ловит само правило щита. jsdom сопоставляет
    // [href$=…] и с атрибутом xlink:href (браузер — нет), поэтому сверяем
    // текст правила: <use>, чей href не фальшивка, скрыт.
    const rule = document.getElementById("pn-role-fake-shield")!.textContent!;
    expect(rule).toContain('[data-original-role] use:not([href$="#godfather"])');
    expect(use.getAttribute("href")!.endsWith("#godfather")).toBe(false);
  });

  test("подпись сверяется и при совпавшем значке; E снимает снимок настоящей роли", () => {
    const { own } = mountTable();
    enable();
    pressF();
    const tip = own.querySelector(".tooltip span")!;
    tip.textContent = "Ваша роль - Шериф"; // сайт вернул настоящую подпись
    fireDom();
    expect(tip.textContent).toBe("Ваша роль - Дон");
    pressE();
    expect(own.hasAttribute("data-original-role"), "снимок живёт только до E").toBe(false);
    // Сайт сменил роль в том же узле — следующий F→E возвращает НОВУЮ.
    own.querySelector("use")!.setAttribute("href", "/sprite.svg#mafia");
    tip.textContent = "Ваша роль - Мафия";
    pressF();
    pressE();
    expect(own.querySelector("use")!.getAttribute("href")).toBe("/sprite.svg#mafia");
  });

  test("меню, появившееся во время подмены, E возвращает", () => {
    mountTable();
    enable();
    pressF();
    const menu = document.createElement("div");
    menu.className = "player__menu with-role";
    menu.style.right = "2rem";
    document.querySelector("#p2")!.append(menu);
    fireDom();
    expect(menu.style.right).toBe("0.5rem");
    pressE();
    expect(menu.style.right).toBe("2rem");
  });

  test("уведомление «Игрок является …» под подменой скрыто щитом", () => {
    mountTable();
    enable();
    pressF();
    const block = document.createElement("div");
    block.className = "notifications-block player__notifications-block";
    block.innerHTML = '<div class="notification-element roleReveal"><span>Игрок является мафией</span></div>';
    document.querySelector("#p2")!.append(block);
    expect(getComputedStyle(block.firstElementChild!).visibility).toBe("hidden");
    pressE();
    expect(getComputedStyle(block.firstElementChild!).visibility).not.toBe("hidden");
  });

  test("следы подмены прежней копии скрипта снимаются при включении (обновление расширения)", () => {
    const { own, foe } = mountTable();
    own.setAttribute("data-original-role", "sheriff");
    own.setAttribute("data-original-sprite-base", "/sprite.svg");
    own.querySelector("use")!.setAttribute("href", "/sprite.svg#godfather");
    foe.style.setProperty("visibility", "hidden", "important");
    foe.setAttribute("data-pn-fake-hidden", "");
    document.documentElement.setAttribute("data-pn-role-faked", "");
    enable();
    expect(own.querySelector("use")!.getAttribute("href")).toBe("/sprite.svg#sheriff");
    expect(foe.style.visibility).toBe("");
    expect(document.documentElement.hasAttribute("data-pn-role-faked")).toBe(false);
  });

  test("21.10.2026: смена флага сайта (D) посреди подмены не раскрывает сокомандника", () => {
    // Сайт прячет/показывает роли v-show — пишет display всем ролям. Наш
    // прежний display:none Vue перезаписывал на первой же смене флага, и
    // состав чёрных проступал посреди подмены — в эфир.
    mountTable();
    enable();
    pressF();
    const partner = document.querySelector<HTMLElement>("#p2 .player__role")!;
    expect(partner.style.visibility).toBe("hidden");
    partner.style.display = "none"; // сайт спрятал роли
    partner.style.display = ""; // и показал обратно (его D)
    fireDom();
    expect(partner.style.visibility, "сокомандник по-прежнему скрыт подменой").toBe("hidden");
  });
});
