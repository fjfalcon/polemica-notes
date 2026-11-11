import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * connect-src страниц расширения ЗАПИНЕН (09.10.2026): «Поиск игрока» в
 * попапе ходит на сайт напрямую, и адреса сайта добавлены осознанно. Любое
 * новое направление сети из попапа/фона — решение, а не случайная правка.
 */
describe("CSP страниц расширения", () => {
  test("connect-src — ровно согласованный список", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src/manifest/manifest.base.json"), "utf8"),
    ) as { content_security_policy: { extension_pages: string } };
    const csp = manifest.content_security_policy.extension_pages;
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1].trim().split(/\s+/) ?? [];
    expect(connect.sort()).toEqual(
      [
        "'self'",
        "https://api.github.com",
        "https://game.polemicagame.com",
        "https://polemicagame.com",
        "ws://localhost:*",
        "wss://localhost:*",
      ].sort(),
    );
    expect(csp, "скрипты — только свои").toMatch(/script-src 'self';/);
  });
});
