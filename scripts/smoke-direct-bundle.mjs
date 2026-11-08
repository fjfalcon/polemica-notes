import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
const file = fileURLToPath(new URL("../.dist-js/direct-requeue-page.js", import.meta.url));
const source = await readFile(file, "utf8");
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "https://polemicagame.com/game", runScripts: "outside-only",
});
try {
  dom.window.eval(source);
  if (dom.window.document.documentElement.getAttribute("data-pn-direct-requeue-installed") !== "1")
    throw new Error("Direct-search browser bundle did not install");
  if (dom.window.document.querySelector("iframe")) throw new Error("Bundle created an executable standby document");
  console.log("Browser smoke passed: direct-search bundle boots without Node globals or side effects");
} finally { dom.window.close(); }
