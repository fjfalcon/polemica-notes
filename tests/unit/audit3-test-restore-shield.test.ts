// @vitest-environment jsdom
// Пробы третьего внешнего аудита видимости ролей (docs/audit-role-stream-3-2026-10-21.md),
// перенесены как регрессионные (21.10.2026). Witness-пробы закрытых дефектов и условные — сняты.
import { afterEach, expect, test } from "vitest";
import { pinOwnRole, liftPins, restoreLiftedPins, resetRolePinForTest } from "@content/role-pin";

afterEach(() => {
  resetRolePinForTest();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

test("AUDIT3 C01: restore after peek protects the next newly mounted own role before heal", () => {
  document.body.innerHTML = `<div class="player my-player"><span class="player__role role my-role"></span></div>`;
  const own = document.querySelector<HTMLElement>(".my-role")!;
  pinOwnRole("hidden");
  expect(liftPins()).toBe(true);
  restoreLiftedPins();
  // The old test only checks this existing node: its inline pin masks a missing CSS shield.
  expect(getComputedStyle(own).visibility).toBe("hidden");
  const fresh = document.createElement("span");
  fresh.className = "player__role role my-role";
  own.replaceWith(fresh);
  expect(getComputedStyle(fresh).visibility, "shield is re-armed on release, before any observer/heal").toBe("hidden");
});
