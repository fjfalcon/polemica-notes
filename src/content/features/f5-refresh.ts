/**
 * Фикс F5. Сайт перехватывает нажатие F5 и открывает настройки игры вместо
 * обновления страницы — это раздражает игроков. Здесь мы ловим чистый F5
 * раньше обработчиков сайта (capture на window) и принудительно перезагружаем
 * страницу.
 *
 * F5 с модификаторами (Ctrl/Shift/Cmd/Alt — жёсткая перезагрузка) НЕ трогаем,
 * чтобы не ломать нативное поведение браузера.
 */
import { log } from "@core/log";
import { keyboard } from "@core/keyboard";
import type { Feature } from "@core/feature";

let handler: ((e: KeyboardEvent) => void) | null = null;

export const f5RefreshFeature: Feature = {
  id: "f5-refresh",
  settingKey: "f5_refresh_fix_enabled",
  enable() {
    handler = (e: KeyboardEvent) => {
      if (e.code !== "F5" && e.key !== "F5") return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // жёсткая перезагрузка — не мешаем
      // F5 назначен нашим хоткеем (например «подсмотреть роли»): клавиша
      // его. stopPropagation роутера соседний listener на том же window не
      // останавливает, а порядок регистрации не гарантирован — без этой
      // проверки удержание F5 перезагружало страницу, и отпускание уже
      // некому было возвращать скрытие (внешний аудит №4, B02).
      if (e.defaultPrevented || keyboard.isBound(e.code || "F5")) return;
      // Блокируем обработчик сайта и делаем обычное обновление.
      e.preventDefault();
      e.stopImmediatePropagation();
      log.info("f5-refresh", "forcing reload");
      location.reload();
    };
    // capture=true на window: срабатываем раньше любых обработчиков сайта.
    window.addEventListener("keydown", handler, true);
  },
  disable() {
    if (handler) window.removeEventListener("keydown", handler, true);
    handler = null;
  },
};
