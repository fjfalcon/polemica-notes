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
  FIRST_PANEL_CLASS,
  HIT_CLASS,
  OWNER_CLASS,
  SEARCHING_CLASS,
  TITLE_CLASS,
  applySearch,
  buildIndex,
  installSettingsSearch,
  matchesWord,
  normalize,
  stem,
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

describe("формы слов", () => {
  test("у слова запроса срезается окончание; латиница и короткие слова — как есть", () => {
    expect(["камера", "камеры", "очередь", "роль", "клавиша", "ники", "заметками"].map(stem)).toEqual([
      "камер",
      "камер",
      "очеред",
      "рол",
      "клавиш",
      "ник",
      "заметк",
    ]);
    expect(["ник", "obs", "f5", "mmr"].map(stem)).toEqual(["ник", "obs", "f5", "mmr"]);
  });
  test("основа ищется в начале слова; длинная — и внутри", () => {
    expect(matchesWord("кнопка обновить камеры", "камера")).toBe(true);
    expect(matchesWord("пароль опционально", "роль"), "«роль» — не «пароль»").toBe(false);
    expect(matchesWord("автозапись игр", "запись"), "составное слово").toBe(true);
    expect(matchesWord("метки ролей у игроков", "роль")).toBe(true);
  });
});

describe("поиск по настоящему меню", () => {
  test("примеры из самой строки поиска и из «ничего не нашлось» находят всё по теме", () => {
    const units = buildIndex(document);
    const found = (q: string) => {
      applySearch(document, units, q);
      return new Set(hits().map((el) => el.querySelector("[id]")?.id));
    };
    const placeholder = $<HTMLInputElement>("settings_search").placeholder;
    const emptyText = $("settings_search_empty").textContent || "";
    const examples = [
      ...placeholder.replace(/^[^:]*:/, "").replace("…", "").split(","),
      ...Array.from(emptyText.matchAll(/«([^»]+)»/g), (m) => m[1]),
    ].map((w) => w.trim());
    expect(examples).toEqual(["камера", "очередь", "клавиша", "роль", "ник", "OBS"]);
    for (const word of examples) expect(found(word).size, `«${word}» что-то находит`).toBeGreaterThan(1);
    // Словарная форма находит то же, что и основа (ревью 16.11.2026).
    expect(found("камера")).toEqual(found("камер"));
    expect(found("камера").has("camera_reload_enabled")).toBe(true);
    expect(found("камера").has("camera_rotate_enabled")).toBe(true);
    expect(found("очередь")).toEqual(found("очеред"));
    expect(found("роль").has("role_marker_enabled")).toBe(true);
    expect(found("роль").has("hotkey_role_peek")).toBe(true);
    expect(found("роль").has("obs_password"), "«Пароль» OBS — не про роли").toBe(false);
    expect(found("запись").has("obs_auto_record_enabled")).toBe(true);
  });

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

  test("самостоятельная строка, скрытая целиком, чужого «хозяина» не получает", () => {
    // Версия из магазина: тумблер уведомлений скрыт. Раньше «хозяином»
    // назначалась строка выше — «Кнопка „У меня тильт“» (ревью 16.11.2026).
    const row = $("update_notify_row");
    row.style.display = "none";
    const units = buildIndex(document);
    applySearch(document, units, "уведомлять о новой версии");
    expect(row.classList.contains(HIT_CLASS)).toBe(true);
    expect(document.querySelectorAll(`.${OWNER_CLASS}`)).toHaveLength(0);
    // А подопция, скрытая вместе с родительской настройкой, хозяина получает.
    $("role_marker_icons_row").style.display = "none";
    applySearch(document, units, "использовать иконки");
    expect(rowOf("role_marker_enabled").classList.contains(OWNER_CLASS)).toBe(true);
  });

  test("первая вкладка с находками помечена — её заголовок без верхнего отступа", () => {
    const units = buildIndex(document);
    applySearch(document, units, "твич");
    const marked = Array.from(document.querySelectorAll<HTMLElement>(`.${FIRST_PANEL_CLASS}`));
    expect(marked.map((p) => p.dataset.panel)).toEqual(["stream"]);
    applySearch(document, units, "");
    expect(document.querySelectorAll(`.${FIRST_PANEL_CLASS}`)).toHaveLength(0);
  });

  test("классы поиска не совпадают с классами «Поиска игрока»", () => {
    expect(html).toContain(".search-hit {"); // строки найденных игроков
    expect([HIT_CLASS, OWNER_CLASS, CONTEXT_CLASS, EMPTY_PANEL_CLASS]).not.toContain("search-hit");
    expect(html).toContain(`.row:not(.${HIT_CLASS})`);
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

describe("контрольное ревью 16.11.2026", () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
  const shownOnPage = (el: Element) => getComputedStyle(el).display !== "none";

  test("«Поиск игрока» работает и внутри результатов: его строки и статус не прячутся и в индекс не идут", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    try {
      installSettingsSearch(document, { activateTab: vi.fn() });
      type("ник");
      const field = rowOf("player_search_input");
      expect(field.classList.contains(HIT_CLASS)).toBe(true);
      // Игрок нажал «Найти»: появились статус и строки найденных.
      $("player_search_status").textContent = "Найдено: 1";
      $("player_search_results").innerHTML =
        '<a class="row search-hit" href="#"><span>Vasya<span class="hint">id 7</span></span><span class="search-mmr">MMR 1500</span></a>';
      const result = document.querySelector<HTMLElement>("#player_search_results .row")!;
      expect(shownOnPage(result), "строка найденного игрока видна").toBe(true);
      expect(shownOnPage($("player_search_status")), "статус поиска виден").toBe(true);
      // Чужие статусы (OBS/Twitch) в результатах по-прежнему скрыты.
      $("obs_settings").style.display = "";
      expect(shownOnPage($("obs_status"))).toBe(false);
      // Строка игрока — не настройка: запрос «mmr» её не помечает.
      type("mmr");
      expect(result.classList.contains(HIT_CLASS)).toBe(false);
      expect(buildIndex(document).some((u) => u.el === result)).toBe(false);
      // Поле не подошло под запрос — уходит вместе со своим содержимым.
      type("обс");
      expect(shownOnPage(field)).toBe(false);
    } finally {
      style.remove();
    }
  });

  test("первое слово подсказки находится: подпись и подсказка не склеиваются", () => {
    const units = buildIndex(document);
    applySearch(document, units, "цвет кнопок");
    expect(rowOf("stats_button_theme").classList.contains(HIT_CLASS)).toBe(true);
    applySearch(document, units, "метки");
    expect(rowOf("unicorn_hearts_enabled").classList.contains(HIT_CLASS)).toBe(true);
  });

  test("«смена ролей» находит «Автосмену»", () => {
    const units = buildIndex(document);
    applySearch(document, units, "смена ролей");
    expect(rowOf("role_phase_auto_switch_enabled").classList.contains(HIT_CLASS)).toBe(true);
    applySearch(document, units, "смена");
    expect(rowOf("role_phase_auto_switch_enabled").classList.contains(HIT_CLASS)).toBe(true);
  });

  test("Esc при открытой модалке длины ников поиск не трогает", () => {
    installSettingsSearch(document, { activateTab: vi.fn() });
    type("очередь");
    $("nicklen_overlay").classList.add("show");
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
    expect($<HTMLInputElement>("settings_search").value).toBe("очередь");
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
    // Фокус ушёл на тумблер в результатах — Esc всё равно чистит поиск.
    type("очередь");
    const esc3 = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    $("queue_peek_enabled").dispatchEvent(esc3);
    expect(esc3.defaultPrevented).toBe(true);
    expect($<HTMLInputElement>("settings_search").value).toBe("");
    type("роль");
    handle.clear();
    expect(document.body.classList.contains(SEARCHING_CLASS)).toBe(false);
  });

  test("индекс свежий: переназначенная клавиша ищется по новой подписи", () => {
    installSettingsSearch(document, { activateTab: vi.fn() });
    $("pause_hotkey_capture").textContent = "F7";
    type("f7");
    expect(rowOf("pause_hotkey_capture").classList.contains(HIT_CLASS)).toBe(true);
    type("f8");
    expect(rowOf("pause_hotkey_capture").classList.contains(HIT_CLASS)).toBe(false);
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
