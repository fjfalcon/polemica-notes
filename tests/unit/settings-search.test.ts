// @vitest-environment jsdom
/**
 * Поиск по настройкам попапа (16.11.2026). Гоняется на НАСТОЯЩЕЙ разметке
 * popup.html: поиск обязан находить каждую строку меню, а не выдуманную.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTEXT_CLASS,
  EMPTY_PANEL_CLASS,
  HIT_CLASS,
  OWNER_CLASS,
  SEARCHING_CLASS,
  TITLE_CLASS,
  applySearch,
  buildIndex,
  installSettingsSearch,
  normalize,
  unitLabel,
} from "../../src/popup/settings-search";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = fs.readFileSync(path.join(ROOT, "src/static/popup.html"), "utf8");
const body = /<body>([\s\S]*)<script/.exec(html)![1];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const rowOf = (id: string) => $(id).closest<HTMLElement>(".row, .field")!;
const hits = () => Array.from(document.querySelectorAll<HTMLElement>(`.${HIT_CLASS}`));
const type = (text: string) => {
  const input = $<HTMLInputElement>("settings_search");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  document.body.className = "";
  document.body.innerHTML = body;
});

describe("разбор текста", () => {
  test("регистр, ё, кавычки и тире не мешают", () => {
    expect(normalize("  Кнопка «Ещё» — ↻ F5 ")).toBe("кнопка еще f5");
  });
  test("подпись строки — без подсказки", () => {
    expect(unitLabel(rowOf("queue_counts_refresh_enabled"))).toBe("Кнопка «↻ Обновить» счётчиков");
    expect(unitLabel(rowOf("obs_host"))).toBe("WebSocket адрес");
  });
});

describe("поиск по настоящему меню", () => {
  test("каждая строка меню находится по собственной подписи", () => {
    const units = buildIndex(document);
    expect(units.length).toBeGreaterThan(100);
    const lost: string[] = [];
    for (const u of units) {
      const label = unitLabel(u.el);
      if (!label) continue;
      applySearch(document, units, label);
      if (!u.el.classList.contains(HIT_CLASS)) lost.push(label);
    }
    expect(lost).toEqual([]);
  });

  test("запрос собирает строки с разных вкладок, остальные не помечены", () => {
    const units = buildIndex(document);
    const shown = applySearch(document, units, "камер");
    const panels = new Set(hits().map((el) => el.closest<HTMLElement>(".panel")!.dataset.panel));
    expect(panels.has("game") && panels.has("icons")).toBe(true);
    expect(rowOf("camera_reload_enabled").classList.contains(HIT_CLASS)).toBe(true);
    expect(rowOf("auto_accept_enabled").classList.contains(HIT_CLASS)).toBe(false);
    expect(shown).toBe(hits().length);
    expect(document.body.classList.contains(SEARCHING_CLASS)).toBe(true);
    // Вкладка без находок прячется целиком, «Тильт» в поиске не участвует.
    expect(document.querySelector('.panel[data-panel="roles"]')!.classList.contains(EMPTY_PANEL_CLASS)).toBe(true);
    expect(units.some((u) => u.panel.dataset.panel === "tilt")).toBe(false);
  });

  test("все слова запроса должны встретиться; порядок не важен", () => {
    const units = buildIndex(document);
    applySearch(document, units, "очереди кнопка");
    expect(rowOf("room_queue_counts_enabled").classList.contains(HIT_CLASS)).toBe(true);
    expect(rowOf("queue_background_warning_enabled").classList.contains(HIT_CLASS)).toBe(false);
  });

  test("подопция находится по подписи родителя, клавиши — по слову «хоткей», синонимы — по data-kw", () => {
    const units = buildIndex(document);
    applySearch(document, units, "действия по цифрам");
    expect(rowOf("player_action_numpad").classList.contains(HIT_CLASS)).toBe(true);
    applySearch(document, units, "хоткей");
    expect(rowOf("pause_hotkey_capture").classList.contains(HIT_CLASS)).toBe(true);
    expect(rowOf("hotkey_role_peek").classList.contains(HIT_CLASS)).toBe(true);
    applySearch(document, units, "ммр");
    expect(rowOf("hide_rating").classList.contains(HIT_CLASS)).toBe(true);
    applySearch(document, units, "обс");
    expect(rowOf("obs_enabled").classList.contains(HIT_CLASS)).toBe(true);
  });

  test("найденная подопция приводит родителя: «Клавиша» без него непонятна", () => {
    const units = buildIndex(document);
    const shown = applySearch(document, units, "нумпад");
    expect(rowOf("player_action_numpad").classList.contains(HIT_CLASS)).toBe(true);
    const parent = rowOf("player_action_keys_enabled");
    expect(parent.classList.contains(CONTEXT_CLASS)).toBe(true);
    expect(parent.classList.contains(HIT_CLASS)).toBe(false);
    expect(shown).toBe(2);
    // Родитель сам подошёл под запрос — отдельной пометки контекста не надо.
    applySearch(document, units, "быстрая пауза");
    expect(rowOf("pause_hotkey_capture").classList.contains(HIT_CLASS)).toBe(true);
    expect(rowOf("pause_hotkey_enabled").classList.contains(HIT_CLASS)).toBe(true);
    expect(rowOf("pause_hotkey_enabled").classList.contains(CONTEXT_CLASS)).toBe(false);
    applySearch(document, units, "");
    expect(document.querySelectorAll(`.${CONTEXT_CLASS}`)).toHaveLength(0);
  });

  test("находка в скрытом блоке показывает строку, которая его включает", () => {
    const units = buildIndex(document);
    // OBS выключен: блок настроек скрыт инлайновым display:none.
    expect($("obs_settings").style.display).toBe("none");
    const shown = applySearch(document, units, "ночная сцена");
    expect(rowOf("obs_night_scene").classList.contains(HIT_CLASS)).toBe(true);
    const owner = rowOf("obs_enabled");
    expect(owner.classList.contains(OWNER_CLASS)).toBe(true);
    expect(shown, "считаются только видимые: хозяин блока").toBe(1);
    // OBS включён, авто-сцены нет — хозяин теперь тумблер авто-сцен.
    $("obs_settings").style.display = "";
    applySearch(document, units, "ночная сцена");
    expect(owner.classList.contains(OWNER_CLASS)).toBe(false);
    expect(rowOf("obs_auto_mode_enabled").classList.contains(OWNER_CLASS)).toBe(true);
    // Блок раскрыт — находка видна сама, хозяин не нужен.
    $("obs_auto_settings").style.display = "";
    expect(applySearch(document, units, "ночная сцена")).toBe(1);
    expect(document.querySelectorAll(`.${OWNER_CLASS}`)).toHaveLength(0);
  });

  test("служебная строка «Скачана версия» в поиск не попадает", () => {
    const units = buildIndex(document);
    expect(units.some((u) => u.el.id === "store_update_ready_row")).toBe(false);
  });

  test("пустой запрос снимает всё; инлайновые стили строк поиск не трогает", () => {
    const units = buildIndex(document);
    const before = Array.from(document.querySelectorAll<HTMLElement>("[style]"), (el) => el.getAttribute("style"));
    applySearch(document, units, "роль");
    expect(applySearch(document, units, "   ")).toBe(0);
    expect(document.body.classList.contains(SEARCHING_CLASS)).toBe(false);
    expect(
      document.querySelectorAll(`.${HIT_CLASS}, .${OWNER_CLASS}, .${CONTEXT_CLASS}, .${EMPTY_PANEL_CLASS}`),
    ).toHaveLength(0);
    expect(Array.from(document.querySelectorAll<HTMLElement>("[style]"), (el) => el.getAttribute("style"))).toEqual(before);
  });
});

describe("подключение к попапу", () => {
  test("ввод ищет, «ничего не нашлось» честное, Esc и clear() возвращают вкладки", () => {
    const activateTab = vi.fn();
    const handle = installSettingsSearch(document, { activateTab });
    const empty = $("settings_search_empty");
    type("очередь");
    expect(hits().length).toBeGreaterThan(2);
    expect(empty.hidden).toBe(true);
    type("абракадабра");
    expect(hits()).toHaveLength(0);
    expect(empty.hidden).toBe(false);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    $("settings_search").dispatchEvent(esc);
    expect(esc.defaultPrevented, "Esc с текстом чистит поиск, а не закрывает попап").toBe(true);
    expect($<HTMLInputElement>("settings_search").value).toBe("");
    expect(document.body.classList.contains(SEARCHING_CLASS)).toBe(false);
    expect(empty.hidden).toBe(true);
    // Пустая строка: Esc не перехватываем — попап закрывается как обычно.
    const esc2 = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    $("settings_search").dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(false);
    type("роль");
    handle.clear();
    expect(document.body.classList.contains(SEARCHING_CLASS)).toBe(false);
  });

  test("заголовок вкладки в результатах: подпись с вкладки, клик открывает её и чистит поиск", () => {
    const activateTab = vi.fn();
    installSettingsSearch(document, { activateTab });
    installSettingsSearch(document, { activateTab }); // повтор заголовков не плодит
    const titles = Array.from(document.querySelectorAll<HTMLElement>(`.${TITLE_CLASS}`));
    expect(titles).toHaveLength(document.querySelectorAll(".tab").length);
    const lobby = document.querySelector<HTMLElement>(`.panel[data-panel="lobby"] > .${TITLE_CLASS}`)!;
    expect(lobby.textContent).toBe("Лобби");
    expect(document.querySelector(`.panel[data-panel="tilt"] > .${TITLE_CLASS}`)).toBeNull();
    type("очередь");
    lobby.click();
    expect(activateTab).toHaveBeenCalledWith("lobby");
    expect($<HTMLInputElement>("settings_search").value).toBe("");
  });
});
