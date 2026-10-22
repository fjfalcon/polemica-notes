/**
 * Блок «Моя картинка» в попапе: превью сохранённой своей картинки и кнопки
 * «Выбрать…» / «Убрать». Сам выбор файла — на отдельной странице
 * расширения (avatar.html): в Firefox окно выбора файла закрывает попап, и
 * выбранная картинка до него не доходила бы. Источник (сайт/своя) —
 * обычная настройка own_avatar_source, её пишет общий механизм попапа.
 */
import { browser } from "@core/env";
import { setSettings } from "@core/settings";
import { clearOwnAvatar, loadOwnAvatar, onOwnAvatarChanged } from "@core/own-avatar";

function render(preview: HTMLImageElement | null, empty: HTMLElement | null, clearBtn: HTMLElement | null, value: string | null): void {
  if (preview) {
    preview.hidden = !value;
    if (value) preview.src = value;
    else preview.removeAttribute("src");
  }
  if (empty) empty.hidden = !!value;
  // Распорка нужна только рядом с превью — иначе подпись делила строку с ней.
  const spacer = document.getElementById("own_avatar_spacer");
  if (spacer) spacer.hidden = !value;
  if (clearBtn) clearBtn.hidden = !value;
}

export function setupOwnAvatarSection(): void {
  const preview = document.getElementById("own_avatar_preview") as HTMLImageElement | null;
  const empty = document.getElementById("own_avatar_empty");
  const pickBtn = document.getElementById("own_avatar_pick");
  const clearBtn = document.getElementById("own_avatar_clear");
  if (!pickBtn) return;

  void loadOwnAvatar().then((value) => render(preview, empty, clearBtn, value));
  // Попап живёт секунды и закрывается целиком — отписка не нужна.
  onOwnAvatarChanged((value) => render(preview, empty, clearBtn, value));

  pickBtn.addEventListener("click", () => {
    void browser.tabs.create({ url: browser.runtime.getURL("avatar.html") });
    window.close();
  });
  // «Убрать» — как на странице выбора: картинка удаляется, источник
  // возвращается к фото с сайта (иначе список показывал бы «Своя картинка»
  // без картинки — ревью 22.10.2026). Select обновит общая подписка попапа.
  clearBtn?.addEventListener("click", () => {
    void clearOwnAvatar()
      .then(() => setSettings({ own_avatar_source: "site" }))
      .catch(() => undefined);
  });
}
