/**
 * «Сводка стола» — плавающее окно в игровой комнате (09.10.2026).
 *
 * Игроки за столом: место, ник, MMR, игры и винрейт за красных (мирный +
 * шериф) и за чёрных (мафия + дон). Цвет строки — по MMR (тройка сверху,
 * тройка снизу), сортировка — по месту, «сильные чёрные» или «сильные
 * красные». Арифметика — в @shared/table-summary, сеть — в @core/polemica-api
 * (общий кэш со статистикой на плитках: один игрок — один запрос).
 *
 * Выключено по умолчанию: окно поверх стола — дело вкуса (тот же принцип,
 * что у «Моего вечера»). Ролей окно не показывает — эфиру не опасно.
 */
import { FloatingPanel } from "@core/FloatingPanel";
import { onDomChange } from "@core/dom";
import { log } from "@core/log";
import { SITE } from "@core/selectors";
import { setSettings } from "@core/settings";
import { fetchActiveGames, fetchRoleBreakdown, findRatingPlayer } from "@core/polemica-api";
import { rememberSeenPlayers } from "@core/seen-players";
import { isGameRoomPath } from "@shared/routes";
import {
  SORT_MODES,
  mmrTiers,
  roleTotals,
  sortModeLabel,
  sortRows,
  winratePct,
  type SortMode,
  type SummaryRow,
} from "@shared/table-summary";
import { playerIdFromNumberEl } from "../features/nick-plate";
import type { Feature } from "@core/feature";

const SCOPE = "table-summary";
/** Режим сортировки помнится между играми (вкус пользователя, не состояние). */
const SORT_PREF_KEY = "pn_table_summary_sort";
/** Сколько профилей грузим параллельно: вежливость к сайту. */
const FETCH_CONCURRENCY = 3;

/** Игрок, прочитанный с плитки. */
export interface TablePlayer {
  seat: number;
  nick: string;
}

/**
 * Прочитать стол с плиток. Судья исключён селектором playerDesktop. Место —
 * по классу `player-N` (N — 0-based id), а не по тексту: класс не зависит от
 * локали и сворачивания ников.
 */
export function readTable(): TablePlayer[] {
  const out: TablePlayer[] = [];
  const seen = new Set<number>();
  for (const tile of Array.from(document.querySelectorAll<HTMLElement>(SITE.playerDesktop))) {
    const numberEl = tile.querySelector(SITE.playerNumber);
    const id = numberEl ? playerIdFromNumberEl(numberEl) : null;
    const nick = tile.querySelector(SITE.playerName)?.textContent?.trim() ?? "";
    if (id === null || !nick) continue;
    const seat = Number(id) + 1;
    if (!Number.isInteger(seat) || seen.has(seat)) continue;
    seen.add(seat);
    out.push({ seat, nick });
  }
  return out.sort((a, b) => a.seat - b.seat);
}

/** Подпись состава: меняется — пересобираем сводку. */
export function tableSignature(players: readonly TablePlayer[]): string {
  return players.map((p) => `${p.seat}:${p.nick.toLowerCase()}`).join("|");
}

const TIER_BG: Record<string, string> = {
  top: "rgba(74,222,128,.20)",
  bottom: "rgba(148,163,184,.16)",
  mid: "transparent",
};

class TableSummaryPanel extends FloatingPanel {
  private listEl: HTMLElement | null = null;
  private sortBtn: HTMLButtonElement | null = null;

  constructor() {
    super({
      storageKey: "table-summary",
      title: "Сводка стола",
      width: 340,
      height: 330,
      minWidth: 260,
      minHeight: 160,
      resizable: true,
      className: "pn-table-summary-panel",
    });
  }

  protected renderBody(body: HTMLElement): void {
    this.sortBtn = this.addHeaderButton("№", () => cycleSort(), "");
    this.addHeaderButton("⟳", () => void resolveTable(true), "Обновить статистику стола");
    this.addHeaderButton("×", () => void requestClose(), "Закрыть (выключает окно в настройках)");
    const style = document.createElement("style");
    style.textContent =
      ".pn-table-summary-panel .pn-ts-row{display:grid;grid-template-columns:22px 1fr 46px 62px 62px;" +
      "gap:4px;align-items:center;padding:3px 4px;border-radius:6px;font:12px/1.4 system-ui,sans-serif;color:#fff;}" +
      ".pn-table-summary-panel .pn-ts-head{opacity:.65;font-size:11px;}" +
      ".pn-table-summary-panel .pn-ts-nick{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;text-decoration:none;}" +
      ".pn-table-summary-panel a.pn-ts-nick:hover{text-decoration:underline;}" +
      ".pn-table-summary-panel .pn-ts-num{text-align:right;font-variant-numeric:tabular-nums;}" +
      ".pn-table-summary-panel .pn-ts-dim{opacity:.55;}";
    body.appendChild(style);
    const list = document.createElement("div");
    Object.assign(list.style, { height: "100%", overflowY: "auto", padding: "6px" });
    body.appendChild(list);
    this.listEl = list;
    this.syncSortButton();
  }

  syncSortButton(): void {
    if (!this.sortBtn) return;
    const l = sortModeLabel(sortMode);
    this.sortBtn.textContent = l.short;
    this.sortBtn.title = `${l.title} — клик меняет порядок`;
  }

  render(rows: readonly SummaryRow[]): void {
    const list = this.listEl;
    if (!list) return;
    list.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pn-ts-dim";
      empty.textContent = "За столом пока никого";
      Object.assign(empty.style, { padding: "8px", color: "#fff" });
      list.appendChild(empty);
      return;
    }
    list.appendChild(buildRow(["№", "Ник", "MMR", "Мир", "Маф"], true));
    const tiers = mmrTiers(rows);
    for (const r of sortRows(rows, sortMode)) {
      const row = document.createElement("div");
      row.className = "pn-ts-row";
      row.style.background = TIER_BG[tiers.get(r.seat) ?? "mid"];
      row.appendChild(cell(String(r.seat), "pn-ts-num"));
      row.appendChild(nickCell(r));
      row.appendChild(cell(r.mmr === null ? "—" : String(r.mmr), "pn-ts-num"));
      row.appendChild(sideCell(r, "civ"));
      row.appendChild(sideCell(r, "maf"));
      list.appendChild(row);
    }
  }
}

function cell(text: string, cls = ""): HTMLElement {
  const el = document.createElement("span");
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

function buildRow(labels: string[], head: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = head ? "pn-ts-row pn-ts-head" : "pn-ts-row";
  labels.forEach((l, i) => row.appendChild(cell(l, i === 0 || i >= 2 ? "pn-ts-num" : "")));
  return row;
}

function nickCell(r: SummaryRow): HTMLElement {
  if (!r.id) return cell(r.nick, "pn-ts-nick");
  const a = document.createElement("a");
  a.className = "pn-ts-nick";
  a.textContent = r.nick;
  a.href = `https://polemicagame.com/profile/${encodeURIComponent(r.id)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = "Открыть профиль";
  return a;
}

/** «игры · винрейт» за сторону; «…» — грузится, «—» — данных нет. */
function sideCell(r: SummaryRow, side: "civ" | "maf"): HTMLElement {
  if (r.status === "loading") return cell("…", "pn-ts-num pn-ts-dim");
  const t = r.totals;
  if (!t) return cell("—", "pn-ts-num pn-ts-dim");
  const games = side === "civ" ? t.civGames : t.mafGames;
  const wr = side === "civ" ? winratePct(t.civWins, t.civGames) : winratePct(t.mafWins, t.mafGames);
  const el = cell(wr === null ? "—" : `${wr.toFixed(0)}%`, "pn-ts-num");
  el.title = `${games} игр${wr === null ? "" : `, винрейт ${wr}%`}`;
  if (games < 10) el.classList.add("pn-ts-dim"); // мало игр — цифре верить осторожно
  return el;
}

// ─────────────────────────── состояние фичи ───────────────────────────

let panel: TableSummaryPanel | null = null;
let offDom: (() => void) | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let lastSignature = "";
let rows: SummaryRow[] = [];
let sortMode: SortMode = "seat";
/** Поколение резолва: поздний ответ старого состава не красит новый. */
let generation = 0;
let active = false;

function rerender(): void {
  panel?.render(rows);
}

function cycleSort(): void {
  const i = SORT_MODES.indexOf(sortMode);
  sortMode = SORT_MODES[(i + 1) % SORT_MODES.length];
  panel?.syncSortButton();
  rerender();
  try {
    localStorage.setItem(SORT_PREF_KEY, sortMode);
  } catch {
    /* приватный режим — порядок не запомнится, и только */
  }
}

function loadSortPref(): SortMode {
  try {
    const v = localStorage.getItem(SORT_PREF_KEY);
    if (v && (SORT_MODES as readonly string[]).includes(v)) return v as SortMode;
  } catch {
    /* хранилище страницы недоступно */
  }
  return "seat";
}

async function requestClose(): Promise<void> {
  // Как у «Моего вечера»: × выключает тумблер, FeatureManager вызовет disable().
  await setSettings({ table_summary_enabled: false });
}

/** Пройти по столу: найти id/MMR и статистику каждого. */
async function resolveTable(manual = false): Promise<void> {
  const gen = ++generation;
  const players = readTable();
  rows = players.map((p) => ({
    seat: p.seat,
    nick: p.nick,
    id: null,
    mmr: null,
    totals: null,
    status: "loading" as const,
  }));
  rerender();
  if (players.length === 0) return;
  if (manual) log.info(SCOPE, "сводка стола обновлена вручную");

  // 1) id и MMR — одним запросом идущих игр; кого там нет — из рейтинга.
  const byNick = new Map<string, { id: string; mmr: number | null }>();
  try {
    const games = (await fetchActiveGames()) as Array<{
      players?: Array<{ username?: unknown; id?: unknown; mmr?: unknown }>;
    }>;
    for (const g of games) {
      for (const p of g.players ?? []) {
        if (typeof p?.username !== "string" || p.id === undefined || p.id === null) continue;
        const mmr = Number(p.mmr);
        byNick.set(p.username.toLowerCase(), {
          id: String(p.id),
          mmr: Number.isFinite(mmr) ? mmr : null,
        });
      }
    }
  } catch (e) {
    log.warn(SCOPE, "список идущих игр недоступен — ищем в рейтинге", e);
  }
  if (gen !== generation || !active) return;

  for (const row of rows) {
    let found = byNick.get(row.nick.toLowerCase());
    if (!found) {
      try {
        const rp = await findRatingPlayer(row.nick);
        if (rp && rp.user_id !== undefined && rp.user_id !== null) {
          const mmr = Number(rp.mmr);
          found = { id: String(rp.user_id), mmr: Number.isFinite(mmr) ? mmr : null };
        }
      } catch {
        /* рейтинг недоступен — строка останется без id */
      }
      if (gen !== generation || !active) return;
    }
    if (found) {
      row.id = found.id;
      row.mmr = found.mmr;
    } else {
      row.status = "unavailable";
    }
  }
  rerender();
  rememberSeenPlayers(
    rows.filter((r) => r.id !== null).map((r) => ({ nick: r.nick, id: r.id as string })),
  );

  // 2) разбивка по ролям — по несколько профилей за раз.
  const queue = rows.filter((r) => r.id !== null);
  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift() as SummaryRow;
      try {
        const raw = await fetchRoleBreakdown(row.id as string);
        if (gen !== generation || !active) return;
        row.totals = roleTotals(raw);
        row.status = "ok";
      } catch (e) {
        if (gen !== generation || !active) return;
        row.status = "unavailable";
        log.warn(SCOPE, "статистика игрока не загрузилась", e);
      }
      rerender();
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
}

/**
 * Тик по мутациям: только ЧТЕНИЕ стола и сравнение подписи — запись (показ
 * окна, пересборка) лишь при смене состава. Окно — свой контейнер (его
 * мутации подписчиков не будят), поэтому проход идемпотентен (§4.1).
 */
function tick(): void {
  if (!active) return;
  if (!isGameRoomPath(location.pathname)) {
    if (panel?.isMounted) panel.hide();
    lastSignature = "";
    return;
  }
  const players = readTable();
  const sig = tableSignature(players);
  if (players.length === 0) return; // стол ещё не отрисован — ждём
  if (!panel) panel = new TableSummaryPanel();
  if (!panel.isMounted) panel.mount();
  if (sig === lastSignature) return;
  lastSignature = sig;
  panel.show();
  void resolveTable();
}

export const tableSummaryFeature: Feature = {
  id: "table-summary",
  settingKey: "table_summary_enabled",
  enable() {
    active = true;
    sortMode = loadSortPref();
    lastSignature = "";
    tick();
    offDom = onDomChange(() => {
      if (tickTimer) return;
      tickTimer = setTimeout(() => {
        tickTimer = null;
        tick();
      }, 1000);
    });
    log.info(SCOPE, "enabled");
  },
  disable() {
    active = false;
    generation++;
    offDom?.();
    offDom = null;
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    panel?.unmount();
    panel = null;
    rows = [];
    lastSignature = "";
  },
};
