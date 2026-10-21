// @vitest-environment jsdom
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { afterEach, expect, test, vi } from "vitest";
vi.mock("@core/dom", () => ({ onDomChange: () => () => {} }));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@core/toast", () => ({ showToast: vi.fn() }));
import { roleFakerFeature } from "@content/features/role-faker";
afterEach(() => { roleFakerFeature.disable(); document.head.innerHTML = ""; document.body.innerHTML = ""; });
test("AUDIT3 A11: reset restores original peer visibility priority, not just value", () => {
  document.body.innerHTML = `<div class="player my-player"><span class="player__role role my-role"><svg><use href="#sheriff"></use></svg></span></div>
    <div class="player"><span class="player__role role peer"></span></div>`;
  const peer = document.querySelector<HTMLElement>(".peer")!;
  peer.style.setProperty("visibility", "visible", "important");
  roleFakerFeature.enable({ settings: {} } as never);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }));
  expect(peer.style.visibility).toBe("visible");
  expect(peer.style.getPropertyPriority("visibility")).toBe("important");
});
