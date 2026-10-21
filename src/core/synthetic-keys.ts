/**
 * Метка наших синтетических клавиатурных событий (внешний аудит 21.10.2026,
 * B02). Роутер (core/keyboard) и блокировщик подмены видят события на window
 * (capture) раньше сайта — и принимали наш D за нажатие игрока: при «подсмотреть»
 * на клавише D синтетический keyup завершал ФИЗИЧЕСКОЕ удержание, роли
 * оставались открытыми. Метка — в core, чтобы роутер отсеивал их сам.
 */
const own = new WeakSet<Event>();

export function markSynthetic(e: Event): void {
  own.add(e);
}

export function isSynthetic(e: Event | undefined | null): boolean {
  return !!e && own.has(e);
}
