/**
 * Маршруты сайта — общее знание content-скрипта и background.
 *
 * Правило должно быть ОДНО: иначе фон и страница расходятся во мнении,
 * игровая ли это вкладка.
 */

/** Страница игровой комнаты (POST-переход после on_game_found). */
export function isGameRoomPath(pathname: string): boolean {
  return pathname === "/game" || pathname.startsWith("/game/");
}

/** Страница поиска игры. */
export function isSearchPath(pathname: string): boolean {
  return pathname === "/game-search" || pathname.startsWith("/game-search/");
}

/**
 * Опознавательный ключ игры в документе: путь и `game_id` из query (сайт
 * бывает и на `/game?game_id=…`). Смена ключа — другая игра (внешний аудит
 * №5, C05). Прочие параметры query игру не меняют.
 */
export function gameRouteKey(loc: { pathname: string; search: string }): string {
  const id = new URLSearchParams(loc.search).get("game_id");
  return id ? `${loc.pathname}?game_id=${id}` : loc.pathname;
}
