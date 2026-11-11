/**
 * Кому из игроков за столом ещё нужен резолв id.
 *
 * Отдельной чистой функцией, потому что это ГЕЙТ ЧАСТОТЫ: проход по плиткам
 * идёт раз в две секунды, и без него резолв превратился бы в фоновый поток
 * запросов. Проверить это внутри класса на три тысячи строк нечем.
 */
export function pendingIdLookups(
  usernames: string[],
  ctx: { attempted: Set<string>; isKnown: (username: string) => boolean },
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of usernames) {
    const username = raw.trim();
    if (!username) continue;
    const lower = username.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (ctx.attempted.has(lower)) continue;
    if (ctx.isKnown(username)) continue;
    out.push(username);
  }
  return out;
}
