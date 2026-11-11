// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const dom = vi.hoisted(() => ({ normal: new Set<() => void>(), immediate: new Set<() => void>(), peeking: false }));
vi.mock("@core/dom", () => ({
  onDomChange: (fn: () => void) => { dom.normal.add(fn); return () => dom.normal.delete(fn); },
  onDomChangeImmediate: (fn: () => void) => { dom.immediate.add(fn); return () => dom.immediate.delete(fn); },
}));
vi.mock("@core/log", () => ({ log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@content/features/auto-start", () => ({ isPeeking: () => dom.peeking }));
vi.mock("@core/FloatingPanel", () => ({ FloatingPanel: class {
  protected root!: HTMLElement;
  constructor(private opts: { className: string }) {}
  protected renderBody(_body: HTMLElement): void {}
  mount() { this.root = document.createElement("div"); this.root.className = this.opts.className; document.body.append(this.root); this.renderBody(this.root); }
  unmount() { this.root.remove(); }
  hide() { this.root.style.display = "none"; }
  addHeaderButton(text: string, click: () => void) { const button = document.createElement("button"); button.textContent = text; button.onclick = click; this.root.append(button); }
} }));
import { rolesPredictorFeature, predictorDiag } from "@content/features/roles-predictor";
import { FAKE_SHIELD_ATTR } from "@content/role-fake-orphans";
import { pinOwnRole, liftPins, resetRolePinForTest } from "@content/role-pin";
import { OWN } from "@core/selectors";
import type { FeatureContext } from "@core/feature";

function mountTable(): HTMLElement {
  document.body.innerHTML = Array.from({ length: 10 }, (_, index) => `<div class="player ${index === 0 ? "my-player" : ""}">
    <span class="player-number">${index + 1}</span><div class="player__info"><span class="info__name">Player ${index + 1}</span></div>
    <div class="player__role role ${index === 0 ? "my-role" : ""}"><svg><use href="/roles.svg#${index === 0 ? "mafia" : "player"}"></use></svg></div></div>`).join("");
  return document.querySelector(".my-role")!;
}
const sensitive = () => document.querySelector<HTMLElement>(".pn-predictor-sensitive")!;
const immediate = () => dom.immediate.forEach(fn => fn());
async function refresh() { dom.normal.forEach(fn => fn()); await vi.advanceTimersByTimeAsync(300); }
async function enable() { await rolesPredictorFeature.enable({ settings: {} } as FeatureContext); }
function blocked() {
  expect(sensitive().hidden).toBe(true);
  expect(sensitive().innerHTML).toBe("");
  const notice = document.querySelector(".pn-predictor-private")!;
  expect(notice.textContent).toContain("Панель скрыта");
  expect(notice.textContent).not.toMatch(/Мафия|Шериф|Дон|%/);
  expect(predictorDiag()).toMatchObject({ privacyBlocked: true, myRole: null, focus: null, table: [] });
}
beforeEach(() => {
  vi.useFakeTimers(); dom.peeking = false; document.head.replaceChildren();
  document.documentElement.removeAttribute(FAKE_SHIELD_ATTR);
  document.documentElement.removeAttribute("data-pn-own-role-hidden");
  resetRolePinForTest(); mountTable();
  // Deliberately positive even under a transparent/hidden ancestor: checking
  // only the role box would reproduce the real privacy leak.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 20, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, toJSON() {} } as DOMRect);
});
afterEach(() => {
  rolesPredictorFeature.disable(); resetRolePinForTest();
  document.body.replaceChildren(); document.head.replaceChildren();
  document.documentElement.removeAttribute(FAKE_SHIELD_ATTR);
  document.documentElement.removeAttribute("data-pn-own-role-hidden");
  vi.useRealTimers();
});
test("visible normal roles retain the existing own-role and sheriff probability view", async () => {
  await enable(); expect(sensitive().hidden).toBe(false);
  expect(sensitive().textContent).toContain("Моя роль: Мафия");
  expect(sensitive().textContent).toContain("шерифа");
  expect(predictorDiag()).toMatchObject({ myRole: "mafia", focus: "sheriff" });
});
test("F immediately shields an already rendered view, then erases role, focus and percentages", async () => {
  await enable(); const own = document.querySelector(".my-role")!;
  own.setAttribute("data-original-role", "mafia"); own.querySelector("use")!.setAttribute("href", "/roles.svg#civilian");
  document.documentElement.setAttribute(FAKE_SHIELD_ATTR, "");
  // CSS is effective before a shared observer callback can run.
  expect(getComputedStyle(sensitive()).display).toBe("none");
  immediate(); blocked(); await refresh(); blocked();
});
test("orphan faker root flag blocks the panel even after its original role node disappears", async () => {
  await enable(); document.querySelector(".my-role")!.remove();
  document.documentElement.setAttribute(FAKE_SHIELD_ATTR, ""); immediate(); blocked();
});
test.each([
  ["native display", (own: HTMLElement) => { own.style.display = "none"; }],
  ["legacy native stop icon", (own: HTMLElement) => { own.querySelector("use")!.setAttribute("href", "/roles.svg#stop"); }],
  ["inline own visibility", (own: HTMLElement) => { own.style.visibility = "hidden"; }],
  ["ancestor opacity", (own: HTMLElement) => { own.parentElement!.style.opacity = "0"; }],
  ["ancestor display", (own: HTMLElement) => { own.parentElement!.style.display = "none"; }],
  ["ancestor visibility even with child override", (own: HTMLElement) => { own.parentElement!.style.visibility = "hidden"; own.style.visibility = "visible"; }],
  ["hidden icon inside visible box", (own: HTMLElement) => { (own.querySelector("use") as SVGElement).style.opacity = "0"; }],
  ["orphan original-role marker", (own: HTMLElement) => { own.setAttribute("data-original-role", "godfather"); }],
])("%s blocks all role-derived output", async (_name, conceal) => {
  await enable(); conceal(document.querySelector<HTMLElement>(".my-role")!); immediate(); blocked();
});
test("auto/manual CSS privacy marker blocks even when an inline visible pin overrides the icon style", async () => {
  await enable(); const style = document.createElement("style"); style.id = OWN.roleHideStyle; document.head.append(style);
  immediate(); blocked();
});
test("hidden OBS pin stays private while lifted by peek", async () => {
  await enable(); pinOwnRole("hidden"); immediate(); blocked();
  expect(liftPins()).toBe(true); expect(document.querySelector<HTMLElement>(".my-role")!.style.visibility).not.toBe("hidden");
  immediate(); blocked(); await refresh(); blocked();
});
test("CSS/inline peek does not reopen the role-derived view even with visible icons", async () => {
  await enable(); dom.peeking = true; immediate(); blocked();
  await refresh(); blocked(); dom.peeking = false; await refresh();
  expect(sensitive().hidden).toBe(false); expect(sensitive().textContent).toContain("Моя роль: Мафия");
});
test("a replaced own role clears the old rendered view before the ordinary refresh", async () => {
  await enable(); const own = document.querySelector(".my-role")!; const replacement = own.cloneNode(true) as HTMLElement;
  replacement.querySelector("use")!.setAttribute("href", "/roles.svg#sheriff"); own.replaceWith(replacement); immediate();
  expect(sensitive().innerHTML).toBe(""); expect(sensitive().hidden).toBe(true);
  await refresh(); expect(sensitive().textContent).toContain("Моя роль: Шериф"); expect(sensitive().textContent).not.toContain("Моя роль: Мафия");
});
test("hidden other-player roles remain unknown and user-closed panel stays closed across privacy changes", async () => {
  const foe = document.querySelectorAll<HTMLElement>(".player")[1]; foe.style.opacity = "0";
  foe.querySelector("use")!.setAttribute("href", "/roles.svg#sheriff"); await enable();
  expect((predictorDiag() as any).table[1].knownRole).toBeNull();
  document.querySelector<HTMLButtonElement>(".pn-roles-predictor button")!.click();
  const own = document.querySelector<HTMLElement>(".my-role")!; own.style.visibility = "hidden"; immediate(); blocked();
  own.style.visibility = ""; await refresh();
  expect(document.querySelector<HTMLElement>(".pn-roles-predictor")!.style.display).toBe("none");
});
test("disable removes both subscriptions and pending refresh without resurrecting the panel", async () => {
  await enable(); dom.normal.forEach(fn => fn()); rolesPredictorFeature.disable();
  expect(dom.normal.size).toBe(0); expect(dom.immediate.size).toBe(0);
  await vi.advanceTimersByTimeAsync(1000); expect(document.querySelector(".pn-roles-predictor")).toBeNull();
});
