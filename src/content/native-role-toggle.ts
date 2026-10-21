/**
 * Синтетический D сайту — единственный способ переключить его флаг
 * `roleDisplay` (v-show на каждой роли; инвариант №13 в AGENTS.md).
 *
 * Хоткеи сайта — hotkeys-js на document: сочетание срабатывает, только если
 * множество зажатых клавиш совпадает с ним ЦЕЛИКОМ. Поэтому шлём две пары:
 * простой D и Ctrl+D — у игрока с опцией профиля «хоткеи с модификатором»
 * сайт слушает только `ctrl+d, command+d`, и простой D для него молчал (все
 * наши показы/возвраты скрытия не работали). Из-за точного совпадения
 * срабатывает ровно одна пара; keyup без ctrlKey снимает Ctrl из зажатых.
 *
 * Свои события помечены: роутер и блокировщик подмены видят их на window
 * (capture) раньше сайта. Раньше их отсеивало окно 250 мс после отправки —
 * и НАСТОЯЩИЙ D игрока в это окно проходил мимо всех гейтов прямо к сайту
 * (adversarial 21.10.2026, №6); блокировщик подмены, наоборот, глотал наш
 * же D, и возврат скрытия после «подсмотреть» срывался (№9).
 */
const own = new WeakSet<Event>();

/** Это наш синтетический D, а не нажатие игрока. */
export function isOwnRoleToggleEvent(e: Event | undefined): boolean {
  return !!e && own.has(e);
}

function send(type: "keydown" | "keyup", ctrlKey: boolean): void {
  const evt = new KeyboardEvent(type, {
    key: "d",
    code: "KeyD",
    keyCode: 68,
    which: 68,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  own.add(evt);
  document.dispatchEvent(evt);
}

export function dispatchNativeRoleToggle(): void {
  send("keydown", false);
  send("keyup", false);
  send("keydown", true);
  send("keyup", false);
}
