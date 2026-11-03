/**
 * Фича: подтверждение ППК (просьба владельца 04.11.2026, после его бана за
 * «нелегитимное ППК» в матче 661276: исход уже решило голосование, ППК
 * запущено за мат под фол).
 *
 * Сайт запускает голосование за ППК сразу по клику «ППК» в меню игрока —
 * подтверждение у него только для судьи. Перед запуском и перед голосом «Да»
 * за ППК показываем короткое напоминание.
 *
 * ТЕКСТ — только то, что подтверждается страницей правил (/rules) или
 * причиной бана от модерации; правилом не выдаём то, чего в правилах нет
 * (ревью 04.11.2026: прежний текст называл клятвы техническим фолом, а
 * правила относят клятву ради доказательства роли к дисквалификации).
 * Короткий — потому что окно блокирует страницу комнаты (см. ниже).
 *
 * Почему window.confirm, а не своё окно: он СИНХРОННЫЙ. Клик либо проходит
 * как есть (тот же клик, никаких повторных нажатий за игрока), либо гасится
 * до обработчика сайта. Своё окно потребовало бы повторять клик, а меню
 * игрока закрывается кликом по окну. Цена: пока окно открыто, страница
 * стоит (таймеры, отрисовка, ответы сокета) — поэтому текст короткий.
 *
 * Перехват — на фазе захвата документа: обработчики Vue висят на самих
 * элементах. Только точные подписи RU-локали (инвариант §4.2): в другой
 * локали сайта защита не срабатывает — честно сказано в подсказке попапа.
 */
import { log } from "@core/log";
import { showToast } from "@core/toast";
import { SITE } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import type { Feature } from "@core/feature";

const SCOPE = "ppk-guard";

/** Подписи сайта (RU-локаль комнаты; сторожатся пробами контракта). */
export const PPK_MENU_LABEL = "ППК";
export const PPK_VOTING_TITLE = "Проголосовать за ППК?";
export const VOTE_YES_LABEL = "Да";
/** Пункт есть только в меню судьи — у судьи своё подтверждение сайта. */
export const JUDGE_MENU_MARKER = "Фол игроку";

const REMINDER =
  "• Исход уже решён (решающее голосование или выстрел) — модерация банит за ППК после этого.\n" +
  "• По правилам мат и крик — технический фол; дисквалификация — второй технический фол или особое нарушение (ушёл из-за стола, переписка, подсказки, клятва или пари ради доказательства роли).\n" +
  "• Нарушение, замеченное поздно, — «Отправить репорт» в меню игрока, с доказательствами после игры.";

export const PPK_CONFIRM_TEXT = {
  start: `Запустить ППК — присуждение поражения команде?\n\n${REMINDER}`,
  vote: `Проголосовать «Да» за ППК — присуждение поражения команде?\n\n${REMINDER}`,
};

/**
 * Отказ быстрее этого — не человек: браузер запретил сайту окна (галочка
 * «не разрешать запросы» в Firefox) и confirm сразу отвечает false. Тогда
 * гасить каждый клик значило бы сделать ППК невозможным молча (ревью, M4).
 */
const SUPPRESSED_DIALOG_MS = 50;

const label = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";

/** Что за клик: запуск ППК, голос «Да» за ППК или ничего из этого. Чистая функция. */
export function ppkClickKind(target: EventTarget | null): "start" | "vote" | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest(SITE.playerMenuItem);
  if (item && label(item) === PPK_MENU_LABEL) {
    // Меню судьи: сайт сам спрашивает «ППК для …?», наш текст — про игрока.
    const siblings = Array.from(item.parentElement?.children ?? []);
    if (siblings.some((li) => label(li) === JUDGE_MENU_MARKER)) return null;
    // Недоступный пункт тоже спрашиваем: обработчик сайта висит и на нём,
    // и проверка доступности — не наша (fail-closed, ревью 04.11.2026).
    return "start";
  }
  const button = target.closest(SITE.penaltyVotingButton);
  if (button && label(button) === VOTE_YES_LABEL) {
    const voting = button.closest(SITE.penaltyVoting);
    if (label(voting?.querySelector(SITE.penaltyVotingTitle)) === PPK_VOTING_TITLE) return "vote";
  }
  return null;
}

function onClick(e: MouseEvent): void {
  // Без проверки isTrusted: ни сайт, ни мы «ППК» программно не нажимаем, а
  // чужой автоклик по ППК подтверждения заслуживает тем более.
  if (!isGameRoomPath(location.pathname)) return;
  const kind = ppkClickKind(e.target);
  if (!kind) return;
  const asked = performance.now();
  const ok = window.confirm(PPK_CONFIRM_TEXT[kind]);
  const ms = Math.round(performance.now() - asked);
  if (ok) {
    log.info(SCOPE, `${kind === "start" ? "ППК запущено" : "голос «Да» за ППК"} после подтверждения (${ms} мс)`);
    return;
  }
  if (ms < SUPPRESSED_DIALOG_MS) {
    log.warn(SCOPE, `окно подтверждения подавлено браузером (${ms} мс) — клик пропущен как есть`);
    showToast("Браузер запретил сайту окна подтверждения — клик по ППК прошёл без вопроса", {
      key: "ppk-guard-suppressed",
      kind: "warn",
    });
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  log.info(SCOPE, `${kind === "start" ? "запуск ППК" : "голос «Да» за ППК"} отменён (${ms} мс)`);
}

export const ppkGuardFeature: Feature = {
  id: "ppk-guard",
  settingKey: "ppk_confirm_enabled",
  // Повторный enable безопасен: та же ссылка с тем же флагом захвата не
  // регистрируется дважды.
  enable() {
    document.addEventListener("click", onClick, true);
  },
  disable() {
    document.removeEventListener("click", onClick, true);
  },
};
