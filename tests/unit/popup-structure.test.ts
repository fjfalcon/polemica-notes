// @vitest-environment jsdom
/**
 * Целостность меню настроек.
 *
 * Владелец попросил «перешерстить пункт, чтобы в меню всё было чётко»
 * (08.08.2026), и вкладка «Игра» разъехалась на две. Перекладывание строк
 * между вкладками — ровно та правка, при которой настройка тихо теряется:
 * контрол уезжает из HTML, попап продолжает писать дефолт, а пользователь
 * видит, что тумблер «не работает». Эти тесты сверяют ТРИ списка:
 * DEFAULT_SETTINGS, контролы в popup.html и подписку попапа на change.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

// Мок расширенческого окружения: @core/settings тянет polyfill, который в
// чистом jsdom отказывается грузиться («should only be loaded in a browser
// extension»), а нам нужны только ДЕФОЛТЫ настроек.
vi.mock("@core/env", () => ({
  browser: {
    storage: {
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: "test" },
  },
  isStoreInstall: () => false,
}));

import { DEFAULT_SETTINGS } from "@core/settings";
import { PLATE_POSITIONS } from "@shared/nick-plate";
import { CUSTOM_THEME, THEME_COLORS } from "@shared/button-theme";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = fs.readFileSync(path.join(ROOT, "src/static/popup.html"), "utf8");
const popupSource = fs.readFileSync(path.join(ROOT, "src/popup/index.ts"), "utf8");

function doc(): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Настройки, у которых контрола в попапе нет и быть не должно: их значение
 * задаётся не тумблером (внутренние, хоткеи с собственным UI, поля OBS/Twitch
 * с отдельной вёрсткой).
 */
const NO_CONTROL = new Set([
  "obs_host",
  "obs_password",
  "obs_day_scene",
  "obs_night_scene",
  "twitch_channel",
  "pause_hotkey_code",
  "mic_sync_hotkey",
  "hotkey_role_fake",
  "hotkey_role_reset",
  "hotkey_role_hide",
  // Десять кнопок захвата player_action_key_1…10, значение — одной строкой.
  "player_action_keys",
  "note_frame_width",
  "match_stats_view",
  "stats_button_theme",
  "nick_plate_position",
]);

describe("вкладки и панели согласованы", () => {
  test("у каждой вкладки есть своя панель, и наоборот", () => {
    const d = doc();
    const tabs = Array.from(d.querySelectorAll(".tab")).map((el) => el.getAttribute("data-tab"));
    const panels = Array.from(d.querySelectorAll(".panel")).map((el) =>
      el.getAttribute("data-panel"),
    );
    // «Тильт» — панель без вкладки: её открывает красная кнопка в шапке.
    expect(tabs.filter(Boolean).sort()).toEqual(panels.filter((p) => p && p !== "tilt").sort());
    // Перекройка 16.11.2026: «Иконки» стали «Плиткой» (имя data-tab прежнее —
    // по нему у пользователей запомнена вкладка), заметки и ники ушли в
    // «Игроков», «Матч» из двух строк влился в «Стату».
    expect(tabs).toEqual(["game", "lobby", "icons", "players", "stats", "roles", "stream", "misc"]);
    expect(d.querySelector('.tab[data-tab="icons"]')?.textContent).toBe("Плитка");
  });

  test("ровно одна вкладка и одна панель активны при открытии", () => {
    const d = doc();
    expect(d.querySelectorAll(".tab.active")).toHaveLength(1);
    expect(d.querySelectorAll(".panel.active")).toHaveLength(1);
    expect(d.querySelector(".tab.active")?.getAttribute("data-tab")).toBe(
      d.querySelector(".panel.active")?.getAttribute("data-panel"),
    );
  });

  test("id контролов уникальны: дубль после переноса строки читался бы первым", () => {
    const d = doc();
    const ids = Array.from(d.querySelectorAll("[id]")).map((el) => el.id);
    expect(ids.length - new Set(ids).size, `дубли: ${ids.filter((v, i) => ids.indexOf(v) !== i)}`).toBe(0);
  });
});

describe("ни одна настройка не потерялась при перекройке", () => {
  test("у каждой настройки есть контрол в попапе (кроме заведомо безконтрольных)", () => {
    const d = doc();
    const missing = Object.keys(DEFAULT_SETTINGS).filter(
      (key) => !NO_CONTROL.has(key) && !d.getElementById(key),
    );
    expect(missing, `нет контролов: ${missing.join(", ")}`).toEqual([]);
  });

  test("контролы с select-настройками на месте и с нужными вариантами", () => {
    const d = doc();
    for (const id of ["stats_button_theme", "match_stats_view", "note_frame_width"]) {
      expect(d.getElementById(id), `${id} пропал из попапа`).not.toBeNull();
    }
    // Палитра кнопок — общий контракт попапа и content-скрипта: до 9.22.0 они
    // жили порознь и УЖЕ разошлись (в разметке не было половины значений, и
    // выбрать их было нечем).
    const theme = d.getElementById("stats_button_theme") as HTMLSelectElement;
    const themeValues = Array.from(theme.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    for (const key of Object.keys(THEME_COLORS)) {
      expect(themeValues, `тема ${key} есть в палитре, но её нельзя выбрать`).toContain(key);
    }
    expect(themeValues, "«своя тема» — отдельный пункт").toContain(CUSTOM_THEME);
    expect(d.getElementById("stats_button_color"), "выбор своего цвета").not.toBeNull();
    const plate = d.getElementById("nick_plate_position") as HTMLSelectElement | null;
    expect(plate, "селект угла плашки").not.toBeNull();
    const values = Array.from(plate?.querySelectorAll("option") || []).map((o) =>
      o.getAttribute("value"),
    );
    // Список углов — общий контракт попапа и content-скрипта (shared/nick-plate).
    expect(values.sort()).toEqual([...PLATE_POSITIONS].sort());
  });

  test("каждый КОНТРОЛ настройки подписан на сохранение (change)", () => {
    // Баг 08.08.2026: `nick_plate_position` попал в разметку и в чтение, но
    // не в список подписки — селект менялся, значение не сохранялось, и
    // настройка выглядела «не работающей». Прошлая версия теста смотрела
    // только чекбоксы и такую дыру не видела.
    const d = doc();
    const list = /const simpleChangeIds = \[([\s\S]*?)\];/.exec(popupSource)?.[1] || "";
    expect(list, "список simpleChangeIds не найден").not.toBe("");
    const subscribed = new Set([...list.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));

    const controls = Array.from(
      d.querySelectorAll<HTMLElement>('input[type="checkbox"][id], select[id]'),
    )
      .map((el) => el.id)
      .filter((id) => id in DEFAULT_SETTINGS);
    // Контролы с СОБСТВЕННЫМ обработчиком change: они не просто сохраняют
    // (мастер-выключатель гасит интерфейс, OBS/Twitch подключаются и
    // раскрывают свои блоки). Для них проверяем, что обработчик есть.
    const OWN_HANDLER: Record<string, RegExp> = {
      extension_enabled: /\$<HTMLInputElement>\("extension_enabled"\)\?\.addEventListener\("change"/,
      obs_enabled: /obsEnabled\.addEventListener\("change"/,
      obs_floating_panel_enabled: /obsFloatingEnabled\.addEventListener\("change"/,
      obs_auto_mode_enabled: /obsAutoModeEnabled\.addEventListener\("change"/,
      twitch_chat_enabled: /twitchEnabled\.addEventListener\("change"/,
      twitch_floating_panel_enabled: /twitchFloatingEnabled\.addEventListener\("change"/,
      // Селекты сцен: их значения нельзя писать вслепую — пустой список
      // сцен означает «OBS не подключён», и сохранённый выбор надо беречь.
      obs_day_scene: /obsDayScene\.addEventListener\("change"/,
      obs_night_scene: /obsNightScene\.addEventListener\("change"/,
      // Источник микрофона (9.75.0): список приходит из OBS, правда — в
      // knownMicInput, как у сцен.
      mic_sync_input: /micInputSel\.addEventListener\("change"/,
    };
    const missing = controls.filter((id) => {
      if (subscribed.has(id)) return false;
      const own = OWN_HANDLER[id];
      return !own || !own.test(popupSource);
    });
    expect(missing, `контролы без подписки на change: ${missing.join(", ")}`).toEqual([]);
  });

  test("каждый чекбокс попапа упомянут в коде попапа", () => {
    // Контрол, забытый в simpleChangeIds, выглядит рабочим и молча теряет
    // значение при закрытии попапа.
    const d = doc();
    const boxes = Array.from(d.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id]'))
      .map((el) => el.id)
      // Галочки очередей разведки и кнопок плитки обрабатываются пачкой —
      // они присутствуют в списке под своими же id, проверяем их так же.
      .filter((id) => id in DEFAULT_SETTINGS);
    const unsubscribed = boxes.filter((id) => !popupSource.includes(`"${id}"`));
    expect(unsubscribed, `не подписаны: ${unsubscribed.join(", ")}`).toEqual([]);
  });
});

describe("режим «Тильт» отключается целиком", () => {
  test("выключатель режима — во «Ещё» (вкладка «Тильт» при выключенном режиме скрыта)", () => {
    const d = doc();
    expect(d.querySelector('.panel[data-panel="misc"] #tilt_mode_enabled')).not.toBeNull();
    // Девятой вкладке в 360px нет места: «Тильт» открывает только кнопка шапки.
    expect(d.querySelector('.tab[data-tab="tilt"]')).toBeNull();
    expect(d.querySelector('.panel[data-panel="tilt"]')).not.toBeNull();
    // Подопция «кнопка на сайте» — сразу под режимом во «Ещё» (12.11.2026:
    // во вкладке «Тильт» её не находили).
    expect(d.querySelector('.panel[data-panel="misc"] #tilt_button_row #tilt_button_enabled')).not.toBeNull();
    expect(d.querySelector('.panel[data-panel="tilt"] #tilt_button_enabled')).toBeNull();
    expect(d.querySelector(".hdr #tilt_open")).not.toBeNull();
  });

  test("попап прячет кнопку и вкладку по режиму и уводит с открытой вкладки", () => {
    expect(popupSource).toContain("function syncTiltMode()");
    expect(popupSource).toMatch(/if \("tilt_mode_enabled" in patch\) syncTiltMode\(\)/);
    expect(popupSource).toContain('$("tilt_mode_enabled")?.addEventListener("change", syncTiltMode)');
  });
});

describe("раскладка настроек по вкладкам (перекройка 16.11.2026)", () => {
  /** Где что лежит. Перенос строки в другую вкладку — осознанная правка этой таблицы. */
  const PLACES: Record<string, string[]> = {
    lobby: [
      "auto_accept_enabled",
      "requeue_after_lobby_fail_enabled",
      "queue_counts_refresh_enabled",
      "room_queue_counts_enabled",
      "queue_peek_enabled",
      "search_avatars_enabled",
      "search_card_avatar_enabled",
      "own_avatar_source",
    ],
    game: [
      "pause_hotkey_enabled",
      "player_action_keys_enabled",
      "f5_refresh_fix_enabled",
      "ppk_confirm_enabled",
      "safe_controls_layout_enabled",
      "disable_webcam_clicks",
      "camera_reload_enabled",
      "stream_lost_icon_enabled",
      "camera_rotate_enabled",
      "player_mute_enabled",
      "player_volume_memory_enabled",
      "mic_pin_enabled",
    ],
    icons: [
      "stats_button_theme",
      "btn_stats_enabled",
      "btn_note_enabled",
      "btn_last_games_enabled",
      "btn_crossover_enabled",
      "btn_hide_video_enabled",
      "tile_buttons_collapsed",
      "last_games_count",
      "nick_plate_position",
      "compact_nicknames_enabled",
      "unicorn_hearts_enabled",
    ],
    players: [
      "player_search_input",
      "open_nick_colors",
      "note_indicator_enabled",
      "note_frame_width",
      "nick_colors_enabled",
      "nick_aliases_enabled",
      "show_nickname_lengths",
    ],
    stats: [
      "hide_rating",
      "statistics_enabled",
      "show_mmr",
      "session_stats_enabled",
      "table_summary_enabled",
      "profile_mmr_chart_enabled",
      "profile_photo_enabled",
      "match_page_stats_enabled",
      "match_stats_view",
    ],
    roles: ["enable_role_faker", "auto_hide_roles_enabled", "hotkey_role_peek", "role_marker_enabled"],
    stream: ["obs_enabled", "obs_auto_record_enabled", "obs_clip_enabled", "mic_sync_enabled", "twitch_chat_enabled"],
    misc: ["tilt_mode_enabled", "update_check_enabled", "export_notes", "debug_logging_enabled", "ws_full_log_enabled"],
  };

  test("каждая настройка лежит в своей вкладке", () => {
    const d = doc();
    for (const [panel, ids] of Object.entries(PLACES)) {
      const el = d.querySelector(`.panel[data-panel="${panel}"]`) as HTMLElement;
      expect(el, `панель ${panel}`).not.toBeNull();
      for (const id of ids) {
        expect(el.querySelector(`#${id}`), `${id} должен быть во вкладке ${panel}`).not.toBeNull();
      }
    }
  });

  test("подопция стоит сразу под своей настройкой, а не через чужие строки", () => {
    const d = doc();
    // Родитель → подопции, которые обязаны идти следом (порядок в разметке).
    const FAMILIES: Record<string, string[]> = {
      statistics_enabled: ["show_mmr", "show_games", "show_id", "show_winrate", "show_kills", "show_roles"],
      postgame_requeue_enabled: ["postgame_skip_confirm_enabled"],
      queue_peek_enabled: ["queue_peek_auto", "queue_peek_standard"],
      pause_hotkey_enabled: ["pause_hotkey_capture"],
      safe_controls_layout_enabled: ["ctl_pos_finish", "ctl_pos_outcry", "ctl_pos_guess"],
      nick_aliases_enabled: ["nick_aliases_on_stream", "nick_aliases_hide_condemned_on_stream"],
      role_marker_enabled: ["role_marker_icons_enabled"],
      match_page_stats_enabled: ["match_stats_view"],
      tilt_mode_enabled: ["tilt_button_enabled"],
      outcry_hotkey_enabled: ["outcry_hotkey_code"],
      finish_speech_hotkey_enabled: ["finish_speech_hotkey_code"],
      player_action_keys_enabled: [
        "player_action_nominate",
        "player_action_key_1",
        "player_action_numpad",
        "player_action_guess",
        "guess_key_maf",
      ],
      stats_button_theme: ["stats_button_color_hex"],
      enable_role_faker: ["hotkey_role_fake", "hotkey_role_reset"],
      own_avatar_source: ["own_avatar_pick"],
      obs_clip_enabled: ["obs_clip_minutes", "obs_clip_hotkey_code"],
      twitch_floating_panel_enabled: ["twitch_chat_everywhere"],
    };
    const rowOf = (id: string) => d.getElementById(id)?.closest(".row") as HTMLElement;
    for (const [parentId, kids] of Object.entries(FAMILIES)) {
      let cursor = rowOf(parentId);
      expect(cursor, parentId).not.toBeNull();
      expect(cursor.classList.contains("child"), `${parentId} — не подопция`).toBe(false);
      for (const kid of kids) {
        const row = rowOf(kid);
        expect(row.classList.contains("child"), `${kid} оформлен подопцией`).toBe(true);
        expect(cursor.nextElementSibling, `${kid} идёт сразу за ${cursor.querySelector("[id]")?.id}`).toBe(row);
        cursor = row;
      }
    }
  });

  test("подопции размечены классом, а не тире в подписи; у каждой есть родитель выше", () => {
    const d = doc();
    for (const row of Array.from(d.querySelectorAll<HTMLElement>(".panel .row"))) {
      const label = row.firstElementChild?.textContent?.trim() || "";
      expect(/^[—–└-]/.test(label), `«${label.slice(0, 30)}» — отступ задаёт класс child`).toBe(false);
    }
    for (const kid of Array.from(d.querySelectorAll<HTMLElement>(".panel .row.child"))) {
      const panel = kid.closest(".panel")!;
      const rows = Array.from(panel.querySelectorAll<HTMLElement>(".row"));
      const before = rows.slice(0, rows.indexOf(kid));
      expect(before.some((r) => !r.classList.contains("child")), `у подопции ${kid.querySelector("[id]")?.id} нет родителя`).toBe(true);
    }
  });

  test("каждый id, к которому обращается код попапа, есть в разметке", () => {
    // Кнопки («Экспорт», «Подключиться») — не настройки, и код их ищет через
    // null-safe $(): потерянная при перекладке кнопка молча перестала бы
    // работать, а тесты настроек этого не видят (ревью 16.11.2026).
    const d = doc();
    const dir = path.join(ROOT, "src/popup");
    const sources = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const ids = new Set(
      [...sources.matchAll(/(?:\$(?:<[^>]+>)?|getElementById)\(\s*"([A-Za-z0-9_]+)"\s*\)/g)].map((m) => m[1]),
    );
    expect(ids.size).toBeGreaterThan(80);
    const missing = [...ids].filter((id) => !d.getElementById(id));
    expect(missing, `код ищет, а в popup.html нет: ${missing.join(", ")}`).toEqual([]);
  });

  test("вкладки «Матч» больше нет, а запомненный выбор уводит в «Стату»", () => {
    const d = doc();
    expect(d.querySelector('[data-tab="match"], [data-panel="match"]')).toBeNull();
    expect(popupSource).toContain('name === "match" ? "stats" : name');
  });
});

describe("галочка = решение гейта", () => {
  test("загрузка настроек рисует галочку строго по === true, как FeatureManager", () => {
    // Truthy-мусор в хранилище (строка "true") рисовал галочку при выключенной
    // фиче: попап врал «всё включено», а кнопок на плитках не было (жалоба
    // 25.08.2026). Правило одно на попап и гейт: включено — только boolean true.
    expect(popupSource).toContain("el.checked = val === true");
    expect(popupSource).not.toMatch(/el\.checked = val;/);
  });
});
