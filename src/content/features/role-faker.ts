/**
 * Подмена собственной роли: F/А — следующая роль, E/У — сброс.
 * Пока подмена активна — прячет чужие роли и блокирует клавишу D/В.
 * Порт role-faker.js на единый keyboard-роутер и общий DOM-наблюдатель.
 */
import { keyboard, isTypingContext, producesText } from "@core/keyboard";
import { onDomChange } from "@core/dom";
import { log } from "@core/log";
import { showToast } from "@core/toast";
import { SITE } from "@core/selectors";
import type { Feature, FeatureContext } from "@core/feature";

interface RoleDef {
  name: string;
  icon: string;
}

/**
 * Глотать ли это нажатие клавиши скрытия роли, пока активна подмена.
 * Вынесено из блокировщика отдельной функцией — чтобы политика гейтов §4.5
 * проверялась тестом поведением, а не чтением исходника.
 *
 * Гейты те же, что у общего роутера: `event.code` (раскладко-независимо),
 * typing-context и модификаторы. А вот `e.repeat` здесь ОСОЗНАННО инвертирован:
 * роутер на автоповторе не действует, чтобы не выполнять действие десятки раз
 * в секунду, но здесь «действие» — это подавление, и оно обязано быть
 * непрерывным. Пропустив повтор, мы отдали бы D сайту, и он показал бы
 * НАСТОЯЩУЮ роль прямо посреди подмены.
 */
export function shouldSwallowRoleKey(e: KeyboardEvent, hideKeyCode: string): boolean {
  if (e.code !== hideKeyCode) return false;
  // Пока пользователь печатает (KeyD = «в» в русской раскладке) или жмёт
  // Cmd/Ctrl+D — не глотаем.
  if (isTypingContext(e) && producesText(e.code)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}

/**
 * Щит подмены (adversarial 21.10.2026, №8): Vue пересоздаёт плитку роли, и
 * до флаша наблюдателя (rAF, ≤ ~270 мс) свежий узел показывал НАСТОЯЩУЮ
 * роль — свою или сокомандника — посреди подмены. Правило таблицы стилей
 * действует на новый узел мгновенно: прячет любую роль без нашей
 * фальшивки (data-original-role ставит changeRole на свою роль).
 */
const FAKE_SHIELD_ID = "pn-role-fake-shield";
/** Маркер чужой роли, спрятанной подменой: по нему снимаются следы прежней копии. */
const FAKE_HIDDEN_ATTR = "data-pn-fake-hidden";
const FAKE_SHIELD_ATTR = "data-pn-role-faked";

function setFakeShield(on: boolean, icon?: string): void {
  const root = document.documentElement;
  if (!on) {
    root.removeAttribute(FAKE_SHIELD_ATTR);
    return;
  }
  let style = document.getElementById(FAKE_SHIELD_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = FAKE_SHIELD_ID;
    (document.head || root).appendChild(style);
  }
  // Второе правило — подменённая роль, у которой Vue заменил только <use>
  // (корень с data-original-role сохранился): настоящий значок не
  // проступает до флаша наблюдателя (внешний аудит 21.10.2026, раздел E).
  const text =
    `html[${FAKE_SHIELD_ATTR}] ${SITE.anyRole}:not([data-original-role]), ` +
    // Текст «Игрок является …» (on_reveal_role) — то же знание, что значок.
    `html[${FAKE_SHIELD_ATTR}] ${SITE.roleRevealNotice} ` +
    `{ visibility: hidden !important; }` +
    // Подсказка роли по наведению: Vue мог вернуть настоящую подпись до
    // флаша наблюдателя (внешний аудит №2, §4 п.2) — под подменой подсказок
    // ролей нет вовсе.
    ` html[${FAKE_SHIELD_ATTR}] ${SITE.anyRole} ${SITE.siteTooltipText} { visibility: hidden !important; }` +
    (icon
      ? ` html[${FAKE_SHIELD_ATTR}] ${SITE.anyRole}[data-original-role] use:not([href$="#${icon}"]) ` +
        `{ visibility: hidden !important; }`
      : "");
  if (style.textContent !== text) style.textContent = text;
  if (!root.hasAttribute(FAKE_SHIELD_ATTR)) root.setAttribute(FAKE_SHIELD_ATTR, "");
}

/**
 * Следы подмены от прежней копии скрипта (обновление расширения посреди
 * игры; внешний аудит 21.10.2026, раздел E): у свежей копии пустые снимки, и
 * E не возвращал ни чужие роли, ни настоящий значок.
 */
function sweepOrphanFake(spriteBase: () => string): void {
  document.documentElement.removeAttribute(FAKE_SHIELD_ATTR);
  document.querySelectorAll<HTMLElement>(`[${FAKE_HIDDEN_ATTR}]`).forEach((el) => {
    el.style.removeProperty("visibility");
    el.removeAttribute(FAKE_HIDDEN_ATTR);
  });
  document.querySelectorAll<HTMLElement>("[data-original-role]").forEach((el) => {
    const use = el.querySelector("use");
    const base = el.getAttribute("data-original-sprite-base") || spriteBase();
    const href = `${base}#${el.getAttribute("data-original-role")}`;
    use?.setAttribute("href", href);
    use?.setAttribute("xlink:href", href);
    const tip = el.querySelector(SITE.siteTooltipText);
    if (tip && el.hasAttribute("data-original-role-name")) {
      tip.textContent = `Ваша роль - ${el.getAttribute("data-original-role-name")}`;
    }
    el.removeAttribute("data-original-role");
    el.removeAttribute("data-original-role-name");
    el.removeAttribute("data-original-sprite-base");
  });
}

class RoleFaker {
  private readonly roles: RoleDef[] = [
    { name: "undefined", icon: "player" },
    { name: "Дон", icon: "godfather" },
    { name: "Мафия", icon: "mafia" },
    { name: "Шериф", icon: "sheriff" },
    { name: "Мирный", icon: "civilian" },
  ];
  private currentRoleIndex = 0;
  private isFaked = false;

  get faked(): boolean {
    return this.isFaked;
  }
  private originalRoles = new Map<HTMLElement, { visibility: string; visibilityPriority: string }>();
  private originalStyles = new Map<HTMLElement, { right: string; position: string }>();
  private spriteBase?: string;

  private offDom: (() => void) | null = null;
  private dBlocker: ((e: KeyboardEvent) => void) | null = null;
  /** Клавиша скрытия роли (блокируется во время подмены). Настраивается. */
  hideKeyCode = "KeyD";

  onFakeKey = () => {
    // Своей роли может не быть вовсе (зритель, судья, роль ещё не
    // смонтирована). Раньше в этом случае подмена не происходила, но чужие
    // роли всё равно скрывались и D блокировался — поле оставалось пустым
    // до E (аудит устойчивости 01.08.2026, находка 9).
    if (!this.changeRole()) {
      // Явное действие человека, которое ничего не сделало: он нажал F и
      // ждёт результата. Раньше обе причины были только в debug, то есть в
      // файл не попадали вовсе, а на экране не было ничего (аудит
      // наблюдаемости 02.08.2026, RF-1).
      log.info("role-faker", "подмена роли не выполнена: своей роли на экране нет");
      showToast("Подмена роли не сработала: своей роли на экране нет", {
        key: "role-faker-no-role",
        kind: "warn",
      });
      return;
    }
    this.hideOtherRoles();
    this.fixMenuPositions();
    this.setFaked(true);
  };

  onResetKey = () => {
    this.resetRoles();
  };

  private setFaked(v: boolean) {
    this.isFaked = v;
    if (v) this.attachDBlocker();
    else this.detachDBlocker();
    setFakeShield(v, this.roles[this.currentRoleIndex]?.icon);
  }

  /** Блокировка D/В пока подмена активна — отдельный capture-листенер (D занят auto-start). */
  private attachDBlocker() {
    if (this.dBlocker) return;
    this.dBlocker = (e: KeyboardEvent) => {
      if (!this.isFaked) return;
      if (!shouldSwallowRoleKey(e, this.hideKeyCode)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", this.dBlocker, true);
  }
  private detachDBlocker() {
    if (this.dBlocker) window.removeEventListener("keydown", this.dBlocker, true);
    this.dBlocker = null;
  }

  spriteBaseForSweep(): string {
    return this.resolveSpriteBase();
  }

  private resolveSpriteBase(): string {
    if (this.spriteBase !== undefined) return this.spriteBase;
    const useEls = document.querySelectorAll(SITE.roleUse);
    const markers = ["#civilian", "#sheriff", "#mafia", "#godfather"];
    if (document.querySelector(SITE.roleSymbols)) return (this.spriteBase = "");
    for (const el of useEls) {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href");
      if (!href) continue;
      if (markers.includes(href)) return (this.spriteBase = "");
      if (!href.includes("/bundle/") || !href.includes(".svg")) continue;
      if (!markers.some((m) => href.includes(m))) continue;
      const base = href.split("#")[0];
      if (base) return (this.spriteBase = base);
    }
    for (const el of useEls) {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href");
      if (!href) continue;
      if (!href.includes("/bundle/") || !href.includes(".svg")) continue;
      const base = href.split("#")[0];
      if (base) return (this.spriteBase = base);
    }
    const prefix = location.pathname.includes("/new-room/") ? "/new-room/bundle/" : "/room/bundle/";
    return (this.spriteBase = `${prefix}f59bacbc2885635c4d91.svg`);
  }

  private fixMenuPositions() {
    document.querySelectorAll<HTMLElement>(SITE.playerMenuWithRole).forEach((menu) => {
      if (menu.closest(SITE.myRoleMark) || menu.closest(SITE.myPlayerTile)) return;
      if (!this.originalStyles.has(menu)) {
        this.originalStyles.set(menu, { right: menu.style.right, position: menu.style.position });
      }
      menu.style.right = "0.5rem";
    });
  }

  private resetMenuPositions() {
    this.originalStyles.forEach((s, menu) => {
      menu.style.right = s.right;
      menu.style.position = s.position;
    });
    this.originalStyles.clear();
  }

  /**
   * Прятать — visibility, НЕ display (21.10.2026): display — флаг сайта
   * (roleDisplay → v-show). Наш display:none Vue перезаписывал на первой же
   * смене флага (D, пункт меню) — сокомандники проступали посреди подмены,
   * и состав уезжал в эфир; а возврат снимка затирал актуальный флаг сайта.
   */
  private hideOtherRoles() {
    document.querySelectorAll<HTMLElement>(SITE.anyRole).forEach((el) => {
      if (el.closest(SITE.myRoleMark) || el.closest(SITE.myPlayerTile)) return;
      if (!this.originalRoles.has(el)) {
        this.originalRoles.set(el, {
          visibility: el.style.visibility,
          visibilityPriority: el.style.getPropertyPriority("visibility"),
        });
      }
      el.style.setProperty("visibility", "hidden", "important");
      el.setAttribute(FAKE_HIDDEN_ATTR, "");
    });
    if (!this.offDom) {
      // Пишем только при реальном расхождении: общий наблюдатель следит за
      // атрибутом style, и безусловная запись превращалась в пинг-понг
      // «сайт перерисовал → мы переписали → мутация → мы снова».
      this.offDom = onDomChange(() => {
        if (!this.isFaked) return;
        document.querySelectorAll<HTMLElement>(SITE.anyRole).forEach((el) => {
          if (el.closest(SITE.myRoleMark) || el.closest(SITE.myPlayerTile)) return;
          if (el.style.visibility !== "hidden") {
            // Снимок ДО скрытия: узел, созданный Vue во время подмены,
            // прятался без регистрации — E/disable возвращали только старые,
            // и напарник оставался скрыт до перерисовки сайта (аудит
            // 29.08.2026, №8).
            if (!this.originalRoles.has(el)) {
              this.originalRoles.set(el, {
                visibility: el.style.visibility,
                visibilityPriority: el.style.getPropertyPriority("visibility"),
              });
            }
            el.style.setProperty("visibility", "hidden", "important");
            el.setAttribute(FAKE_HIDDEN_ATTR, "");
          }
        });
        // №3: Vue пересоздал узел СВОЕЙ роли — data-original-* умерли вместе
        // с ним, новый узел показывает настоящую роль при живом isFaked и
        // заблокированном D. Перенакладываем ту же фальшивую роль (без
        // сдвига по кругу). ПЕРЕИСПОЛЬЗОВАННЫЙ узел — отдельно (F-1): Vue
        // патчит href, не трогая data-*, маркер выживает — дрейф ловим
        // сравнением href с текущей фальшивкой.
        const own = document.querySelector<HTMLElement>(SITE.myRole);
        if (own) {
          if (!own.hasAttribute("data-original-role")) this.reapplyFake();
          else this.ensureFakePainted(own);
        }
        // Меню, появившиеся во время подмены, — через тот же снимок, иначе
        // E их не возвращал (внешний аудит 21.10.2026).
        if (
          Array.from(document.querySelectorAll<HTMLElement>(SITE.playerMenuWithRole)).some(
            (m) => !m.closest(SITE.myRoleMark) && !m.closest(SITE.myPlayerTile) && m.style.right !== "0.5rem",
          )
        ) {
          this.fixMenuPositions();
        }
      });
    }
  }

  private resetRoles() {
    this.originalRoles.forEach((s, el) => {
      el.style.removeProperty("visibility");
      if (s.visibility) el.style.setProperty("visibility", s.visibility, s.visibilityPriority);
      el.removeAttribute(FAKE_HIDDEN_ATTR);
    });
    this.originalRoles.clear();
    this.resetMenuPositions();
    if (this.offDom) {
      this.offDom();
      this.offDom = null;
    }
    const myRole = document.querySelector<HTMLElement>(SITE.myRole);
    if (myRole) {
      const use = myRole.querySelector("use");
      if (use && myRole.hasAttribute("data-original-role")) {
        const role = myRole.getAttribute("data-original-role");
        const base = myRole.getAttribute("data-original-sprite-base") || this.resolveSpriteBase();
        const href = `${base}#${role}`;
        use.setAttribute("href", href);
        use.setAttribute("xlink:href", href);
        if (use.hasAttributeNS("http://www.w3.org/1999/xlink", "href")) {
          use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
        }
      }
      const tip = myRole.querySelector(SITE.siteTooltipText);
      if (tip && myRole.hasAttribute("data-original-role-name")) {
        tip.textContent = `Ваша роль - ${myRole.getAttribute("data-original-role-name")}`;
      }
      // Снимок «настоящей роли» живёт только до E: сайт может сменить роль в
      // том же узле, и следующий F→E вернул бы прежнюю (внешний аудит).
      myRole.removeAttribute("data-original-role");
      myRole.removeAttribute("data-original-role-name");
      myRole.removeAttribute("data-original-sprite-base");
    }
    this.setFaked(false);
  }

  /**
   * Дрейф переиспользованного узла (F-1): сайт переписал href (цикл
   * «скрыть/показать роли» в его меню), настоящая роль проступила при живой
   * подмене. Перекрашиваем обратно — кроме нативного «#stop»: скрытие,
   * выбранное игроком, фальшивка не имеет права перебивать (спрятанная роль
   * в эфир не утекает). Записи идемпотентны: пишем только при расхождении.
   */
  private ensureFakePainted(el: HTMLElement): void {
    const use = el.querySelector("use");
    if (!use) return;
    const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
    if (href.includes("#stop")) return;
    const role = this.roles[this.currentRoleIndex];
    // Сайт поставил НАСТОЯЩУЮ роль (в том числе новую — смена роли в том же
    // узле): её и вернёт E, а не снимок прежней (внешний аудит №2, §4 п.2).
    // RoomIcon сайта патчит xlink:href — наш href при этом остаётся фальшивым
    // (браузер рисует href), поэтому смотрим оба.
    const xlink =
      use.getAttributeNS("http://www.w3.org/1999/xlink", "href") || use.getAttribute("xlink:href") || "";
    const realHref = !href.endsWith(`#${role.icon}`) ? href : !xlink.endsWith(`#${role.icon}`) ? xlink : "";
    if (realHref && !realHref.includes("#stop")) {
      const real = realHref.split("#")[1];
      if (real && real !== el.getAttribute("data-original-role")) {
        el.setAttribute("data-original-role", real);
        const tipNow = el.querySelector(SITE.siteTooltipText)?.textContent ?? "";
        if (tipNow && tipNow !== `Ваша роль - ${role.name}`) {
          el.setAttribute("data-original-role-name", tipNow.replace("Ваша роль - ", ""));
        }
      }
    }
    if (!href.endsWith(`#${role.icon}`) || !xlink.endsWith(`#${role.icon}`)) {
      const base = el.getAttribute("data-original-sprite-base") || this.resolveSpriteBase();
      const fake = `${base}#${role.icon}`;
      use.setAttribute("href", fake);
      use.setAttribute("xlink:href", fake);
      // И пространственный атрибут сайта — иначе перекраска шла бы на каждом
      // флаше (он так и оставался бы настоящим).
      if (use.hasAttributeNS("http://www.w3.org/1999/xlink", "href")) {
        use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", fake);
      }
    }
    // Подпись сверяем ВСЕГДА: сайт мог вернуть настоящую при фальшивом
    // значке — и она всплывала по наведению (внешний аудит 21.10.2026).
    const tip = el.querySelector(SITE.siteTooltipText);
    const text = `Ваша роль - ${role.name}`;
    if (tip && tip.textContent !== text) tip.textContent = text;
  }

  /** Перенаклад текущей подмены на пересозданный узел (без сдвига по кругу). */
  private reapplyFake(): void {
    this.currentRoleIndex = (this.currentRoleIndex + this.roles.length - 1) % this.roles.length;
    if (!this.changeRole()) {
      // Узел исчез между проверкой и применением — вернём индекс, следующий
      // проход попробует снова.
      this.currentRoleIndex = (this.currentRoleIndex + 1) % this.roles.length;
    }
  }

  /** true — своя роль реально подменена. false — подменять было нечего. */
  private changeRole(): boolean {
    const el = document.querySelector<HTMLElement>(SITE.myRole);
    if (!el) {
      log.debug("role-faker", "my role element not found");
      return false;
    }
    // Без <use> подменять нечего: прежний «true» на полусобранной разметке
    // не ставил data-original-role, и reapplyFake крутился на каждом проходе
    // наблюдателя, а безусловная запись тултипа пересоздавала текстовый узел
    // — вечный 4Гц-тик (adversarial 29.08.2026, F-6).
    if (!el.querySelector("use")) {
      log.debug("role-faker", "my role has no <use> — nothing to fake");
      return false;
    }
    // Ниже: контейнер роли есть, но внутри нечего менять (сайт пересобрал
    // разметку). Отдельная причина — и в логе она должна отличаться.
    if (!el.hasAttribute("data-original-role")) {
      const use = el.querySelector("use");
      if (use) {
        const raw = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
        const [base, role] = raw.split("#");
        el.setAttribute("data-original-sprite-base", base || this.resolveSpriteBase());
        el.setAttribute("data-original-role", role || "civilian");
      }
      const tip = el.querySelector(SITE.siteTooltipText);
      if (tip) {
        el.setAttribute("data-original-role-name", (tip.textContent || "").replace("Ваша роль - ", ""));
      }
    }
    this.currentRoleIndex = (this.currentRoleIndex + 1) % this.roles.length;
    const role = this.roles[this.currentRoleIndex];
    const use = el.querySelector("use");
    if (use) {
      const base = el.getAttribute("data-original-sprite-base") || this.resolveSpriteBase();
      const href = `${base}#${role.icon}`;
      use.setAttribute("href", href);
      use.setAttribute("xlink:href", href);
    }
    const tip = el.querySelector(SITE.siteTooltipText);
    const text = `Ваша роль - ${role.name}`;
    if (tip && tip.textContent !== text) tip.textContent = text;
    if (this.isFaked) setFakeShield(true, role.icon);
    return true;
  }

  teardown() {
    if (this.isFaked) this.resetRoles();
    this.detachDBlocker();
    if (this.offDom) {
      this.offDom();
      this.offDom = null;
    }
  }
}

let faker: RoleFaker | null = null;

/**
 * Активна ли подмена роли — для клавиши скрытия auto-start (аудит скрытия
 * ролей 29.08.2026, №4): его роутер срабатывает РАНЬШЕ нашего dBlocker и
 * успевал снять CSS со всех НАСТОЯЩИХ ролей, пока на экране фальшивая.
 */
export function isRoleFaked(): boolean {
  return faker?.faked === true;
}
let offKeys: Array<() => void> = [];
let boundFake = "KeyF";
let boundReset = "KeyE";

function bindKeys(): void {
  offKeys.forEach((off) => off());
  offKeys = [
    keyboard.register(boundFake, () => faker?.onFakeKey()),
    keyboard.register(boundReset, () => faker?.onResetKey()),
  ];
}

export const roleFakerFeature: Feature = {
  id: "role-faker",
  settingKey: "enable_role_faker",
  enable(ctx: FeatureContext) {
    faker = new RoleFaker();
    const fresh = faker;
    sweepOrphanFake(() => fresh.spriteBaseForSweep());
    faker.hideKeyCode = ctx.settings.hotkey_role_hide || "KeyD";
    boundFake = ctx.settings.hotkey_role_fake || "KeyF";
    boundReset = ctx.settings.hotkey_role_reset || "KeyE";
    bindKeys();
  },
  update(ctx: FeatureContext) {
    if (!faker) return;
    faker.hideKeyCode = ctx.settings.hotkey_role_hide || "KeyD";
    const f = ctx.settings.hotkey_role_fake || "KeyF";
    const r = ctx.settings.hotkey_role_reset || "KeyE";
    if (f !== boundFake || r !== boundReset) {
      boundFake = f;
      boundReset = r;
      bindKeys();
    }
  },
  disable() {
    offKeys.forEach((off) => off());
    offKeys = [];
    faker?.teardown();
    faker = null;
  },
};
