/**
 * Один валидатор id игрока для статистики, ключей заметок и резолва.
 * Раньше ключи заметок принимали "007" и небезопасные целые, а статистика
 * и координатор их отвергали: один игрок получал два ключа (ревью апстрима
 * 09.10.2026). Модуль без зависимостей, чтобы его мог взять любой слой.
 */

/** id игрока: положительное safe-целое числом или строкой без ведущих нулей, иначе undefined. */
export function validPlayerId(id: unknown): number | string | undefined {
  if (typeof id === "number") return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  if (typeof id === "string" && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) {
    return id;
  }
  return undefined;
}
