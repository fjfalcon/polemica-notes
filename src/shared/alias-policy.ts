/**
 * Какие свои ники показывать на страницах сайта (22.10.2026).
 *  • "none" — никаких: тумблер «Показывать свои ники» выключен, или идёт
 *    эфир и выключено «Показывать ники во время эфира»;
 *  • "safe" — идёт эфир, свои ники видны, кроме помеченных «Осуждёнка»
 *    (галочка «Не показывать осуждёнку во время эфира»);
 *  • "all" — все.
 * Окно заметки, «Заметки и цвета» и попап показывают всегда — это действие
 * самого пользователя, не страница.
 */
import type { Settings } from "./types";

export type AliasPolicy = "all" | "safe" | "none";

export function aliasPolicy(settings: Partial<Settings> | null | undefined, live: boolean): AliasPolicy {
  if (settings?.nick_aliases_enabled === false) return "none";
  if (!live) return "all";
  if (settings?.nick_aliases_on_stream === false) return "none";
  return settings?.nick_aliases_hide_condemned_on_stream === false ? "all" : "safe";
}
