/**
 * Следы подмены роли (role-faker) в DOM — общее знание подмены и тех, кто
 * обязан их чистить без неё. Отдельный модуль: auto-start зовёт уборку и
 * при выключенной подмене (внешний аудит №5, C04), не завися от самой фичи.
 */
import { SITE } from "@core/selectors";

/** Маркер чужой роли, спрятанной подменой: по нему снимаются следы прежней копии. */
export const FAKE_HIDDEN_ATTR = "data-pn-fake-hidden";
export const FAKE_SHIELD_ATTR = "data-pn-role-faked";

/** Подмена ЭТОЙ копии скрипта включена — её следы не сироты. */
let liveFaker = false;

export function setLiveFaker(on: boolean): void {
  liveFaker = on;
}

/** База спрайта по значку, который сейчас стоит у подменённой роли. */
function currentSpriteBase(): string {
  const use = document.querySelector("[data-original-role] use");
  const href = use?.getAttribute("href") || use?.getAttribute("xlink:href") || "";
  const hash = href.indexOf("#");
  return hash >= 0 ? href.slice(0, hash) : "";
}

/**
 * Следы подмены от прежней копии скрипта (обновление расширения посреди
 * игры; внешний аудит 21.10.2026, раздел E): у свежей копии пустые снимки, и
 * E не возвращал ни чужие роли, ни настоящий значок.
 */
export function sweepOrphanFake(spriteBase: () => string = currentSpriteBase): void {
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

/**
 * Следы прежней копии, когда своя подмена не включена: иначе их чистило
 * только включение подмены, и при выключенной фиче фальшивая роль и скрытые
 * напарники оставались навсегда (внешний аудит №5, C04).
 */
export function sweepOrphanFakeIfIdle(): void {
  if (!liveFaker) sweepOrphanFake();
}
