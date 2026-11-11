/**
 * Фича: «Завершите речь» с клавиши (просьба владельца 10.11.2026).
 *
 * Кнопка — действие `skip` в центре контролов (UserControls: подпись
 * Loc.speech_player_finish, сверено с room/bundle 10.11.2026). Своей клавиши у
 * сайта нет (у выкрика есть K, у этой — нет).
 *
 * Досрочный конец речи НЕОБРАТИМ, отсюда те же ограничения, что у выкрика:
 *  1. ВЫКЛЮЧЕНО по умолчанию;
 *  2. только в комнате, только когда кнопка видима и не заблокирована — сайт
 *     показывает её лишь в СВОЮ речь; вне её клавиша сайту и браузеру как есть;
 *  3. только ТОЧНАЯ подпись (§4 п.2) и самая глубокая кнопка.
 *
 * Клавишу можно делить с выкриком: в свою речь в том месте контролов
 * «Завершите речь», в чужую — «Выкрикнуть» (controls-keys).
 *
 * Автоповтор и печать в чате гасит роутер клавиш.
 */
import { isVisible, safeClick } from "@core/dom";
import { log } from "@core/log";
import { SITE, TEXT, SITE_CLASS } from "@core/selectors";
import { isGameRoomPath } from "@shared/routes";
import { setControlKey, type ControlAction } from "./controls-keys";
import type { Feature, FeatureContext } from "@core/feature";

const SCOPE = "finish-speech-hotkey";
const DEFAULT_CODE = "KeyS";

const norm = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function disabled(el: Element): boolean {
  return (
    el.classList.contains(SITE_CLASS.disabled) ||
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true"
  );
}

/** Видимая кнопка «Завершите речь»; null — сейчас не твоя речь. Тестовый шов. */
export function findFinishSpeechButton(root: ParentNode = document): HTMLElement | null {
  const center = root.querySelector<HTMLElement>(SITE.controlsCenter);
  if (!center) return null;
  const candidates = Array.from(center.querySelectorAll<HTMLElement>(SITE.controlsButton));
  return (
    candidates.find((button) => {
      if (!TEXT.finishSpeechButton.includes(norm(button.textContent))) return false;
      if (!isVisible(button) || disabled(button)) return false;
      return !candidates.some((other) => other !== button && button.contains(other));
    }) ?? null
  );
}

/** Нажатие клавиши: true — речь завершена кликом. Тестовый шов. */
export function pressFinishSpeech(): boolean {
  if (!isGameRoomPath(location.pathname)) return false;
  const button = findFinishSpeechButton();
  if (!button) return false;
  safeClick(button);
  log.info(SCOPE, "речь завершена по клавише");
  return true;
}

const FINISH_ACTION: ControlAction = {
  available: () => isGameRoomPath(location.pathname) && findFinishSpeechButton() !== null,
  press: pressFinishSpeech,
  // Вне своей речи клавиша — обычная буква для сайта и браузера.
  alwaysSwallow: false,
};

/** Клавиша — у координатора: её можно делить с выкриком (controls-keys). */
export const finishSpeechHotkeyFeature: Feature = {
  id: "finish-speech-hotkey",
  settingKey: "finish_speech_hotkey_enabled",

  enable(ctx: FeatureContext) {
    setControlKey("finish", FINISH_ACTION, ctx.settings.finish_speech_hotkey_code || DEFAULT_CODE);
  },

  update(ctx: FeatureContext) {
    setControlKey("finish", FINISH_ACTION, ctx.settings.finish_speech_hotkey_code || DEFAULT_CODE);
  },

  disable() {
    setControlKey("finish", FINISH_ACTION, null);
  },
};
