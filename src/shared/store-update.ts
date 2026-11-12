/**
 * Флаг «обновление из магазина скачано и ждёт» — общий для фона
 * (background/store-update) и попапа (кнопка «Обновить»).
 * Чистые функции без браузерного API.
 */

export const STORE_UPDATE_READY_KEY = "pn_store_update_ready";
export interface StoreUpdateReady {
  version: string;
  attempted?: boolean;
}

/** a > b для версий вида 9.83.0. */
export function versionNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

export function readyFrom(raw: unknown): StoreUpdateReady | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { version?: unknown }).version;
  if (typeof v !== "string" || !/^\d+(\.\d+){0,3}$/.test(v)) return null;
  return { version: v, attempted: (raw as { attempted?: unknown }).attempted === true };
}
