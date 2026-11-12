/**
 * Счётчики столов — PAGE-скрипт (мир страницы), ставится лениво кнопкой
 * «Обновить» (features/queue-counts-refresh). Просьба владельца 12.11.2026:
 * игрок открывает поиск посмотреть, сколько людей за столами, «Играть» не
 * жмёт — и числа так и стоят с момента открытия страницы.
 *
 * Как у сайта (bundle/game-search, сверено 12.11.2026): у компонента поиска
 * в data `censorshipModes: [{mode, count, countTarget, participants, available}]`;
 * при открытии метод getSearchState зовёт GET <newGameService.httpUrl>/api/search
 * и раскладывает ответ через censorshipModesUpdate.
 *
 * Метод сайта НЕ зовём: censorshipModesUpdate пишет ещё и `available` и при
 * false снимает выбранные галочки, а анонимный ответ (без куки) у всех столов
 * отдаёт available:false — проверить ответ вошедшего игрока мы не можем.
 * Поэтому сами запрашиваем числа и пишем `count` (Vue перерисует) и, как сам
 * сайт при числовом ответе, `participants = undefined`: массив состава
 * наполняет только поисковый сокет, после выхода из поиска его никто не
 * сбрасывает — вне поиска он заведомо устарел (контрольное ревью 12.11.2026).
 *
 * Не во время поиска и не при собранной игре: там числа ведёт сокет сайта.
 * Команду может подделать сама страница — это ничего ей не даёт: свои
 * счётчики и так в её власти. Имена (censorshipModes/count/newGameService/
 * isSearching) — ключи объектов Vue, минификатор их не трогает.
 */
import { SITE } from "@core/selectors";
import {
  SEARCH_COUNTS_CMD,
  SEARCH_COUNTS_RESULT,
  safeServiceOrigin,
  sanitizeQueueCounts,
} from "@shared/search-counts";

interface Mode {
  mode?: unknown;
  count?: unknown;
  participants?: unknown;
}
export interface SearchProxy {
  censorshipModes?: Mode[];
  newGameService?: { httpUrl?: unknown } | null;
  isSearching?: unknown;
  isFoundGame?: unknown;
  isIniSearch?: unknown;
  getSearchState?: unknown;
  $children?: SearchProxy[];
}

/** Компонент поиска: обход дерева Vue 2 от корня приложения. */
export function findSearch(doc: Document): SearchProxy | null {
  const root = doc.querySelector(SITE.vueRoot) as (Element & { __vue__?: SearchProxy }) | null;
  const queue = root?.__vue__ ? [root.__vue__] : [];
  const seen = new Set<SearchProxy>();
  for (let i = 0; i < queue.length && i < 3000; i++) {
    const item = queue[i];
    if (seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item.censorshipModes) && typeof item.getSearchState === "function") return item;
    if (Array.isArray(item.$children)) queue.push(...item.$children);
  }
  return null;
}

function busy(c: SearchProxy): boolean {
  return c.isSearching === true || c.isFoundGame === true || c.isIniSearch === true;
}

/** Записать числа в столы; вернуть, сколько изменилось. Экспорт — тестовый шов. */
export function applyCounts(c: SearchProxy, counts: Record<string, number>): number {
  let changed = 0;
  for (const m of c.censorshipModes ?? []) {
    if (typeof m.mode !== "string" || !(m.mode in counts)) continue;
    let touched = false;
    if (m.count !== counts[m.mode]) {
      m.count = counts[m.mode];
      touched = true;
    }
    if (m.participants !== undefined) {
      m.participants = undefined;
      touched = true;
    }
    if (touched) changed++;
  }
  return changed;
}

export type RefreshResult = { ok: true; changed: number } | { ok: false; reason: string };

/** Перечитать счётчики. Экспорт — тестовый шов. */
export async function refreshCounts(doc: Document, fetchImpl: typeof fetch = fetch): Promise<RefreshResult> {
  const c = findSearch(doc);
  if (!c) return { ok: false, reason: "no-component" };
  if (busy(c)) return { ok: false, reason: "searching" };
  const origin = safeServiceOrigin(c.newGameService?.httpUrl);
  if (!origin) return { ok: false, reason: "no-service" };
  let res: Response;
  try {
    // Без куки: числа публичные, а личный ответ нам не нужен.
    res = await fetchImpl(`${origin}/api/search`, { method: "GET", credentials: "omit", cache: "no-store" });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!res.ok) return { ok: false, reason: `http-${res.status}` };
  let counts: Record<string, number> | null = null;
  try {
    counts = sanitizeQueueCounts(await res.json());
  } catch {
    /* не JSON */
  }
  if (!counts) return { ok: false, reason: "shape" };
  // Пока шёл запрос, игрок мог нажать «Играть» — тогда числа ведёт сокет.
  if (busy(c)) return { ok: false, reason: "searching" };
  return { ok: true, changed: applyCounts(c, counts) };
}

interface CountsWindow extends Window {
  __pnSearchCountsInstalled?: boolean;
}

(() => {
  const w = window as CountsWindow;
  if (w.__pnSearchCountsInstalled) return;
  w.__pnSearchCountsInstalled = true;

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as { source?: unknown; id?: unknown } | null;
    if (!d || d.source !== SEARCH_COUNTS_CMD || typeof d.id !== "string") return;
    const id = d.id.slice(0, 64);
    void refreshCounts(document)
      .catch((): RefreshResult => ({ ok: false, reason: "error" }))
      .then((r) => {
        try {
          window.postMessage({ source: SEARCH_COUNTS_RESULT, id, ...r }, location.origin);
        } catch {
          /* страница уходит */
        }
      });
  });
})();
